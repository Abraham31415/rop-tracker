"""
GET /api/reports/summary — statistics for coordinators
GET /api/reports/population — filterable population report for PDF export
GET /api/reports/outcomes — outcomes summary for reports tab
GET /api/reports/research-export — anonymised CSV for research
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone, date
from collections import defaultdict
from typing import Optional
from uuid import UUID
import csv
import io

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.baby import Baby, BabyStatus
from app.models.exam import Exam
from app.models.hospital import Hospital
from app.models.reminder import Reminder, ReminderStatus
from app.models.appointment import Appointment, AppointmentStatus
from app.models.user import User, UserRole
from app.models.outcome import Outcome, TreatmentType, VisualOutcome, DischargeStatus
from app.models.referral import Referral, ReferralStatus

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/summary")
def reports_summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from fastapi import HTTPException
    if user.role not in (UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Reports are available to coordinators only")
    is_central = user.role == UserRole.CENTRAL_COORDINATOR

    # Base baby query scoped by hospital
    baby_q = db.query(Baby)
    if not is_central and user.hospital_id:
        baby_q = baby_q.filter(Baby.hospital_id == user.hospital_id)
    all_babies = baby_q.all()
    baby_ids = [b.id for b in all_babies]

    # ── Enrollment by month (last 12 months) ─────────────────────────────────
    monthly_enroll: dict[str, int] = defaultdict(int)
    monthly_ltfu: dict[str, int] = defaultdict(int)
    for baby in all_babies:
        if baby.enrolled_at:
            key = baby.enrolled_at.strftime("%Y-%m")
            monthly_enroll[key] += 1
            if baby.status == BabyStatus.LTFU:
                monthly_ltfu[key] += 1

    # Build sorted list for last 12 months
    today = date.today()
    months = []
    for i in range(11, -1, -1):
        d = date(today.year, today.month, 1) - timedelta(days=i * 30)
        key = d.strftime("%Y-%m")
        label = d.strftime("%b %Y")
        months.append({
            "month": key,
            "label": label,
            "enrolled": monthly_enroll.get(key, 0),
            "ltfu": monthly_ltfu.get(key, 0),
        })

    # ── Hospital breakdown ────────────────────────────────────────────────────
    hospitals = db.query(Hospital).filter(Hospital.is_active == True).all()
    hospital_rows = []
    for h in hospitals:
        h_babies = [b for b in all_babies if b.hospital_id == h.id]
        if not h_babies and not is_central:
            continue
        hospital_rows.append({
            "hospital_id": str(h.id),
            "hospital_name": h.name,
            "district": h.district,
            "total": len(h_babies),
            "ltfu": sum(1 for b in h_babies if b.status == BabyStatus.LTFU),
            "active": sum(1 for b in h_babies if b.status == BabyStatus.ACTIVE),
        })
    hospital_rows.sort(key=lambda x: x["total"], reverse=True)

    # ── ROP stage breakdown ───────────────────────────────────────────────────
    stage_counts: dict[str, int] = defaultdict(int)
    if baby_ids:
        exams = db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).all()
        for exam in exams:
            key = f"{exam.worst_zone or 'unknown'}/{exam.worst_stage or 'unknown'}"
            stage_counts[key] += 1
    stage_breakdown = [
        {"zone_stage": k, "count": v}
        for k, v in sorted(stage_counts.items(), key=lambda x: -x[1])
    ]

    # ── Summary totals ────────────────────────────────────────────────────────
    total = len(all_babies)
    ltfu_total = sum(1 for b in all_babies if b.status == BabyStatus.LTFU)
    active_total = sum(1 for b in all_babies if b.status == BabyStatus.ACTIVE)

    # ── SMS stats (last 30 days) ──────────────────────────────────────────────
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    sms_q = db.query(Reminder)
    if baby_ids:
        sms_q = sms_q.filter(Reminder.baby_id.in_(baby_ids))
    sms_q = sms_q.filter(Reminder.created_at >= cutoff)
    all_sms = sms_q.all()
    sms_sent = sum(1 for r in all_sms if r.status == ReminderStatus.SENT)
    sms_failed = sum(1 for r in all_sms if r.status == ReminderStatus.FAILED)
    sms_total = len(all_sms)
    sms_rate = round(sms_sent / sms_total * 100, 1) if sms_total else 0

    return {
        "summary": {
            "total_babies": total,
            "active": active_total,
            "ltfu": ltfu_total,
            "ltfu_rate": round(ltfu_total / total * 100, 1) if total else 0,
        },
        "enrollment_by_month": months,
        "hospital_breakdown": hospital_rows,
        "stage_breakdown": stage_breakdown,
        "sms_stats": {
            "sent": sms_sent,
            "failed": sms_failed,
            "total": sms_total,
            "success_rate": sms_rate,
        },
    }


@router.get("/population")
def population_report(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return all data needed to generate the population/program PDF report."""
    from fastapi import HTTPException
    if user.role not in (UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Reports are available to coordinators only")
    is_central = user.role == UserRole.CENTRAL_COORDINATOR

    # ── Scope hospital ────────────────────────────────────────────────────────
    scope_hospital_id = None
    if hospital_id:
        scope_hospital_id = hospital_id
    elif not is_central and user.hospital_id:
        scope_hospital_id = user.hospital_id

    hospital_name = "All Hospitals"
    if scope_hospital_id:
        h = db.query(Hospital).filter(Hospital.id == scope_hospital_id).first()
        hospital_name = h.name if h else "Unknown"

    # ── Baby query ────────────────────────────────────────────────────────────
    baby_q = db.query(Baby)
    if scope_hospital_id:
        baby_q = baby_q.filter(Baby.hospital_id == scope_hospital_id)
    if start_date:
        dt_start = datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc)
        baby_q = baby_q.filter(Baby.enrolled_at >= dt_start)
    if end_date:
        dt_end = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59, tzinfo=timezone.utc)
        baby_q = baby_q.filter(Baby.enrolled_at <= dt_end)

    all_babies = baby_q.all()
    baby_ids = [b.id for b in all_babies]

    # ── Exams for these babies ────────────────────────────────────────────────
    all_exams = db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).all() if baby_ids else []

    # Exams within date range for monthly trend
    trend_exams = all_exams
    if start_date:
        trend_exams = [e for e in trend_exams if e.exam_date >= start_date]
    if end_date:
        trend_exams = [e for e in trend_exams if e.exam_date <= end_date]

    # ── Summary stats ─────────────────────────────────────────────────────────
    total = len(all_babies)
    ltfu_count = sum(1 for b in all_babies if b.status == BabyStatus.LTFU)

    rop_stages = {"no_rop", "immature"}
    rop_detected_exams = [e for e in all_exams if e.worst_stage and e.worst_stage not in rop_stages]
    treatment_exams = [e for e in all_exams if e.treatment_recommended]

    sms_q = db.query(Reminder)
    if baby_ids:
        sms_q = sms_q.filter(Reminder.baby_id.in_(baby_ids))
    if start_date:
        sms_q = sms_q.filter(Reminder.created_at >= datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc))
    if end_date:
        sms_q = sms_q.filter(Reminder.created_at <= datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59, tzinfo=timezone.utc))
    all_reminders = sms_q.all() if baby_ids else []
    sms_sent_count = sum(1 for r in all_reminders if r.status == ReminderStatus.SENT)

    # ── Stage breakdown (latest exam per baby) ────────────────────────────────
    stage_order = ["no_rop", "immature", "stage_1", "stage_2", "stage_3", "stage_4", "stage_5"]
    stage_labels = {
        "no_rop": "No ROP", "immature": "Immature", "stage_1": "Stage 1",
        "stage_2": "Stage 2", "stage_3": "Stage 3", "stage_4": "Stage 4", "stage_5": "Stage 5",
    }
    stage_map: dict[str, int] = defaultdict(int)
    baby_exam_map: dict = {}
    for e in all_exams:
        bid = str(e.baby_id)
        if bid not in baby_exam_map or e.exam_date > baby_exam_map[bid].exam_date:
            baby_exam_map[bid] = e
    for baby in all_babies:
        last = baby_exam_map.get(str(baby.id))
        stage_map[last.worst_stage if last and last.worst_stage else "no_exam"] += 1

    stage_breakdown = [
        {"stage": s, "label": stage_labels.get(s, s), "count": stage_map.get(s, 0)}
        for s in stage_order if stage_map.get(s, 0) > 0
    ]
    if stage_map.get("no_exam", 0):
        stage_breakdown.append({"stage": "no_exam", "label": "No Exam Yet", "count": stage_map["no_exam"]})

    # ── GA band breakdown ─────────────────────────────────────────────────────
    ga_breakdown = [
        {"band": "< 28 weeks", "count": sum(1 for b in all_babies if b.gestational_age_weeks and b.gestational_age_weeks < 28)},
        {"band": "28-30 weeks", "count": sum(1 for b in all_babies if b.gestational_age_weeks and 28 <= b.gestational_age_weeks < 30)},
        {"band": "30-32 weeks", "count": sum(1 for b in all_babies if b.gestational_age_weeks and 30 <= b.gestational_age_weeks < 32)},
        {"band": "> 32 weeks",  "count": sum(1 for b in all_babies if b.gestational_age_weeks and b.gestational_age_weeks >= 32)},
    ]

    # ── Hospital breakdown ────────────────────────────────────────────────────
    hosp_list = db.query(Hospital).filter(Hospital.is_active == True).all()
    hospital_breakdown = []
    for h in hosp_list:
        h_babies = [b for b in all_babies if b.hospital_id == h.id]
        if not h_babies:
            continue
        h_exams = [e for e in all_exams if any(b.id == e.baby_id for b in h_babies)]
        hospital_breakdown.append({
            "hospital_name": h.name,
            "district": h.district,
            "total": len(h_babies),
            "active": sum(1 for b in h_babies if b.status == BabyStatus.ACTIVE),
            "ltfu": sum(1 for b in h_babies if b.status == BabyStatus.LTFU),
            "ltfu_rate": round(sum(1 for b in h_babies if b.status == BabyStatus.LTFU) / len(h_babies) * 100, 1),
            "exams": len(h_exams),
        })
    hospital_breakdown.sort(key=lambda x: -x["total"])

    # ── LTFU analysis (missed appointments) ───────────────────────────────────
    ltfu_1, ltfu_2, ltfu_3plus = 0, 0, 0
    for baby in all_babies:
        if baby.status == BabyStatus.LTFU:
            missed = db.query(Appointment).filter(
                Appointment.baby_id == baby.id,
                Appointment.status.in_([AppointmentStatus.MISSED, AppointmentStatus.LTFU]),
            ).count()
            if missed <= 1:
                ltfu_1 += 1
            elif missed == 2:
                ltfu_2 += 1
            else:
                ltfu_3plus += 1

    ltfu_analysis = {"missed_1": ltfu_1, "missed_2": ltfu_2, "missed_3plus": ltfu_3plus}

    # ── Monthly trend ─────────────────────────────────────────────────────────
    monthly: dict[str, dict] = defaultdict(lambda: {"enrolled": 0, "exams": 0})
    for baby in all_babies:
        if baby.enrolled_at:
            k = baby.enrolled_at.strftime("%Y-%m")
            monthly[k]["enrolled"] += 1
    for exam in trend_exams:
        k = exam.exam_date.strftime("%Y-%m")
        monthly[k]["exams"] += 1
    monthly_trend = [
        {"month": k, "label": datetime.strptime(k, "%Y-%m").strftime("%b %Y"), **monthly[k]}
        for k in sorted(monthly.keys())
    ]

    return {
        "hospital_name": hospital_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": {"name": user.full_name, "role": user.role},
        "filters": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
            "hospital_id": str(hospital_id) if hospital_id else None,
        },
        "summary": {
            "total_babies": total,
            "total_exams": len(all_exams),
            "rop_detected": len(rop_detected_exams),
            "rop_detected_pct": round(len(rop_detected_exams) / len(all_exams) * 100, 1) if all_exams else 0,
            "treatment_required": len(treatment_exams),
            "ltfu_count": ltfu_count,
            "ltfu_rate": round(ltfu_count / total * 100, 1) if total else 0,
            "sms_sent": sms_sent_count,
        },
        "stage_breakdown": stage_breakdown,
        "ga_breakdown": ga_breakdown,
        "hospital_breakdown": hospital_breakdown,
        "ltfu_analysis": ltfu_analysis,
        "monthly_trend": monthly_trend,
    }


@router.get("/outcomes")
def outcomes_report(
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Outcomes summary: treatment breakdown, visual outcomes, referral stats."""
    from fastapi import HTTPException
    if user.role not in (UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Reports are available to coordinators only")
    is_central = user.role == UserRole.CENTRAL_COORDINATOR
    scope_id = hospital_id if hospital_id else (None if is_central else user.hospital_id)

    baby_q = db.query(Baby)
    if scope_id:
        baby_q = baby_q.filter(Baby.hospital_id == scope_id)
    baby_ids = [b.id for b in baby_q.all()]

    outcomes = db.query(Outcome).filter(Outcome.baby_id.in_(baby_ids)).all() if baby_ids else []
    referrals = db.query(Referral).filter(Referral.baby_id.in_(baby_ids)).all() if baby_ids else []

    # Treatment breakdown
    treatment_counts: dict[str, int] = defaultdict(int)
    for o in outcomes:
        t = o.treatment_type.value if o.treatment_type else "none"
        treatment_counts[t] += 1

    # Visual outcome breakdown
    visual_counts: dict[str, int] = defaultdict(int)
    for o in outcomes:
        v = o.visual_outcome.value if o.visual_outcome else "unknown"
        visual_counts[v] += 1

    # Discharge status breakdown
    discharge_counts: dict[str, int] = defaultdict(int)
    for o in outcomes:
        d = o.discharge_status.value if o.discharge_status else "ongoing"
        discharge_counts[d] += 1

    # Blindness prevented = babies with active treatment
    blindness_prevented = sum(
        1 for o in outcomes
        if o.treatment_type and o.treatment_type != TreatmentType.NONE
    )

    # Referral stats
    referral_total = len(referrals)
    referral_arrived = sum(1 for r in referrals if r.status == ReferralStatus.ARRIVED_TREATED)
    referral_pending = sum(1 for r in referrals if r.status == ReferralStatus.PENDING)
    referral_no_show = sum(1 for r in referrals if r.status == ReferralStatus.DID_NOT_ARRIVE)

    return {
        "total_outcomes": len(outcomes),
        "blindness_prevented": blindness_prevented,
        "treatment_breakdown": [{"type": k, "count": v} for k, v in treatment_counts.items()],
        "visual_outcome_breakdown": [{"outcome": k, "count": v} for k, v in visual_counts.items()],
        "discharge_breakdown": [{"status": k, "count": v} for k, v in discharge_counts.items()],
        "referrals": {
            "total": referral_total,
            "arrived_treated": referral_arrived,
            "pending": referral_pending,
            "did_not_arrive": referral_no_show,
            "success_rate": round(referral_arrived / referral_total * 100, 1) if referral_total else 0,
        },
    }


@router.get("/research-export")
def research_export(
    hospital_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Anonymised CSV export for research. Names replaced with sequential IDs."""
    is_central = user.role == UserRole.CENTRAL_COORDINATOR
    if not is_central and user.role.value not in ("hospital_coordinator", "ophthalmologist"):
        from fastapi import HTTPException
        raise HTTPException(403, "Not authorised for research export")

    scope_id = hospital_id if hospital_id else (None if is_central else user.hospital_id)

    baby_q = db.query(Baby)
    if scope_id:
        baby_q = baby_q.filter(Baby.hospital_id == scope_id)
    all_babies = baby_q.order_by(Baby.enrolled_at).all()
    baby_ids = [b.id for b in all_babies]

    # Build lookup maps
    outcomes_map = {}
    if baby_ids:
        for o in db.query(Outcome).filter(Outcome.baby_id.in_(baby_ids)).all():
            outcomes_map[str(o.baby_id)] = o
    exams_map: dict[str, list] = defaultdict(list)
    if baby_ids:
        for e in db.query(Exam).filter(Exam.baby_id.in_(baby_ids)).order_by(Exam.exam_date).all():
            exams_map[str(e.baby_id)].append(e)
    hospital_map = {str(h.id): h.name for h in db.query(Hospital).all()}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        # Baby-level (repeated per exam row)
        "study_id", "hospital", "enroll_year", "sex",
        "birth_weight_g", "gestational_age_weeks",
        "oxygen_therapy", "blood_transfusion", "sepsis", "inotropes", "anaemia",
        "total_exams", "final_status",
        # Outcome summary (baby-level)
        "treatment_type", "treatment_eye", "treatment_date",
        "visual_outcome", "discharge_status", "discharge_date",
        # Per-exam fields
        "exam_number", "exam_date", "postnatal_age_days",
        "right_zone", "right_stage", "right_plus",
        "left_zone", "left_stage", "left_plus",
        "worst_zone", "worst_stage", "has_plus_disease",
        "treatment_recommended",
        # Visual function per exam
        "vf_right_fixation", "vf_right_following", "vf_right_csm",
        "vf_right_teller_acuity", "vf_right_vep",
        "vf_left_fixation", "vf_left_following", "vf_left_csm",
        "vf_left_teller_acuity", "vf_left_vep",
        "vf_nystagmus", "vf_strabismus",
        "vf_functional_impression", "vf_notes",
    ])

    def _ev(obj, attr):
        v = getattr(obj, attr, None)
        if v is None:
            return ""
        return v.value if hasattr(v, 'value') else v

    for idx, baby in enumerate(all_babies, start=1):
        study_id = f"ROP-{idx:04d}"
        baby_exams = exams_map.get(str(baby.id), [])
        outcome = outcomes_map.get(str(baby.id))

        base = [
            study_id,
            hospital_map.get(str(baby.hospital_id), ""),
            baby.enrolled_at.year if baby.enrolled_at else "",
            baby.sex.value if baby.sex else "",
            baby.birth_weight_grams or "",
            baby.gestational_age_weeks or "",
            int(baby.oxygen_therapy or 0),
            int(baby.blood_transfusion or 0),
            int(baby.sepsis or 0),
            int(baby.inotropes or 0),
            int(baby.anaemia or 0),
            len(baby_exams),
            baby.status.value if baby.status else "",
            outcome.treatment_type.value if outcome and outcome.treatment_type else "",
            outcome.treatment_eye.value if outcome and outcome.treatment_eye else "",
            outcome.treatment_date.isoformat() if outcome and outcome.treatment_date else "",
            outcome.visual_outcome.value if outcome and outcome.visual_outcome else "",
            outcome.discharge_status.value if outcome and outcome.discharge_status else "",
            outcome.discharge_date.isoformat() if outcome and outcome.discharge_date else "",
        ]

        if not baby_exams:
            writer.writerow(base + [""] * 25)
        else:
            for enum_n, exam in enumerate(baby_exams, start=1):
                writer.writerow(base + [
                    enum_n,
                    exam.exam_date.isoformat() if exam.exam_date else "",
                    exam.postnatal_age_days or "",
                    _ev(exam, 'right_zone'), _ev(exam, 'right_stage'), _ev(exam, 'right_plus'),
                    _ev(exam, 'left_zone'), _ev(exam, 'left_stage'), _ev(exam, 'left_plus'),
                    _ev(exam, 'worst_zone'), _ev(exam, 'worst_stage'),
                    exam.has_plus_disease or "",
                    exam.treatment_recommended or "",
                    _ev(exam, 'vf_right_fixation'), _ev(exam, 'vf_right_following'), _ev(exam, 'vf_right_csm'),
                    exam.vf_right_teller_acuity or "", exam.vf_right_vep or "",
                    _ev(exam, 'vf_left_fixation'), _ev(exam, 'vf_left_following'), _ev(exam, 'vf_left_csm'),
                    exam.vf_left_teller_acuity or "", exam.vf_left_vep or "",
                    _ev(exam, 'vf_nystagmus'), _ev(exam, 'vf_strabismus'),
                    _ev(exam, 'vf_functional_impression'), exam.vf_notes or "",
                ])

    output.seek(0)
    filename = f"rop_research_export_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
