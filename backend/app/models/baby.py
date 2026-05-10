from __future__ import annotations
import uuid
import enum
from sqlalchemy import (
    Column, String, Boolean, Date, DateTime, Float, Integer,
    ForeignKey, Enum, Text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Sex(str, enum.Enum):
    MALE = "male"
    FEMALE = "female"


class Language(str, enum.Enum):
    ENGLISH = "english"
    LUGANDA = "luganda"
    RUNYANKOLE = "runyankole"
    ACHOLI = "acholi"
    ATESO = "ateso"


class BabyStatus(str, enum.Enum):
    ACTIVE = "active"          # being followed
    DISCHARGED = "discharged"  # no further follow-up needed
    LTFU = "ltfu"              # lost to follow-up
    TREATED = "treated"        # received treatment


class Baby(Base):
    __tablename__ = "babies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hospital_id = Column(UUID(as_uuid=True), ForeignKey("hospitals.id"), nullable=False)

    # Identity
    full_name = Column(String, nullable=False)
    date_of_birth = Column(Date, nullable=False)
    sex = Column(Enum(Sex), nullable=False)

    # Birth metrics
    birth_weight_grams = Column(Float, nullable=False)
    gestational_age_weeks = Column(Float, nullable=False)  # e.g. 28.5 weeks
    postnatal_age_days = Column(Integer, nullable=True)    # at first exam

    # Risk factors (boolean flags)
    oxygen_therapy = Column(Boolean, default=False)
    blood_transfusion = Column(Boolean, default=False)
    sepsis = Column(Boolean, default=False)
    inotropes = Column(Boolean, default=False)
    anaemia = Column(Boolean, default=False)

    # Parent / caregiver
    caregiver_name = Column(String, nullable=False)
    mtn_phone = Column(String, nullable=True)
    airtel_phone = Column(String, nullable=True)
    language_preference = Column(Enum(Language), default=Language.ENGLISH)

    # Status
    status = Column(Enum(BabyStatus), default=BabyStatus.ACTIVE)
    notes = Column(Text, nullable=True)

    enrolled_at = Column(DateTime(timezone=True), server_default=func.now())
    enrolled_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    hospital = relationship("Hospital", back_populates="babies")
    exams = relationship("Exam", back_populates="baby", order_by="Exam.exam_date.desc()")
    appointments = relationship("Appointment", back_populates="baby", order_by="Appointment.due_date")
    reminders = relationship("Reminder", back_populates="baby")
    outcome = relationship("Outcome", back_populates="baby", uselist=False)
    referrals = relationship("Referral", back_populates="baby", order_by="Referral.referral_date.desc()")
