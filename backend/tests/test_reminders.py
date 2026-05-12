"""Tests for /api/reminders/ endpoints."""
from datetime import date
from .conftest import make_baby


def _make_appointment(db, baby_id):
    from app.models.appointment import Appointment, AppointmentStatus
    a = Appointment(baby_id=baby_id, due_date=date(2024, 6, 1), status=AppointmentStatus.SCHEDULED)
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def test_coordinator_can_list_reminders(client, auth, coordinator):
    r = client.get("/api/reminders/", headers=auth("coord@test.com"))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_nurse_can_list_reminders(client, auth, nurse):
    r = client.get("/api/reminders/", headers=auth("nurse@test.com"))
    assert r.status_code == 200


def test_coordinator_can_log_phone_call(client, auth, coordinator, hospital_a, db):
    baby = make_baby(db, hospital_a.id, name="Baby Call Test")
    _make_appointment(db, baby.id)

    r = client.post(
        f"/api/reminders/log-call/{baby.id}",
        headers=auth("coord@test.com"),
        json={"outcome": "reached", "notes": "Caregiver confirmed attendance"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["reminder_type"] == "phone_call"
    assert data["status"] == "acknowledged"
    assert "Reached" in data["message_body"]


def test_nurse_cannot_log_phone_call(client, auth, nurse, hospital_a, db):
    baby = make_baby(db, hospital_a.id)
    _make_appointment(db, baby.id)

    r = client.post(
        f"/api/reminders/log-call/{baby.id}",
        headers=auth("nurse@test.com"),
        json={"outcome": "reached", "notes": ""},
    )
    assert r.status_code == 403
