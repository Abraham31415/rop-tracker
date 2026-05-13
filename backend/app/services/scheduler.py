"""
Automated reminder scheduler using APScheduler.

Jobs (all run hourly, staggered by 10 min):
  1. send_t_minus_3  — SMS 3 days before appointment
  2. send_t_minus_1  — SMS 1 day before appointment
  3. mark_missed_ltfu — mark overdue as MISSED; escalate 48 h+ to LTFU + send alert SMS

All jobs create a fresh DB session and close it when done, so they're safe
to run in APScheduler background threads.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.executors.pool import ThreadPoolExecutor

from app.database import SessionLocal
from app.models.alert import Alert, AlertType
from app.models.appointment import Appointment, AppointmentStatus
from app.models.baby import Baby, BabyStatus
from app.models.exam import Exam
from app.models.reminder import Reminder, ReminderStatus, ReminderTrigger
from app.models.screening_request import ScreeningRequest, ScreeningRequestStatus

logger = logging.getLogger(__name__)

# Tracks the last successful completion time for each job (module-level, in-process only)
_last_run: dict[str, datetime] = {}

# One executor thread is enough — jobs are short DB queries + one HTTP call each
_scheduler = BackgroundScheduler(
    executors={"default": ThreadPoolExecutor(2)},
    timezone="Africa/Kampala",
    job_defaults={"coalesce": True, "max_instances": 1},
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _already_sent(db, appointment_id, trigger: str) -> bool:
    """Return True if a SENT reminder for this appointment+trigger already exists."""
    return db.query(Reminder).filter(
        Reminder.appointment_id == appointment_id,
        Reminder.trigger == trigger,
        Reminder.status == ReminderStatus.SENT,
    ).first() is not None


# ── Job 1 & 2: upcoming reminders ────────────────────────────────────────────

def _send_upcoming_reminders(days_before: int, trigger: str) -> None:
    """
    Find all SCHEDULED appointments due in exactly `days_before` calendar days
    and dispatch an SMS reminder if not already sent.
    """
    from app.services.messaging import dispatch_reminder

    db = SessionLocal()
    try:
        target_date = date.today() + timedelta(days=days_before)
        # Exclude discharged and treated babies — their reminders should stop
        active_baby_ids = (
            db.query(Baby.id)
            .filter(Baby.status.in_([BabyStatus.ACTIVE, BabyStatus.LTFU]))
            .subquery()
        )
        appointments = (
            db.query(Appointment)
            .filter(
                Appointment.due_date == target_date,
                Appointment.status == AppointmentStatus.SCHEDULED,
                Appointment.baby_id.in_(active_baby_ids),
            )
            .all()
        )

        sent = skipped = failed = 0
        for appt in appointments:
            if _already_sent(db, appt.id, trigger):
                skipped += 1
                continue
            reminder = dispatch_reminder(db, appt, trigger)
            if reminder.status == ReminderStatus.SENT:
                sent += 1
            else:
                failed += 1

        if appointments:
            logger.info(
                "Reminder job %s (T-%dd): %d sent, %d skipped, %d failed",
                trigger, days_before, sent, skipped, failed,
            )
        job_id = f"reminder_{trigger.replace('-', '_')}"
        _last_run[job_id] = datetime.now(timezone.utc)
    except Exception:
        logger.exception("Error in reminder job %s", trigger)
        db.rollback()
    finally:
        db.close()


# ── Job 3: mark missed → LTFU ─────────────────────────────────────────────────

def _mark_missed_and_ltfu() -> None:
    """
    Pass 1 — SCHEDULED appointments whose due_date has passed → mark MISSED.
    Pass 2 — MISSED appointments 48 h+ overdue → mark LTFU, update baby, send alert.
    """
    from app.services.messaging import dispatch_reminder

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        today = date.today()

        # ── Pass 1: SCHEDULED → MISSED ─────────────────────────────────────
        newly_missed = (
            db.query(Appointment)
            .filter(
                Appointment.due_date < today,
                Appointment.status == AppointmentStatus.SCHEDULED,
            )
            .all()
        )
        for appt in newly_missed:
            appt.status = AppointmentStatus.MISSED
            appt.missed_at = now
        if newly_missed:
            db.commit()
            logger.info("Marked %d appointment(s) as MISSED", len(newly_missed))

        # ── Pass 2: MISSED 48h+ → LTFU ─────────────────────────────────────
        cutoff = now - timedelta(hours=48)
        ltfu_appts = (
            db.query(Appointment)
            .filter(
                Appointment.status == AppointmentStatus.MISSED,
                Appointment.missed_at <= cutoff,
            )
            .all()
        )
        for appt in ltfu_appts:
            # Skip if an exam was recorded after the due date (baby did attend)
            exam_after = db.query(Exam).filter(
                Exam.baby_id == appt.baby_id,
                Exam.exam_date >= appt.due_date,
            ).first()
            if exam_after:
                appt.status = AppointmentStatus.ATTENDED
                continue

            appt.status = AppointmentStatus.LTFU
            appt.ltfu_at = now

            # Mark the baby as LTFU
            baby = db.query(Baby).filter(Baby.id == appt.baby_id).first()
            if baby and baby.status != BabyStatus.LTFU:
                baby.status = BabyStatus.LTFU
                logger.info("Baby %s marked LTFU", baby.full_name)

            # Create a dashboard alert for the hospital coordinator (once per appointment)
            if baby:
                existing_alert = db.query(Alert).filter(
                    Alert.appointment_id == appt.id,
                    Alert.alert_type == AlertType.LTFU_FLAGGED,
                ).first()
                if not existing_alert:
                    alert = Alert(
                        hospital_id=baby.hospital_id,
                        baby_id=baby.id,
                        appointment_id=appt.id,
                        alert_type=AlertType.LTFU_FLAGGED,
                        title=f"LTFU: {baby.full_name}",
                        body=(
                            f"{baby.full_name} missed their appointment on "
                            f"{appt.due_date.strftime('%d %b %Y')} and has not been seen "
                            f"in over 48 hours. Caregiver: {baby.caregiver_name}. "
                            f"Phone: {baby.mtn_phone or baby.airtel_phone or 'N/A'}."
                        ),
                    )
                    db.add(alert)

            # Send LTFU alert SMS (once)
            if not _already_sent(db, appt.id, ReminderTrigger.LTFU_48H):
                dispatch_reminder(db, appt, ReminderTrigger.LTFU_48H)

        if ltfu_appts:
            db.commit()
            logger.info("Escalated %d appointment(s) to LTFU", len(ltfu_appts))

        _last_run["mark_missed_ltfu"] = datetime.now(timezone.utc)
    except Exception:
        logger.exception("Error in mark_missed_ltfu job")
        db.rollback()
    finally:
        db.close()


# ── Job 4: escalate unactioned screening requests at 24h ─────────────────────

def _escalate_stale_screening_requests() -> None:
    """
    Screening requests that have been PENDING for 24h without being claimed
    are escalated: status -> ESCALATED and a coordinator alert is created.
    """
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=24)

        stale = (
            db.query(ScreeningRequest)
            .filter(
                ScreeningRequest.status == ScreeningRequestStatus.PENDING,
                ScreeningRequest.created_at <= cutoff,
            )
            .all()
        )

        for req in stale:
            req.status = ScreeningRequestStatus.ESCALATED
            req.escalated_at = now

            baby = db.query(Baby).filter(Baby.id == req.baby_id).first()
            if baby:
                existing = db.query(Alert).filter(
                    Alert.baby_id == baby.id,
                    Alert.alert_type == AlertType.LTFU_FLAGGED,  # reuse closest type
                    Alert.title.like("Screening request%"),
                ).first()
                if not existing:
                    alert = Alert(
                        hospital_id=req.hospital_id,
                        baby_id=baby.id,
                        alert_type=AlertType.LTFU_FLAGGED,
                        title=f"Screening request unactioned: {baby.full_name}",
                        body=(
                            f"A screening request for {baby.full_name} was submitted over 24 hours ago "
                            f"and has not been claimed by any ophthalmologist. "
                            f"Please assign an ophthalmologist manually."
                        ),
                    )
                    db.add(alert)

        if stale:
            db.commit()
            logger.info("Escalated %d stale screening request(s)", len(stale))

        _last_run["escalate_screening_requests"] = datetime.now(timezone.utc)
    except Exception:
        logger.exception("Error in escalate_screening_requests job")
        db.rollback()
    finally:
        db.close()


# ── Public API ────────────────────────────────────────────────────────────────

def get_scheduler_state() -> dict:
    """Return current scheduler status for the health dashboard."""
    jobs = {}
    for job in _scheduler.get_jobs():
        last = _last_run.get(job.id)
        jobs[job.id] = {
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
            "last_run": last.isoformat() if last else None,
        }
    all_last = [v for v in _last_run.values()]
    return {
        "running": _scheduler.running,
        "jobs": jobs,
        "last_any_run": max(all_last).isoformat() if all_last else None,
    }


def start_scheduler() -> None:
    """Register all jobs and start the scheduler. Call once at app startup."""
    _scheduler.add_job(
        lambda: _send_upcoming_reminders(3, ReminderTrigger.T_MINUS_3),
        trigger="interval",
        hours=1,
        id="reminder_t_minus_3",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc),  # run immediately on startup too
    )
    _scheduler.add_job(
        lambda: _send_upcoming_reminders(1, ReminderTrigger.T_MINUS_1),
        trigger="interval",
        hours=1,
        id="reminder_t_minus_1",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    _scheduler.add_job(
        _mark_missed_and_ltfu,
        trigger="interval",
        hours=1,
        id="mark_missed_ltfu",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc) + timedelta(minutes=20),
    )
    _scheduler.add_job(
        _escalate_stale_screening_requests,
        trigger="interval",
        hours=1,
        id="escalate_screening_requests",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    _scheduler.start()
    logger.info("ROP reminder scheduler started (4 jobs)")


def stop_scheduler() -> None:
    """Graceful shutdown — call at app teardown."""
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("ROP reminder scheduler stopped")


def run_all_jobs_now() -> dict:
    """
    Manually fire all three jobs immediately (useful for testing/admin).
    Returns counts of what ran.
    """
    _send_upcoming_reminders(3, ReminderTrigger.T_MINUS_3)
    _send_upcoming_reminders(1, ReminderTrigger.T_MINUS_1)
    _mark_missed_and_ltfu()
    return {"status": "all jobs executed"}
