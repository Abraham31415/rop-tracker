from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.exam import Exam
from app.models.appointment import Appointment, AppointmentStatus
from app.models.baby import Baby
from app.models.hospital import Hospital
from app.models.user import User, UserRole
from app.schemas.exam import ExamCreate, ExamOut
from app.auth.jwt import get_current_user
from app.services.scheduling import derive_worst_finding, calculate_next_exam_weeks, next_due_date

router = APIRouter(prefix="/api/exams", tags=["exams"])


@router.get("/my-hospitals")
def get_my_hospitals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return hospitals relevant to this ophthalmologist for the enroll form.

    Returns { recent: [...], all: [...] } where 'recent' are hospitals where
    this ophthalmologist has previously recorded exams, and 'all' is every
    active hospital in the system.
    """
    if current_user.role not in (
        UserRole.OPHTHALMOLOGIST, UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    def _h(hospital: Hospital) -> dict:
        return {"id": str(hospital.id), "name": hospital.name, "district": hospital.district}

    # Hospitals where this user has previously examined babies
    examined_baby_ids = (
        db.query(Exam.baby_id)
        .filter(Exam.examiner_id == current_user.id)
        .distinct()
        .subquery()
    )
    recent_hospital_ids = (
        db.query(Baby.hospital_id)
        .filter(Baby.id.in_(examined_baby_ids))
        .distinct()
        .all()
    )
    recent_ids = {r[0] for r in recent_hospital_ids}
    if current_user.hospital_id:
        recent_ids.add(current_user.hospital_id)

    all_hospitals = db.query(Hospital).filter(Hospital.is_active == True).order_by(Hospital.name).all()
    recent = [_h(h) for h in all_hospitals if h.id in recent_ids]
    rest   = [_h(h) for h in all_hospitals if h.id not in recent_ids]

    return {"recent": recent, "all": rest}


@router.post("/", response_model=ExamOut)
def record_exam(
    data: ExamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in (UserRole.OPHTHALMOLOGIST, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Only ophthalmologists can record exams")

    exam = Exam(**data.model_dump(), examiner_id=current_user.id)

    # Derive worst finding and next appointment interval
    worst_zone, worst_stage, has_plus = derive_worst_finding(exam)
    exam.worst_zone = worst_zone
    exam.worst_stage = worst_stage
    exam.has_plus_disease = "yes" if has_plus else "no"
    weeks = calculate_next_exam_weeks(worst_zone, worst_stage, has_plus)
    exam.next_exam_weeks = weeks

    db.add(exam)
    db.flush()

    # Close out any open appointments for this baby (exam was attended)
    open_appts = (
        db.query(Appointment)
        .filter(
            Appointment.baby_id == data.baby_id,
            Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.MISSED]),
        )
        .all()
    )
    for a in open_appts:
        a.status = AppointmentStatus.ATTENDED

    # Auto-create the next appointment
    due = next_due_date(data.exam_date, weeks)
    appointment = Appointment(
        baby_id=data.baby_id,
        exam_id=exam.id,
        due_date=due,
        status=AppointmentStatus.SCHEDULED,
    )
    db.add(appointment)
    db.commit()
    db.refresh(exam)
    return exam


@router.get("/baby/{baby_id}", response_model=list[ExamOut])
def list_exams_for_baby(
    baby_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Exam).filter(Exam.baby_id == baby_id).order_by(Exam.exam_date.desc()).all()


@router.get("/my-hospitals")
def my_hospitals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    For ophthalmologists: returns two sections:
      - recent: hospitals where this ophthalmologist has recorded exams, ordered by most recent exam
      - all: all active hospitals, alphabetically, excluding those already in recent
    """
    all_hospitals = (
        db.query(Hospital)
        .filter(Hospital.is_active == True)
        .order_by(Hospital.name)
        .all()
    )

    if current_user.role != UserRole.OPHTHALMOLOGIST:
        # For other roles just return all hospitals flat
        return {
            "recent": [],
            "all": [{"id": str(h.id), "name": h.name, "district": h.district} for h in all_hospitals],
        }

    # Find hospitals where this ophthalmologist has exams, ordered by most recent
    recent_rows = (
        db.query(Baby.hospital_id, Exam.exam_date)
        .join(Baby, Exam.baby_id == Baby.id)
        .filter(Exam.examiner_id == current_user.id)
        .order_by(Exam.exam_date.desc())
        .all()
    )

    seen_ids: list[UUID] = []
    for row in recent_rows:
        if row.hospital_id not in seen_ids:
            seen_ids.append(row.hospital_id)

    hosp_map = {h.id: h for h in all_hospitals}
    recent = [
        {"id": str(hid), "name": hosp_map[hid].name, "district": hosp_map[hid].district}
        for hid in seen_ids
        if hid in hosp_map
    ]
    remaining = [
        {"id": str(h.id), "name": h.name, "district": h.district}
        for h in all_hospitals
        if h.id not in seen_ids
    ]

    return {"recent": recent, "all": remaining}
