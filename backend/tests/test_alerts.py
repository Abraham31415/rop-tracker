"""Tests for /api/alerts/ endpoints."""
from datetime import date
from .conftest import make_baby


def _make_alert(db, hospital_id, baby_id):
    from app.models.alert import Alert, AlertType
    a = Alert(
        hospital_id=hospital_id,
        baby_id=baby_id,
        alert_type=AlertType.LTFU_FLAGGED,
        title="LTFU: Baby Test",
        body="Baby missed appointment 48h+ ago.",
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def test_coordinator_can_list_alerts(client, auth, coordinator, hospital_a, db):
    baby = make_baby(db, hospital_a.id)
    _make_alert(db, hospital_a.id, baby.id)

    r = client.get("/api/alerts/", headers=auth("coord@test.com"))
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["alert_type"] == "ltfu_flagged"


def test_coordinator_does_not_see_other_hospital_alerts(client, auth, coordinator, hospital_a, hospital_b, db):
    baby_b = make_baby(db, hospital_b.id)
    _make_alert(db, hospital_b.id, baby_b.id)

    r = client.get("/api/alerts/", headers=auth("coord@test.com"))
    assert r.status_code == 200
    assert len(r.json()) == 0


def test_alert_count(client, auth, coordinator, hospital_a, db):
    baby = make_baby(db, hospital_a.id)
    _make_alert(db, hospital_a.id, baby.id)
    _make_alert(db, hospital_a.id, baby.id)

    r = client.get("/api/alerts/count", headers=auth("coord@test.com"))
    assert r.status_code == 200
    assert r.json()["count"] == 2


def test_dismiss_alert(client, auth, coordinator, hospital_a, db):
    baby = make_baby(db, hospital_a.id)
    alert = _make_alert(db, hospital_a.id, baby.id)

    r = client.patch(f"/api/alerts/{alert.id}/dismiss", headers=auth("coord@test.com"))
    assert r.status_code == 200
    assert r.json()["is_dismissed"] is True

    # Should no longer appear in active list
    r2 = client.get("/api/alerts/", headers=auth("coord@test.com"))
    assert all(a["id"] != str(alert.id) for a in r2.json())
