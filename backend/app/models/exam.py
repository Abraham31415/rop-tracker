from __future__ import annotations
import uuid
import enum
from sqlalchemy import Column, String, Date, DateTime, ForeignKey, Enum, Text, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Zone(str, enum.Enum):
    ZONE_I = "zone_i"
    ZONE_II = "zone_ii"
    ZONE_III = "zone_iii"


class Stage(str, enum.Enum):
    NO_ROP = "no_rop"
    STAGE_1 = "stage_1"
    STAGE_2 = "stage_2"
    STAGE_3 = "stage_3"
    STAGE_4 = "stage_4"
    STAGE_5 = "stage_5"
    IMMATURE = "immature"


class PlusDisease(str, enum.Enum):
    NONE = "none"
    PRE_PLUS = "pre_plus"
    PLUS = "plus"


class Exam(Base):
    __tablename__ = "exams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baby_id = Column(UUID(as_uuid=True), ForeignKey("babies.id"), nullable=False)
    examiner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    exam_date = Column(Date, nullable=False)
    postnatal_age_days = Column(Integer, nullable=True)
    postmenstrual_age_weeks = Column(String, nullable=True)

    # Right eye
    right_zone = Column(Enum(Zone), nullable=True)
    right_stage = Column(Enum(Stage), nullable=True)
    right_plus = Column(Enum(PlusDisease), default=PlusDisease.NONE)

    # Left eye
    left_zone = Column(Enum(Zone), nullable=True)
    left_stage = Column(Enum(Stage), nullable=True)
    left_plus = Column(Enum(PlusDisease), default=PlusDisease.NONE)

    # Worst finding (used for scheduling — system auto-derives this)
    worst_zone = Column(Enum(Zone), nullable=True)
    worst_stage = Column(Enum(Stage), nullable=True)
    has_plus_disease = Column(String, nullable=True)  # "yes" / "no"

    # Next appointment interval auto-calculated from findings
    next_exam_weeks = Column(Integer, nullable=True)  # 1, 2, 3, or 4

    treatment_recommended = Column(String, nullable=True)  # laser / bevacizumab / surgery
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    baby = relationship("Baby", back_populates="exams")
    examiner = relationship("User", back_populates="exams")
    appointment = relationship("Appointment", back_populates="exam", uselist=False)
