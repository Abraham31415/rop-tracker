from __future__ import annotations
import uuid
import enum
from sqlalchemy import Column, String, Date, DateTime, ForeignKey, Enum, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class TreatmentType(str, enum.Enum):
    NONE = "none"
    LASER = "laser"
    ANTI_VEGF = "anti_vegf"
    SURGERY = "surgery"
    COMBINATION = "combination"


class TreatmentEye(str, enum.Enum):
    RIGHT = "right"
    LEFT = "left"
    BOTH = "both"


class VisualOutcome(str, enum.Enum):
    GOOD_VISION = "good_vision"
    MILD_IMPAIRMENT = "mild_impairment"
    SEVERE_IMPAIRMENT = "severe_impairment"
    BLIND = "blind"
    TOO_YOUNG = "too_young"
    LTFU_BEFORE_OUTCOME = "ltfu_before_outcome"


class DischargeStatus(str, enum.Enum):
    COMPLETED_NO_ROP = "completed_no_rop"
    COMPLETED_TREATED = "completed_treated"
    REFERRED_NATIONAL = "referred_national"
    REFERRED_ABROAD = "referred_abroad"
    DIED = "died"
    LOST = "lost"
    ONGOING = "ongoing"


class Outcome(Base):
    __tablename__ = "outcomes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baby_id = Column(UUID(as_uuid=True), ForeignKey("babies.id"), unique=True, nullable=False)

    treatment_type = Column(Enum(TreatmentType), nullable=True)
    treatment_eye = Column(Enum(TreatmentEye), nullable=True)
    treatment_date = Column(Date, nullable=True)
    treatment_hospital_id = Column(UUID(as_uuid=True), ForeignKey("hospitals.id"), nullable=True)
    treating_ophthalmologist = Column(String, nullable=True)

    visual_outcome = Column(Enum(VisualOutcome), nullable=True)
    discharge_status = Column(Enum(DischargeStatus), nullable=True)
    discharge_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    baby = relationship("Baby", back_populates="outcome")
    treatment_hospital = relationship("Hospital", foreign_keys=[treatment_hospital_id])
