from __future__ import annotations

import os
import time
import uuid
import urllib.request
import urllib.error
import json as _json
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Any
from uuid import UUID

import pyotp
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import func, cast, String, text, and_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User, UserRole
from app.models.baby import Baby
from app.models.hospital import Hospital
from app.models.audit_log import AuditLog
from app.models.reminder import Reminder, ReminderStatus
from app.utils.audit import write_audit

router = APIRouter(prefix="/api/sys-mgmt", tags=["admin"])

_ADMIN_TOKEN_EXPIRE_MINUTES = 120   # 2-hour session

# ── In-memory session state ───────────────────────────────────────────────────
_active_session_jti: Optional[str] = None

# ── Rate limiting (per IP, in-memory) ────────────────────────────────────────
_LOGIN_WINDOW_SECONDS = 30 * 60   # 30 minutes
_LOGIN_MAX_FAILURES   = 5
_login_failures: dict[str, list[float]] = {}   # ip -> list of failure timestamps

# ── TOTP setup secret (used when ADMIN_TOTP_SECRET not yet persisted in env) ──
_setup_totp_secret: Optional[str] = None


def _get_totp_secret() -> str:
    """Return active TOTP secret, auto-generating one for first-run setup."""
    global _setup_totp_secret
    if settings.ADMIN_TOTP_SECRET:
        return settings.ADMIN_TOTP_SECRET
    if not _setup_totp_secret:
        _setup_totp_secret = pyotp.random_base32()
    return _setup_totp_secret


# ── Rate-limit helpers ────────────────────────────────────────────────────────

def _check_rate_limit(ip: str) -> None:
    now = time.time()
    recent = [t for t in _login_failures.get(ip, []) if now - t < _LOGIN_WINDOW_SECONDS]
    _login_failures[ip] = recent
    if len(recent) >= _LOGIN_MAX_FAILURES:
        wait_secs = int(_LOGIN_WINDOW_SECONDS - (now - recent[0]))
        mins = max(1, (wait_secs + 59) // 60)
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {mins} minute{'s' if mins != 1 else ''}.",
            headers={"Retry-After": str(wait_secs)},
        )


def _record_failure(ip: str) -> None:
    now = time.time()
    recent = [t for t in _login_failures.get(ip, []) if now - t < _LOGIN_WINDOW_SECONDS]
    recent.append(now)
    _login_failures[ip] = recent


def _reset_rate_limit(ip: str) -> None:
    _login_failures.pop(ip, None)


# ── Admin JWT helpers ─────────────────────────────────────────────────────────

def _admin_secret() -> str:
    return settings.ADMIN_SESSION_SECRET or settings.ADMIN_SECRET_KEY or settings.SECRET_KEY


def _create_admin_token() -> str:
    global _active_session_jti
    jti = str(uuid.uuid4())
    _active_session_jti = jti
    payload = {
        "sub": "admin",
        "role": "superadmin",
        "jti": jti,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=_ADMIN_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, _admin_secret(), algorithm=settings.ALGORITHM)


def _verify_admin_token(admin_session: Optional[str] = Cookie(None)) -> dict:
    if not admin_session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(admin_session, _admin_secret(), algorithms=[settings.ALGORITHM])
        if payload.get("role") != "superadmin":
            raise HTTPException(status_code=403, detail="Not an admin token")
        if payload.get("jti") != _active_session_jti:
            raise HTTPException(status_code=401, detail="Session invalidated - please log in again")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")


def _set_session_cookie(response: Response, token: str) -> None:
    """Set the HttpOnly admin session cookie with correct flags for environment."""
    secure   = settings.PRODUCTION
    samesite = "none" if settings.PRODUCTION else "lax"
    response.set_cookie(
        key="admin_session",
        value=token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=_ADMIN_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key="admin_session",
        path="/",
        httponly=True,
        secure=settings.PRODUCTION,
        samesite="none" if settings.PRODUCTION else "lax",
    )


# ── Schemas ───────────────────────────────────────────────────────────────────

class AdminLoginStep1(BaseModel):
    email: str
    password: str


class AdminLoginStep2(BaseModel):
    totp_token: str
    code: str


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


class HospitalActivity(BaseModel):
    name: Optional[str] = None
    detail: Optional[str] = None
    needs_attention: bool = False


class DashboardStats(BaseModel):
    total_hospitals: int
    active_hospitals: int
    total_coordinators: int
    active_coordinators: int
    total_babies: int
    babies_at_risk: int
    recent_audit_entries: int
    ltfu_this_month: int
    babies_screened: int
    babies_treated: int
    most_active_hospital: Optional[HospitalActivity] = None
    least_active_hospital: Optional[HospitalActivity] = None


# ── Login - Step 1: email + password ─────────────────────────────────────────

@router.post("/login")
def admin_login_step1(
    data: AdminLoginStep1,
    request: Request,
    db: Session = Depends(get_db),
):
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)

    if data.email != settings.ADMIN_EMAIL or data.password != settings.ADMIN_PASSWORD:
        _record_failure(ip)
        write_audit(
            db,
            user_name="UNKNOWN",
            user_role="anonymous",
            action_type="FAILED_LOGIN",
            entity_type="Admin",
            entity_id="admin",
            details={"email": data.email, "ip": ip},
            ip_address=ip,
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Issue a short-lived TOTP-pending token (5 minutes)
    totp_payload = {
        "sub": "admin",
        "type": "totp_pending",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    totp_token = jwt.encode(totp_payload, _admin_secret(), algorithm=settings.ALGORITHM)

    setup_required = not bool(settings.ADMIN_TOTP_SECRET)
    totp_secret    = _get_totp_secret()
    qr_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
        name=data.email,
        issuer_name="ROP Tracker Uganda",
    )

    response: dict[str, Any] = {
        "requires_totp": True,
        "totp_token": totp_token,
        "setup_required": setup_required,
        "qr_uri": qr_uri if setup_required else None,
    }
    if setup_required:
        # Show the raw secret once so admin can also enter it manually
        response["totp_secret_raw"] = totp_secret
    return response


# ── Login - Step 2: TOTP verification → sets HttpOnly cookie ─────────────────

@router.post("/login/totp")
def admin_login_step2(
    data: AdminLoginStep2,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)

    # Validate the TOTP-pending token
    try:
        pending = jwt.decode(data.totp_token, _admin_secret(), algorithms=[settings.ALGORITHM])
        if pending.get("type") != "totp_pending":
            raise HTTPException(status_code=400, detail="Invalid token type")
    except JWTError:
        raise HTTPException(status_code=401, detail="Session expired - please start login again")

    # Verify the 6-digit TOTP code
    totp_secret = _get_totp_secret()
    totp = pyotp.TOTP(totp_secret)
    if not totp.verify(data.code, valid_window=1):
        _record_failure(ip)
        write_audit(
            db,
            user_name="Admin",
            user_role="superadmin",
            action_type="FAILED_TOTP",
            entity_type="Admin",
            entity_id="admin",
            details={"ip": ip},
            ip_address=ip,
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Success - invalidate any previous session and create new one
    _reset_rate_limit(ip)
    token = _create_admin_token()
    _set_session_cookie(response, token)

    write_audit(
        db,
        user_name="Admin",
        user_role="superadmin",
        action_type="LOGIN",
        entity_type="Admin",
        entity_id="admin",
        details={"ip": ip},
        ip_address=ip,
    )
    db.commit()
    return {"ok": True}


# ── Session check (frontend calls this on mount to verify cookie) ─────────────

@router.get("/me")
def admin_me(_: dict = Depends(_verify_admin_token)):
    return {"ok": True, "role": "superadmin", "email": settings.ADMIN_EMAIL}


# ── Logout ────────────────────────────────────────────────────────────────────

@router.post("/logout")
def admin_logout(response: Response):
    global _active_session_jti
    _active_session_jti = None
    _clear_session_cookie(response)
    return {"ok": True}


# ── Dashboard stats ───────────────────────────────────────────────────────────

@router.get("/dashboard", response_model=DashboardStats)
def admin_dashboard(
    db: Session = Depends(get_db),
    _: dict = Depends(_verify_admin_token),
):
    from app.models.exam import Exam
    from app.models.outcome import Outcome

    coord_names = ['CENTRAL_COORDINATOR', 'HOSPITAL_COORDINATOR']
    role_col = cast(User.role, String)

    now         = datetime.now(timezone.utc)
    today       = date.today()
    week_ago    = now - timedelta(days=7)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    total_hospitals   = db.query(func.count(Hospital.id)).scalar() or 0
    active_hospitals  = db.query(func.count(Hospital.id)).filter(Hospital.is_active == True).scalar() or 0
    total_coords      = db.query(func.count(User.id)).filter(role_col.in_(coord_names)).scalar() or 0
    active_coords     = db.query(func.count(User.id)).filter(
        role_col.in_(coord_names), User.is_active == True
    ).scalar() or 0
    total_babies      = db.query(func.count(Baby.id)).scalar() or 0

    treated_ids = {
        r[0] for r in db.query(Outcome.baby_id).filter(cast(Outcome.treatment_type, String) != 'NONE')
    }
    at_risk_q = db.query(func.count(Exam.baby_id.distinct())).filter(
        Exam.treatment_recommended != None,
    )
    if treated_ids:
        at_risk_q = at_risk_q.filter(~Exam.baby_id.in_(treated_ids))
    at_risk = at_risk_q.scalar() or 0

    recent_audit = db.query(func.count(AuditLog.id)).filter(
        AuditLog.created_at >= week_ago
    ).scalar() or 0

    # LTFU babies whose status was last changed this month
    ltfu_this_month = db.query(func.count(Baby.id)).filter(
        cast(Baby.status, String) == 'LTFU',
        Baby.updated_at >= month_start,
    ).scalar() or 0

    # Care funnel: enrolled -> screened (>=1 exam) -> treated
    babies_screened = db.query(func.count(Exam.baby_id.distinct())).scalar() or 0
    babies_treated  = len(treated_ids)

    # Most active hospital today (by audit-log volume)
    most_active = None
    top = (
        db.query(Hospital.name, func.count(AuditLog.id).label("cnt"))
        .join(User, User.hospital_id == Hospital.id)
        .join(AuditLog, AuditLog.user_id == User.id)
        .filter(func.date(AuditLog.created_at) == today)
        .group_by(Hospital.id, Hospital.name)
        .order_by(func.count(AuditLog.id).desc())
        .first()
    )
    if top:
        most_active = HospitalActivity(
            name=top[0],
            detail=f"{top[1]} action{'s' if top[1] != 1 else ''} today",
        )

    # Least active hospital (longest since any staff login)
    least_active = None
    login_rows = (
        db.query(Hospital.name, func.max(AuditLog.created_at).label("last_login"))
        .outerjoin(User, User.hospital_id == Hospital.id)
        .outerjoin(AuditLog, and_(
            AuditLog.user_id == User.id,
            AuditLog.action_type == "LOGIN",
        ))
        .filter(Hospital.is_active == True)
        .group_by(Hospital.id, Hospital.name)
        .all()
    )
    if login_rows:
        oldest = min(
            login_rows,
            key=lambda r: r.last_login or datetime.min.replace(tzinfo=timezone.utc),
        )
        if oldest.last_login is None:
            least_active = HospitalActivity(
                name=oldest.name, detail="no recorded login", needs_attention=True,
            )
        else:
            days = (now - oldest.last_login).days
            if days <= 0:
                detail = "last login today"
            elif days == 1:
                detail = "last login 1 day ago"
            else:
                detail = f"last login {days} days ago"
            least_active = HospitalActivity(
                name=oldest.name, detail=detail, needs_attention=days >= 7,
            )

    return DashboardStats(
        total_hospitals=total_hospitals,
        active_hospitals=active_hospitals,
        total_coordinators=total_coords,
        active_coordinators=active_coords,
        total_babies=total_babies,
        babies_at_risk=at_risk,
        recent_audit_entries=recent_audit,
        ltfu_this_month=ltfu_this_month,
        babies_screened=babies_screened,
        babies_treated=babies_treated,
        most_active_hospital=most_active,
        least_active_hospital=least_active,
    )


# ── Coordinator management ────────────────────────────────────────────────────

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


# ── Audit log ─────────────────────────────────────────────────────────────────

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
    baby_count  = db.query(func.count(Baby.id)).filter(Baby.hospital_id == h.id).scalar() or 0
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


# ── Health / monitoring ───────────────────────────────────────────────────────

@router.get("/ping")
def admin_ping(_: dict = Depends(_verify_admin_token)):
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat()}


def _fetch_at_balance() -> Optional[float]:
    """Fetch Africa's Talking account balance. Returns None on error or simulation."""
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

    now      = datetime.now(timezone.utc)
    today    = date.today()
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    fifteen_min_ago = now - timedelta(minutes=15)

    status_col = cast(Reminder.status, String)

    sent_today = db.query(func.count(Reminder.id)).filter(
        status_col == 'SENT', func.date(Reminder.created_at) == today,
    ).scalar() or 0

    sent_week = db.query(func.count(Reminder.id)).filter(
        status_col == 'SENT', Reminder.created_at >= week_ago,
    ).scalar() or 0

    sent_month = db.query(func.count(Reminder.id)).filter(
        status_col == 'SENT', Reminder.created_at >= month_ago,
    ).scalar() or 0

    failed_week = db.query(func.count(Reminder.id)).filter(
        status_col == 'FAILED', Reminder.created_at >= week_ago,
    ).scalar() or 0

    total_month = db.query(func.count(Reminder.id)).filter(
        status_col.in_(['SENT', 'FAILED']), Reminder.created_at >= month_ago,
    ).scalar() or 0
    delivery_rate = round(sent_month / total_month * 100, 1) if total_month > 0 else None

    at_balance = _fetch_at_balance()

    active_users = db.query(func.count(AuditLog.user_id.distinct())).filter(
        AuditLog.created_at >= fifteen_min_ago, AuditLog.user_id.isnot(None),
    ).scalar() or 0

    logins_today = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'LOGIN', func.date(AuditLog.created_at) == today,
    ).scalar() or 0

    enrollments_today = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'ENROLL', func.date(AuditLog.created_at) == today,
    ).scalar() or 0

    enrollments_week = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'ENROLL', AuditLog.created_at >= week_ago,
    ).scalar() or 0

    exams_today = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'EXAM', func.date(AuditLog.created_at) == today,
    ).scalar() or 0

    exams_week = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action_type == 'EXAM', AuditLog.created_at >= week_ago,
    ).scalar() or 0

    last_activity = db.query(func.max(AuditLog.created_at)).scalar()

    db_size_bytes = db.execute(
        text("SELECT pg_database_size(current_database())")
    ).scalar() or 0

    scheduler = get_scheduler_state()

    # Threshold alerts
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
                body=f"The reminder scheduler last ran at {last_any}. This may indicate a problem.",
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
        "db": {"size_bytes": db_size_bytes},
        "recent_alerts": recent_alerts,
        "fetched_at": now.isoformat(),
    }
