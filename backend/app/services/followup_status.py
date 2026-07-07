"""
Per-baby follow-up status classification.

A single baby is placed into exactly one of six mutually-exclusive tiers based on
their exam history and the review dates scheduled off each exam. This is the
authoritative definition of "loss to follow-up" (LTFU) for the programme and is
computed as-of `today`, not from appointment status flags (which historical
imports never populate).

Tiers
-----
- discharged        : formally discharged from screening (Baby.status == DISCHARGED)
- ebne              : enrolled but never examined (no exam findings recorded at all)
- ltfu              : all four LTFU criteria met (see classify_baby)
- late_attender     : returned, but more than LTFU_GRACE_DAYS after a scheduled review
- pending           : next review not yet arrived, or overdue by <= LTFU_GRACE_DAYS
- completed_followup: attended everything on time with no overdue review pending

LTFU criteria (all must hold):
  1. Not discharged
  2. Their scheduled next-review date has passed (< today)
  3. They did not return within LTFU_GRACE_DAYS after that scheduled date
  4. No later visit exists in their record

Note: "days to first exam" and other date-based programme metrics deliberately do
NOT key off Baby.enrolled_at for imported babies, because that column holds the
bulk-import timestamp rather than a real enrollment date.
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.baby import Baby, BabyStatus
from app.models.exam import Exam
from app.models.appointment import Appointment
from app.models.hospital import Hospital

LTFU_GRACE_DAYS = 14

DISCHARGED = "discharged"
COMPLETED = "completed_followup"
LATE = "late_attender"
LTFU = "ltfu"
EBNE = "ebne"
PENDING = "pending"

# Tiers that represent a baby actively engaged in the follow-up process
# (examined, not discharged). These form the denominator of the LTFU rate.
IN_FOLLOWUP = (LTFU, LATE, PENDING, COMPLETED)

ALL_STATUSES = [DISCHARGED, COMPLETED, LATE, LTFU, EBNE, PENDING]

STATUS_LABELS = {
    DISCHARGED: "Discharged",
    COMPLETED: "Completed follow-up",
    LATE: "Late attender",
    LTFU: "Lost to follow-up",
    EBNE: "Enrolled but not examined",
    PENDING: "Pending",
}


def classify_baby(
    status: Optional[BabyStatus],
    exams: list[Exam],
    appts: list[Appointment],
    today: date,
) -> tuple[str, Optional[date]]:
    """Classify one baby. Returns (tier, next_review_date).

    `exams` and `appts` are that baby's own exams/appointments (any order).
    `next_review_date` is the scheduled review currently being evaluated (may be None).
    """
    if status == BabyStatus.DISCHARGED:
        return DISCHARGED, None

    exams = sorted((e for e in exams if e.exam_date), key=lambda e: e.exam_date)
    if not exams:
        return EBNE, None

    # Each appointment records the exam that generated it (exam_id) and the review
    # date the baby was told to return by (due_date). Map exam -> its review date.
    due_by_exam: dict[UUID, date] = {}
    for a in appts:
        if a.exam_id and a.due_date:
            prev = due_by_exam.get(a.exam_id)
            if prev is None or a.due_date > prev:
                due_by_exam[a.exam_id] = a.due_date

    last_exam = exams[-1]
    next_review = due_by_exam.get(last_exam.id)
    if next_review is None:
        # Last exam scheduled no follow-up (e.g. manual appt, or unclear review date):
        # fall back to the most recent review date that no later visit has fulfilled.
        unfulfilled = [
            a.due_date for a in appts
            if a.due_date and not any(e.exam_date and e.exam_date >= a.due_date for e in exams)
        ]
        next_review = max(unfulfilled) if unfulfilled else None

    # Historical lateness: did any return land more than the grace window after the
    # review date that preceded it?
    late = False
    for i in range(len(exams) - 1):
        r = due_by_exam.get(exams[i].id)
        nxt = exams[i + 1].exam_date
        if r and nxt and (nxt - r).days > LTFU_GRACE_DAYS:
            late = True
            break

    # Criteria 2-4: a scheduled review is now more than the grace window overdue, and
    # (because next_review is anchored to the last visit) no later visit exists.
    if next_review is not None and next_review < today and (today - next_review).days > LTFU_GRACE_DAYS:
        return LTFU, next_review
    if late:
        return LATE, next_review
    if next_review is not None and next_review >= today:
        return COMPLETED, next_review
    if next_review is not None and (today - next_review).days <= LTFU_GRACE_DAYS:
        return PENDING, next_review
    # No pending review at all -> screening concluded without a formal discharge.
    return COMPLETED, next_review


def review_episodes(
    exams: list[Exam],
    appts: list[Appointment],
    today: date,
) -> list[dict]:
    """One record per scheduled review in a baby's history.

    Returns [{"review_date": date, "outcome": str}] where outcome is:
      attended - the baby returned within the grace window (<= LTFU_GRACE_DAYS late,
                 or early) for that review
      late     - the baby returned, but more than the grace window after the review
      missed   - the review is now past due + grace with no return (the LTFU review)
      pending  - the review is not yet resolved (in the future / still within grace)

    Used for adherence-over-time, which needs per-review granularity across a baby's
    whole history rather than just their current status.
    """
    exams = sorted((e for e in exams if e.exam_date), key=lambda e: e.exam_date)
    if not exams:
        return []

    due_by_exam: dict[UUID, date] = {}
    for a in appts:
        if a.exam_id and a.due_date:
            prev = due_by_exam.get(a.exam_id)
            if prev is None or a.due_date > prev:
                due_by_exam[a.exam_id] = a.due_date

    episodes = []
    for i, e in enumerate(exams):
        review = due_by_exam.get(e.id)
        if not review:
            continue
        nxt = exams[i + 1].exam_date if i + 1 < len(exams) else None
        if nxt is not None:
            delta = (nxt - review).days
            episodes.append({"review_date": review, "outcome": "attended" if delta <= LTFU_GRACE_DAYS else "late"})
        elif (today - review).days > LTFU_GRACE_DAYS:
            episodes.append({"review_date": review, "outcome": "missed"})
        else:
            episodes.append({"review_date": review, "outcome": "pending"})
    return episodes


def all_review_episodes(
    db: Session,
    hospital_id: Optional[UUID] = None,
    today: Optional[date] = None,
) -> list[dict]:
    """Flat list of review episodes across every baby in scope (see review_episodes)."""
    today = today or date.today()

    bq = db.query(Baby)
    if hospital_id:
        bq = bq.filter(Baby.hospital_id == hospital_id)
    babies = bq.all()
    baby_ids = [b.id for b in babies]

    exams_by_baby: dict[UUID, list[Exam]] = {}
    appts_by_baby: dict[UUID, list[Appointment]] = {}
    if baby_ids:
        for e in db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).all():
            exams_by_baby.setdefault(e.baby_id, []).append(e)
        for a in db.query(Appointment).filter(Appointment.baby_id.in_(baby_ids)).all():
            appts_by_baby.setdefault(a.baby_id, []).append(a)

    out = []
    for b in babies:
        out.extend(review_episodes(exams_by_baby.get(b.id, []), appts_by_baby.get(b.id, []), today))
    return out


def ltfu_window_summary(
    db: Session,
    from_date: date,
    to_date: date,
    hospital_id: Optional[UUID] = None,
) -> dict:
    """Fixed, reproducible LTFU summary for a closed date window [from_date, to_date].

    Unlike the live snapshot (followup_breakdown / ltfu-deep-dive), every review is
    assessed as-of `to_date` (the window end), so the same range always yields the same
    numbers regardless of when the report is run - suitable for academic reporting.

    The denominator is scheduled follow-up reviews whose due date falls in the window.
    A review is `missed` (LTFU) when it was still overdue by more than LTFU_GRACE_DAYS
    with no return by to_date; `attended`/`late` when the baby returned within/after the
    grace window; `pending` reviews (not yet resolvable by to_date) are excluded from the
    rate denominator.
    """
    bq = db.query(Baby)
    if hospital_id:
        bq = bq.filter(Baby.hospital_id == hospital_id)
    babies = bq.all()
    baby_ids = [b.id for b in babies]

    exams_by_baby: dict[UUID, list[Exam]] = {}
    appts_by_baby: dict[UUID, list[Appointment]] = {}
    if baby_ids:
        for e in db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).all():
            exams_by_baby.setdefault(e.baby_id, []).append(e)
        for a in db.query(Appointment).filter(Appointment.baby_id.in_(baby_ids)).all():
            appts_by_baby.setdefault(a.baby_id, []).append(a)

    def _blank() -> dict:
        return {"attended": 0, "late": 0, "missed": 0, "pending": 0}

    overall = _blank()
    per_hospital: dict[UUID, dict] = {}
    for b in babies:
        # Assess this baby's whole review history as of the window end (to_date).
        for ep in review_episodes(exams_by_baby.get(b.id, []), appts_by_baby.get(b.id, []), to_date):
            review = ep["review_date"]
            if review < from_date or review > to_date:
                continue
            overall[ep["outcome"]] += 1
            per_hospital.setdefault(b.hospital_id, _blank())[ep["outcome"]] += 1

    def _rate(bucket: dict) -> tuple[int, Optional[float]]:
        resolved = bucket["attended"] + bucket["late"] + bucket["missed"]
        rate = round(bucket["missed"] / resolved * 100, 1) if resolved else None
        return resolved, rate

    resolved, ltfu_rate = _rate(overall)
    attendance = round(overall["attended"] / resolved * 100, 1) if resolved else None

    hospitals = {h.id: h.name for h in db.query(Hospital).all()} if per_hospital else {}
    by_hospital = []
    for hid, bucket in per_hospital.items():
        h_resolved, h_rate = _rate(bucket)
        by_hospital.append({
            "hospital_name": hospitals.get(hid, "Unknown"),
            "reviews_due": bucket["attended"] + bucket["late"] + bucket["missed"] + bucket["pending"],
            "resolved": h_resolved,
            "attended": bucket["attended"],
            "late": bucket["late"],
            "missed_ltfu": bucket["missed"],
            "pending": bucket["pending"],
            "ltfu_rate": h_rate,
        })
    by_hospital.sort(key=lambda r: (r["ltfu_rate"] is not None, r["ltfu_rate"] or 0), reverse=True)

    return {
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "reviews_due": overall["attended"] + overall["late"] + overall["missed"] + overall["pending"],
        "resolved": resolved,
        "attended": overall["attended"],
        "late": overall["late"],
        "missed_ltfu": overall["missed"],
        "pending": overall["pending"],
        "ltfu_rate": ltfu_rate,
        "attendance_rate": attendance,
        "by_hospital": by_hospital,
    }


def followup_breakdown(
    db: Session,
    hospital_id: Optional[UUID] = None,
    today: Optional[date] = None,
) -> dict:
    """Classify every baby in scope and return counts, the overall LTFU rate, and a
    per-baby list (tier + next_review + hospital) for period/hospital bucketing.

    The LTFU rate and tier counts are an as-of-today snapshot of the whole cohort and
    are intentionally not windowed by date; callers that want a time series bucket the
    returned `entries` by `next_review` themselves.
    """
    today = today or date.today()

    bq = db.query(Baby)
    if hospital_id:
        bq = bq.filter(Baby.hospital_id == hospital_id)
    babies = bq.all()
    baby_ids = [b.id for b in babies]

    exams_by_baby: dict[UUID, list[Exam]] = {}
    appts_by_baby: dict[UUID, list[Appointment]] = {}
    if baby_ids:
        for e in db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).all():
            exams_by_baby.setdefault(e.baby_id, []).append(e)
        for a in db.query(Appointment).filter(Appointment.baby_id.in_(baby_ids)).all():
            appts_by_baby.setdefault(a.baby_id, []).append(a)

    counts = {s: 0 for s in ALL_STATUSES}
    entries = []
    for b in babies:
        tier, next_review = classify_baby(
            b.status,
            exams_by_baby.get(b.id, []),
            appts_by_baby.get(b.id, []),
            today,
        )
        counts[tier] += 1
        entries.append({
            "baby_id": b.id,
            "hospital_id": b.hospital_id,
            "tier": tier,
            "next_review": next_review,
        })

    eligible = sum(counts[t] for t in IN_FOLLOWUP)
    ltfu_rate = round(counts[LTFU] / eligible * 100, 1) if eligible else 0.0

    return {
        "counts": counts,
        "ltfu_rate": ltfu_rate,
        "eligible": eligible,
        "entries": entries,
    }
