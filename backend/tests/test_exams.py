"""Tests for /api/exams/ endpoints."""
from datetime import date
from .conftest import make_baby


_EXAM_BASE = {
    "exam_date": "2024-03-01",
    "right_zone": "zone_ii",
    "right_stage": "stage_2",
    "right_plus": "none",
    "left_zone": "zone_ii",
    "left_stage": "stage_1",
    "left_plus": "none",
}


def test_ophthalmologist_can_record_exam(client, auth, ophthalmologist, hospital_a, db):
    baby = make_baby(db, hospital_a.id)
    payload = {**_EXAM_BASE, "baby_id": str(baby.id)}
    r = client.post("/api/exams/", headers=auth("ophthal@test.com"), json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["baby_id"] == str(baby.id)
    assert data["worst_zone"] == "zone_ii"
    assert data["next_exam_weeks"] is not None


def test_nurse_cannot_record_exam(client, auth, nurse, hospital_a, db):
    baby = make_baby(db, hospital_a.id)
    payload = {**_EXAM_BASE, "baby_id": str(baby.id)}
    r = client.post("/api/exams/", headers=auth("nurse@test.com"), json=payload)
    assert r.status_code == 403


def test_recording_exam_creates_appointment(client, auth, ophthalmologist, hospital_a, db):
    from app.models.appointment import Appointment, AppointmentStatus
    baby = make_baby(db, hospital_a.id)
    payload = {**_EXAM_BASE, "baby_id": str(baby.id)}
    client.post("/api/exams/", headers=auth("ophthal@test.com"), json=payload)

    appt = db.query(Appointment).filter(
        Appointment.baby_id == baby.id,
        Appointment.status == AppointmentStatus.SCHEDULED,
    ).first()
    assert appt is not None
    assert appt.due_date > date(2024, 3, 1)


def test_recording_exam_closes_open_appointment(client, auth, ophthalmologist, hospital_a, db):
    from app.models.appointment import Appointment, AppointmentStatus
    baby = make_baby(db, hospital_a.id)

    # Create a pre-existing scheduled appointment
    open_appt = Appointment(
        baby_id=baby.id,
        due_date=date(2024, 3, 1),
        status=AppointmentStatus.SCHEDULED,
    )
    db.add(open_appt)
    db.commit()

    # Record exam — should close the open appointment
    payload = {**_EXAM_BASE, "baby_id": str(baby.id)}
    client.post("/api/exams/", headers=auth("ophthal@test.com"), json=payload)
    db.refresh(open_appt)

    assert open_appt.status == AppointmentStatus.ATTENDED


def test_list_exams_for_baby(client, auth, ophthalmologist, hospital_a, db):
    baby = make_baby(db, hospital_a.id)
    payload = {**_EXAM_BASE, "baby_id": str(baby.id)}
    client.post("/api/exams/", headers=auth("ophthal@test.com"), json=payload)

    r = client.get(f"/api/exams/baby/{baby.id}", headers=auth("ophthal@test.com"))
    assert r.status_code == 200
    assert len(r.json()) == 1
