"""
Network overview for the Central Coordinator.
GET /api/network/overview — hospitals + urgency counts + reminder activity.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, case, and_
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.baby import Baby, BabyStatus
from app.models.hospital import Hospital
from app.models.appointment import Appointment, AppointmentStatus
from app.models.reminder import Reminder, ReminderStatus, ReminderTrigger
from app.models.user import User, UserRole
from app.models.outcome import Outcome, TreatmentType

router = APIRouter(prefix="/api/network", tags=["network"])


def _require_central(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.CENTRAL_COORDINATOR:
        raise HTTPException(403, "Central coordinators only")
    return user


@router.get("/overview")
def network_overview(
    db: Session = Depends(get_db),
    user: User = Depends(_require_central),
):
    today = date.today()
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    # ── 1. Load all active babies with their latest appointment ──────────────
    babies = db.query(Baby).filter(Baby.status != BabyStatus.DISCHARGED).all()

    # Pre-load next scheduled appointment per baby in one query
    next_appts_rows = (
        db.query(
            Appointment.baby_id,
            func.min(Appointment.due_date).label("next_due"),
        )
        .filter(Appointment.status == AppointmentStatus.SCHEDULED)
        .group_by(Appointment.baby_id)
        .all()
    )
    next_appt_by_baby = {str(r.baby_id): r.next_due for r in next_appts_rows}

    # ── 2. Classify each baby into an urgency bucket ─────────────────────────
    def urgency_of(baby: Baby) -> str:
        if baby.status == BabyStatus.LTFU:
            return "ltfu"
        due = next_appt_by_baby.get(str(baby.id))
        if due is None:
            return "on_track"
        days = (due - today).days
        if days < 0:
            return "ltfu"       # missed and not yet marked — treat as LTFU in display
        if days == 0:
            return "due_today"
        if days <= 2:
            return "due_soon"
        return "on_track"

    # ── 3. Aggregate counts per hospital ─────────────────────────────────────
    # Index hospitals that have at least one baby (or all active hospitals)
    all_hospitals = (
        db.query(Hospital)
        .filter(Hospital.is_active == True)
        .order_by(Hospital.region, Hospital.name)
        .all()
    )

    hosp_data: dict[str, dict] = {}
    for h in all_hospitals:
        hosp_data[str(h.id)] = {
            "id": str(h.id),
            "name": h.name,
            "district": h.district,
            "region": h.region,
            "total": 0,
            "ltfu": 0,
            "due_today": 0,
            "due_soon": 0,
            "on_track": 0,
        }

    net_total = net_ltfu = net_due_today = net_due_soon = net_on_track = 0

    for baby in babies:
        hid = str(baby.hospital_id)
        urg = urgency_of(baby)
        if hid in hosp_data:
            hosp_data[hid]["total"] += 1
            hosp_data[hid][urg] += 1
        net_total += 1
        if urg == "ltfu":       net_ltfu += 1
        elif urg == "due_today": net_due_today += 1
        elif urg == "due_soon":  net_due_soon += 1
        else:                    net_on_track += 1

    # Sort hospitals: those with LTFU first, then by name
    hospital_list = sorted(
        hosp_data.values(),
        key=lambda h: (-h["ltfu"], -h["total"], h["name"]),
    )
    # Only include hospitals that have enrolled babies OR all active ones
    # (keep all so coordinator can see zero-enrollment hospitals too)

    active_hospital_count = sum(1 for h in hospital_list if h["total"] > 0)

    # ── 4. Reminder activity — last 7 days ───────────────────────────────────
    reminder_rows = (
        db.query(
            Reminder.trigger,
            Reminder.status,
            func.count(Reminder.id).label("n"),
        )
        .filter(Reminder.created_at >= week_ago)
        .group_by(Reminder.trigger, Reminder.status)
        .all()
    )

    # Build a clean structure: trigger → {sent, failed, total}
    trigger_summary: dict[str, dict] = {}
    for row in reminder_rows:
        t = row.trigger if isinstance(row.trigger, str) else row.trigger.value
        if t not in trigger_summary:
            trigger_summary[t] = {"trigger": t, "sent": 0, "failed": 0, "total": 0}
        if row.status in (ReminderStatus.SENT, "sent"):
            trigger_summary[t]["sent"] += row.n
        elif row.status in (ReminderStatus.FAILED, "failed"):
            trigger_summary[t]["failed"] += row.n
        trigger_summary[t]["total"] += row.n

    # Ensure all 4 triggers appear even if no activity
    for trig in (ReminderTrigger.T_MINUS_3, ReminderTrigger.T_MINUS_1,
                 ReminderTrigger.DAY_OF, ReminderTrigger.LTFU_48H):
        tv = trig.value
        if tv not in trigger_summary:
            trigger_summary[tv] = {"trigger": tv, "sent": 0, "failed": 0, "total": 0}

    reminder_activity = sorted(trigger_summary.values(), key=lambda r: r["trigger"])
    reminders_sent_week = sum(r["sent"] for r in reminder_activity)
    reminders_failed_week = sum(r["failed"] for r in reminder_activity)

    # ── 5. Blindness prevention counter ─────────────────────────────────────
    # Babies who received active treatment (not NONE) are counted as
    # "blindness cases prevented" — each treated baby = 1 prevented case.
    blindness_prevented = (
        db.query(func.count(Outcome.id))
        .filter(
            Outcome.treatment_type != None,
            Outcome.treatment_type != TreatmentType.NONE,
        )
        .scalar()
    ) or 0

    # ── 6. Response ───────────────────────────────────────────────────────────
    return {
        "summary": {
            "total_babies": net_total,
            "total_ltfu": net_ltfu,
            "total_due_today": net_due_today,
            "total_due_soon": net_due_soon,
            "total_on_track": net_on_track,
            "active_hospitals": active_hospital_count,
            "reminders_sent_this_week": reminders_sent_week,
            "reminders_failed_this_week": reminders_failed_week,
            "blindness_prevented": blindness_prevented,
        },
        "hospitals": hospital_list,
        "reminder_activity": reminder_activity,
    }
