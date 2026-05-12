"""Tests for /api/users/ endpoints."""
from .conftest import _create_user


def test_coordinator_can_list_users(client, auth, coordinator, hospital_a):
    r = client.get("/api/users/", headers=auth("coord@test.com"))
    assert r.status_code == 200
    emails = [u["email"] for u in r.json()]
    assert "coord@test.com" in emails


def test_coordinator_only_sees_own_hospital_users(client, auth, coordinator, hospital_b, db):
    from app.models.user import UserRole
    _create_user(db, "other@test.com", UserRole.NICU_NURSE, hospital_b.id)

    r = client.get("/api/users/", headers=auth("coord@test.com"))
    assert r.status_code == 200
    emails = [u["email"] for u in r.json()]
    assert "other@test.com" not in emails


def test_nurse_cannot_list_users(client, auth, nurse):
    r = client.get("/api/users/", headers=auth("nurse@test.com"))
    assert r.status_code == 403


def test_coordinator_can_create_user(client, auth, coordinator, hospital_a):
    r = client.post("/api/users/", headers=auth("coord@test.com"), json={
        "email": "newstaff@test.com",
        "full_name": "New Staff",
        "password": "securepass",
        "role": "nicu_nurse",
        "hospital_id": str(hospital_a.id),
    })
    assert r.status_code == 200
    assert r.json()["email"] == "newstaff@test.com"
    assert r.json()["is_active"] is True


def test_coordinator_can_deactivate_user(client, auth, coordinator, nurse, hospital_a):
    r = client.patch(f"/api/users/{nurse.id}/deactivate", headers=auth("coord@test.com"))
    assert r.status_code == 200
    assert r.json()["is_active"] is False


def test_cannot_deactivate_own_account(client, auth, coordinator):
    r = client.patch(f"/api/users/{coordinator.id}/deactivate", headers=auth("coord@test.com"))
    assert r.status_code == 400
