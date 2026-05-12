from __future__ import annotations
import uuid
import enum
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class ContactLogType(str, enum.Enum):
    SMS = "sms"
    PHONE_CALL = "phone_call"
    CAREGIVER_EDIT = "caregiver_edit"
    SCREENING_REQUEST = "screening_request"
    NOTE = "note"


class ContactLog(Base):
    __tablename__ = "contact_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baby_id = Column(UUID(as_uuid=True), ForeignKey("babies.id"), nullable=False)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    log_type = Column(
        Enum(ContactLogType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Human-readable description shown in the timeline
    message = Column(Text, nullable=False)

    # For caregiver_edit entries: which field changed and what the values were
    field_name = Column(String, nullable=True)
    old_value = Column(String, nullable=True)
    new_value = Column(String, nullable=True)

    baby = relationship("Baby", back_populates="contact_logs")
    created_by = relationship("User", foreign_keys=[created_by_id])
