from __future__ import annotations
from uuid import UUID
from datetime import date, datetime
from pydantic import BaseModel
from typing import Optional
from app.models.exam import Zone, Stage, PlusDisease


class ExamCreate(BaseModel):
    baby_id: UUID
    exam_date: date
    postnatal_age_days: Optional[int] = None
    postmenstrual_age_weeks: Optional[str] = None

    right_zone: Optional[Zone] = None
    right_stage: Optional[Stage] = None
    right_plus: PlusDisease = PlusDisease.NONE

    left_zone: Optional[Zone] = None
    left_stage: Optional[Stage] = None
    left_plus: PlusDisease = PlusDisease.NONE

    treatment_recommended: Optional[str] = None
    notes: Optional[str] = None


class ExamOut(BaseModel):
    id: UUID
    baby_id: UUID
    exam_date: date
    postnatal_age_days: Optional[int]
    right_zone: Optional[Zone]
    right_stage: Optional[Stage]
    right_plus: Optional[PlusDisease]
    left_zone: Optional[Zone]
    left_stage: Optional[Stage]
    left_plus: Optional[PlusDisease]
    worst_zone: Optional[Zone]
    worst_stage: Optional[Stage]
    has_plus_disease: Optional[str]
    next_exam_weeks: Optional[int]
    treatment_recommended: Optional[str]
    notes: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}
