from __future__ import annotations

from datetime import date, datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.jwt import get_current_user
from app.database import get_db
from app.models.appointment import Appointment, AppointmentStatus
from app.models.baby import Baby, BabyStatus
from app.models.hospital import Hospital
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/appointments", tags=["appointments"])

_CAN_MARK_ATTENDED = {
    UserRole.HOSPITAL_COORDINATOR,
    UserRole.CENTRAL_COORDINATOR,
    UserRole.OPHTHALMOLOGIST,
}

_CAN_RESCHEDULE = {
    UserRole.HOSPITAL_COORDINATOR,
    UserRole.CENTRAL_COORDINATOR,
    UserRole.OPHTHALMOLOGIST,
}


class AppointmentOut(BaseModel):
    id: UUID
    baby_id: UUID
    due_date: str
    status: str
    attended_at: Optional[str]
    missed_at: Optional[str]
    ltfu_at: Optional[str]
    notes: Optional[str]
    created_at: str

    model_config = {"from_attributes": True}


class AppointmentListItem(BaseModel):
    id: UUID
    baby_id: UUID
    due_date: str
    status: str
    attended_at: Optional[str]
    missed_at: Optional[str]
    ltfu_at: Optional[str]
    notes: Optional[str]
    # Baby fields
    baby_name: str
    caregiver_name: str
    mtn_phone: Optional[str]
    airtel_phone: Optional[str]
    # Hospital
    hospital_id: UUID
    hospital_name: Optional[str]


class AttendPayload(BaseModel):
    notes: Optional[str] = None


class ReschedulePayload(BaseModel):
    new_date: date
    notes: Optional[str] = None


def _appt_to_out(appt: Appointment) -> AppointmentOut:
    def _fmt(dt):
        return dt.isoformat() if dt else None

    return AppointmentOut(
        id=appt.id,
        baby_id=appt.baby_id,
        due_date=appt.due_date.isoformat(),
        status=appt.status.value if hasattr(appt.status, "value") else appt.status,
        attended_at=_fmt(appt.attended_at),
        missed_at=_fmt(appt.missed_at),
        ltfu_at=_fmt(appt.ltfu_at),
        notes=appt.notes,
        created_at=_fmt(appt.created_at),
    )


@router.get("/", response_model=List[AppointmentListItem])
def list_all_appointments(
    status: Optional[List[str]] = Query(default=None),
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        db.query(Appointment, Baby, Hospital)
        .join(Baby, Appointment.baby_id == Baby.id)
        .join(Hospital, Baby.hospital_id == Hospital.id)
    )

    if current_user.role != UserRole.CENTRAL_COORDINATOR:
        query = query.filter(Baby.hospital_id == current_user.hospital_id)
    elif hospital_id:
        query = query.filter(Baby.hospital_id == hospital_id)

    if status:
        query = query.filter(Appointment.status.in_(status))
    if from_date:
        query = query.filter(Appointment.due_date >= from_date)
    if to_date:
        query = query.filter(Appointment.due_date <= to_date)

    rows = query.order_by(Appointment.due_date.asc()).limit(limit).all()

    def _fmt(dt):
        return dt.isoformat() if dt else None

    result = []
    for appt, baby, hospital in rows:
        result.append(AppointmentListItem(
            id=appt.id,
            baby_id=appt.baby_id,
            due_date=appt.due_date.isoformat(),
            status=appt.status.value if hasattr(appt.status, "value") else appt.status,
            attended_at=_fmt(appt.attended_at),
            missed_at=_fmt(appt.missed_at),
            ltfu_at=_fmt(appt.ltfu_at),
            notes=appt.notes,
            baby_name=baby.full_name,
            caregiver_name=baby.caregiver_name,
            mtn_phone=baby.mtn_phone,
            airtel_phone=baby.airtel_phone,
            hospital_id=baby.hospital_id,
            hospital_name=hospital.name,
        ))
    return result


@router.patch("/{appointment_id}/reschedule", response_model=AppointmentOut)
def reschedule_appointment(
    appointment_id: UUID,
    payload: ReschedulePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in _CAN_RESCHEDULE:
        raise HTTPException(status_code=403, detail="Not permitted to reschedule appointments")

    appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    baby = db.query(Baby).filter(Baby.id == appt.baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if current_user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != current_user.hospital_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if appt.status != AppointmentStatus.SCHEDULED:
        raise HTTPException(status_code=409, detail="Only scheduled appointments can be rescheduled")

    appt.due_date = payload.new_date
    if payload.notes:
        appt.notes = payload.notes

    db.commit()
    db.refresh(appt)
    return _appt_to_out(appt)


@router.get("/baby/{baby_id}", response_model=list[AppointmentOut])
def list_appointments(
    baby_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if current_user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != current_user.hospital_id:
        raise HTTPException(status_code=403, detail="Access denied")

    appts = (
        db.query(Appointment)
        .filter(Appointment.baby_id == baby_id)
        .order_by(Appointment.due_date.desc())
        .all()
    )
    return [_appt_to_out(a) for a in appts]


@router.patch("/{appointment_id}/attend", response_model=AppointmentOut)
def mark_attended(
    appointment_id: UUID,
    payload: AttendPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in _CAN_MARK_ATTENDED:
        raise HTTPException(status_code=403, detail="Not permitted to mark attendance")

    appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    baby = db.query(Baby).filter(Baby.id == appt.baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if current_user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != current_user.hospital_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if appt.status == AppointmentStatus.ATTENDED:
        raise HTTPException(status_code=409, detail="Appointment already marked as attended")

    now = datetime.now(timezone.utc)
    appt.status = AppointmentStatus.ATTENDED
    appt.attended_at = now
    if payload.notes:
        appt.notes = payload.notes

    # If the baby was flagged LTFU, reset to active now that they've attended
    if baby.status == BabyStatus.LTFU:
        baby.status = BabyStatus.ACTIVE

    db.commit()
    db.refresh(appt)
    return _appt_to_out(appt)
