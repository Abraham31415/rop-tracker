from __future__ import annotations
import uuid
import enum
from sqlalchemy import Column, String, Date, DateTime, ForeignKey, Enum, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class ReferralReason(str, enum.Enum):
    LASER_NOT_AVAILABLE = "laser_not_available"
    SURGERY_NEEDED = "surgery_needed"
    SECOND_OPINION = "second_opinion"
    OTHER = "other"


class ReferralStatus(str, enum.Enum):
    PENDING = "pending"
    ARRIVED_TREATED = "arrived_treated"
    DID_NOT_ARRIVE = "did_not_arrive"
    UNKNOWN = "unknown"


class Referral(Base):
    __tablename__ = "referrals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baby_id = Column(UUID(as_uuid=True), ForeignKey("babies.id"), nullable=False)

    from_hospital_id = Column(UUID(as_uuid=True), ForeignKey("hospitals.id"), nullable=True)
    to_hospital_id = Column(UUID(as_uuid=True), ForeignKey("hospitals.id"), nullable=True)
    to_external = Column(Boolean, default=False)  # True for 'External / abroad'

    reason = Column(Enum(ReferralReason, values_callable=lambda x: [e.value for e in x]), nullable=False)
    referral_date = Column(Date, nullable=False)
    status = Column(Enum(ReferralStatus, values_callable=lambda x: [e.value for e in x]), default=ReferralStatus.PENDING)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    baby = relationship("Baby", back_populates="referrals")
    from_hospital = relationship("Hospital", foreign_keys=[from_hospital_id])
    to_hospital = relationship("Hospital", foreign_keys=[to_hospital_id])
