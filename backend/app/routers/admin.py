from __future__ import annotations
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User, UserRole
from app.models.baby import Baby
from app.models.hospital import Hospital
from app.models.audit_log import AuditLog

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


class DashboardStats(BaseModel):
    total_hospitals: int
    active_hospitals: int
    total_coordinators: int
    active_coordinators: int
    total_babies: int
    babies_at_risk: int
    recent_audit_entries: int


# ── Audit log helper ──────────────────────────────────────────────────────────

def write_audit(
    db: Session,
    *,
    user_name: str,
    user_role: str,
    action_type: str,
    entity_type: str,
    entity_id: str | None = None,
    details: dict | None = None,
    ip_address: str | None = None,
    user_id: UUID | None = None,
) -> None:
    entry = AuditLog(
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
        action_type=action_type,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
        ip_address=ip_address,
    )
    db.add(entry)
    db.flush()


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
    coordinator_roles = [UserRole.CENTRAL_COORDINATOR, UserRole.HOSPITAL_COORDINATOR]

    total_hospitals   = db.query(func.count(Hospital.id)).scalar()
    active_hospitals  = db.query(func.count(Hospital.id)).filter(Hospital.is_active == True).scalar()
    total_coords      = db.query(func.count(User.id)).filter(User.role.in_(coordinator_roles)).scalar()
    active_coords     = db.query(func.count(User.id)).filter(
        User.role.in_(coordinator_roles), User.is_active == True
    ).scalar()
    total_babies      = db.query(func.count(Baby.id)).scalar()

    # At-risk: has exam with treatment_recommended set and no completed outcome
    from app.models.exam import Exam
    from app.models.outcome import Outcome
    treated_ids = {
        r[0] for r in db.query(Outcome.baby_id).filter(Outcome.treatment_type != "none")
    }
    at_risk = db.query(func.count(Exam.baby_id.distinct())).filter(
        Exam.treatment_recommended != None,
        ~Exam.baby_id.in_(treated_ids) if treated_ids else True,
    ).scalar()

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
    coordinator_roles = [UserRole.CENTRAL_COORDINATOR, UserRole.HOSPITAL_COORDINATOR]
    users = (
        db.query(User)
        .filter(User.role.in_(coordinator_roles))
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
