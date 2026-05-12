from __future__ import annotations
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401 — registers all ORM models with Base

from app.routers import auth, babies, exams, hospitals, reminders, network, alerts, notifications, reports, users, templates, outcomes, referrals, contact_logs, screening_requests
from app.services.scheduler import start_scheduler, stop_scheduler


def _run_migrations() -> None:
    from alembic.config import Config
    from alembic import command

    ini_path = os.path.join(os.path.dirname(__file__), "..", "alembic.ini")
    cfg = Config(os.path.abspath(ini_path))
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _run_migrations()
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
app.include_router(contact_logs.router)
app.include_router(screening_requests.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "ROP Tracker Uganda"}
