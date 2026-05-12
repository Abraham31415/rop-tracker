"""Tests for /api/reports/ endpoints."""
from .conftest import make_baby


def test_summary_returns_expected_shape(client, auth, coordinator):
    r = client.get("/api/reports/summary", headers=auth("coord@test.com"))
    assert r.status_code == 200
    data = r.json()
    # Top-level keys
    for key in ("summary", "enrollment_by_month", "hospital_breakdown", "stage_breakdown", "sms_stats"):
        assert key in data, f"Missing key: {key}"
    # Summary sub-keys
    summary = data["summary"]
    for key in ("total_babies", "active", "ltfu", "ltfu_rate"):
        assert key in summary, f"Missing summary key: {key}"


def test_summary_counts_scoped_babies(client, auth, coordinator, hospital_a, hospital_b, db):
    make_baby(db, hospital_a.id, name="Baby One")
    make_baby(db, hospital_a.id, name="Baby Two")
    make_baby(db, hospital_b.id, name="Baby Other Hospital")

    r = client.get("/api/reports/summary", headers=auth("coord@test.com"))
    assert r.status_code == 200
    # Hospital coordinator sees only hospital_a babies
    assert r.json()["summary"]["total_babies"] == 2


def test_unauthenticated_cannot_access_reports(client):
    r = client.get("/api/reports/summary")
    assert r.status_code == 401
