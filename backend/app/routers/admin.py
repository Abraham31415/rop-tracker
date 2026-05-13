from __future__ import annotations
import os
import urllib.request
import urllib.error
import json as _json
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import func, cast, String, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User, UserRole
from app.models.baby import Baby
from app.models.hospital import Hospital
from app.models.audit_log import AuditLog
from app.models.reminder import Reminder, ReminderStatus
from app.utils.audit import write_audit

router = APIRouter(prefix="/api/admin", tags=["admin"])

_ADMIN_TOKEN_EXPIRE_MINUTES = 480
_ADMIN_SCHEME = OAuth2PasswordBearer(tokenUrl="/api/admin/login")

# ── Admin JWT helpers ─────────────────────────────────────────────────────────

def _admin_secret() -> str:
    key = settings.ADMIN_SECRET_KEY or settings.SECRET_KEY
    return key


def _create_admin_token() -> str:
    payload = {
        "sub": "admin",
        "role": "superadmin",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=_ADMIN_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, _admin_secret(), algorithm=settings.ALGORITHM)


def _verify_admin_token(token: str = Depends(_ADMIN_SCHEME)) -> dict:
    try:
        payload = jwt.decode(token, _admin_secret(), algorithms=[settings.ALGORITHM])
        if payload.get("role") != "superadmin":
            raise HTTPException(status_code=403, detail="Not an admin token")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")


# ── Schemas ───────────────────────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    email: str
    password: str


class AdminTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CoordinatorOut(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: Optional[datetime]
    hospital_id: Optional[UUID]
    hospital_name: Optional[str]

    model_config = {"from_attributes": True}


class CoordinatorCreate(BaseModel):
    email: str
    full_name: str
    password: str
    role: str = "central_coordinator"
    hospital_id: Optional[UUID] = None


class AuditLogOut(BaseModel):
    id: UUID
    created_at: datetime
    user_id: Optional[UUID]
    user_name: str
    user_role: str
    action_type: str
    entity_type: str
    entity_id: Optional[str]
    details: Optional[dict]
    ip_address: Optional[str]

    model_config = {"from_attributes": True}


class HospitalOut(BaseModel):
    id: UUID
    name: str
    district: str
    region: str
    hospital_type: Optional[str]
    physical_address: Optional[str]
    contact_phone: Optional[str]
    is_active: bool
    baby_count: int = 0
    staff_count: int = 0

    model_config = {"from_attributes": True}


class HospitalCreate(BaseModel):
    name: str
    district: str
    region: str
    hospital_type: str
    physical_address: Optional[str] = None
    contact_phone: Optional[str] = None


class HospitalUpdate(BaseModel):
    name: Optional[str] = None
    district: Optional[str] = None
    region: Optional[str] = None
    hospital_type: Optional[str] = None
    physical_address: Optional[str] = None
    contact_phone: Optional[str] = None


class DashboardStats(BaseModel):
    total_hospitals: int
    active_hospitals: int
    total_coordinators: int
    active_coordinators: int
    total_babies: int
    babies_at_risk: int
    recent_audit_entries: int


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=AdminTokenOut)
def admin_login(data: AdminLoginRequest):
    if data.email != settings.ADMIN_EMAIL or data.password != settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    return {"access_token": _create_admin_token()}


@router.get("/dashboard", response_model=DashboardStats)
def admin_dashboard(
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    coord_names = ['CENTRAL_COORDINATOR', 'HOSPITAL_COORDINATOR']
    role_col = cast(User.role, String)

    total_hospitals   = db.query(func.count(Hospital.id)).scalar()
    active_hospitals  = db.query(func.count(Hospital.id)).filter(Hospital.is_active == True).scalar()
    total_coords      = db.query(func.count(User.id)).filter(role_col.in_(coord_names)).scalar()
    active_coords     = db.query(func.count(User.id)).filter(
        role_col.in_(coord_names), User.is_active == True
    ).scalar()
    total_babies      = db.query(func.count(Baby.id)).scalar()

    from app.models.exam import Exam
    from app.models.outcome import Outcome
    treated_ids = {
        r[0] for r in db.query(Outcome.baby_id).filter(cast(Outcome.treatment_type, String) != 'NONE')
    }
    at_risk_q = db.query(func.count(Exam.baby_id.distinct())).filter(
        Exam.treatment_recommended != None,
    )
    if treated_ids:
        at_risk_q = at_risk_q.filter(~Exam.baby_id.in_(treated_ids))
    at_risk = at_risk_q.scalar()

    recent_audit = db.query(func.count(AuditLog.id)).filter(
        AuditLog.created_at >= datetime.now(timezone.utc) - timedelta(days=7)
    ).scalar()

    return DashboardStats(
        total_hospitals=total_hospitals,
        active_hospitals=active_hospitals,
        total_coordinators=total_coords,
        active_coordinators=active_coords,
        total_babies=total_babies,
        babies_at_risk=at_risk,
        recent_audit_entries=recent_audit,
    )


@router.get("/coordinators", response_model=list[CoordinatorOut])
def list_coordinators(
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    coord_names = ['CENTRAL_COORDINATOR', 'HOSPITAL_COORDINATOR']
    users = (
        db.query(User)
        .filter(cast(User.role, String).in_(coord_names))
        .order_by(User.role.desc(), User.full_name)
        .all()
    )
    result = []
    for u in users:
        result.append(CoordinatorOut(
            id=u.id,
            email=u.email,
            full_name=u.full_name,
            role=u.role,
            is_active=u.is_active,
            created_at=u.created_at,
            hospital_id=u.hospital_id,
            hospital_name=u.hospital.name if u.hospital else None,
        ))
    return result


@router.post("/coordinators", response_model=CoordinatorOut)
def create_coordinator(
    request: Request,
    data: CoordinatorCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    from app.auth.jwt import hash_password
    allowed = [UserRole.CENTRAL_COORDINATOR.value, UserRole.HOSPITAL_COORDINATOR.value]
    if data.role not in allowed:
        raise HTTPException(status_code=400, detail="Role must be central_coordinator or hospital_coordinator")
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=data.email,
        full_name=data.full_name,
        hashed_password=hash_password(data.password),
        role=data.role,
        hospital_id=data.hospital_id,
    )
    db.add(user)
    db.flush()

    write_audit(
        db,
        user_name="Admin",
        user_role="superadmin",
        action_type="CREATE",
        entity_type="User",
        entity_id=str(user.id),
        details={"email": user.email, "role": user.role},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(user)

    return CoordinatorOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        hospital_id=user.hospital_id,
        hospital_name=user.hospital.name if user.hospital else None,
    )


@router.patch("/coordinators/{user_id}/deactivate", response_model=CoordinatorOut)
def deactivate_coordinator(
    user_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    coordinator_roles = [UserRole.CENTRAL_COORDINATOR, UserRole.HOSPITAL_COORDINATOR]
    if user.role not in coordinator_roles:
        raise HTTPException(status_code=400, detail="User is not a coordinator")

    user.is_active = False
    write_audit(
        db,
        user_name="Admin",
        user_role="superadmin",
        action_type="DEACTIVATE",
        entity_type="User",
        entity_id=str(user.id),
        details={"email": user.email, "role": user.role},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(user)

    return CoordinatorOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        hospital_id=user.hospital_id,
        hospital_name=user.hospital.name if user.hospital else None,
    )


@router.patch("/coordinators/{user_id}/activate", response_model=CoordinatorOut)
def activate_coordinator(
    user_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = True
    write_audit(
        db,
        user_name="Admin",
        user_role="superadmin",
        action_type="ACTIVATE",
        entity_type="User",
        entity_id=str(user.id),
        details={"email": user.email, "role": user.role},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(user)

    return CoordinatorOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        hospital_id=user.hospital_id,
        hospital_name=user.hospital.name if user.hospital else None,
    )


@router.get("/audit", response_model=list[AuditLogOut])
def list_audit_logs(
    entity_type: Optional[str] = None,
    action_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    q = db.query(AuditLog)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if action_type:
        q = q.filter(AuditLog.action_type == action_type)
    return q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()


# ── Hospital admin endpoints ──────────────────────────────────────────────────

def _hospital_out(h: Hospital, db: Session) -> HospitalOut:
    baby_count = db.query(func.count(Baby.id)).filter(Baby.hospital_id == h.id).scalar() or 0
    staff_count = db.query(func.count(User.id)).filter(User.hospital_id == h.id).scalar() or 0
    return HospitalOut(
        id=h.id,
        name=h.name,
        district=h.district,
        region=h.region,
        hospital_type=h.hospital_type,
        physical_address=h.physical_address,
        contact_phone=h.contact_phone,
        is_active=h.is_active,
        baby_count=baby_count,
        staff_count=staff_count,
    )


@router.get("/hospitals", response_model=list[HospitalOut])
def list_hospitals_admin(
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    hospitals = db.query(Hospital).order_by(Hospital.name).all()
    return [_hospital_out(h, db) for h in hospitals]


@router.post("/hospitals", response_model=HospitalOut)
def create_hospital_admin(
    request: Request,
    data: HospitalCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    if db.query(Hospital).filter(Hospital.name == data.name).first():
        raise HTTPException(status_code=400, detail="A hospital with that name already exists")
    hospital = Hospital(**data.model_dump())
    db.add(hospital)
    db.flush()
    write_audit(
        db,
        user_name="Admin",
        user_role="superadmin",
        action_type="CREATE",
        entity_type="Hospital",
        entity_id=str(hospital.id),
        details={"name": hospital.name, "district": hospital.district, "region": hospital.region},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(hospital)
    return _hospital_out(hospital, db)


@router.patch("/hospitals/{hospital_id}", response_model=HospitalOut)
def update_hospital_admin(
    hospital_id: UUID,
    request: Request,
    data: HospitalUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    hospital = db.query(Hospital).filter(Hospital.id == hospital_id).first()
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] != hospital.name:
        if db.query(Hospital).filter(Hospital.name == changes["name"]).first():
            raise HTTPException(status_code=400, detail="A hospital with that name already exists")
    for field, value in changes.items():
        setattr(hospital, field, value)
    write_audit(
        db,
        user_name="Admin",
        user_role="superadmin",
        action_type="UPDATE",
        entity_type="Hospital",
        entity_id=str(hospital.id),
        details={"fields": list(changes.keys())},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(hospital)
    return _hospital_out(hospital, db)


@router.patch("/hospitals/{hospital_id}/deactivate", response_model=HospitalOut)
def deactivate_hospital_admin(
    hospital_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    hospital = db.query(Hospital).filter(Hospital.id == hospital_id).first()
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    hospital.is_active = False
    write_audit(
        db,
        user_name="Admin",
        user_role="superadmin",
        action_type="DEACTIVATE",
        entity_type="Hospital",
        entity_id=str(hospital.id),
        details={"name": hospital.name},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(hospital)
    return _hospital_out(hospital, db)


@router.patch("/hospitals/{hospital_id}/activate", response_model=HospitalOut)
def activate_hospital_admin(
    hospital_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    hospital = db.query(Hospital).filter(Hospital.id == hospital_id).first()
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    hospital.is_active = True
    write_audit(
        db,
        user_name="Admin",
        user_role="superadmin",
        action_type="ACTIVATE",
        entity_type="Hospital",
        entity_id=str(hospital.id),
        details={"name": hospital.name},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(hospital)
    return _hospital_out(hospital, db)


# ── Health / monitoring endpoints ─────────────────────────────────────────────

@router.get("/ping")
def admin_ping(_: dict = Depends(_verify_admin_token)):
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat()}


def _fetch_at_balance() -> Optional[float]:
    """Fetch Africa's Talking account balance. Returns None on error or when simulating."""
    if settings.AT_SIMULATE or not settings.AT_API_KEY:
        return None
    try:
        url = f"https://api.africastalking.com/version1/user?username={settings.AT_USERNAME}"
        req = urllib.request.Request(url, headers={
            "apiKey": settings.AT_API_KEY,
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = _json.loads(resp.read())
        balance_str = data.get("UserData", {}).get("balance", "")
        # Balance comes as "UGX 12500.00" — strip currency prefix
        parts = balance_str.strip().split()
        return float(parts[-1]) if parts else None
    except Exception:
        return None


@router.get("/health")
def admin_health(
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    from app.services.scheduler import get_scheduler_state
    from app.services.alerting import send_alert_email

    now = datetime.now(timezone.utc)
    today = date.today()
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    fifteen_min_ago = now - timedelta(minutes=15)

    # ── SMS stats ─────────────────────────────────────────────────────────────
    status_col = cast(Reminder.status, String)
    r_type_col = cast(getattr(Reminder, 'reminder_type', None) or Reminder.id, String)

    sent_today = db.query(func.count(Reminder.id)).filter(
        status_col == 'SENT',
        func.date(Reminder.created_at) == today,
    ).scalar() or 0

    sent_week = db.query(func.count(Reminder.id)).filter(
        status_col == 'SENT',
        Reminder.created_at >= week_ago,
    ).scalar() or 0

    sent_month = db.query(func.count(Reminder.id)).filter(
        status_col == 'SENT',
        Reminder.created_at >= month_ago,
    ).scalar() or 0

    failed_week = db.query(func.count(Reminder.id)).filter(
        status_col == 'FAILED',
        Reminder.created_at >= week_ago,
    ).scalar() or 0

    total_month = db.query(func.count(Reminder.id)).filter(
        status_col.in_(['SENT', 'FAILED']),
        Reminder.created_at >= month_ago,
    ).scalar() or 0
    delivery_rate = round(sent_month / total_month * 100, 1) if total_month > 0 else None

    at_balance = _fetch_at_balance()

    # ── Application activity ──────────────────────────────────────────────────
    active_users = db.query(func.count(AuditLog.user_id.distinct())).filter(
        AuditLog.created_at >= fifteen_min_ago,
        AuditLog.user_id.isnot(None),
    ).scalar() or 0

    logins_today = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'LOGIN',
        func.date(AuditLog.created_at) == today,
    ).scalar() or 0

    enrollments_today = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'ENROLL',
        func.date(AuditLog.created_at) == today,
    ).scalar() or 0

    enrollments_week = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'ENROLL',
        AuditLog.created_at >= week_ago,
    ).scalar() or 0

    exams_today = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'EXAM',
        func.date(AuditLog.created_at) == today,
    ).scalar() or 0

    exams_week = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'EXAM',
        AuditLog.created_at >= week_ago,
    ).scalar() or 0

    last_activity = db.query(func.max(AuditLog.created_at)).scalar()

    # ── DB size ───────────────────────────────────────────────────────────────
    db_size_bytes = db.execute(
        text("SELECT pg_database_size(current_database())")
    ).scalar() or 0

    # ── Scheduler state ───────────────────────────────────────────────────────
    scheduler = get_scheduler_state()

    # ── Threshold alerts — log to audit_log when they fire ───────────────────
    alert_writes: list[tuple[str, str]] = []

    if delivery_rate is not None and delivery_rate < 75:
        fired = send_alert_email(
            subject="SMS delivery rate below 75%",
            body=f"SMS delivery rate this month is {delivery_rate}% ({sent_month} sent, {total_month - sent_month} failed).",
            alert_key="sms_delivery_rate",
        )
        if fired:
            alert_writes.append(("sms_delivery_rate", f"SMS delivery rate dropped to {delivery_rate}%"))

    if at_balance is not None and at_balance < settings.AT_BALANCE_ALERT_THRESHOLD:
        fired = send_alert_email(
            subject=f"Africa's Talking balance low: {at_balance}",
            body=f"AT account balance is {at_balance} which is below the alert threshold of {settings.AT_BALANCE_ALERT_THRESHOLD}.",
            alert_key="at_balance_low",
        )
        if fired:
            alert_writes.append(("at_balance_low", f"AT balance is {at_balance} UGX (threshold: {settings.AT_BALANCE_ALERT_THRESHOLD})"))

    last_any = scheduler.get("last_any_run")
    if scheduler.get("running") and last_any:
        last_dt = datetime.fromisoformat(last_any)
        if (now - last_dt).total_seconds() > 26 * 3600:
            fired = send_alert_email(
                subject="Scheduler has not run in over 26 hours",
                body=f"The reminder scheduler last ran at {last_any}. This may indicate a problem with the background job executor.",
                alert_key="scheduler_stale",
            )
            if fired:
                hours_since = round((now - last_dt).total_seconds() / 3600, 1)
                alert_writes.append(("scheduler_stale", f"Scheduler last ran {hours_since}h ago"))

    if alert_writes:
        for alert_key, message in alert_writes:
            write_audit(
                db,
                user_name="System",
                user_role="system",
                action_type="ALERT",
                entity_type="SystemHealth",
                entity_id=alert_key,
                details={"message": message},
            )
        db.commit()

    # ── Recent alerts (last 7 days) ───────────────────────────────────────────
    raw_alerts = (
        db.query(AuditLog)
        .filter(
            AuditLog.entity_type == "SystemHealth",
            AuditLog.action_type == "ALERT",
            AuditLog.created_at >= now - timedelta(days=7),
        )
        .order_by(AuditLog.created_at.desc())
        .limit(5)
        .all()
    )
    recent_alerts = [
        {
            "id": str(a.id),
            "created_at": a.created_at.isoformat(),
            "alert_key": a.entity_id,
            "message": a.details.get("message", "") if a.details else "",
        }
        for a in raw_alerts
    ]

    return {
        "sms": {
            "sent_today": sent_today,
            "sent_this_week": sent_week,
            "sent_this_month": sent_month,
            "failed_this_week": failed_week,
            "delivery_rate_month": delivery_rate,
            "at_balance": at_balance,
            "at_simulating": settings.AT_SIMULATE,
        },
        "activity": {
            "active_users_15m": active_users,
            "logins_today": logins_today,
            "enrollments_today": enrollments_today,
            "enrollments_this_week": enrollments_week,
            "exams_today": exams_today,
            "exams_this_week": exams_week,
            "last_activity": last_activity.isoformat() if last_activity else None,
        },
        "scheduler": scheduler,
        "db": {
            "size_bytes": db_size_bytes,
        },
        "recent_alerts": recent_alerts,
        "fetched_at": now.isoformat(),
    }
