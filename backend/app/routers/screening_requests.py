"""
POST  /api/screening-requests/             — nurse creates a request for their hospital
GET   /api/screening-requests/pending      — ophthalmologist sees pending requests at their hospitals
POST  /api/screening-requests/{id}/claim   — ophthalmologist claims a request
POST  /api/screening-requests/{id}/complete — ophthalmologist marks completed
GET   /api/screening-requests/baby/{baby_id} — get active request for a baby
"""
from __future__ import annotations
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.auth.jwt import get_current_user
from app.models.user import User, UserRole
from app.models.baby import Baby
from app.models.hospital import Hospital
from app.models.alert import Alert, AlertType
from app.models.contact_log import ContactLog, ContactLogType
from app.models.screening_request import ScreeningRequest, ScreeningRequestStatus

router = APIRouter(prefix="/api/screening-requests", tags=["screening-requests"])


class ScreeningRequestIn(BaseModel):
    baby_id: UUID
    notes: Optional[str] = None


class ScreeningRequestOut(BaseModel):
    id: UUID
    baby_id: UUID
    hospital_id: UUID
    status: ScreeningRequestStatus
    notes: Optional[str] = None
    created_at: datetime
    claimed_at: Optional[datetime] = None
    requested_by_name: Optional[str] = None
    claimed_by_name: Optional[str] = None
    baby_name: Optional[str] = None

    model_config = {"from_attributes": True}


def _to_out(req: ScreeningRequest) -> ScreeningRequestOut:
    return ScreeningRequestOut(
        id=req.id,
        baby_id=req.baby_id,
        hospital_id=req.hospital_id,
        status=req.status,
        notes=req.notes,
        created_at=req.created_at,
        claimed_at=req.claimed_at,
        requested_by_name=req.requested_by.full_name if req.requested_by else None,
        claimed_by_name=req.claimed_by.full_name if req.claimed_by else None,
        baby_name=req.baby.full_name if req.baby else None,
    )


@router.post("/", response_model=ScreeningRequestOut)
def create_screening_request(
    data: ScreeningRequestIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """NICU nurse (or coordinator) sends a screening request to all ophthalmologists at the hospital."""
    if current_user.role not in (UserRole.NICU_NURSE, UserRole.HOSPITAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Only nurses and coordinators can request screenings")

    baby = db.query(Baby).filter(Baby.id == data.baby_id).first()
    if not baby:
        raise HTTPException(status_code=404, detail="Baby not found")
    if baby.hospital_id != current_user.hospital_id:
        raise HTTPException(status_code=403, detail="Baby is not at your hospital")

    # Only one active request per baby at a time
    existing = db.query(ScreeningRequest).filter(
        ScreeningRequest.baby_id == data.baby_id,
        ScreeningRequest.status.in_([ScreeningRequestStatus.PENDING, ScreeningRequestStatus.CLAIMED]),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="An active screening request already exists for this baby")

    req = ScreeningRequest(
        baby_id=data.baby_id,
        hospital_id=current_user.hospital_id,
        requested_by_id=current_user.id,
        notes=data.notes,
        status=ScreeningRequestStatus.PENDING,
    )
    db.add(req)
    db.flush()

    # Log to contact log
    log = ContactLog(
        baby_id=data.baby_id,
        created_by_id=current_user.id,
        log_type=ContactLogType.SCREENING_REQUEST,
        message=f"Screening requested by {current_user.full_name}"
                + (f": {data.notes}" if data.notes else ""),
    )
    db.add(log)
    db.commit()
    db.refresh(req)
    return _to_out(req)


@router.get("/pending", response_model=list[ScreeningRequestOut])
def list_pending_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ophthalmologist sees pending requests at hospitals where they work."""
    if current_user.role not in (
        UserRole.OPHTHALMOLOGIST, UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    query = db.query(ScreeningRequest).filter(
        ScreeningRequest.status.in_([ScreeningRequestStatus.PENDING, ScreeningRequestStatus.CLAIMED])
    )

    if current_user.role == UserRole.OPHTHALMOLOGIST:
        # Scope to hospitals where this ophthalmologist has recorded exams
        from app.models.exam import Exam
        hospital_ids = (
            db.query(Exam.baby_id)
            .filter(Exam.examiner_id == current_user.id)
            .subquery()
        )
        baby_hospital_ids = (
            db.query(Baby.hospital_id)
            .filter(Baby.id.in_(hospital_ids))
            .distinct()
            .all()
        )
        h_ids = [r[0] for r in baby_hospital_ids]
        # Also include their own hospital
        if current_user.hospital_id:
            h_ids.append(current_user.hospital_id)
        h_ids = list(set(h_ids))
        query = query.filter(ScreeningRequest.hospital_id.in_(h_ids))
    elif current_user.role == UserRole.HOSPITAL_COORDINATOR:
        query = query.filter(ScreeningRequest.hospital_id == current_user.hospital_id)

    reqs = query.order_by(ScreeningRequest.created_at).all()
    return [_to_out(r) for r in reqs]


@router.get("/baby/{baby_id}", response_model=Optional[ScreeningRequestOut])
def get_active_request_for_baby(
    baby_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current active (pending/claimed) screening request for a baby, if any."""
    req = db.query(ScreeningRequest).filter(
        ScreeningRequest.baby_id == baby_id,
        ScreeningRequest.status.in_([ScreeningRequestStatus.PENDING, ScreeningRequestStatus.CLAIMED]),
    ).first()
    return _to_out(req) if req else None


@router.post("/{request_id}/claim", response_model=ScreeningRequestOut)
def claim_request(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ophthalmologist claims a pending screening request. First to claim wins."""
    if current_user.role != UserRole.OPHTHALMOLOGIST:
        raise HTTPException(status_code=403, detail="Only ophthalmologists can claim screening requests")

    req = db.query(ScreeningRequest).filter(ScreeningRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Screening request not found")
    if req.status != ScreeningRequestStatus.PENDING:
        raise HTTPException(status_code=409, detail="Request is no longer pending")

    req.status = ScreeningRequestStatus.CLAIMED
    req.claimed_by_id = current_user.id
    req.claimed_at = datetime.now(timezone.utc)

    log = ContactLog(
        baby_id=req.baby_id,
        created_by_id=current_user.id,
        log_type=ContactLogType.SCREENING_REQUEST,
        message=f"Screening request claimed by Dr. {current_user.full_name}",
    )
    db.add(log)
    db.commit()
    db.refresh(req)
    return _to_out(req)


@router.post("/{request_id}/complete", response_model=ScreeningRequestOut)
def complete_request(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a claimed screening request as completed (ophthalmologist has examined the baby)."""
    if current_user.role not in (UserRole.OPHTHALMOLOGIST, UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(status_code=403, detail="Access denied")

    req = db.query(ScreeningRequest).filter(ScreeningRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Screening request not found")
    if req.status not in (ScreeningRequestStatus.PENDING, ScreeningRequestStatus.CLAIMED):
        raise HTTPException(status_code=409, detail="Request is already completed or escalated")

    req.status = ScreeningRequestStatus.COMPLETED
    db.commit()
    db.refresh(req)
    return _to_out(req)
