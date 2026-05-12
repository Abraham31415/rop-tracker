"""
GET  /api/contact-logs/{baby_id}      — list contact log entries for a baby
POST /api/contact-logs/{baby_id}/note — add a manual note
"""
from __future__ import annotations
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.user import User, UserRole
from app.models.baby import Baby
from app.models.contact_log import ContactLog, ContactLogType

router = APIRouter(prefix="/api/contact-logs", tags=["contact-logs"])


class ContactLogOut(BaseModel):
    id: UUID
    baby_id: UUID
    log_type: ContactLogType
    message: str
    field_name: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    created_at: datetime
    created_by_name: Optional[str] = None

    model_config = {"from_attributes": True}


class NoteIn(BaseModel):
    message: str


def _check_baby_access(baby_id: UUID, user: User, db: Session) -> Baby:
    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != user.hospital_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return baby


@router.get("/{baby_id}", response_model=list[ContactLogOut])
def list_contact_logs(
    baby_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_baby_access(baby_id, current_user, db)
    logs = (
        db.query(ContactLog)
        .filter(ContactLog.baby_id == baby_id)
        .order_by(ContactLog.created_at.desc())
        .all()
    )
    result = []
    for log in logs:
        entry = ContactLogOut(
            id=log.id,
            baby_id=log.baby_id,
            log_type=log.log_type,
            message=log.message,
            field_name=log.field_name,
            old_value=log.old_value,
            new_value=log.new_value,
            created_at=log.created_at,
            created_by_name=log.created_by.full_name if log.created_by else None,
        )
        result.append(entry)
    return result


@router.post("/{baby_id}/note", response_model=ContactLogOut)
def add_note(
    baby_id: UUID,
    data: NoteIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    baby = _check_baby_access(baby_id, current_user, db)
    log = ContactLog(
        baby_id=baby_id,
        created_by_id=current_user.id,
        log_type=ContactLogType.NOTE,
        message=data.message.strip(),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return ContactLogOut(
        id=log.id,
        baby_id=log.baby_id,
        log_type=log.log_type,
        message=log.message,
        created_at=log.created_at,
        created_by_name=current_user.full_name,
    )
