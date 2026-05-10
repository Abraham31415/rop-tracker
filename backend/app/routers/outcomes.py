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
from app.models.outcome import Outcome, TreatmentType, TreatmentEye, VisualOutcome, DischargeStatus
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/outcomes", tags=["outcomes"])


class OutcomeUpsert(BaseModel):
    treatment_type: Optional[TreatmentType] = None
    treatment_eye: Optional[TreatmentEye] = None
    treatment_date: Optional[date] = None
    treatment_hospital_id: Optional[UUID] = None
    treating_ophthalmologist: Optional[str] = None
    visual_outcome: Optional[VisualOutcome] = None
    discharge_status: Optional[DischargeStatus] = None
    discharge_date: Optional[date] = None
    notes: Optional[str] = None


class OutcomeOut(BaseModel):
    id: UUID
    baby_id: UUID
    treatment_type: Optional[TreatmentType]
    treatment_eye: Optional[TreatmentEye]
    treatment_date: Optional[date]
    treatment_hospital_id: Optional[UUID]
    treating_ophthalmologist: Optional[str]
    visual_outcome: Optional[VisualOutcome]
    discharge_status: Optional[DischargeStatus]
    discharge_date: Optional[date]
    notes: Optional[str]
    treatment_hospital_name: Optional[str] = None

    model_config = {"from_attributes": True}


def _check_access(baby: Baby, user: User):
    if user.role != UserRole.CENTRAL_COORDINATOR and baby.hospital_id != user.hospital_id:
        raise HTTPException(403, "Access denied")


@router.get("/{baby_id}", response_model=Optional[OutcomeOut])
def get_outcome(
    baby_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(404, "Baby not found")
    _check_access(baby, user)

    outcome = db.query(Outcome).filter(Outcome.baby_id == baby_id).first()
    if not outcome:
        return None

    result = OutcomeOut.model_validate(outcome)
    if outcome.treatment_hospital:
        result.treatment_hospital_name = outcome.treatment_hospital.name
    return result


@router.put("/{baby_id}", response_model=OutcomeOut)
def upsert_outcome(
    baby_id: UUID,
    data: OutcomeUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    baby = db.query(Baby).filter(Baby.id == baby_id).first()
    if not baby:
        raise HTTPException(404, "Baby not found")
    _check_access(baby, user)

    outcome = db.query(Outcome).filter(Outcome.baby_id == baby_id).first()
    if outcome is None:
        outcome = Outcome(baby_id=baby_id)
        db.add(outcome)

    for field, value in data.model_dump(exclude_unset=False).items():
        setattr(outcome, field, value)

    # Auto-update baby status based on discharge status
    if data.discharge_status in (DischargeStatus.COMPLETED_NO_ROP, DischargeStatus.COMPLETED_TREATED):
        baby.status = "discharged"
    elif data.discharge_status in (DischargeStatus.LOST,):
        baby.status = "ltfu"
    elif data.treatment_type and data.treatment_type != TreatmentType.NONE:
        baby.status = "treated"

    db.commit()
    db.refresh(outcome)

    result = OutcomeOut.model_validate(outcome)
    if outcome.treatment_hospital:
        result.treatment_hospital_name = outcome.treatment_hospital.name
    return result
