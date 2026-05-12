"""Tests for /api/babies/ endpoints."""
from .conftest import make_baby

_ENROLL_BASE = {
    "full_name": "Baby Nakamya",
    "date_of_birth": "2024-01-15",
    "sex": "female",
    "birth_weight_grams": 1200.0,
    "gestational_age_weeks": 28.0,
    "caregiver_name": "Prossy Nakamya",
    "mtn_phone": "+256772000001",
}


def test_nurse_can_enroll_baby(client, auth, nurse, hospital_a):
    payload = {**_ENROLL_BASE, "hospital_id": str(hospital_a.id)}
    r = client.post("/api/babies/", headers=auth("nurse@test.com"), json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["full_name"] == "Baby Nakamya"
    assert data["sex"] == "female"
    assert data["status"] == "active"


def test_all_eleven_risk_factors_are_stored(client, auth, nurse, hospital_a):
    payload = {
        **_ENROLL_BASE,
        "hospital_id": str(hospital_a.id),
        "oxygen_therapy": True,
        "blood_transfusion": True,
        "sepsis": True,
        "inotropes": True,
        "anaemia": True,
        "mechanical_ventilation": True,
        "surfactant_therapy": True,
        "apnoea": True,
        "nec": True,
        "twins_or_multiple": True,
        "phototherapy": True,
    }
    r = client.post("/api/babies/", headers=auth("nurse@test.com"), json=payload)
    assert r.status_code == 200
    data = r.json()
    for field in [
        "oxygen_therapy", "blood_transfusion", "sepsis", "inotropes", "anaemia",
        "mechanical_ventilation", "surfactant_therapy", "apnoea",
        "nec", "twins_or_multiple", "phototherapy",
    ]:
        assert data[field] is True, f"{field} should be True"


def test_multiple_risk_factors_can_be_independently_set(client, auth, nurse, hospital_a):
    """Regression: only some risk factors set — others must stay False."""
    payload = {
        **_ENROLL_BASE,
        "hospital_id": str(hospital_a.id),
        "oxygen_therapy": True,
        "sepsis": True,
    }
    r = client.post("/api/babies/", headers=auth("nurse@test.com"), json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["oxygen_therapy"] is True
    assert data["sepsis"] is True
    assert data["blood_transfusion"] is False
    assert data["inotropes"] is False
    assert data["mechanical_ventilation"] is False


def test_hospital_coordinator_only_sees_own_hospital(client, auth, coordinator, hospital_a, hospital_b, db):
    make_baby(db, hospital_a.id, name="Baby Hospital A")
    make_baby(db, hospital_b.id, name="Baby Hospital B")

    r = client.get("/api/babies/", headers=auth("coord@test.com"))
    assert r.status_code == 200
    names = [b["full_name"] for b in r.json()]
    assert "Baby Hospital A" in names
    assert "Baby Hospital B" not in names


def test_central_coordinator_sees_all_hospitals(client, auth, central, hospital_a, hospital_b, db):
    make_baby(db, hospital_a.id, name="Baby A")
    make_baby(db, hospital_b.id, name="Baby B")

    r = client.get("/api/babies/", headers=auth("central@test.com"))
    assert r.status_code == 200
    names = [b["full_name"] for b in r.json()]
    assert "Baby A" in names
    assert "Baby B" in names


def test_get_baby(client, auth, nurse, hospital_a, db):
    baby = make_baby(db, hospital_a.id, name="Baby Get Test")
    r = client.get(f"/api/babies/{baby.id}", headers=auth("nurse@test.com"))
    assert r.status_code == 200
    assert r.json()["full_name"] == "Baby Get Test"


def test_get_baby_from_other_hospital_returns_403(client, auth, coordinator, hospital_b, db):
    baby = make_baby(db, hospital_b.id, name="Other Hospital Baby")
    r = client.get(f"/api/babies/{baby.id}", headers=auth("coord@test.com"))
    assert r.status_code == 403


def test_search_babies(client, auth, coordinator, hospital_a, db):
    make_baby(db, hospital_a.id, name="Unique Name Nakato", caregiver="Sender Search")
    r = client.get("/api/babies/search", headers=auth("coord@test.com"), params={"q": "Nakato"})
    assert r.status_code == 200
    results = r.json()
    assert len(results) >= 1
    assert any("Nakato" in b["full_name"] for b in results)
