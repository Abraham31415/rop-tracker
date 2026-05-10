"""
User management endpoints (coordinators only).
GET    /api/users/             — list users (hospital-scoped)
POST   /api/users/             — create user
PATCH  /api/users/{id}/deactivate — deactivate user
PATCH  /api/users/{id}/activate   — reactivate user
"""
from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.hospital import Hospital
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/users", tags=["users"])


def _require_coordinator(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(403, "Coordinators only")
    return user


def _serialize(u: User, db: Session) -> dict:
    hospital = db.query(Hospital).filter(Hospital.id == u.hospital_id).first() if u.hospital_id else None
    return {
        "id": str(u.id),
        "email": u.email,
        "full_name": u.full_name,
        "role": u.role,
        "hospital_id": str(u.hospital_id) if u.hospital_id else None,
        "hospital_name": hospital.name if hospital else None,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("/")
def list_users(
    db: Session = Depends(get_db),
    user: User = Depends(_require_coordinator),
):
    q = db.query(User)
    if user.role == UserRole.HOSPITAL_COORDINATOR and user.hospital_id:
        q = q.filter(User.hospital_id == user.hospital_id)
    users = q.order_by(User.full_name).all()
    return [_serialize(u, db) for u in users]


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: UserRole
    hospital_id: UUID | None = None


@router.post("/")
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    current: User = Depends(_require_coordinator),
):
    # Hospital coordinators can only create users for their own hospital
    hospital_id = data.hospital_id
    if current.role == UserRole.HOSPITAL_COORDINATOR:
        hospital_id = current.hospital_id
    if not hospital_id:
        raise HTTPException(400, "hospital_id is required")

    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(400, "Email already registered")

    from app.auth.jwt import hash_password
    hashed = hash_password(data.password)
    new_user = User(
        email=data.email,
        full_name=data.full_name,
        hashed_password=hashed,
        role=data.role,
        hospital_id=hospital_id,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return _serialize(new_user, db)


@router.patch("/{user_id}/deactivate")
def deactivate_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current: User = Depends(_require_coordinator),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(404, "User not found")
    if current.role == UserRole.HOSPITAL_COORDINATOR and target.hospital_id != current.hospital_id:
        raise HTTPException(403, "Not your hospital")
    if str(target.id) == str(current.id):
        raise HTTPException(400, "Cannot deactivate your own account")
    target.is_active = False
    db.commit()
    return _serialize(target, db)


@router.patch("/{user_id}/activate")
def activate_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current: User = Depends(_require_coordinator),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(404, "User not found")
    if current.role == UserRole.HOSPITAL_COORDINATOR and target.hospital_id != current.hospital_id:
        raise HTTPException(403, "Not your hospital")
    target.is_active = True
    db.commit()
    return _serialize(target, db)
