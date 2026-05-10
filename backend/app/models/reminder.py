from __future__ import annotations
import uuid
import enum
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class ReminderType(str, enum.Enum):
    SMS = "sms"
    WHATSAPP = "whatsapp"
    IN_APP = "in_app"      # alert to coordinator
    PHONE_CALL = "phone_call"  # logged when coordinator calls


class ReminderTrigger(str, enum.Enum):
    T_MINUS_3 = "t_minus_3"       # 3 days before
    T_MINUS_1 = "t_minus_1"       # 1 day before
    DAY_OF = "day_of"             # day of, no-show
    LTFU_48H = "ltfu_48h"         # 48h after missed
    MANUAL_CALL = "manual_call"   # coordinator logged a phone call


class ReminderStatus(str, enum.Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    ACKNOWLEDGED = "acknowledged"


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baby_id = Column(UUID(as_uuid=True), ForeignKey("babies.id"), nullable=False)
    appointment_id = Column(UUID(as_uuid=True), ForeignKey("appointments.id"), nullable=False)

    reminder_type = Column(Enum(ReminderType), nullable=False)
    trigger = Column(Enum(ReminderTrigger), nullable=False)
    language = Column(String, nullable=False, default="english")

    recipient_phone = Column(String, nullable=True)
    message_body = Column(Text, nullable=True)

    status = Column(Enum(ReminderStatus), default=ReminderStatus.PENDING)
    provider_message_id = Column(String, nullable=True)  # Africa's Talking message ID
    error_message = Column(Text, nullable=True)

    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    baby = relationship("Baby", back_populates="reminders")
    appointment = relationship("Appointment", back_populates="reminders")
