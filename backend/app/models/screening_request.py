from __future__ import annotations
import uuid
import enum
from sqlalchemy import Column, Text, DateTime, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class ScreeningRequestStatus(str, enum.Enum):
    PENDING = "pending"
    CLAIMED = "claimed"
    COMPLETED = "completed"
    ESCALATED = "escalated"


class ScreeningRequest(Base):
    __tablename__ = "screening_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baby_id = Column(UUID(as_uuid=True), ForeignKey("babies.id"), nullable=False)
    hospital_id = Column(UUID(as_uuid=True), ForeignKey("hospitals.id"), nullable=False)
    requested_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    claimed_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    status = Column(
        Enum(ScreeningRequestStatus, values_callable=lambda x: [e.value for e in x]),
        default=ScreeningRequestStatus.PENDING,
        nullable=False,
    )

    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    escalated_at = Column(DateTime(timezone=True), nullable=True)

    baby = relationship("Baby", back_populates="screening_requests")
    hospital = relationship("Hospital")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    claimed_by = relationship("User", foreign_keys=[claimed_by_id])
