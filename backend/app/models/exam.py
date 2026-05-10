from __future__ import annotations
import uuid
import enum
from sqlalchemy import Column, String, Date, DateTime, ForeignKey, Enum, Text, Integer, Float
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


class VFFixation(str, enum.Enum):
    CENTRAL = "central"
    ECCENTRIC = "eccentric"
    NONE_UNABLE = "none_unable"


class VFFollowing(str, enum.Enum):
    FOLLOWS_SMOOTHLY = "follows_smoothly"
    FOLLOWS_PARTIALLY = "follows_partially"
    DOES_NOT_FOLLOW = "does_not_follow"
    UNABLE_TO_ASSESS = "unable_to_assess"


class VFCSM(str, enum.Enum):
    CSM = "csm"
    CS = "cs"
    C = "c"
    NOT_CENTRAL = "not_central"
    UNABLE_TO_ASSESS = "unable_to_assess"


class Nystagmus(str, enum.Enum):
    ABSENT = "absent"
    PENDULAR = "pendular"
    JERK = "jerk"
    LATENT = "latent"


class Strabismus(str, enum.Enum):
    ABSENT = "absent"
    ESOTROPIA = "esotropia"
    EXOTROPIA = "exotropia"
    SUSPECTED = "suspected"


class VFFunctionalImpression(str, enum.Enum):
    AGE_APPROPRIATE = "age_appropriate"
    MILDLY_DELAYED = "mildly_delayed"
    SIGNIFICANTLY_DELAYED = "significantly_delayed"
    UNABLE_TO_ASSESS = "unable_to_assess"


class Exam(Base):
    __tablename__ = "exams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baby_id = Column(UUID(as_uuid=True), ForeignKey("babies.id"), nullable=False)
    examiner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    exam_date = Column(Date, nullable=False)
    postnatal_age_days = Column(Integer, nullable=True)
    postmenstrual_age_weeks = Column(String, nullable=True)

    # Right eye
    right_zone = Column(Enum(Zone, values_callable=lambda x: [e.value for e in x]), nullable=True)
    right_stage = Column(Enum(Stage, values_callable=lambda x: [e.value for e in x]), nullable=True)
    right_plus = Column(Enum(PlusDisease, values_callable=lambda x: [e.value for e in x]), default=PlusDisease.NONE)

    # Left eye
    left_zone = Column(Enum(Zone, values_callable=lambda x: [e.value for e in x]), nullable=True)
    left_stage = Column(Enum(Stage, values_callable=lambda x: [e.value for e in x]), nullable=True)
    left_plus = Column(Enum(PlusDisease, values_callable=lambda x: [e.value for e in x]), default=PlusDisease.NONE)

    # Worst finding (used for scheduling — system auto-derives this)
    worst_zone = Column(Enum(Zone, values_callable=lambda x: [e.value for e in x]), nullable=True)
    worst_stage = Column(Enum(Stage, values_callable=lambda x: [e.value for e in x]), nullable=True)
    has_plus_disease = Column(String, nullable=True)  # "yes" / "no"

    # Next appointment interval auto-calculated from findings
    next_exam_weeks = Column(Integer, nullable=True)  # 1, 2, 3, or 4

    treatment_recommended = Column(String, nullable=True)  # laser / bevacizumab / surgery
    notes = Column(Text, nullable=True)

    # Visual Function Assessment
    vf_right_fixation = Column(Enum(VFFixation, name='vffixation', values_callable=lambda x: [e.value for e in x]), nullable=True)
    vf_right_following = Column(Enum(VFFollowing, name='vffollowing', values_callable=lambda x: [e.value for e in x]), nullable=True)
    vf_right_csm = Column(Enum(VFCSM, name='vfcsm', values_callable=lambda x: [e.value for e in x]), nullable=True)
    vf_right_teller_acuity = Column(Float, nullable=True)
    vf_right_vep = Column(Float, nullable=True)
    vf_left_fixation = Column(Enum(VFFixation, name='vffixation', values_callable=lambda x: [e.value for e in x]), nullable=True)
    vf_left_following = Column(Enum(VFFollowing, name='vffollowing', values_callable=lambda x: [e.value for e in x]), nullable=True)
    vf_left_csm = Column(Enum(VFCSM, name='vfcsm', values_callable=lambda x: [e.value for e in x]), nullable=True)
    vf_left_teller_acuity = Column(Float, nullable=True)
    vf_left_vep = Column(Float, nullable=True)
    vf_nystagmus = Column(Enum(Nystagmus, name='nystagmus', values_callable=lambda x: [e.value for e in x]), nullable=True)
    vf_strabismus = Column(Enum(Strabismus, name='strabismus', values_callable=lambda x: [e.value for e in x]), nullable=True)
    vf_functional_impression = Column(Enum(VFFunctionalImpression, name='vffunctionalimpression', values_callable=lambda x: [e.value for e in x]), nullable=True)
    vf_notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    baby = relationship("Baby", back_populates="exams")
    examiner = relationship("User", back_populates="exams")
    appointment = relationship("Appointment", back_populates="exam", uselist=False)
