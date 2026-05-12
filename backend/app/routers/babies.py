from __future__ import annotations
from uuid import UUID
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.baby import Baby, BabyStatus
from app.models.user import User, UserRole
from app.models.hospital import Hospital
from app.models.contact_log import ContactLog, ContactLogType
from app.models.appointment import Appointment, AppointmentStatus
from app.models.outcome import Outcome, DischargeStatus
from app.schemas.baby import BabyCreate, BabyUpdate, BabyOut, BabyDashboardItem, DilationUpdate
from app.auth.jwt import get_current_user
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/babies", tags=["babies"])


def _get_hospital_or_403(user: User, hospital_id: UUID | None, db: Session) -> UUID:
    """Return the hospital_id to use, enforcing role scope."""
    if user.role == UserRole.CENTRAL_COORDINATOR:
        return hospital_id
    return user.hospital_id


@router.post("/", response_model=BabyOut)
def enroll_baby(
    data: BabyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in (
        UserRole.NICU_NURSE, UserRole.HOSPITAL_COORDINATOR,
        UserRole.CENTRAL_COORDINATOR, UserRole.OPHTHALMOLOGIST,
    ):
        raise HTTPException(status_code=403, detail="Not permitted to enroll babies")

    hospital = db.query(Hospital).filter(Hospital.id == data.hospital_id).first()
    if not hospital:
        raise HTTPException(status_code=400, detail="Hospital not found")

    baby_data = data.model_dump(exclude={'hospital_id'})
    baby = Baby(**baby_data, hospital_id=data.hospital_id, enrolled_by_id=current_user.id)
    db.add(baby)
    db.commit()
    db.refresh(baby)
    return baby


@router.get("/", response_model=list[BabyOut])
def list_babies(
    hospital_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Baby)
    if current_user.role == UserRole.CENTRAL_COORDINATOR:
        if hospital_id:
            query = query.filter(Baby.hospital_id == hospital_id)
    elif current_user.role == UserRole.OPHTHALMOLOGIST:
        # Ophthalmologists see babies they have personally examined OR enrolled
        from app.models.exam import Exam
        examined_ids = db.query(Exam.baby_id).filter(Exam.examiner_id == current_user.id).subquery()
        query = query.filter(
            (Baby.id.in_(examined_ids)) | (Baby.enrolled_by_id == current_user.id)
        )
    else:
        query = query.filter(Baby.hospital_id == current_user.hospital_id)
    return query.order_by(Baby.enrolled_at.desc()).all()


# NOTE: /search and /dashboard/urgency must be defined before /{baby_id} so
# FastAPI does not swallow them as UUID path parameters.

@router.get("/search")
def search_babies_route(
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Quick search by baby name, caregiver name, or phone number."""
    from app.models.appointment import Appointment, AppointmentStatus
    from datetime import date as _date

    like = f"%{q}%"
    query = db.query(Baby).filter(
        (Baby.full_name.ilike(like)) |
        (Baby.caregiver_name.ilike(like)) |
        (Baby.mtn_phone.ilike(like)) |
        (Baby.airtel_phone.ilike(like))
    )
    if current_user.role != UserRole.CENTRAL_COORDINATOR:
        query = query.filter(Baby.hospital_id == current_user.hospital_id)

    babies = query.limit(20).all()
    today = _date.today()
    results = []
    for baby in babies:
        next_appt = (
            db.query(Appointment)
            .filter(Appointment.baby_id == baby.id, Appointment.status == AppointmentStatus.SCHEDULED)
            .order_by(Appointment.due_date).first()
        )
        last_exam = baby.exams[0] if baby.exams else None
        due_date = next_appt.due_date if next_appt else None
        days_until = (due_date - today).days if due_date else None
        if baby.status == BabyStatus.LTFU:
            urgency = "ltfu"
        elif due_date == today:
            urgency = "due_today"
        elif days_until is not None and days_until <= 2:
            urgency = "due_soon"
        else:
            urgency = "on_track"
        hospital = db.query(Hospital).filter(Hospital.id == baby.hospital_id).first()
        results.append({
            "id": str(baby.id),
            "full_name": baby.full_name,
            "caregiver_name": baby.caregiver_name,
            "mtn_phone": baby.mtn_phone,
            "airtel_phone": baby.airtel_phone,
            "hospital_name": hospital.name if hospital else None,
            "status": baby.status,
            "urgency": urgency,
            "last_zone": last_exam.worst_zone if last_exam else None,
            "last_stage": last_exam.worst_stage if last_exam else None,
            "next_due_date": due_date.isoformat() if due_date else None,
        })
    return results


@router.get("/{baby_id}", response_model=BabyOut)
def get_baby(
    baby_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if current_user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != current_user.hospital_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return baby


@router.patch("/{baby_id}", response_model=BabyOut)
def update_baby(
    baby_id: UUID,
    data: BabyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if current_user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != current_user.hospital_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Caregiver-facing field labels for audit log
    CAREGIVER_FIELDS = {
        "caregiver_name": "Caregiver name",
        "mtn_phone": "MTN number",
        "airtel_phone": "Airtel number",
        "language_preference": "Language preference",
    }

    changes = data.model_dump(exclude_unset=True)
    for field, new_val in changes.items():
        old_val = getattr(baby, field, None)
        setattr(baby, field, new_val)
        # Write a contact log entry for caregiver-detail fields
        if field in CAREGIVER_FIELDS and str(old_val) != str(new_val):
            label = CAREGIVER_FIELDS[field]
            log = ContactLog(
                baby_id=baby_id,
                created_by_id=current_user.id,
                log_type=ContactLogType.CAREGIVER_EDIT,
                message=f"{label} updated by {current_user.full_name}: {old_val or '(none)'} → {new_val or '(none)'}",
                field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(new_val) if new_val is not None else None,
            )
            db.add(log)

    db.commit()
    db.refresh(baby)
    return baby


@router.patch("/{baby_id}/dilation", response_model=BabyOut)
def update_dilation(
    baby_id: UUID,
    data: DilationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """NICU nurse sets dilation status before ophthalmologist screening."""
    if current_user.role not in (UserRole.NICU_NURSE, UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Only nurses and coordinators can update dilation status")

    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if current_user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != current_user.hospital_id:
        raise HTTPException(status_code=403, detail="Access denied")

    from datetime import datetime, timezone
    DILATION_LABELS = {
        "dilated": "Dilated and ready for screening",
        "not_dilated": "Not yet dilated",
        "dilation_refused": "Dilation refused",
    }
    label = DILATION_LABELS.get(data.dilation_status.value, data.dilation_status.value)

    baby.dilation_status = data.dilation_status
    baby.dilation_updated_at = datetime.now(timezone.utc)
    baby.dilation_updated_by_id = current_user.id

    log = ContactLog(
        baby_id=baby_id,
        created_by_id=current_user.id,
        log_type=ContactLogType.NOTE,
        message=f"Dilation status set to '{label}' by {current_user.full_name}",
    )
    db.add(log)
    db.commit()
    db.refresh(baby)
    return baby


@router.get("/dashboard/urgency", response_model=list[BabyDashboardItem])
def dashboard_urgency(
    hospital_id: UUID | None = None,
    q: str | None = None,
    urgency_filter: str | None = None,
    rop_stage: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return babies sorted by urgency for the coordinator dashboard."""
    from app.models.appointment import Appointment, AppointmentStatus
    from app.models.exam import Exam

    query = db.query(Baby)
    if current_user.role == UserRole.CENTRAL_COORDINATOR:
        if hospital_id:
            query = query.filter(Baby.hospital_id == hospital_id)
    elif current_user.role == UserRole.OPHTHALMOLOGIST:
        from app.models.exam import Exam as _Exam
        examined_ids = db.query(_Exam.baby_id).filter(_Exam.examiner_id == current_user.id).subquery()
        query = query.filter(
            (Baby.id.in_(examined_ids)) | (Baby.enrolled_by_id == current_user.id)
        )
    else:
        query = query.filter(Baby.hospital_id == current_user.hospital_id)

    if q:
        like = f"%{q}%"
        query = query.filter(
            (Baby.full_name.ilike(like)) | (Baby.caregiver_name.ilike(like))
        )

    babies = query.all()
    today = date.today()
    items = []

    for baby in babies:
        next_appt = (
            db.query(Appointment)
            .filter(
                Appointment.baby_id == baby.id,
                Appointment.status == AppointmentStatus.SCHEDULED,
            )
            .order_by(Appointment.due_date)
            .first()
        )

        last_exam = baby.exams[0] if baby.exams else None
        hospital = db.query(Hospital).filter(Hospital.id == baby.hospital_id).first()

        due_date = next_appt.due_date if next_appt else None
        days_until = (due_date - today).days if due_date else None

        if baby.status == BabyStatus.LTFU:
            urgency = "ltfu"
        elif due_date == today:
            urgency = "due_today"
        elif days_until is not None and days_until <= 2:
            urgency = "due_soon"
        else:
            urgency = "on_track"

        items.append(BabyDashboardItem(
            id=baby.id,
            full_name=baby.full_name,
            sex=baby.sex,
            date_of_birth=baby.date_of_birth,
            gestational_age_weeks=baby.gestational_age_weeks,
            birth_weight_grams=baby.birth_weight_grams,
            status=baby.status,
            hospital_name=hospital.name if hospital else None,
            next_due_date=due_date,
            days_until_due=days_until,
            urgency=urgency,
            last_exam_date=last_exam.exam_date if last_exam else None,
            last_zone=last_exam.worst_zone if last_exam else None,
            last_stage=last_exam.worst_stage if last_exam else None,
            caregiver_name=baby.caregiver_name,
            mtn_phone=baby.mtn_phone,
            airtel_phone=baby.airtel_phone,
        ))

    if urgency_filter:
        items = [i for i in items if i.urgency == urgency_filter]
    if rop_stage:
        items = [i for i in items if i.last_stage == rop_stage]

    urgency_order = {"ltfu": 0, "due_today": 1, "due_soon": 2, "on_track": 3}
    items.sort(key=lambda x: (urgency_order.get(x.urgency, 9), x.next_due_date or date.max))
    return items


# ── Discharge schema ──────────────────────────────────────────────────────────

DISCHARGE_REASON_LABELS = {
    "completed_no_rop":  "Completed - no ROP detected",
    "completed_treated": "Completed - treated successfully",
    "referred_national": "Referred to national centre",
    "referred_abroad":   "Referred abroad",
    "died":              "Died",
    "lost":              "Lost to follow-up",
}

class DischargeIn(BaseModel):
    discharge_reason: str   # one of DischargeStatus values (except "ongoing")
    notes: Optional[str] = None


# ── Discharge endpoint ────────────────────────────────────────────────────────

@router.post("/{baby_id}/discharge", response_model=BabyOut)
def discharge_baby(
    baby_id: UUID,
    data: DischargeIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Transition a baby from Active to Discharged:
      1. Set baby.status = DISCHARGED
      2. Cancel all future SCHEDULED appointments (prevents further reminders)
      3. Upsert the Outcome row with discharge_status + discharge_date = today
      4. Log the action to contact_logs
    """
    allowed = (
        UserRole.HOSPITAL_COORDINATOR,
        UserRole.CENTRAL_COORDINATOR,
        UserRole.OPHTHALMOLOGIST,
    )
    if current_user.role not in allowed:
        raise HTTPException(status_code=403, detail="Not permitted to discharge babies")

    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if current_user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != current_user.hospital_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if baby.status == BabyStatus.DISCHARGED:
        raise HTTPException(status_code=409, detail="Baby is already discharged")

    # Validate discharge reason
    try:
        discharge_status = DischargeStatus(data.discharge_reason)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid discharge reason: {data.discharge_reason}")
    if discharge_status == DischargeStatus.ONGOING:
        raise HTTPException(status_code=422, detail="'ongoing' is not a valid discharge reason")

    from datetime import datetime, timezone

    # 1. Update baby status
    baby.status = BabyStatus.DISCHARGED

    # 2. Cancel all future SCHEDULED appointments
    future_appts = (
        db.query(Appointment)
        .filter(
            Appointment.baby_id == baby_id,
            Appointment.status == AppointmentStatus.SCHEDULED,
            Appointment.due_date >= date.today(),
        )
        .all()
    )
    for appt in future_appts:
        appt.status = AppointmentStatus.ATTENDED  # closes the appointment cleanly

    # 3. Upsert Outcome row
    outcome = db.query(Outcome).filter(Outcome.baby_id == baby_id).first()
    if outcome is None:
        outcome = Outcome(baby_id=baby_id)
        db.add(outcome)
    outcome.discharge_status = discharge_status
    outcome.discharge_date = date.today()
    if data.notes and not outcome.notes:
        outcome.notes = data.notes

    # 4. Contact log entry
    reason_label = DISCHARGE_REASON_LABELS.get(data.discharge_reason, data.discharge_reason)
    log_msg = f"Baby discharged by {current_user.full_name} — {reason_label}"
    if data.notes:
        log_msg += f". Notes: {data.notes}"
    log = ContactLog(
        baby_id=baby_id,
        created_by_id=current_user.id,
        log_type=ContactLogType.NOTE,
        message=log_msg,
    )
    db.add(log)

    db.commit()
    db.refresh(baby)
    return baby


# ── Reactivate endpoint ───────────────────────────────────────────────────────

@router.post("/{baby_id}/reactivate", response_model=BabyOut)
def reactivate_baby(
    baby_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Coordinators only: reverse a discharge and set the baby back to Active."""
    if current_user.role not in (UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Only coordinators can reactivate a baby")

    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if current_user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != current_user.hospital_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if baby.status != BabyStatus.DISCHARGED:
        raise HTTPException(status_code=409, detail="Baby is not currently discharged")

    baby.status = BabyStatus.ACTIVE

    # Clear the discharge fields on the outcome row so reports are accurate
    outcome = db.query(Outcome).filter(Outcome.baby_id == baby_id).first()
    if outcome:
        outcome.discharge_status = DischargeStatus.ONGOING
        outcome.discharge_date = None

    log = ContactLog(
        baby_id=baby_id,
        created_by_id=current_user.id,
        log_type=ContactLogType.NOTE,
        message=f"Baby reactivated by {current_user.full_name}",
    )
    db.add(log)

    db.commit()
    db.refresh(baby)
    return baby
