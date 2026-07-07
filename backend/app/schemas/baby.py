from __future__ import annotations
from uuid import UUID
from datetime import date, datetime
from pydantic import BaseModel
from typing import Optional
from app.models.baby import Sex, Language, BabyStatus, DilationStatus


class BabyCreate(BaseModel):
    hospital_id: UUID
    full_name: str
    date_of_birth: date
    sex: Sex
    birth_weight_grams: float
    gestational_age_weeks: float
    postnatal_age_days: Optional[int] = None

    # Risk factors
    oxygen_therapy: bool = False
    blood_transfusion: bool = False
    sepsis: bool = False
    inotropes: bool = False
    anaemia: bool = False
    mechanical_ventilation: bool = False
    surfactant_therapy: bool = False
    apnoea: bool = False
    nec: bool = False
    twins_or_multiple: bool = False
    phototherapy: bool = False

    # Caregiver
    caregiver_name: str
    mtn_phone: Optional[str] = None
    airtel_phone: Optional[str] = None
    language_preference: Language = Language.ENGLISH

    notes: Optional[str] = None


class BabyUpdate(BaseModel):
    full_name: Optional[str] = None
    caregiver_name: Optional[str] = None
    mtn_phone: Optional[str] = None
    airtel_phone: Optional[str] = None
    language_preference: Optional[Language] = None
    status: Optional[BabyStatus] = None
    notes: Optional[str] = None


class DilationUpdate(BaseModel):
    dilation_status: DilationStatus


class BabyOut(BaseModel):
    id: UUID
    hospital_id: UUID
    rop_id: Optional[str] = None
    full_name: str
    date_of_birth: date
    sex: Sex
    birth_weight_grams: float
    gestational_age_weeks: float
    postnatal_age_days: Optional[int]
    oxygen_therapy: bool
    blood_transfusion: bool
    sepsis: bool
    inotropes: bool
    anaemia: bool
    mechanical_ventilation: bool
    surfactant_therapy: bool
    apnoea: bool
    nec: bool
    twins_or_multiple: bool
    phototherapy: bool
    caregiver_name: str
    mtn_phone: Optional[str]
    airtel_phone: Optional[str]
    language_preference: Language
    status: BabyStatus
    notes: Optional[str]
    enrolled_at: datetime
    dilation_status: Optional[DilationStatus] = None
    dilation_updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class BabyDashboardItem(BaseModel):
    id: UUID
    rop_id: Optional[str] = None
    full_name: str
    sex: Optional[str] = None
    date_of_birth: Optional[date] = None  # unknown for some imported register babies
    gestational_age_weeks: Optional[float] = None
    birth_weight_grams: Optional[float] = None
    status: BabyStatus
    hospital_name: Optional[str] = None
    next_due_date: Optional[date] = None
    days_until_due: Optional[int] = None
    urgency: str  # "ltfu" | "due_today" | "due_soon" | "on_track"
    last_exam_date: Optional[date] = None
    last_zone: Optional[str] = None
    last_stage: Optional[str] = None
    caregiver_name: str
    mtn_phone: Optional[str]
    airtel_phone: Optional[str]
    sms_failed_recently: bool = False

    model_config = {"from_attributes": True}
