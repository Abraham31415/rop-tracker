"""
Pytest fixtures shared across all test modules.

Requirements:
  - A PostgreSQL database named "rop_test" accessible at localhost.
  - Default credentials: postgres/postgres (override via TEST_DATABASE_URL env var).

Quick setup:
  createdb rop_test
  pip install -r requirements.txt -r requirements-test.txt
  cd backend && pytest
"""
from __future__ import annotations

import os
from datetime import date
from unittest.mock import patch

# ── Env must be set before any app module is imported ────────────────────────
os.environ.setdefault(
    "DATABASE_URL",
    os.getenv("TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost/rop_test"),
)
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.database import Base, get_db
import app.models  # noqa: F401 — registers all ORM models with Base

_engine = create_engine(os.environ["DATABASE_URL"])


# ── Schema lifecycle (once per test session) ──────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def _schema():
    """Drop and recreate the full schema before the test session."""
    Base.metadata.drop_all(_engine)
    Base.metadata.create_all(_engine)
    yield
    Base.metadata.drop_all(_engine)


# ── Table truncation (before every test) ─────────────────────────────────────

@pytest.fixture(autouse=True)
def _clean(_schema):
    """Wipe all rows before each test so tests are fully isolated."""
    names = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    with _engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))


# ── Database session ──────────────────────────────────────────────────────────

@pytest.fixture
def db():
    session = Session(_engine)
    yield session
    session.close()


# ── FastAPI test client ────────────────────────────────────────────────────────

@pytest.fixture
def client(db):
    from app.main import app

    def _override():
        yield db

    app.dependency_overrides[get_db] = _override

    with (
        patch("app.main._run_migrations"),
        patch("app.main.start_scheduler"),
        patch("app.main.stop_scheduler"),
    ):
        with TestClient(app, raise_server_exceptions=True) as c:
            yield c

    app.dependency_overrides.clear()


# ── Hospital fixtures ─────────────────────────────────────────────────────────

@pytest.fixture
def hospital_a(db):
    from app.models.hospital import Hospital
    h = Hospital(name="Mulago National Referral Hospital", district="Kampala", region="Central")
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


@pytest.fixture
def hospital_b(db):
    from app.models.hospital import Hospital
    h = Hospital(name="Gulu Regional Referral Hospital", district="Gulu", region="Northern")
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


# ── User factories ────────────────────────────────────────────────────────────

def _create_user(db, email, role, hospital_id=None, password="testpass"):
    from app.models.user import User
    from app.auth.jwt import hash_password
    u = User(
        email=email,
        full_name=email.split("@")[0].replace(".", " ").title(),
        hashed_password=hash_password(password),
        role=role,
        hospital_id=hospital_id,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def nurse(db, hospital_a):
    from app.models.user import UserRole
    return _create_user(db, "nurse@test.com", UserRole.NICU_NURSE, hospital_a.id)


@pytest.fixture
def coordinator(db, hospital_a):
    from app.models.user import UserRole
    return _create_user(db, "coord@test.com", UserRole.HOSPITAL_COORDINATOR, hospital_a.id)


@pytest.fixture
def central(db):
    from app.models.user import UserRole
    return _create_user(db, "central@test.com", UserRole.CENTRAL_COORDINATOR)


@pytest.fixture
def ophthalmologist(db, hospital_a):
    from app.models.user import UserRole
    return _create_user(db, "ophthal@test.com", UserRole.OPHTHALMOLOGIST, hospital_a.id)


# ── Auth header helper ────────────────────────────────────────────────────────

@pytest.fixture
def auth(client):
    """auth(email) -> Authorization headers dict."""
    def _get(email, password="testpass"):
        r = client.post("/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, f"Login failed for {email}: {r.text}"
        return {"Authorization": f"Bearer {r.json()['access_token']}"}
    return _get


# ── Baby factory (module-level helper, not a fixture) ────────────────────────

def make_baby(db, hospital_id, *, name="Baby Test", sex="female",
              dob=None, weight=1200.0, ga=28.0, caregiver="Test Caregiver"):
    from app.models.baby import Baby, BabyStatus
    b = Baby(
        hospital_id=hospital_id,
        full_name=name,
        date_of_birth=dob or date(2024, 1, 15),
        sex=sex,
        birth_weight_grams=weight,
        gestational_age_weeks=ga,
        caregiver_name=caregiver,
        status=BabyStatus.ACTIVE,
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return b
