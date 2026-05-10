from __future__ import annotations
import uuid
import enum
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Enum, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class AlertType(str, enum.Enum):
    LTFU_FLAGGED = "ltfu_flagged"       # baby not seen 48 h+ after appointment


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Scope — who sees this alert
    hospital_id     = Column(UUID(as_uuid=True), ForeignKey("hospitals.id"), nullable=False)

    # What triggered it
    baby_id         = Column(UUID(as_uuid=True), ForeignKey("babies.id"),    nullable=False)
    appointment_id  = Column(UUID(as_uuid=True), ForeignKey("appointments.id"), nullable=True)

    alert_type      = Column(Enum(AlertType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=AlertType.LTFU_FLAGGED)
    title           = Column(String, nullable=False)
    body            = Column(Text, nullable=True)

    is_dismissed    = Column(Boolean, default=False, nullable=False)
    dismissed_at    = Column(DateTime(timezone=True), nullable=True)
    dismissed_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    hospital     = relationship("Hospital")
    baby         = relationship("Baby")
    appointment  = relationship("Appointment")
