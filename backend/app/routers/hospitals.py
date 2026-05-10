from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.hospital import Hospital
from app.models.user import User, UserRole
from app.auth.jwt import get_current_user

router = APIRouter(prefix="/api/hospitals", tags=["hospitals"])


class HospitalCreate(BaseModel):
    name: str
    district: str
    region: str


class HospitalOut(BaseModel):
    id: UUID
    name: str
    district: str
    region: str
    is_active: bool

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[HospitalOut])
def list_hospitals(db: Session = Depends(get_db)):
    return db.query(Hospital).filter(Hospital.is_active == True).all()


@router.post("/", response_model=HospitalOut)
def create_hospital(
    data: HospitalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.CENTRAL_COORDINATOR:
        raise HTTPException(status_code=403, detail="Only central coordinators can add hospitals")
    hospital = Hospital(**data.model_dump())
    db.add(hospital)
    db.commit()
    db.refresh(hospital)
    return hospital
