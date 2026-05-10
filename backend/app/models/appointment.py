from __future__ import annotations
import uuid
import enum
from sqlalchemy import Column, Date, DateTime, ForeignKey, Enum, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class AppointmentStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    ATTENDED = "attended"
    MISSED = "missed"
    LTFU = "ltfu"      # 48h+ after missed


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baby_id = Column(UUID(as_uuid=True), ForeignKey("babies.id"), nullable=False)
    exam_id = Column(UUID(as_uuid=True), ForeignKey("exams.id"), nullable=True)  # exam that generated this appt

    due_date = Column(Date, nullable=False)
    status = Column(Enum(AppointmentStatus, values_callable=lambda x: [e.value for e in x]), default=AppointmentStatus.SCHEDULED)

    attended_at = Column(DateTime(timezone=True), nullable=True)
    missed_at = Column(DateTime(timezone=True), nullable=True)
    ltfu_at = Column(DateTime(timezone=True), nullable=True)

    coordinator_alerted = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    baby = relationship("Baby", back_populates="appointments")
    exam = relationship("Exam", back_populates="appointment")
    reminders = relationship("Reminder", back_populates="appointment")
