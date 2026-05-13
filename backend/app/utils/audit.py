from __future__ import annotations
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.audit_log import AuditLog


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
