"""
Analytics endpoints for the central coordinator dashboard.

GET /api/analytics/screening-volume  — babies enrolled per period
GET /api/analytics/ltfu-rate         — loss-to-follow-up rate per period
GET /api/analytics/at-risk-trend     — newly at-risk babies per period + current count
GET /api/analytics/at-risk-babies    — current at-risk baby list with full clinical detail
GET /api/analytics/ltfu-babies       — babies whose appointments fell LTFU in a period
"""
from __future__ import annotations
import re
import statistics
from uuid import UUID
from datetime import datetime, date, timedelta, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.baby import Baby, BabyStatus, Language
from app.models.exam import Exam, Zone, Stage
from app.models.hospital import Hospital
from app.models.appointment import Appointment, AppointmentStatus
from app.models.outcome import Outcome, TreatmentType, VisualOutcome, DischargeStatus
from app.models.reminder import Reminder, ReminderStatus
from app.models.user import User, UserRole
from app.services.scheduling import calculate_next_exam_weeks
from app.services.followup_status import (
    followup_breakdown,
    all_review_episodes,
    ltfu_window_summary,
    LTFU as FOLLOWUP_LTFU,
    LATE as FOLLOWUP_LATE,
    IN_FOLLOWUP as FOLLOWUP_IN_FOLLOWUP,
)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

GroupBy = Literal["day", "week", "month", "quarter", "year"]

# ── Shared bucketing / ranking helpers ────────────────────────────────────────

STAGE_ORDER = [Stage.NO_ROP, Stage.IMMATURE, Stage.STAGE_1, Stage.STAGE_2, Stage.STAGE_3, Stage.STAGE_4, Stage.STAGE_5]
_STAGE_RANK = {s: i - 1 for i, s in enumerate(STAGE_ORDER)}  # NO_ROP=-1 .. STAGE_5=5

GA_BANDS = ["under_28", "28_30", "30_32", "over_32"]
GA_BAND_LABELS = {"under_28": "Under 28 weeks", "28_30": "28-30 weeks", "30_32": "30-32 weeks", "over_32": "Over 32 weeks"}

WEIGHT_BANDS = ["under_1000", "1000_1250", "1250_1500", "over_1500"]
WEIGHT_BAND_LABELS = {"under_1000": "Under 1000g", "1000_1250": "1000-1250g", "1250_1500": "1250-1500g", "over_1500": "Over 1500g"}

RISK_FACTORS = [
    ("oxygen_therapy", "Oxygen Therapy"),
    ("blood_transfusion", "Blood Transfusion"),
    ("sepsis", "Sepsis"),
    ("inotropes", "Inotropes"),
    ("anaemia", "Anaemia"),
    ("mechanical_ventilation", "Mechanical Ventilation"),
    ("nec", "NEC"),
    ("twins_or_multiple", "Twins"),
    ("apnoea", "Apnoea"),
    ("phototherapy", "Phototherapy"),
]


def _ga_band(weeks: Optional[float]) -> Optional[str]:
    if weeks is None:
        return None
    if weeks < 28:
        return "under_28"
    if weeks < 30:
        return "28_30"
    if weeks < 32:
        return "30_32"
    return "over_32"


def _weight_band(grams: Optional[float]) -> Optional[str]:
    if grams is None:
        return None
    if grams < 1000:
        return "under_1000"
    if grams < 1250:
        return "1000_1250"
    if grams < 1500:
        return "1250_1500"
    return "over_1500"


def _sms_error_category(raw: Optional[str]) -> str:
    """Mirrors mapSmsError() in frontend/src/pages/BabyDetailPage.jsx — keep in sync."""
    if not raw:
        return "SMS delivery failed — please contact parent directly"
    e = raw.lower()
    if re.search(r"ssl|connection error|econnrefused|network|connect timed out", e):
        return "Could not reach SMS provider — network issue"
    if re.search(r"invalid.*phone|phone.*invalid|invalid destination|not a valid|unreachable", e):
        return "Phone number is invalid or unreachable"
    if re.search(r"balance|credit|insufficient|low funds", e):
        return "SMS not sent — account balance too low"
    if re.search(r"timeout|timed out", e):
        return "SMS provider did not respond — will retry"
    return "SMS delivery failed — please contact parent directly"


def _require_central(user: User) -> None:
    if user.role != UserRole.CENTRAL_COORDINATOR:
        raise HTTPException(status_code=403, detail="Analytics are available to central coordinators only")


def _hospital_baby_ids(db: Session, hospital_id: Optional[UUID]) -> Optional[set]:
    """None means 'no filter'; otherwise the set of baby ids at that hospital."""
    if not hospital_id:
        return None
    return {b.id for b in db.query(Baby.id).filter(Baby.hospital_id == hospital_id).all()}


def _scoped_babies(db: Session, hospital_id: Optional[UUID]) -> list[Baby]:
    q = db.query(Baby)
    if hospital_id:
        q = q.filter(Baby.hospital_id == hospital_id)
    return q.all()


def _worst_ever_by_baby(db: Session, baby_ids: set) -> dict:
    """baby_id -> the Exam with that baby's highest-ever stage rank."""
    if not baby_ids:
        return {}
    best: dict = {}
    for e in db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).order_by(Exam.exam_date).all():
        cur = best.get(e.baby_id)
        if cur is None or _STAGE_RANK.get(e.worst_stage, -99) >= _STAGE_RANK.get(cur.worst_stage, -99):
            best[e.baby_id] = e
    return best


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
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    q = db.query(Baby)
    if hospital_id:
        q = q.filter(Baby.hospital_id == hospital_id)
    babies = q.all()
    baby_ids = [b.id for b in babies]

    # Each baby enters screening on its first exam date. enrolled_at is unreliable for
    # historical imports (it holds the single bulk-import timestamp, which would collapse
    # every imported baby into one bucket), so bucket by first-exam month and only fall
    # back to enrolled_at for babies not yet examined.
    first_exam: dict = {}
    if baby_ids:
        for e in db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).order_by(Exam.exam_date).all():
            if e.exam_date and e.baby_id not in first_exam:
                first_exam[e.baby_id] = e.exam_date

    counts: dict[str, dict] = {}
    for baby in babies:
        entered = first_exam.get(baby.id) or (baby.enrolled_at.date() if baby.enrolled_at else None)
        if not entered:
            continue
        if from_date and entered < from_date:
            continue
        if to_date and entered > to_date:
            continue
        key, label = _period_key(entered, group_by)
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
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Programme-wide LTFU rate (headline KPI) plus a per-period trend series.

    The headline ltfu_rate/counts/eligible are a live snapshot from the per-baby
    six-tier classification (see app.services.followup_status), one row per baby -
    matching the Dashboard and LTFU deep-dive.

    The per-period "data" trend is built from *every* resolved review episode in each
    baby's history (all_review_episodes), not from each baby's single current status.
    Bucketing by current-status-only would make nearly every past period read ~100%
    LTFU, since any review whose due date has passed and was never fulfilled is, by
    construction, already past the 14-day grace window by "today" - that's a trivial
    result of comparing an old date to today, not a real historical rate.
    """
    _require_central(user)

    breakdown = followup_breakdown(db, hospital_id)

    episodes = all_review_episodes(db, hospital_id)
    periods: dict[str, dict] = {}
    for ep in episodes:
        if ep["outcome"] == "pending":
            continue
        review = ep["review_date"]
        if from_date and review < from_date:
            continue
        if to_date and review > to_date:
            continue
        key, label = _period_key(review, group_by)
        p = periods.setdefault(key, {"period": key, "label": label, "total": 0, "ltfu_count": 0, "rate": 0.0})
        p["total"] += 1
        if ep["outcome"] == "missed":
            p["ltfu_count"] += 1

    for p in periods.values():
        p["rate"] = round(p["ltfu_count"] / p["total"] * 100, 1) if p["total"] else 0.0

    return {
        "data": sorted(periods.values(), key=lambda x: x["period"]),
        "ltfu_rate": breakdown["ltfu_rate"],
        "eligible": breakdown["eligible"],
        "counts": breakdown["counts"],
    }


# ── LTFU window summary (academic reporting) ──────────────────────────────────

@router.get("/ltfu-summary")
def ltfu_summary(
    from_date: date,
    to_date: date,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Fixed, reproducible LTFU summary for a closed date window, for academic reporting.

    from_date and to_date are required (unlike the live snapshots). Every scheduled
    review due in the window is assessed as-of to_date, so the same range always returns
    the same numbers."""
    _require_central(user)
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="from_date must be on or before to_date")
    return ltfu_window_summary(db, from_date, to_date, hospital_id)


# ── At-risk trend ─────────────────────────────────────────────────────────────

@router.get("/at-risk-trend")
def at_risk_trend(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    group_by: GroupBy = "month",
    hospital_id: Optional[UUID] = None,
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
    baby_ids = _hospital_baby_ids(db, hospital_id)
    if baby_ids is not None:
        first_exams = {bid: e for bid, e in first_exams.items() if e.baby_id in baby_ids}

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
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Current list of at-risk babies: treatment recommended but not yet treated."""
    _require_central(user)

    treated = _treated_baby_ids(db)
    first_exams = _first_treatment_exams(db)
    scoped_ids = _hospital_baby_ids(db, hospital_id)

    at_risk_baby_ids = [
        exam.baby_id for bid, exam in first_exams.items()
        if bid not in treated and (scoped_ids is None or exam.baby_id in scoped_ids)
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
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Babies whose appointments were missed/LTFU within the given date range."""
    _require_central(user)

    q = db.query(Appointment).filter(
        Appointment.status.in_([AppointmentStatus.MISSED, AppointmentStatus.LTFU])
    )
    baby_ids_scope = _hospital_baby_ids(db, hospital_id)
    if baby_ids_scope is not None:
        q = q.filter(Appointment.baby_id.in_(baby_ids_scope))
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


# ── KPI extras (Section 1) ────────────────────────────────────────────────────

@router.get("/kpi-extra")
def kpi_extra(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Total exams in period, treatment rate, screening coverage, avg days to first exam."""
    _require_central(user)

    babies = _scoped_babies(db, hospital_id)
    baby_ids = {b.id for b in babies}

    all_exams = db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).all() if baby_ids else []
    period_exams = [
        e for e in all_exams
        if e.exam_date and (not from_date or e.exam_date >= from_date) and (not to_date or e.exam_date <= to_date)
    ]
    total_exams = len(period_exams)

    exams_by_baby: dict = {}
    for e in sorted(all_exams, key=lambda e: e.exam_date or date.min):
        exams_by_baby.setdefault(e.baby_id, []).append(e)

    examined_baby_ids = set(exams_by_baby.keys())
    screening_coverage = round(len(examined_baby_ids) / len(babies) * 100, 1) if babies else 0.0

    outcomes = db.query(Outcome).filter(Outcome.baby_id.in_(baby_ids)).all() if baby_ids else []
    treated_ids = {o.baby_id for o in outcomes if o.treatment_type and o.treatment_type != TreatmentType.NONE}
    treatment_rate = (
        round(len(treated_ids & examined_baby_ids) / len(examined_baby_ids) * 100, 1)
        if examined_baby_ids else 0.0
    )

    # Age (in days) at first screening exam. Measured from date_of_birth rather than
    # enrolled_at: enrolled_at holds the bulk-import timestamp for historical babies,
    # which sits *after* their exam dates and produced a nonsensical negative average.
    gaps = []
    for b in babies:
        exams = exams_by_baby.get(b.id)
        if exams and exams[0].exam_date and b.date_of_birth:
            delta = (exams[0].exam_date - b.date_of_birth).days
            if delta >= 0:
                gaps.append(delta)
    avg_days_to_first_exam = round(sum(gaps) / len(gaps), 1) if gaps else None

    return {
        "total_exams": total_exams,
        "treatment_rate": treatment_rate,
        "screening_coverage": screening_coverage,
        "avg_days_to_first_exam": avg_days_to_first_exam,
    }


# ── ROP findings distribution (Section 2) ─────────────────────────────────────

@router.get("/rop-findings-distribution")
def rop_findings_distribution(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Breakdown of each examined baby's worst-ever finding, overall and per hospital."""
    _require_central(user)

    babies = _scoped_babies(db, hospital_id)
    if from_date:
        babies = [b for b in babies if b.enrolled_at and b.enrolled_at.date() >= from_date]
    if to_date:
        babies = [b for b in babies if b.enrolled_at and b.enrolled_at.date() <= to_date]
    baby_ids = {b.id for b in babies}
    worst = _worst_ever_by_baby(db, baby_ids)

    hospitals = {h.id: h.name for h in db.query(Hospital).all()}
    overall = {s.value: 0 for s in STAGE_ORDER}
    by_hospital: dict[str, dict] = {}

    for b in babies:
        exam = worst.get(b.id)
        if not exam or not exam.worst_stage:
            continue
        stage_key = exam.worst_stage.value
        overall[stage_key] += 1
        hname = hospitals.get(b.hospital_id, "Unknown")
        row = by_hospital.setdefault(hname, {s.value: 0 for s in STAGE_ORDER})
        row[stage_key] += 1

    total = sum(overall.values())
    overall_list = [
        {"stage": s.value, "count": overall[s.value], "pct": round(overall[s.value] / total * 100, 1) if total else 0.0}
        for s in STAGE_ORDER
    ]
    table = [{"hospital_name": name, **counts} for name, counts in sorted(by_hospital.items())]

    return {"overall": overall_list, "by_hospital": table}


# ── Treatment analytics (Section 3) ───────────────────────────────────────────

@router.get("/treatment-analytics")
def treatment_analytics(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    baby_ids = _hospital_baby_ids(db, hospital_id)

    outcome_q = db.query(Outcome)
    if baby_ids is not None:
        outcome_q = outcome_q.filter(Outcome.baby_id.in_(baby_ids))
    if from_date:
        outcome_q = outcome_q.filter(Outcome.treatment_date >= from_date)
    if to_date:
        outcome_q = outcome_q.filter(Outcome.treatment_date <= to_date)
    outcomes = [o for o in outcome_q.all() if o.treatment_type]

    type_labels = {
        TreatmentType.NONE: "None / Observation Only",
        TreatmentType.LASER: "Laser Photocoagulation",
        TreatmentType.ANTI_VEGF: "Anti-VEGF (Bevacizumab)",
        TreatmentType.COMBINATION: "Laser + Anti-VEGF",
        TreatmentType.SURGERY: "Vitreoretinal Surgery",
    }
    type_counts = {t: 0 for t in type_labels}
    for o in outcomes:
        type_counts[o.treatment_type] += 1
    types = [{"type": t.value, "label": type_labels[t], "count": c} for t, c in type_counts.items()]

    # Timing: worst stage at/before treatment date, for babies who actually got treated
    treated_outcomes = [o for o in outcomes if o.treatment_type != TreatmentType.NONE]
    treated_ids = {o.baby_id for o in treated_outcomes}
    exams_by_baby: dict = {}
    if treated_ids:
        for e in db.query(Exam).filter(Exam.baby_id.in_(treated_ids)).order_by(Exam.exam_date).all():
            exams_by_baby.setdefault(e.baby_id, []).append(e)

    timing_counts = {"stage_2": 0, "stage_3": 0, "stage_4": 0, "stage_5": 0}
    for o in treated_outcomes:
        exams = exams_by_baby.get(o.baby_id, [])
        relevant = [e for e in exams if not o.treatment_date or not e.exam_date or e.exam_date <= o.treatment_date]
        candidates = relevant or exams
        if not candidates:
            continue
        worst = max(candidates, key=lambda e: _STAGE_RANK.get(e.worst_stage, -99))
        if worst.worst_stage and worst.worst_stage.value in timing_counts:
            timing_counts[worst.worst_stage.value] += 1
    timing = [{"stage": k, "count": v} for k, v in timing_counts.items()]

    # Flagged untreated: worst-ever stage >= Stage 2, no active treatment recorded
    scoped_babies = _scoped_babies(db, hospital_id)
    all_baby_ids = {b.id for b in scoped_babies}
    worst_ever = _worst_ever_by_baby(db, all_baby_ids)
    treated_lookup = {
        o.baby_id: o for o in db.query(Outcome).filter(Outcome.baby_id.in_(all_baby_ids)).all()
    } if all_baby_ids else {}
    flagged = 0
    for b in scoped_babies:
        exam = worst_ever.get(b.id)
        if not exam or not exam.worst_stage or _STAGE_RANK.get(exam.worst_stage, -99) < 2:
            continue
        outcome = treated_lookup.get(b.id)
        if not outcome or not outcome.treatment_type or outcome.treatment_type == TreatmentType.NONE:
            flagged += 1

    return {"types": types, "timing": timing, "flagged_untreated_count": flagged}


# ── LTFU deep dive (Section 4) ────────────────────────────────────────────────

@router.get("/ltfu-deep-dive")
def ltfu_deep_dive(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    # Derived from the per-baby six-tier follow-up classification, not appointment
    # status flags. As-of-today snapshot: from_date/to_date are accepted for API
    # compatibility but do not window a current-state classification.
    breakdown = followup_breakdown(db, hospital_id)
    entries = breakdown["entries"]
    today = date.today()

    ltfu_entries = [e for e in entries if e["tier"] == FOLLOWUP_LTFU]
    late_entries = [e for e in entries if e["tier"] == FOLLOWUP_LATE]
    total_episodes = len(ltfu_entries)

    overdue_days = [
        (today - e["next_review"]).days for e in ltfu_entries if e["next_review"]
    ]
    median_days_overdue = round(statistics.median(overdue_days), 1) if overdue_days else None

    # Recovery: of babies who fell overdue, how many eventually returned (late attenders)
    # vs. remained lost. late / (late + ltfu).
    recovery_denom = len(ltfu_entries) + len(late_entries)
    recovery_rate = round(len(late_entries) / recovery_denom * 100, 1) if recovery_denom else 0.0

    # By hospital: LTFU rate among babies engaged in follow-up at each hospital.
    hospitals = {h.id: h.name for h in db.query(Hospital).all()}
    by_hospital_counts: dict = {}
    for e in entries:
        if e["tier"] not in FOLLOWUP_IN_FOLLOWUP:
            continue
        row = by_hospital_counts.setdefault(e["hospital_id"], {"total": 0, "ltfu": 0})
        row["total"] += 1
        if e["tier"] == FOLLOWUP_LTFU:
            row["ltfu"] += 1
    by_hospital = [
        {
            "hospital_name": hospitals.get(hid, "Unknown"),
            "ltfu_count": v["ltfu"],
            "rate": round(v["ltfu"] / v["total"] * 100, 1) if v["total"] else 0.0,
        }
        for hid, v in by_hospital_counts.items()
    ]
    by_hospital.sort(key=lambda r: r["rate"], reverse=True)

    # By GA band
    baby_ga = {b.id: b.gestational_age_weeks for b in db.query(Baby.id, Baby.gestational_age_weeks).all()}
    band_counts = {b: {"total": 0, "ltfu": 0} for b in GA_BANDS}
    for e in entries:
        if e["tier"] not in FOLLOWUP_IN_FOLLOWUP:
            continue
        band = _ga_band(baby_ga.get(e["baby_id"]))
        if not band:
            continue
        band_counts[band]["total"] += 1
        if e["tier"] == FOLLOWUP_LTFU:
            band_counts[band]["ltfu"] += 1
    by_ga_band = [
        {
            "band": b, "label": GA_BAND_LABELS[b],
            "ltfu_count": band_counts[b]["ltfu"],
            "rate": round(band_counts[b]["ltfu"] / band_counts[b]["total"] * 100, 1) if band_counts[b]["total"] else 0.0,
        }
        for b in GA_BANDS
    ]

    return {
        "total_episodes": total_episodes,
        "median_days_overdue": median_days_overdue,
        "recovery_rate": recovery_rate,
        "by_hospital": by_hospital,
        "by_ga_band": by_ga_band,
    }


# ── Appointment adherence (Section 5) ─────────────────────────────────────────

@router.get("/adherence")
def adherence(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    baby_ids = _hospital_baby_ids(db, hospital_id)
    appt_q = db.query(Appointment).filter(Appointment.status.in_([
        AppointmentStatus.ATTENDED, AppointmentStatus.MISSED, AppointmentStatus.LTFU,
    ]))
    if baby_ids is not None:
        appt_q = appt_q.filter(Appointment.baby_id.in_(baby_ids))
    if from_date:
        appt_q = appt_q.filter(Appointment.due_date >= from_date)
    if to_date:
        appt_q = appt_q.filter(Appointment.due_date <= to_date)
    appts = appt_q.all()

    # Over time (always monthly, regardless of the page's overall grouping).
    # Adherence = returned within the grace window for a scheduled review, derived from
    # review episodes rather than appointment status flags (which the historical import
    # never set to MISSED/LTFU, previously pinning this line flat at 100%). Pending
    # (unresolved) reviews are excluded.
    episodes = all_review_episodes(db, hospital_id)
    periods: dict = {}
    for ep in episodes:
        if ep["outcome"] == "pending":
            continue
        review = ep["review_date"]
        if from_date and review < from_date:
            continue
        if to_date and review > to_date:
            continue
        key, label = _period_key(review, "month")
        p = periods.setdefault(key, {"period": key, "label": label, "attended": 0, "total": 0})
        p["total"] += 1
        if ep["outcome"] == "attended":
            p["attended"] += 1
    over_time = [
        {"period": p["period"], "label": p["label"], "rate": round(p["attended"] / p["total"] * 100, 1) if p["total"] else 0.0}
        for p in sorted(periods.values(), key=lambda x: x["period"])
    ]

    # Reminders per appointment (SMS sent/acknowledged before due date)
    appt_ids = [a.id for a in appts]
    reminders_by_appt: dict = {}
    if appt_ids:
        for r in db.query(Reminder).filter(Reminder.appointment_id.in_(appt_ids)).all():
            reminders_by_appt.setdefault(r.appointment_id, []).append(r)

    def had_sms(appt):
        return any(r.status in (ReminderStatus.SENT, ReminderStatus.ACKNOWLEDGED) for r in reminders_by_appt.get(appt.id, []))

    sms_group = {"total": 0, "attended": 0}
    no_sms_group = {"total": 0, "attended": 0}
    for a in appts:
        g = sms_group if had_sms(a) else no_sms_group
        g["total"] += 1
        if a.status == AppointmentStatus.ATTENDED:
            g["attended"] += 1
    by_reminder_status = [
        {"group": "SMS sent", "rate": round(sms_group["attended"] / sms_group["total"] * 100, 1) if sms_group["total"] else 0.0, "total": sms_group["total"]},
        {"group": "No SMS", "rate": round(no_sms_group["attended"] / no_sms_group["total"] * 100, 1) if no_sms_group["total"] else 0.0, "total": no_sms_group["total"]},
    ]

    # By caregiver language
    baby_lang = {b.id: b.language_preference for b in db.query(Baby.id, Baby.language_preference).all()}
    lang_groups: dict = {}
    for a in appts:
        lang = baby_lang.get(a.baby_id)
        lang_key = lang.value if lang else "unknown"
        g = lang_groups.setdefault(lang_key, {"total": 0, "attended": 0})
        g["total"] += 1
        if a.status == AppointmentStatus.ATTENDED:
            g["attended"] += 1
    by_language = [
        {"language": k, "rate": round(v["attended"] / v["total"] * 100, 1) if v["total"] else 0.0, "total": v["total"]}
        for k, v in lang_groups.items()
    ]

    # Avg reminders sent before attendance
    attended_appts = [a for a in appts if a.status == AppointmentStatus.ATTENDED]
    counts = []
    for a in attended_appts:
        n = sum(
            1 for r in reminders_by_appt.get(a.id, [])
            if r.status in (ReminderStatus.SENT, ReminderStatus.ACKNOWLEDGED)
            and (not a.attended_at or not r.sent_at or r.sent_at <= a.attended_at)
        )
        counts.append(n)
    avg_reminders_before_attendance = round(sum(counts) / len(counts), 2) if counts else None

    return {
        "over_time": over_time,
        "by_reminder_status": by_reminder_status,
        "by_language": by_language,
        "avg_reminders_before_attendance": avg_reminders_before_attendance,
    }


# ── Screening programme performance (Section 6) ───────────────────────────────

@router.get("/programme-performance")
def programme_performance(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    babies = _scoped_babies(db, hospital_id)
    if from_date:
        babies = [b for b in babies if b.enrolled_at and b.enrolled_at.date() >= from_date]
    if to_date:
        babies = [b for b in babies if b.enrolled_at and b.enrolled_at.date() <= to_date]
    baby_ids = {b.id for b in babies}

    exams_by_baby: dict = {}
    if baby_ids:
        for e in db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).order_by(Exam.exam_date).all():
            exams_by_baby.setdefault(e.baby_id, []).append(e)

    # Time birth -> first exam
    bins = [(0, 7), (8, 14), (15, 21), (22, 28), (29, 35), (36, 42)]
    histogram = {f"{lo}-{hi}d": 0 for lo, hi in bins}
    histogram["42d+"] = 0
    under_30wk_total = 0
    under_30wk_on_target = 0
    for b in babies:
        exams = exams_by_baby.get(b.id)
        if not exams or not exams[0].exam_date or not b.date_of_birth:
            continue
        days = (exams[0].exam_date - b.date_of_birth).days
        if days < 0:
            continue
        placed = False
        for lo, hi in bins:
            if lo <= days <= hi:
                histogram[f"{lo}-{hi}d"] += 1
                placed = True
                break
        if not placed:
            histogram["42d+"] += 1
        if b.gestational_age_weeks is not None and b.gestational_age_weeks < 30:
            under_30wk_total += 1
            if days <= 28:
                under_30wk_on_target += 1
    time_to_first_exam = {
        "histogram": [{"bucket": k, "count": v} for k, v in histogram.items()],
        "pct_under_30wk_on_target": round(under_30wk_on_target / under_30wk_total * 100, 1) if under_30wk_total else None,
    }

    # Time Stage-2+ diagnosis -> treatment
    outcome_q = db.query(Outcome).filter(Outcome.baby_id.in_(baby_ids)) if baby_ids else None
    treated = [
        o for o in (outcome_q.all() if outcome_q is not None else [])
        if o.treatment_type and o.treatment_type != TreatmentType.NONE and o.treatment_date
    ]
    t_bins = [(0, 3), (4, 7), (8, 14), (15, 21)]
    t_hist = {f"{lo}-{hi}d": 0 for lo, hi in t_bins}
    t_hist["22d+"] = 0
    within_target = 0
    treated_with_diagnosis = 0
    for o in treated:
        diag_exams = [e for e in exams_by_baby.get(o.baby_id, []) if e.worst_stage and _STAGE_RANK.get(e.worst_stage, -99) >= 2]
        if not diag_exams or not diag_exams[0].exam_date:
            continue
        days = (o.treatment_date - diag_exams[0].exam_date).days
        if days < 0:
            continue
        treated_with_diagnosis += 1
        placed = False
        for lo, hi in t_bins:
            if lo <= days <= hi:
                t_hist[f"{lo}-{hi}d"] += 1
                placed = True
                break
        if not placed:
            t_hist["22d+"] += 1
        if days <= 7:
            within_target += 1
    time_to_treatment = {
        "histogram": [{"bucket": k, "count": v} for k, v in t_hist.items()],
        "pct_within_7_days": round(within_target / treated_with_diagnosis * 100, 1) if treated_with_diagnosis else None,
    }

    # Exam frequency compliance (actual gap vs calculate_next_exam_weeks of the earlier exam)
    compliant = 0
    pairs = 0
    for b in babies:
        exams = exams_by_baby.get(b.id, [])
        for i in range(len(exams) - 1):
            e1, e2 = exams[i], exams[i + 1]
            if not e1.exam_date or not e2.exam_date:
                continue
            recommended_weeks = calculate_next_exam_weeks(e1.worst_zone, e1.worst_stage, e1.has_plus_disease == "yes")
            actual_days = (e2.exam_date - e1.exam_date).days
            pairs += 1
            if actual_days <= recommended_weeks * 7 + 2:  # small grace for real-world scheduling slack
                compliant += 1
    exam_frequency_compliance_pct = round(compliant / pairs * 100, 1) if pairs else None

    # Bilateral completeness
    all_exams = [e for exams in exams_by_baby.values() for e in exams]
    bilateral = sum(1 for e in all_exams if e.right_zone is not None and e.left_zone is not None)
    bilateral_completeness_pct = round(bilateral / len(all_exams) * 100, 1) if all_exams else None

    return {
        "time_to_first_exam": time_to_first_exam,
        "time_to_treatment": time_to_treatment,
        "exam_frequency_compliance_pct": exam_frequency_compliance_pct,
        "bilateral_completeness_pct": bilateral_completeness_pct,
    }


# ── Patient profile (Section 7) ───────────────────────────────────────────────

@router.get("/patient-profile")
def patient_profile(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    babies = _scoped_babies(db, hospital_id)
    if from_date:
        babies = [b for b in babies if b.enrolled_at and b.enrolled_at.date() >= from_date]
    if to_date:
        babies = [b for b in babies if b.enrolled_at and b.enrolled_at.date() <= to_date]
    baby_ids = {b.id for b in babies}

    # GA histogram, 2-week bands
    ga_bins: dict = {}
    for b in babies:
        if b.gestational_age_weeks is None:
            continue
        band_lo = int(b.gestational_age_weeks // 2) * 2
        key = f"{band_lo}-{band_lo + 2}w"
        ga_bins[key] = ga_bins.get(key, 0) + 1
    ga_histogram = [
        {"band": k, "count": v} for k, v in sorted(ga_bins.items(), key=lambda kv: int(kv[0].split('-')[0]))
    ]

    # Weight bands
    weight_counts = {w: 0 for w in WEIGHT_BANDS}
    for b in babies:
        band = _weight_band(b.birth_weight_grams)
        if band:
            weight_counts[band] += 1
    weight_bands = [{"band": w, "label": WEIGHT_BAND_LABELS[w], "count": weight_counts[w]} for w in WEIGHT_BANDS]

    # Risk factor frequency
    risk_counts = []
    for field, label in RISK_FACTORS:
        count = sum(1 for b in babies if getattr(b, field, False))
        risk_counts.append({"factor": field, "label": label, "count": count})
    risk_counts.sort(key=lambda r: r["count"], reverse=True)

    # Correlation: avg worst-ever stage rank per risk factor
    worst = _worst_ever_by_baby(db, baby_ids)

    def stage_rank_for(b):
        e = worst.get(b.id)
        return _STAGE_RANK.get(e.worst_stage) if e and e.worst_stage else None

    correlation = []
    for field, label in RISK_FACTORS:
        ranks = [r for r in (stage_rank_for(b) for b in babies if getattr(b, field, False)) if r is not None]
        avg = round(sum(ranks) / len(ranks), 2) if ranks else None
        correlation.append({"factor": field, "label": label, "avg_worst_stage_rank": avg, "n": len(ranks)})

    return {
        "ga_histogram": ga_histogram,
        "weight_bands": weight_bands,
        "risk_factor_frequency": risk_counts,
        "risk_factor_stage_correlation": correlation,
    }


# ── Visual outcomes (Section 8) ───────────────────────────────────────────────

@router.get("/visual-outcomes")
def visual_outcomes(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    baby_ids = _hospital_baby_ids(db, hospital_id)
    q = db.query(Outcome)
    if baby_ids is not None:
        q = q.filter(Outcome.baby_id.in_(baby_ids))
    outcomes = q.all()

    if not outcomes:
        return {"has_data": False}

    outcome_labels = {
        VisualOutcome.GOOD_VISION: "Good Vision",
        VisualOutcome.MILD_IMPAIRMENT: "Mild Impairment",
        VisualOutcome.SEVERE_IMPAIRMENT: "Severe Impairment",
        VisualOutcome.BLIND: "Blind",
        VisualOutcome.TOO_YOUNG: "Too Young to Assess",
        VisualOutcome.LTFU_BEFORE_OUTCOME: "LTFU Before Outcome Known",
    }
    dist_counts = {o: 0 for o in outcome_labels}
    for o in outcomes:
        if o.visual_outcome:
            dist_counts[o.visual_outcome] += 1
    distribution = [{"outcome": k.value, "label": v, "count": dist_counts[k]} for k, v in outcome_labels.items()]

    # By treatment type
    type_labels = {
        TreatmentType.LASER: "Laser",
        TreatmentType.ANTI_VEGF: "Anti-VEGF",
        TreatmentType.COMBINATION: "Laser + Anti-VEGF",
        TreatmentType.SURGERY: "Surgery",
    }
    by_treatment = []
    for ttype, tlabel in type_labels.items():
        group = [o for o in outcomes if o.treatment_type == ttype and o.visual_outcome]
        counts: dict = {}
        for o in group:
            counts[o.visual_outcome.value] = counts.get(o.visual_outcome.value, 0) + 1
        by_treatment.append({"treatment_type": ttype.value, "label": tlabel, "n": len(group), "outcomes": counts})

    # Blindness prevention: treated while worst-to-date stage was 2 or 3 (i.e. before 4/5)
    treated_ids = {o.baby_id for o in outcomes if o.treatment_type and o.treatment_type != TreatmentType.NONE}
    exams_by_baby: dict = {}
    if treated_ids:
        for e in db.query(Exam).filter(Exam.baby_id.in_(treated_ids)).order_by(Exam.exam_date).all():
            exams_by_baby.setdefault(e.baby_id, []).append(e)
    blindness_prevention_count = 0
    for o in outcomes:
        if not o.treatment_type or o.treatment_type == TreatmentType.NONE:
            continue
        exams = exams_by_baby.get(o.baby_id, [])
        relevant = [e for e in exams if not o.treatment_date or not e.exam_date or e.exam_date <= o.treatment_date] or exams
        if not relevant:
            continue
        worst = max(relevant, key=lambda e: _STAGE_RANK.get(e.worst_stage, -99))
        if worst.worst_stage in (Stage.STAGE_2, Stage.STAGE_3):
            blindness_prevention_count += 1

    # Discharge status
    discharge_labels = {
        DischargeStatus.COMPLETED_NO_ROP: "Completed - No ROP",
        DischargeStatus.COMPLETED_TREATED: "Completed - Treated",
        DischargeStatus.REFERRED_NATIONAL: "Referred (National)",
        DischargeStatus.REFERRED_ABROAD: "Referred (Abroad)",
        DischargeStatus.DIED: "Died",
        DischargeStatus.LOST: "Lost to Follow-Up",
        DischargeStatus.ONGOING: "Still Under Follow-Up",
    }
    disc_counts = {d: 0 for d in discharge_labels}
    for o in outcomes:
        if o.discharge_status:
            disc_counts[o.discharge_status] += 1
    discharge_status = [{"status": k.value, "label": v, "count": disc_counts[k]} for k, v in discharge_labels.items()]

    return {
        "has_data": True,
        "distribution": distribution,
        "by_treatment": by_treatment,
        "blindness_prevention_count": blindness_prevention_count,
        "discharge_status": discharge_status,
    }


# ── SMS / reminder performance (Section 9) ────────────────────────────────────

@router.get("/reminder-performance")
def reminder_performance(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    baby_ids = _hospital_baby_ids(db, hospital_id)
    q = db.query(Reminder)
    if baby_ids is not None:
        q = q.filter(Reminder.baby_id.in_(baby_ids))
    if from_date:
        q = q.filter(Reminder.created_at >= datetime(from_date.year, from_date.month, from_date.day, tzinfo=timezone.utc))
    if to_date:
        q = q.filter(Reminder.created_at <= datetime(to_date.year, to_date.month, to_date.day, 23, 59, 59, tzinfo=timezone.utc))
    reminders = q.all()

    total = len(reminders)
    delivered = sum(1 for r in reminders if r.status in (ReminderStatus.SENT, ReminderStatus.ACKNOWLEDGED))
    failed = sum(1 for r in reminders if r.status == ReminderStatus.FAILED)
    delivery_rate = round(delivered / total * 100, 1) if total else 0.0
    failure_rate = round(failed / total * 100, 1) if total else 0.0

    # By carrier (matched against the baby's registered MTN/Airtel numbers)
    baby_phones = {b.id: (b.mtn_phone, b.airtel_phone) for b in db.query(Baby.id, Baby.mtn_phone, Baby.airtel_phone).all()}

    def carrier_for(r):
        mtn, airtel = baby_phones.get(r.baby_id, (None, None))
        if r.recipient_phone and mtn and r.recipient_phone == mtn:
            return "MTN"
        if r.recipient_phone and airtel and r.recipient_phone == airtel:
            return "Airtel"
        return "Unknown"

    carrier_groups: dict = {}
    for r in reminders:
        g = carrier_groups.setdefault(carrier_for(r), {"total": 0, "delivered": 0})
        g["total"] += 1
        if r.status in (ReminderStatus.SENT, ReminderStatus.ACKNOWLEDGED):
            g["delivered"] += 1
    by_carrier = [
        {"carrier": k, "rate": round(v["delivered"] / v["total"] * 100, 1) if v["total"] else 0.0, "total": v["total"]}
        for k, v in carrier_groups.items()
    ]

    # By language
    lang_groups: dict = {}
    for r in reminders:
        g = lang_groups.setdefault(r.language or "unknown", {"total": 0, "delivered": 0})
        g["total"] += 1
        if r.status in (ReminderStatus.SENT, ReminderStatus.ACKNOWLEDGED):
            g["delivered"] += 1
    by_language = [
        {"language": k, "rate": round(v["delivered"] / v["total"] * 100, 1) if v["total"] else 0.0, "total": v["total"]}
        for k, v in lang_groups.items()
    ]

    # Avg reminders before attendance (same calc as /adherence)
    appt_q = db.query(Appointment).filter(Appointment.status == AppointmentStatus.ATTENDED)
    if baby_ids is not None:
        appt_q = appt_q.filter(Appointment.baby_id.in_(baby_ids))
    if from_date:
        appt_q = appt_q.filter(Appointment.due_date >= from_date)
    if to_date:
        appt_q = appt_q.filter(Appointment.due_date <= to_date)
    attended_appts = appt_q.all()
    appt_ids = [a.id for a in attended_appts]
    reminders_by_appt: dict = {}
    if appt_ids:
        for r in db.query(Reminder).filter(Reminder.appointment_id.in_(appt_ids)).all():
            reminders_by_appt.setdefault(r.appointment_id, []).append(r)
    counts = [
        sum(1 for r in reminders_by_appt.get(a.id, []) if r.status in (ReminderStatus.SENT, ReminderStatus.ACKNOWLEDGED))
        for a in attended_appts
    ]
    avg_reminders_before_attendance = round(sum(counts) / len(counts), 2) if counts else None

    # Failed by human-readable reason
    reason_counts: dict = {}
    for r in reminders:
        if r.status != ReminderStatus.FAILED:
            continue
        cat = _sms_error_category(r.error_message)
        reason_counts[cat] = reason_counts.get(cat, 0) + 1
    failed_by_reason = [{"reason": k, "count": v} for k, v in sorted(reason_counts.items(), key=lambda kv: -kv[1])]

    return {
        "total_sent": total,
        "delivery_rate": delivery_rate,
        "failure_rate": failure_rate,
        "by_carrier": by_carrier,
        "by_language": by_language,
        "avg_reminders_before_attendance": avg_reminders_before_attendance,
        "failed_by_reason": failed_by_reason,
    }


# ── Hospital network comparison (Section 10) ──────────────────────────────────

@router.get("/hospital-comparison")
def hospital_comparison(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_central(user)

    hospitals = db.query(Hospital).filter(Hospital.is_active == True).all()  # noqa: E712
    babies = db.query(Baby).all()
    babies_by_hospital: dict = {}
    for b in babies:
        babies_by_hospital.setdefault(b.hospital_id, []).append(b)

    all_baby_ids = {b.id for b in babies}
    exams_by_baby: dict = {}
    if all_baby_ids:
        for e in db.query(Exam).filter(Exam.baby_id.in_(all_baby_ids)).order_by(Exam.exam_date).all():
            exams_by_baby.setdefault(e.baby_id, []).append(e)

    outcomes_by_baby = {o.baby_id: o for o in db.query(Outcome).all()}

    appts_by_baby: dict = {}
    for a in db.query(Appointment).all():
        appts_by_baby.setdefault(a.baby_id, []).append(a)

    reminders_by_baby: dict = {}
    for r in db.query(Reminder).all():
        reminders_by_baby.setdefault(r.baby_id, []).append(r)

    def in_period(d):
        if not d:
            return False
        if from_date and d < from_date:
            return False
        if to_date and d > to_date:
            return False
        return True

    rows = []
    for h in hospitals:
        hbabies = babies_by_hospital.get(h.id, [])
        enrolled = sum(1 for b in hbabies if b.enrolled_at and in_period(b.enrolled_at.date()))

        exam_count = 0
        gaps = []
        last_activity = None
        for b in hbabies:
            exams = exams_by_baby.get(b.id, [])
            for e in exams:
                if e.exam_date and in_period(e.exam_date):
                    exam_count += 1
                if e.created_at and (last_activity is None or e.created_at > last_activity):
                    last_activity = e.created_at
            if exams and exams[0].exam_date and b.date_of_birth:
                delta = (exams[0].exam_date - b.date_of_birth).days
                if delta >= 0:
                    gaps.append(delta)
        avg_days_to_first_exam = round(sum(gaps) / len(gaps), 1) if gaps else None

        hospital_appts = [a for b in hbabies for a in appts_by_baby.get(b.id, []) if a.due_date and in_period(a.due_date)]
        ltfu_count = sum(1 for a in hospital_appts if a.status == AppointmentStatus.LTFU)
        ltfu_rate = round(ltfu_count / len(hospital_appts) * 100, 1) if hospital_appts else 0.0

        examined_ids = {b.id for b in hbabies if exams_by_baby.get(b.id)}
        treated_ids = {
            bid for bid in examined_ids
            if outcomes_by_baby.get(bid) and outcomes_by_baby[bid].treatment_type
            and outcomes_by_baby[bid].treatment_type != TreatmentType.NONE
        }
        treatment_rate = round(len(treated_ids) / len(examined_ids) * 100, 1) if examined_ids else 0.0

        hospital_reminders = [
            r for b in hbabies for r in reminders_by_baby.get(b.id, [])
            if r.created_at and in_period(r.created_at.date())
        ]
        delivered = sum(1 for r in hospital_reminders if r.status in (ReminderStatus.SENT, ReminderStatus.ACKNOWLEDGED))
        sms_delivery_rate = round(delivered / len(hospital_reminders) * 100, 1) if hospital_reminders else 0.0

        if not last_activity and hbabies:
            last_activity = max((b.enrolled_at for b in hbabies if b.enrolled_at), default=None)

        rows.append({
            "id": str(h.id),
            "name": h.name,
            "enrolled": enrolled,
            "exams": exam_count,
            "ltfu_rate": ltfu_rate,
            "treatment_rate": treatment_rate,
            "avg_days_to_first_exam": avg_days_to_first_exam,
            "sms_delivery_rate": sms_delivery_rate,
            "last_activity": last_activity.isoformat() if last_activity else None,
        })

    return {"hospitals": rows}


# ── Flagged-untreated babies list (drill-down for Section 3) ─────────────────

@router.get("/flagged-untreated-babies")
def flagged_untreated_babies(
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Babies whose worst-ever stage is Stage 2+ with no treatment recorded."""
    _require_central(user)

    babies = _scoped_babies(db, hospital_id)
    baby_ids = {b.id for b in babies}
    worst_ever = _worst_ever_by_baby(db, baby_ids)
    outcomes = {
        o.baby_id: o for o in db.query(Outcome).filter(Outcome.baby_id.in_(baby_ids)).all()
    } if baby_ids else {}
    hospitals = {h.id: h.name for h in db.query(Hospital).all()}

    today = date.today()
    result = []
    for b in babies:
        exam = worst_ever.get(b.id)
        if not exam or not exam.worst_stage or _STAGE_RANK.get(exam.worst_stage, -99) < 2:
            continue
        outcome = outcomes.get(b.id)
        if outcome and outcome.treatment_type and outcome.treatment_type != TreatmentType.NONE:
            continue
        result.append({
            "id": str(b.id),
            "full_name": b.full_name,
            "hospital_name": hospitals.get(b.hospital_id, "Unknown"),
            "status": b.status.value if b.status else None,
            "zone": exam.worst_zone,
            "stage": exam.worst_stage,
            "last_exam_date": exam.exam_date.isoformat() if exam.exam_date else None,
            "days_since_diagnosis": (today - exam.exam_date).days if exam.exam_date else None,
        })

    result.sort(key=lambda x: x["days_since_diagnosis"] or 0, reverse=True)
    return {"babies": result, "total": len(result)}
