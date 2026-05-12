"""Tests for /api/auth/login and /api/auth/me."""


def test_login_success(client, nurse):
    r = client.post("/api/auth/login", json={"email": "nurse@test.com", "password": "testpass"})
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "nurse@test.com"
    assert body["user"]["role"] == "nicu_nurse"


def test_login_wrong_password(client, nurse):
    r = client.post("/api/auth/login", json={"email": "nurse@test.com", "password": "wrong"})
    assert r.status_code == 401


def test_login_unknown_email(client):
    r = client.post("/api/auth/login", json={"email": "nobody@test.com", "password": "testpass"})
    assert r.status_code == 401


def test_me_returns_current_user(client, auth, coordinator):
    r = client.get("/api/auth/me", headers=auth("coord@test.com"))
    assert r.status_code == 200
    assert r.json()["email"] == "coord@test.com"
    assert r.json()["role"] == "hospital_coordinator"


def test_me_requires_token(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 401
