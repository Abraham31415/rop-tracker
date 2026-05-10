"""
Alert endpoints.
GET  /api/alerts/        — list undismissed alerts for the current coordinator
GET  /api/alerts/count   — unread count (for badge)
PATCH /api/alerts/{id}/dismiss — dismiss an alert
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.alert import Alert
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _require_coordinator(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Coordinators only")
    return user


def _serialize(a: Alert) -> dict:
    return {
        "id": str(a.id),
        "hospital_id": str(a.hospital_id),
        "baby_id": str(a.baby_id),
        "appointment_id": str(a.appointment_id) if a.appointment_id else None,
        "alert_type": a.alert_type,
        "title": a.title,
        "body": a.body,
        "is_dismissed": a.is_dismissed,
        "dismissed_at": a.dismissed_at.isoformat() if a.dismissed_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "baby_name": a.baby.full_name if a.baby else None,
    }


@router.get("/")
def list_alerts(
    db: Session = Depends(get_db),
    user: User = Depends(_require_coordinator),
):
    q = db.query(Alert).filter(Alert.is_dismissed == False)

    if user.role == UserRole.HOSPITAL_COORDINATOR and user.hospital_id:
        q = q.filter(Alert.hospital_id == user.hospital_id)

    alerts = q.order_by(Alert.created_at.desc()).limit(100).all()
    return [_serialize(a) for a in alerts]


@router.get("/count")
def alert_count(
    db: Session = Depends(get_db),
    user: User = Depends(_require_coordinator),
):
    q = db.query(Alert).filter(Alert.is_dismissed == False)

    if user.role == UserRole.HOSPITAL_COORDINATOR and user.hospital_id:
        q = q.filter(Alert.hospital_id == user.hospital_id)

    return {"count": q.count()}


@router.patch("/{alert_id}/dismiss")
def dismiss_alert(
    alert_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(_require_coordinator),
):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(404, "Alert not found")

    if user.role == UserRole.HOSPITAL_COORDINATOR and alert.hospital_id != user.hospital_id:
        raise HTTPException(403, "Not your hospital's alert")

    alert.is_dismissed = True
    alert.dismissed_at = datetime.now(timezone.utc)
    alert.dismissed_by_id = user.id
    db.commit()
    db.refresh(alert)
    return _serialize(alert)
