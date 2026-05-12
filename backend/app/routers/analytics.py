"""
Analytics endpoints for the central coordinator dashboard.

GET /api/analytics/screening-volume  — babies enrolled per period
GET /api/analytics/ltfu-rate         — loss-to-follow-up rate per period
GET /api/analytics/at-risk-trend     — newly at-risk babies per period + current count
GET /api/analytics/at-risk-babies    — current at-risk baby list with full clinical detail
GET /api/analytics/ltfu-babies       — babies whose appointments fell LTFU in a period
"""
from __future__ import annotations
from datetime import datetime, date, timedelta, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.baby import Baby, BabyStatus
from app.models.exam import Exam
from app.models.hospital import Hospital
from app.models.appointment import Appointment, AppointmentStatus
from app.models.outcome import Outcome, TreatmentType
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

GroupBy = Literal["day", "week", "month", "quarter", "year"]


def _require_central(user: User) -> None:
    if user.role != UserRole.CENTRAL_COORDINATOR:
        raise HTTPException(status_code=403, detail="Analytics are available to central coordinators only")


def _period_key(d: date, group_by: GroupBy) -> tuple[str, str]:
    """Return (sort_key, display_label) for a date given the grouping."""
    if group_by == "day":
        return d.strftime("%Y-%m-%d"), d.strftime("%d %b %Y")
    if group_by == "week":
        iso = d.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}", f"W{iso[1]} {iso[0]}"
    if group_by == "month":
        return d.strftime("%Y-%m"), d.strftime("%b %Y")
    if group_by == "quarter":
        q = (d.month - 1) // 3 + 1
        return f"{d.year}-Q{q}", f"Q{q} {d.year}"
    # year
    return str(d.year), str(d.year)


def _treated_baby_ids(db: Session) -> set[str]:
    """Return IDs of babies that have received actual treatment (outcome != none)."""
    return {
        str(o.baby_id)
        for o in db.query(Outcome).filter(
            Outcome.treatment_type.isnot(None),
            Outcome.treatment_type != TreatmentType.NONE,
        ).all()
    }


def _first_treatment_exams(db: Session) -> dict[str, Exam]:
    """Return the first treatment-recommended exam per baby (keyed by str baby_id)."""
    exams = (
        db.query(Exam)
        .filter(Exam.treatment_recommended.isnot(None), Exam.treatment_recommended != "")
        .order_by(Exam.exam_date)
        .all()
    )
    first: dict[str, Exam] = {}
    for e in exams:
        bid = str(e.baby_id)
        if bid not in first:
            first[bid] = e
    return first


# ── Screening volume ──────────────────────────────────────────────────────────

@router.get("/screening-volume")
def screening_volume(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    group_by: GroupBy = "month",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    q = db.query(Baby)
    if from_date:
        q = q.filter(Baby.enrolled_at >= datetime(from_date.year, from_date.month, from_date.day, tzinfo=timezone.utc))
    if to_date:
        q = q.filter(Baby.enrolled_at <= datetime(to_date.year, to_date.month, to_date.day, 23, 59, 59, tzinfo=timezone.utc))

    counts: dict[str, dict] = {}
    for baby in q.all():
        if not baby.enrolled_at:
            continue
        key, label = _period_key(baby.enrolled_at.date(), group_by)
        if key not in counts:
            counts[key] = {"period": key, "label": label, "count": 0}
        counts[key]["count"] += 1

    return {"data": sorted(counts.values(), key=lambda x: x["period"])}


# ── LTFU rate ─────────────────────────────────────────────────────────────────

@router.get("/ltfu-rate")
def ltfu_rate(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    group_by: GroupBy = "month",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    q = db.query(Appointment)
    if from_date:
        q = q.filter(Appointment.due_date >= from_date)
    if to_date:
        q = q.filter(Appointment.due_date <= to_date)

    periods: dict[str, dict] = {}
    for appt in q.all():
        if not appt.due_date:
            continue
        key, label = _period_key(appt.due_date, group_by)
        if key not in periods:
            periods[key] = {"period": key, "label": label, "total": 0, "ltfu_count": 0, "rate": 0.0}
        periods[key]["total"] += 1
        if appt.status in (AppointmentStatus.MISSED, AppointmentStatus.LTFU):
            periods[key]["ltfu_count"] += 1

    for p in periods.values():
        p["rate"] = round(p["ltfu_count"] / p["total"] * 100, 1) if p["total"] else 0.0

    return {"data": sorted(periods.values(), key=lambda x: x["period"])}


# ── At-risk trend ─────────────────────────────────────────────────────────────

@router.get("/at-risk-trend")
def at_risk_trend(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    group_by: GroupBy = "month",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Newly at-risk babies per period (grouped by date treatment was first recommended)
    plus the current live count of untreated at-risk babies.
    """
    _require_central(user)

    treated = _treated_baby_ids(db)
    first_exams = _first_treatment_exams(db)

    counts: dict[str, dict] = {}
    for bid, exam in first_exams.items():
        if bid in treated:
            continue
        if not exam.exam_date:
            continue
        if from_date and exam.exam_date < from_date:
            continue
        if to_date and exam.exam_date > to_date:
            continue
        key, label = _period_key(exam.exam_date, group_by)
        if key not in counts:
            counts[key] = {"period": key, "label": label, "count": 0}
        counts[key]["count"] += 1

    current_count = sum(1 for bid in first_exams if bid not in treated)

    return {
        "current_count": current_count,
        "data": sorted(counts.values(), key=lambda x: x["period"]),
    }


# ── At-risk babies list ───────────────────────────────────────────────────────

@router.get("/at-risk-babies")
def at_risk_babies(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Current list of at-risk babies: treatment recommended but not yet treated."""
    _require_central(user)

    treated = _treated_baby_ids(db)
    first_exams = _first_treatment_exams(db)

    at_risk_baby_ids = [
        exam.baby_id for bid, exam in first_exams.items() if bid not in treated
    ]
    if not at_risk_baby_ids:
        return {"babies": [], "total": 0}

    babies = db.query(Baby).filter(Baby.id.in_(at_risk_baby_ids)).all()
    hospital_map = {str(h.id): h.name for h in db.query(Hospital).all()}

    # Latest exam per baby for current zone/stage
    latest_exams: dict[str, Exam] = {}
    for exam in (
        db.query(Exam)
        .filter(Exam.baby_id.in_(at_risk_baby_ids))
        .order_by(Exam.exam_date)
        .all()
    ):
        latest_exams[str(exam.baby_id)] = exam  # ascending order — last write wins

    today = date.today()
    result = []
    for baby in babies:
        bid = str(baby.id)
        first = first_exams[bid]
        latest = latest_exams.get(bid, first)
        days_since = (today - first.exam_date).days if first.exam_date else None
        result.append({
            "id": bid,
            "full_name": baby.full_name,
            "hospital_name": hospital_map.get(str(baby.hospital_id), "Unknown"),
            "status": baby.status.value if baby.status else None,
            "days_since_diagnosis": days_since,
            "zone": latest.worst_zone,
            "stage": latest.worst_stage,
            "last_exam_date": latest.exam_date.isoformat() if latest.exam_date else None,
            "treatment_recommended": first.treatment_recommended,
        })

    result.sort(key=lambda x: x["days_since_diagnosis"] or 0, reverse=True)
    return {"babies": result, "total": len(result)}


# ── LTFU babies list ──────────────────────────────────────────────────────────

@router.get("/ltfu-babies")
def ltfu_babies(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Babies whose appointments were missed/LTFU within the given date range."""
    _require_central(user)

    q = db.query(Appointment).filter(
        Appointment.status.in_([AppointmentStatus.MISSED, AppointmentStatus.LTFU])
    )
    if from_date:
        q = q.filter(Appointment.due_date >= from_date)
    if to_date:
        q = q.filter(Appointment.due_date <= to_date)

    appts = q.all()
    if not appts:
        return {"babies": [], "total": 0}

    baby_ids = list({a.baby_id for a in appts})
    babies = db.query(Baby).filter(Baby.id.in_(baby_ids)).all()
    hospital_map = {str(h.id): h.name for h in db.query(Hospital).all()}

    latest_exams: dict[str, Exam] = {}
    for exam in (
        db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).order_by(Exam.exam_date).all()
    ):
        latest_exams[str(exam.baby_id)] = exam

    # Most recent missed appointment per baby in the period
    latest_appt: dict[str, Appointment] = {}
    for appt in appts:
        bid = str(appt.baby_id)
        if bid not in latest_appt or appt.due_date > latest_appt[bid].due_date:
            latest_appt[bid] = appt

    today = date.today()
    result = []
    for baby in babies:
        bid = str(baby.id)
        latest = latest_exams.get(bid)
        appt = latest_appt.get(bid)
        result.append({
            "id": bid,
            "full_name": baby.full_name,
            "hospital_name": hospital_map.get(str(baby.hospital_id), "Unknown"),
            "status": baby.status.value if baby.status else None,
            "zone": latest.worst_zone if latest else None,
            "stage": latest.worst_stage if latest else None,
            "last_exam_date": latest.exam_date.isoformat() if latest and latest.exam_date else None,
            "missed_appointment_date": appt.due_date.isoformat() if appt else None,
            "days_overdue": (today - appt.due_date).days if appt and appt.due_date else None,
        })

    result.sort(key=lambda x: x["days_overdue"] or 0, reverse=True)
    return {"babies": result, "total": len(result)}
