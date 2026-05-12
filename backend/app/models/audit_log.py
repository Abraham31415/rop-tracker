from __future__ import annotations
import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func

from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Who performed the action (nullable — admin actions have no DB user)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_name = Column(String, nullable=False)
    user_role = Column(String, nullable=False)

    # What happened
    action_type = Column(String, nullable=False)   # e.g. CREATE, UPDATE, DEACTIVATE
    entity_type = Column(String, nullable=False)   # e.g. User, Baby, Hospital
    entity_id = Column(String, nullable=True)
    details = Column(JSONB, nullable=True)

    ip_address = Column(String, nullable=True)
