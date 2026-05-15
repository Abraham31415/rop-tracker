from __future__ import annotations
from uuid import UUID
from pydantic import BaseModel, EmailStr
from app.models.user import UserRole


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: UserRole
    hospital_id: UUID | None = None


class UserOut(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: UserRole
    hospital_id: UUID | None
    theme: str = "system"

    model_config = {"from_attributes": True}


class ThemeUpdate(BaseModel):
    theme: str


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
