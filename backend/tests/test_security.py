"""
Security tests:
  - Global auth middleware: all /api/ paths except /api/auth/login and /api/health
    must return 401 for unauthenticated requests.
  - Previously unprotected endpoints (GET /api/hospitals/, POST /api/auth/register)
    are now protected.
  - Rate limiting: exceeding 100 requests/minute per IP returns 429.
"""
from unittest.mock import patch
from .conftest import make_baby


# ── Auth enforcement — public paths are still reachable ──────────────────────

class TestPublicPaths:
    def test_health_requires_no_auth(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200

    def test_login_requires_no_auth(self, client, central):
        r = client.post("/api/auth/login", json={"email": "central@test.com", "password": "testpass"})
        assert r.status_code == 200
        assert "access_token" in r.json()


# ── Auth enforcement — every protected path returns 401 without a token ───────

class TestUnauthenticatedRequests:
    """Every /api/ route that is not /api/auth/login or /api/health must reject
    requests with no Authorization header."""

    PROTECTED_ENDPOINTS = [
        ("GET",    "/api/hospitals/"),
        ("GET",    "/api/babies/"),
        ("GET",    "/api/users/"),
        ("GET",    "/api/reports/summary"),
        ("GET",    "/api/network/overview"),
        ("GET",    "/api/analytics/screening-volume"),
        ("GET",    "/api/analytics/ltfu-rate"),
        ("GET",    "/api/analytics/at-risk-trend"),
        ("GET",    "/api/analytics/at-risk-babies"),
        ("GET",    "/api/analytics/ltfu-babies"),
        ("GET",    "/api/alerts/"),
        ("GET",    "/api/notifications/"),
        ("GET",    "/api/reminders/"),
        ("POST",   "/api/auth/register"),
    ]

    def test_all_protected_endpoints_return_401(self, client):
        for method, path in self.PROTECTED_ENDPOINTS:
            r = client.request(method, path)
            assert r.status_code == 401, (
                f"{method} {path} returned {r.status_code}, expected 401"
            )

    def test_invalid_token_returns_401(self, client):
        bad_headers = {"Authorization": "Bearer not.a.real.token"}
        r = client.get("/api/hospitals/", headers=bad_headers)
        assert r.status_code == 401

    def test_malformed_auth_header_returns_401(self, client):
        # Missing "Bearer " prefix
        r = client.get("/api/hospitals/", headers={"Authorization": "sometoken"})
        assert r.status_code == 401

    def test_empty_bearer_returns_401(self, client):
        r = client.get("/api/hospitals/", headers={"Authorization": "Bearer "})
        assert r.status_code == 401


# ── Previously unprotected endpoints ─────────────────────────────────────────

class TestPreviouslyUnprotected:
    def test_list_hospitals_requires_auth(self, client):
        r = client.get("/api/hospitals/")
        assert r.status_code == 401

    def test_list_hospitals_succeeds_with_valid_token(self, client, auth, nurse):
        r = client.get("/api/hospitals/", headers=auth("nurse@test.com"))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_register_requires_auth(self, client):
        r = client.post("/api/auth/register", json={
            "email": "newuser@test.com",
            "full_name": "New User",
            "password": "pass1234",
            "role": "nicu_nurse",
            "hospital_id": None,
        })
        assert r.status_code == 401

    def test_register_requires_coordinator_role(self, client, auth, nurse, hospital_a):
        r = client.post("/api/auth/register",
            headers=auth("nurse@test.com"),
            json={
                "email": "newuser@test.com",
                "full_name": "New User",
                "password": "pass1234",
                "role": "nicu_nurse",
                "hospital_id": str(hospital_a.id),
            })
        assert r.status_code == 403

    def test_register_succeeds_for_coordinator(self, client, auth, coordinator, hospital_a):
        r = client.post("/api/auth/register",
            headers=auth("coord@test.com"),
            json={
                "email": "brandnew@test.com",
                "full_name": "Brand New",
                "password": "pass1234",
                "role": "nicu_nurse",
                "hospital_id": str(hospital_a.id),
            })
        assert r.status_code == 200
        assert r.json()["email"] == "brandnew@test.com"


# ── Rate limiting ─────────────────────────────────────────────────────────────

class TestRateLimiting:
    def test_rate_limit_exceeded_returns_429(self):
        """A dedicated micro-app with a 1/minute limit returns 429 on the 2nd request."""
        from fastapi import FastAPI
        from slowapi import Limiter, _rate_limit_exceeded_handler
        from slowapi.util import get_remote_address
        from slowapi.errors import RateLimitExceeded
        from slowapi.middleware import SlowAPIMiddleware
        from starlette.testclient import TestClient

        test_limiter = Limiter(key_func=get_remote_address, default_limits=["1/minute"])
        test_app = FastAPI()
        test_app.state.limiter = test_limiter
        test_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
        test_app.add_middleware(SlowAPIMiddleware)

        @test_app.get("/ping")
        def ping():
            return {"ok": True}

        with TestClient(test_app, raise_server_exceptions=False) as c:
            r1 = c.get("/ping")
            assert r1.status_code == 200
            r2 = c.get("/ping")
            assert r2.status_code == 429

    def test_rate_limiter_is_configured_on_app(self, client):
        """The production app has a limiter attached to its state."""
        from app.main import app
        assert hasattr(app.state, "limiter")
        assert app.state.limiter is not None

    def test_rate_limiter_default_limit_is_100_per_minute(self):
        """Verify the configured default limit parses to 100 requests per minute."""
        from app.main import limiter
        assert len(limiter._default_limits) == 1
        # LimitGroup is iterable; each item is a slowapi Limit whose .limit is a RateLimitItem
        limit_items = list(limiter._default_limits[0])
        assert len(limit_items) == 1
        rate = limit_items[0].limit  # limits.RateLimitItem
        assert rate.amount == 100
        assert rate.GRANULARITY.name.lower() == "minute"

    def test_under_rate_limit_requests_succeed(self, client):
        """10 rapid requests to the public health endpoint should all succeed."""
        for _ in range(10):
            r = client.get("/api/health")
            assert r.status_code == 200
