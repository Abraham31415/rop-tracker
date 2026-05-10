"""
GET /api/notifications   — aggregated notification feed for coordinators:
  - LTFU alerts (from alerts table)
  - MISSED appointments not yet escalated
  - SMS delivery failures (last 7 days)
  - Due-today appointments
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone, date
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.alert import Alert, AlertType
from app.models.appointment import Appointment, AppointmentStatus
from app.models.baby import Baby, BabyStatus
from app.models.reminder import Reminder, ReminderStatus
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _scoped(query, user: User, baby_model=Baby):
    if user.role == UserRole.HOSPITAL_COORDINATOR and user.hospital_id:
        query = query.filter(baby_model.hospital_id == user.hospital_id)
    return query


@router.get("/")
def list_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = []
    now = datetime.now(timezone.utc)
    today = date.today()

    # ── 1. LTFU alerts ────────────────────────────────────────────────────────
    alert_q = db.query(Alert).filter(Alert.is_dismissed == False)
    if user.role == UserRole.HOSPITAL_COORDINATOR and user.hospital_id:
        alert_q = alert_q.filter(Alert.hospital_id == user.hospital_id)
    for a in alert_q.all():
        items.append({
            "id": f"alert-{a.id}",
            "type": "ltfu",
            "title": a.title,
            "body": a.body,
            "baby_id": str(a.baby_id),
            "baby_name": a.baby.full_name if a.baby else None,
            "triggered_at": a.created_at.isoformat() if a.created_at else None,
            "is_dismissible": True,
            "alert_id": str(a.id),
        })

    # ── 2. MISSED appointments (not yet LTFU) ─────────────────────────────────
    missed_q = (
        db.query(Appointment)
        .join(Baby, Baby.id == Appointment.baby_id)
        .filter(
            Appointment.status == AppointmentStatus.MISSED,
            Baby.status != BabyStatus.LTFU,
        )
    )
    if user.role == UserRole.HOSPITAL_COORDINATOR and user.hospital_id:
        missed_q = missed_q.filter(Baby.hospital_id == user.hospital_id)
    for appt in missed_q.all():
        baby = appt.baby
        items.append({
            "id": f"missed-{appt.id}",
            "type": "missed",
            "title": f"Missed appointment: {baby.full_name}",
            "body": (
                f"{baby.full_name} missed their scheduled exam on "
                f"{appt.due_date.strftime('%d %b %Y')}. "
                f"Contact: {baby.caregiver_name} — "
                f"{baby.mtn_phone or baby.airtel_phone or 'no phone on record'}"
            ),
            "baby_id": str(baby.id),
            "baby_name": baby.full_name,
            "triggered_at": appt.missed_at.isoformat() if appt.missed_at else appt.due_date.isoformat(),
            "is_dismissible": False,
            "alert_id": None,
        })

    # ── 3. Due today ──────────────────────────────────────────────────────────
    due_q = (
        db.query(Appointment)
        .join(Baby, Baby.id == Appointment.baby_id)
        .filter(Appointment.due_date == today, Appointment.status == AppointmentStatus.SCHEDULED)
    )
    if user.role == UserRole.HOSPITAL_COORDINATOR and user.hospital_id:
        due_q = due_q.filter(Baby.hospital_id == user.hospital_id)
    for appt in due_q.all():
        baby = appt.baby
        items.append({
            "id": f"due-{appt.id}",
            "type": "due_today",
            "title": f"Exam due today: {baby.full_name}",
            "body": (
                f"{baby.full_name} is scheduled for an eye exam today. "
                f"Caregiver: {baby.caregiver_name} — "
                f"{baby.mtn_phone or baby.airtel_phone or 'no phone'}"
            ),
            "baby_id": str(baby.id),
            "baby_name": baby.full_name,
            "triggered_at": datetime.combine(today, datetime.min.time()).isoformat(),
            "is_dismissible": False,
            "alert_id": None,
        })

    # ── 4. SMS failures (last 7 days) ─────────────────────────────────────────
    cutoff = now - timedelta(days=7)
    fail_q = (
        db.query(Reminder)
        .join(Baby, Baby.id == Reminder.baby_id)
        .filter(Reminder.status == ReminderStatus.FAILED, Reminder.created_at >= cutoff)
    )
    if user.role == UserRole.HOSPITAL_COORDINATOR and user.hospital_id:
        fail_q = fail_q.filter(Baby.hospital_id == user.hospital_id)
    for rem in fail_q.all():
        baby = rem.baby
        items.append({
            "id": f"sms-{rem.id}",
            "type": "sms_failed",
            "title": f"SMS failed: {baby.full_name if baby else 'Unknown'}",
            "body": (
                f"Could not send {rem.trigger} reminder to "
                f"{rem.recipient_phone or 'unknown number'}. "
                f"Error: {rem.error_message or 'unknown error'}"
            ),
            "baby_id": str(rem.baby_id),
            "baby_name": baby.full_name if baby else None,
            "triggered_at": rem.created_at.isoformat() if rem.created_at else None,
            "is_dismissible": False,
            "alert_id": None,
        })

    # Sort newest first
    items.sort(key=lambda x: x["triggered_at"] or "", reverse=True)
    return items
