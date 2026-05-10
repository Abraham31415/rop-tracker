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


@asynccontextmanager
async def lifespan(app: FastAPI):
    _migrate_enums()
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
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
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
