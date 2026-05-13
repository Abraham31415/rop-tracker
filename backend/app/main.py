from __future__ import annotations
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

import app.models  # noqa: F401 — registers all ORM models with Base

from app.routers import (
    auth, babies, exams, hospitals, reminders, network, alerts,
    notifications, reports, users, templates, outcomes, referrals,
    appointments, contact_logs, screening_requests, analytics, admin,
)
from app.services.scheduler import start_scheduler, stop_scheduler

# Paths that do not require a clinical JWT (admin routes have their own cookie auth)
_PUBLIC_PATHS = {
    "/api/auth/login",
    "/api/health",
    "/api/sys-mgmt/login",
    "/api/sys-mgmt/login/totp",
    "/api/sys-mgmt/me",
    "/api/sys-mgmt/logout",
}
_ADMIN_PATH_PREFIX   = "/api/sys-mgmt/"
_LEGACY_ADMIN_PREFIX = "/api/admin/"


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


limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])

app = FastAPI(
    title="ROP Tracker Uganda API",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


# ── Security headers for admin API paths ──────────────────────────────────────
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(_ADMIN_PATH_PREFIX):
        response.headers["X-Frame-Options"]           = "DENY"
        response.headers["X-Content-Type-Options"]    = "nosniff"
        response.headers["Referrer-Policy"]           = "no-referrer"
        response.headers["Content-Security-Policy"]   = "default-src 'self'"
    return response


# ── 404 for old /api/admin/* paths (gives nothing away) ──────────────────────
@app.middleware("http")
async def block_legacy_admin(request: Request, call_next):
    if request.url.path.startswith(_LEGACY_ADMIN_PREFIX):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    return await call_next(request)


# ── Clinical JWT guard ────────────────────────────────────────────────────────
@app.middleware("http")
async def require_auth(request: Request, call_next):
    """Reject requests to protected API paths that carry no valid JWT."""
    if (
        request.url.path not in _PUBLIC_PATHS
        and request.url.path.startswith("/api/")
        and not request.url.path.startswith(_ADMIN_PATH_PREFIX)
    ):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        from app.auth.jwt import decode_token
        try:
            decode_token(auth_header[7:])
        except Exception:
            return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)
    return await call_next(request)


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
app.include_router(appointments.router)
app.include_router(contact_logs.router)
app.include_router(screening_requests.router)
app.include_router(analytics.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "ROP Tracker Uganda"}
