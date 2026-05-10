from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.exam import Exam
from app.models.appointment import Appointment, AppointmentStatus
from app.models.user import User, UserRole
from app.schemas.exam import ExamCreate, ExamOut
from app.auth.jwt import get_current_user
from app.services.scheduling import derive_worst_finding, calculate_next_exam_weeks, next_due_date

router = APIRouter(prefix="/api/exams", tags=["exams"])


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
