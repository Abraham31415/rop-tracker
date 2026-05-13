"""
Reminder log endpoints.
GET  /api/reminders               — list recent reminders (filterable by baby)
POST /api/reminders/trigger       — manually fire all scheduler jobs (coordinators only)
GET  /api/reminders/preview       — preview what an SMS would look like for a baby
POST /api/reminders/log-call      — coordinator logs a manual phone call attempt
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID
from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.reminder import Reminder, ReminderStatus, ReminderTrigger, ReminderType
from app.models.appointment import Appointment, AppointmentStatus
from app.models.baby import Baby
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/reminders", tags=["reminders"])


def _require_coordinator(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Coordinators only")
    return user


# ── List reminder log ────────────────────────────────────────────────────────

@router.get("/")
def list_reminders(
    baby_id: Optional[UUID] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = (
        db.query(Reminder)
        .order_by(Reminder.created_at.desc())
    )

    # Hospital coordinators only see babies from their hospital
    if user.role == UserRole.HOSPITAL_COORDINATOR and user.hospital_id:
        q = q.join(Baby, Baby.id == Reminder.baby_id).filter(
            Baby.hospital_id == user.hospital_id
        )

    if baby_id:
        q = q.filter(Reminder.baby_id == baby_id)
    if status:
        try:
            q = q.filter(Reminder.status == ReminderStatus(status))
        except ValueError:
            raise HTTPException(400, f"Invalid status: {status}")

    rows = q.limit(limit).all()
    return [_serialize_reminder(r) for r in rows]


def _serialize_reminder(r: Reminder) -> dict:
    return {
        "id": str(r.id),
        "baby_id": str(r.baby_id),
        "appointment_id": str(r.appointment_id),
        "reminder_type": r.reminder_type,
        "trigger": r.trigger,
        "language": r.language,
        "recipient_phone": r.recipient_phone,
        "message_body": r.message_body,
        "status": r.status,
        "provider_message_id": r.provider_message_id,
        "error_message": r.error_message,
        "scheduled_at": r.scheduled_at.isoformat() if r.scheduled_at else None,
        "sent_at": r.sent_at.isoformat() if r.sent_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ── Manual trigger ───────────────────────────────────────────────────────────

@router.post("/trigger")
def trigger_jobs(
    db: Session = Depends(get_db),
    user: User = Depends(_require_coordinator),
):
    """Run all scheduler jobs immediately. Useful for testing or catch-up after downtime."""
    from app.services.scheduler import run_all_jobs_now
    result = run_all_jobs_now()
    return result


# ── Send reminder to a single baby ──────────────────────────────────────────

@router.post("/send/{baby_id}")
def send_reminder_now(
    baby_id: UUID,
    trigger: str = Query("t_minus_1", description="t_minus_3 | t_minus_1 | ltfu_48h"),
    db: Session = Depends(get_db),
    user: User = Depends(_require_coordinator),
):
    """
    Manually dispatch an SMS to a specific baby's caregiver right now.
    Useful when a coordinator wants to contact a family immediately.
    """
    from app.services.messaging import dispatch_reminder

    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(404, "Baby not found")

    # Enforce hospital scope
    if user.role == UserRole.HOSPITAL_COORDINATOR and baby.hospital_id != user.hospital_id:
        raise HTTPException(403, "Baby is not in your hospital")

    # Find the latest scheduled appointment, or synthesise a dummy one for LTFU
    appt = (
        db.query(Appointment)
        .filter(Appointment.baby_id == baby_id)
        .order_by(Appointment.due_date.desc())
        .first()
    )
    if not appt:
        raise HTTPException(404, "No appointment found for this baby — record an exam first")

    valid_triggers = {t.value for t in ReminderTrigger}
    if trigger not in valid_triggers:
        raise HTTPException(400, f"trigger must be one of: {', '.join(valid_triggers)}")

    reminder = dispatch_reminder(db, appt, trigger)
    return _serialize_reminder(reminder)


# ── Retry a failed reminder ──────────────────────────────────────────────────

@router.post("/{reminder_id}/retry")
def retry_reminder(
    reminder_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Retry sending a failed SMS reminder. Creates a new reminder record."""
    from app.services.messaging import dispatch_reminder

    if user.role not in (UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Coordinators only")

    reminder = db.query(Reminder).filter(Reminder.id == reminder_id).first()
    if not reminder:
        raise HTTPException(404, "Reminder not found")
    if reminder.status != ReminderStatus.FAILED:
        raise HTTPException(400, "Only failed reminders can be retried")

    baby = db.query(Baby).filter(Baby.id == reminder.baby_id).first()
    if not baby:
        raise HTTPException(404, "Baby not found")
    if user.role == UserRole.HOSPITAL_COORDINATOR and baby.hospital_id != user.hospital_id:
        raise HTTPException(403, "Baby is not in your hospital")

    appt = db.query(Appointment).filter(Appointment.id == reminder.appointment_id).first()
    if not appt:
        raise HTTPException(404, "Original appointment no longer exists")

    new_reminder = dispatch_reminder(db, appt, reminder.trigger)
    return _serialize_reminder(new_reminder)


# ── Log phone call ───────────────────────────────────────────────────────────

class CallLogBody(BaseModel):
    outcome: str = "not_reached"   # reached | not_reached | voicemail
    notes: str = ""

@router.post("/log-call/{baby_id}")
def log_phone_call(
    baby_id: UUID,
    body: CallLogBody,
    db: Session = Depends(get_db),
    user: User = Depends(_require_coordinator),
):
    """Record that a coordinator called the caregiver."""
    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(404, "Baby not found")

    if user.role == UserRole.HOSPITAL_COORDINATOR and baby.hospital_id != user.hospital_id:
        raise HTTPException(403, "Baby is not in your hospital")

    appt = (
        db.query(Appointment)
        .filter(Appointment.baby_id == baby_id)
        .order_by(Appointment.due_date.desc())
        .first()
    )
    if not appt:
        raise HTTPException(404, "No appointment on record — enroll an exam first")

    outcome_label = {"reached": "Reached", "not_reached": "Not reached", "voicemail": "Left voicemail"}.get(
        body.outcome, body.outcome
    )
    message = f"Call outcome: {outcome_label}. Logged by: {user.full_name}."
    if body.notes:
        message += f" Notes: {body.notes}"

    now = datetime.now(timezone.utc)
    reminder = Reminder(
        baby_id=baby_id,
        appointment_id=appt.id,
        reminder_type=ReminderType.PHONE_CALL,
        trigger=ReminderTrigger.MANUAL_CALL,
        language="english",
        recipient_phone=baby.mtn_phone or baby.airtel_phone,
        message_body=message,
        status=ReminderStatus.ACKNOWLEDGED,
        scheduled_at=now,
        sent_at=now,
        acknowledged_at=now,
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return _serialize_reminder(reminder)


# ── Gateway status ───────────────────────────────────────────────────────────

@router.get("/gateway-status")
def gateway_status(
    db: Session = Depends(get_db),
    user: User = Depends(_require_coordinator),
):
    """Return AT gateway configuration and 24-hour delivery stats."""
    from datetime import timedelta
    from app.config import settings

    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=24)

    base = db.query(Reminder).filter(
        Reminder.reminder_type == ReminderType.SMS,
        Reminder.created_at >= since,
    )
    sent_24h   = base.filter(Reminder.status == ReminderStatus.SENT).count()
    failed_24h = base.filter(Reminder.status == ReminderStatus.FAILED).count()

    last_sent = (
        db.query(Reminder)
        .filter(Reminder.reminder_type == ReminderType.SMS, Reminder.status == ReminderStatus.SENT)
        .order_by(Reminder.sent_at.desc())
        .first()
    )
    last_failed = (
        db.query(Reminder)
        .filter(Reminder.reminder_type == ReminderType.SMS, Reminder.status == ReminderStatus.FAILED)
        .order_by(Reminder.created_at.desc())
        .first()
    )

    return {
        "mode": "simulate" if settings.AT_SIMULATE else "live",
        "configured": bool(settings.AT_API_KEY),
        "username": settings.AT_USERNAME,
        "sender_id": settings.AT_SENDER_ID or None,
        "stats_24h": {"sent": sent_24h, "failed": failed_24h},
        "last_sent_at": last_sent.sent_at.isoformat() if last_sent and last_sent.sent_at else None,
        "last_failed_at": last_failed.created_at.isoformat() if last_failed else None,
    }


# ── Test SMS ─────────────────────────────────────────────────────────────────

@router.post("/test-sms")
def send_test_sms(
    phone: str = Query(..., description="E.164 phone number, e.g. +256772000001"),
    user: User = Depends(_require_coordinator),
):
    """
    Send a live test SMS via Africa's Talking, bypassing simulation mode.
    Use this to verify AT credentials are correct and the gateway is reachable.
    """
    from app.services.messaging import test_gateway
    result = test_gateway(phone)
    return result


# ── Preview message ──────────────────────────────────────────────────────────

@router.get("/preview/{baby_id}")
def preview_message(
    baby_id: UUID,
    trigger: str = Query("t_minus_3"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the rendered SMS text without actually sending it."""
    from app.services.messaging import render_message

    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(404, "Baby not found")

    appt = (
        db.query(Appointment)
        .filter(Appointment.baby_id == baby_id)
        .order_by(Appointment.due_date.desc())
        .first()
    )
    appt_date = appt.due_date if appt else date.today()
    hospital_name = baby.hospital.name if baby.hospital else "your hospital"

    message = render_message(
        trigger=trigger,
        language=baby.language_preference or "english",
        baby_name=baby.full_name,
        caregiver=baby.caregiver_name,
        appt_date=appt_date,
        hospital=hospital_name,
    )
    return {
        "baby": baby.full_name,
        "language": baby.language_preference,
        "phone": baby.mtn_phone or baby.airtel_phone,
        "trigger": trigger,
        "message": message,
    }
