from __future__ import annotations
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.hospital import Hospital
from app.models.user import User, UserRole
from app.auth.jwt import get_current_user
from app.utils.audit import write_audit

router = APIRouter(prefix="/api/hospitals", tags=["hospitals"])


def _validate_hospital_code(code: str) -> str:
    if not code or len(code) != 3 or not code.isalpha():
        raise ValueError("Hospital code must be exactly 3 letters")
    return code.upper()


class HospitalCreate(BaseModel):
    name: str
    district: str
    region: str
    hospital_code: Optional[str] = None      # 3 letters if supplied
    hospital_type: Optional[str] = None
    physical_address: Optional[str] = None
    contact_phone: Optional[str] = None


class HospitalOut(BaseModel):
    id: UUID
    name: str
    district: str
    region: str
    hospital_code: Optional[str] = None
    hospital_type: Optional[str] = None
    is_active: bool

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[HospitalOut])
def list_hospitals(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(Hospital).filter(Hospital.is_active == True).all()


@router.get("/check-code/{code}")
def check_hospital_code(
    code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Real-time code uniqueness check. Central coordinators only."""
    if current_user.role != UserRole.CENTRAL_COORDINATOR:
        raise HTTPException(status_code=403, detail="Only central coordinators can check hospital codes")
    code_upper = code.strip().upper()
    if not code_upper or len(code_upper) != 3 or not code_upper.isalpha():
        return {"available": False, "code": code_upper, "reason": "Code must be exactly 3 letters"}
    existing = db.query(Hospital).filter(Hospital.hospital_code == code_upper).first()
    if existing:
        return {"available": False, "code": code_upper, "taken_by": existing.name}
    return {"available": True, "code": code_upper}


@router.post("/", response_model=HospitalOut)
def create_hospital(
    data: HospitalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.CENTRAL_COORDINATOR:
        raise HTTPException(status_code=403, detail="Only central coordinators can add hospitals")
    if db.query(Hospital).filter(Hospital.name == data.name).first():
        raise HTTPException(status_code=400, detail="A hospital with that name already exists")

    code: Optional[str] = None
    if data.hospital_code:
        try:
            code = _validate_hospital_code(data.hospital_code)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        if db.query(Hospital).filter(Hospital.hospital_code == code).first():
            raise HTTPException(status_code=400, detail=f"Hospital code '{code}' is already in use")

    payload = data.model_dump()
    payload["hospital_code"] = code
    hospital = Hospital(**payload)
    db.add(hospital)
    db.flush()
    write_audit(
        db,
        user_id=current_user.id,
        user_name=current_user.full_name,
        user_role=current_user.role.value,
        action_type="CREATE",
        entity_type="Hospital",
        entity_id=str(hospital.id),
        details={"name": hospital.name, "district": hospital.district, "region": hospital.region, "hospital_code": code},
    )
    db.commit()
    db.refresh(hospital)
    return hospital
