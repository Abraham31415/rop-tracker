from __future__ import annotations
from uuid import UUID
from datetime import date, datetime
from pydantic import BaseModel
from typing import Optional
from app.models.exam import Zone, Stage, PlusDisease, VFFixation, VFFollowing, VFCSM, Nystagmus, Strabismus, VFFunctionalImpression


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
    vf_right_fixation: Optional[VFFixation] = None
    vf_right_following: Optional[VFFollowing] = None
    vf_right_csm: Optional[VFCSM] = None
    vf_right_teller_acuity: Optional[float] = None
    vf_right_vep: Optional[float] = None
    vf_left_fixation: Optional[VFFixation] = None
    vf_left_following: Optional[VFFollowing] = None
    vf_left_csm: Optional[VFCSM] = None
    vf_left_teller_acuity: Optional[float] = None
    vf_left_vep: Optional[float] = None
    vf_nystagmus: Optional[Nystagmus] = None
    vf_strabismus: Optional[Strabismus] = None
    vf_functional_impression: Optional[VFFunctionalImpression] = None
    vf_notes: Optional[str] = None


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
    vf_right_fixation: Optional[VFFixation]
    vf_right_following: Optional[VFFollowing]
    vf_right_csm: Optional[VFCSM]
    vf_right_teller_acuity: Optional[float]
    vf_right_vep: Optional[float]
    vf_left_fixation: Optional[VFFixation]
    vf_left_following: Optional[VFFollowing]
    vf_left_csm: Optional[VFCSM]
    vf_left_teller_acuity: Optional[float]
    vf_left_vep: Optional[float]
    vf_nystagmus: Optional[Nystagmus]
    vf_strabismus: Optional[Strabismus]
    vf_functional_impression: Optional[VFFunctionalImpression]
    vf_notes: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}
