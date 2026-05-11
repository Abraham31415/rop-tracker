from __future__ import annotations
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
import app.models  # register all ORM models before create_all

from app.routers import auth, babies, exams, hospitals, reminders, network, alerts, notifications, reports, users, templates, outcomes, referrals
from app.services.scheduler import start_scheduler, stop_scheduler

Base.metadata.create_all(bind=engine)


def _migrate_enums() -> None:
    """Add new enum values to PostgreSQL types if not already present."""
    from sqlalchemy import text
    additions = [
        ("remindertrigger", "manual_call"),
        ("alerttype", "ltfu_flagged"),
    ]
    with engine.connect() as conn:
        for type_name, value in additions:
            exists = conn.execute(text(
                "SELECT 1 FROM pg_enum "
                "WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = :t) "
                "AND enumlabel = :v"
            ), {"t": type_name, "v": value}).scalar()
            if not exists:
                conn.execute(text(f"ALTER TYPE {type_name} ADD VALUE '{value}'"))
                conn.commit()


def _migrate_visual_function() -> None:
    """Create VF enum types and add VF columns to exams table if missing."""
    from sqlalchemy import text
    enum_types = {
        'vffixation': ['central', 'eccentric', 'none_unable'],
        'vffollowing': ['follows_smoothly', 'follows_partially', 'does_not_follow', 'unable_to_assess'],
        'vfcsm': ['csm', 'cs', 'c', 'not_central', 'unable_to_assess'],
        'nystagmus': ['absent', 'pendular', 'jerk', 'latent'],
        'strabismus': ['absent', 'esotropia', 'exotropia', 'suspected'],
        'vffunctionalimpression': ['age_appropriate', 'mildly_delayed', 'significantly_delayed', 'unable_to_assess'],
    }
    float_cols = [
        'vf_right_teller_acuity', 'vf_right_vep',
        'vf_left_teller_acuity', 'vf_left_vep',
    ]
    text_cols = ['vf_notes']
    enum_cols = [
        ('vf_right_fixation', 'vffixation'),
        ('vf_right_following', 'vffollowing'),
        ('vf_right_csm', 'vfcsm'),
        ('vf_left_fixation', 'vffixation'),
        ('vf_left_following', 'vffollowing'),
        ('vf_left_csm', 'vfcsm'),
        ('vf_nystagmus', 'nystagmus'),
        ('vf_strabismus', 'strabismus'),
        ('vf_functional_impression', 'vffunctionalimpression'),
    ]
    with engine.connect() as conn:
        for type_name, values in enum_types.items():
            exists = conn.execute(text(
                "SELECT 1 FROM pg_type WHERE typname = :t"
            ), {"t": type_name}).scalar()
            if not exists:
                vals_sql = ', '.join(f"'{v}'" for v in values)
                conn.execute(text(f"CREATE TYPE {type_name} AS ENUM ({vals_sql})"))
                conn.commit()
        for col_name in float_cols + text_cols:
            exists = conn.execute(text(
                "SELECT 1 FROM information_schema.columns WHERE table_name='exams' AND column_name=:c"
            ), {"c": col_name}).scalar()
            if not exists:
                sql_type = 'double precision' if col_name in float_cols else 'text'
                conn.execute(text(f"ALTER TABLE exams ADD COLUMN {col_name} {sql_type}"))
                conn.commit()
        for col_name, type_name in enum_cols:
            exists = conn.execute(text(
                "SELECT 1 FROM information_schema.columns WHERE table_name='exams' AND column_name=:c"
            ), {"c": col_name}).scalar()
            if not exists:
                conn.execute(text(f"ALTER TABLE exams ADD COLUMN {col_name} {type_name}"))
                conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _migrate_enums()
    _migrate_visual_function()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="ROP Tracker Uganda API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://rop-tracker.vercel.app",
        "https://*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(babies.router)
app.include_router(exams.router)
app.include_router(hospitals.router)
app.include_router(reminders.router)
app.include_router(network.router)
app.include_router(alerts.router)
app.include_router(notifications.router)
app.include_router(reports.router)
app.include_router(users.router)
app.include_router(templates.router)
app.include_router(outcomes.router)
app.include_router(referrals.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "ROP Tracker Uganda"}
