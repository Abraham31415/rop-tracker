from __future__ import annotations
from uuid import UUID
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.exam import Exam
from app.models.appointment import Appointment, AppointmentStatus
from app.models.baby import Baby
from app.models.contact_log import ContactLog, ContactLogType
from app.models.hospital import Hospital
from app.models.user import User, UserRole
from app.schemas.exam import ExamCreate, ExamOut
from app.auth.jwt import get_current_user
from app.services.scheduling import derive_worst_finding, calculate_next_exam_weeks, next_due_date
from app.utils.audit import write_audit

router = APIRouter(prefix="/api/exams", tags=["exams"])


@router.get("/my-hospitals")
def get_my_hospitals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return hospitals relevant to this user for the exam / enroll form.

    Returns { recent: [...], all: [...] } where 'recent' are hospitals where
    this user has previously recorded exams (ordered by most recent exam),
    and 'all' is every other active hospital alphabetically.
    """
    if current_user.role not in (
        UserRole.OPHTHALMOLOGIST, UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    def _h(hospital: Hospital) -> dict:
        return {"id": str(hospital.id), "name": hospital.name, "district": hospital.district}

    all_hospitals = (
        db.query(Hospital)
        .filter(Hospital.is_active == True)
        .order_by(Hospital.name)
        .all()
    )
    hosp_map = {h.id: h for h in all_hospitals}

    # Build ordered list of recently-used hospital IDs (most recent exam first)
    recent_rows = (
        db.query(Baby.hospital_id, Exam.exam_date)
        .join(Baby, Exam.baby_id == Baby.id)
        .filter(Exam.examiner_id == current_user.id)
        .order_by(Exam.exam_date.desc())
        .all()
    )
    seen_ids: list = []
    for row in recent_rows:
        if row.hospital_id not in seen_ids:
            seen_ids.append(row.hospital_id)

    # Also include the user's home hospital at the top of recent if not already there
    if current_user.hospital_id and current_user.hospital_id not in seen_ids:
        seen_ids.insert(0, current_user.hospital_id)

    recent = [_h(hosp_map[hid]) for hid in seen_ids if hid in hosp_map]
    rest   = [_h(h) for h in all_hospitals if h.id not in seen_ids]

    return {"recent": recent, "all": rest}


@router.post("/", response_model=ExamOut)
def record_exam(
    data: ExamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in (UserRole.OPHTHALMOLOGIST, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Only ophthalmologists can record exams")

    override_date = data.next_review_override_date
    override_reason = data.next_review_override_reason
    if override_date is not None and override_date < date.today():
        raise HTTPException(status_code=400, detail="Review date cannot be in the past")

    exam_data = data.model_dump(exclude={"next_review_override_date", "next_review_override_reason"})
    exam = Exam(**exam_data, examiner_id=current_user.id)

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

    # Auto-create the next appointment (or use a manual override date if supplied)
    auto_due = next_due_date(data.exam_date, weeks)
    if override_date is not None:
        appointment = Appointment(
            baby_id=data.baby_id,
            exam_id=exam.id,
            due_date=override_date,
            status=AppointmentStatus.SCHEDULED,
            date_source="manual",
            date_change_reason=override_reason,
            date_changed_at=datetime.now(timezone.utc),
            date_changed_by_id=current_user.id,
        )
        override_note = (
            f"Next review date manually overridden to {override_date.isoformat()} "
            f"(auto-scheduled would have been {auto_due.isoformat()}). "
            f"Reason: {override_reason or '(none given)'}"
        )
        exam.notes = f"{exam.notes}\n{override_note}" if exam.notes else override_note
    else:
        appointment = Appointment(
            baby_id=data.baby_id,
            exam_id=exam.id,
            due_date=auto_due,
            status=AppointmentStatus.SCHEDULED,
        )
    db.add(appointment)
    db.flush()
    write_audit(
        db,
        user_id=current_user.id,
        user_name=current_user.full_name,
        user_role=current_user.role.value,
        action_type="EXAM",
        entity_type="Exam",
        entity_id=str(exam.id),
        details={
            "baby_id": str(data.baby_id),
            "exam_date": str(data.exam_date),
            "worst_zone": str(exam.worst_zone) if exam.worst_zone else None,
            "worst_stage": str(exam.worst_stage) if exam.worst_stage else None,
            "treatment_recommended": exam.treatment_recommended,
        },
    )
    if override_date is not None:
        write_audit(
            db,
            user_id=current_user.id,
            user_name=current_user.full_name,
            user_role=current_user.role.value,
            action_type="RESCHEDULE",
            entity_type="Appointment",
            entity_id=str(appointment.id),
            details={
                "baby_id": str(data.baby_id),
                "old_date": auto_due.isoformat(),
                "new_date": override_date.isoformat(),
                "reason": override_reason,
                "source": "exam_override",
            },
        )
        db.add(ContactLog(
            baby_id=data.baby_id,
            created_by_id=current_user.id,
            log_type=ContactLogType.NOTE,
            message=(
                f"Review date set to {override_date.isoformat()} at exam "
                f"(overriding auto-scheduled {auto_due.isoformat()}) by {current_user.full_name}. "
                f"Reason: {override_reason or '(none given)'}"
            ),
        ))
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


