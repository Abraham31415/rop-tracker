from __future__ import annotations
from uuid import UUID
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.baby import Baby
from app.models.referral import Referral, ReferralReason, ReferralStatus
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/referrals", tags=["referrals"])


class ReferralCreate(BaseModel):
    from_hospital_id: Optional[UUID] = None
    to_hospital_id: Optional[UUID] = None
    to_external: bool = False
    reason: ReferralReason
    referral_date: date
    status: ReferralStatus = ReferralStatus.PENDING
    notes: Optional[str] = None


class ReferralStatusUpdate(BaseModel):
    status: ReferralStatus
    notes: Optional[str] = None


class ReferralOut(BaseModel):
    id: UUID
    baby_id: UUID
    from_hospital_id: Optional[UUID]
    to_hospital_id: Optional[UUID]
    to_external: bool
    reason: ReferralReason
    referral_date: date
    status: ReferralStatus
    notes: Optional[str]
    from_hospital_name: Optional[str] = None
    to_hospital_name: Optional[str] = None

    model_config = {"from_attributes": True}


def _enrich(ref: Referral) -> ReferralOut:
    out = ReferralOut.model_validate(ref)
    if ref.from_hospital:
        out.from_hospital_name = ref.from_hospital.name
    if ref.to_external:
        out.to_hospital_name = "External / Abroad"
    elif ref.to_hospital:
        out.to_hospital_name = ref.to_hospital.name
    return out


@router.get("/baby/{baby_id}", response_model=list[ReferralOut])
def list_referrals(
    baby_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(404, "Baby not found")
    if user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != user.hospital_id:
        raise HTTPException(403, "Access denied")
    refs = db.query(Referral).filter(Referral.baby_id == baby_id).order_by(Referral.referral_date.desc()).all()
    return [_enrich(r) for r in refs]


@router.post("/baby/{baby_id}", response_model=ReferralOut)
def create_referral(
    baby_id: UUID,
    data: ReferralCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(404, "Baby not found")
    if user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != user.hospital_id:
        raise HTTPException(403, "Access denied")

    # Auto-fill from_hospital if not provided
    from_hosp = data.from_hospital_id or baby.hospital_id

    ref = Referral(
        baby_id=baby_id,
        from_hospital_id=from_hosp,
        to_hospital_id=data.to_hospital_id,
        to_external=data.to_external,
        reason=data.reason,
        referral_date=data.referral_date,
        status=data.status,
        notes=data.notes,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)
    return _enrich(ref)


@router.patch("/{referral_id}", response_model=ReferralOut)
def update_referral_status(
    referral_id: UUID,
    data: ReferralStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ref = db.query(Referral).filter(Referral.id == referral_id).first()
    if not ref:
        raise HTTPException(404, "Referral not found")

    baby = db.query(Baby).filter(Baby.id == ref.baby_id).first()
    if user.role != UserRole.CENTRAL_COORDINATOR and baby and baby.hospital_id != user.hospital_id:
        raise HTTPException(403, "Access denied")

    ref.status = data.status
    if data.notes is not None:
        ref.notes = data.notes
    db.commit()
    db.refresh(ref)
    return _enrich(ref)
