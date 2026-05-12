"""Tests for /api/analytics/ endpoints (central coordinator only)."""
from datetime import date, datetime, timezone, timedelta
from .conftest import make_baby


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_exam(db, baby, *, exam_date=None, treatment_recommended=None,
              worst_zone="zone_ii", worst_stage="stage_2"):
    from app.models.exam import Exam
    e = Exam(
        baby_id=baby.id,
        exam_date=exam_date or date(2024, 3, 1),
        worst_zone=worst_zone,
        worst_stage=worst_stage,
        treatment_recommended=treatment_recommended,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


def make_appointment(db, baby, *, due_date=None, status="scheduled"):
    from app.models.appointment import Appointment, AppointmentStatus
    a = Appointment(
        baby_id=baby.id,
        due_date=due_date or date(2024, 4, 1),
        status=AppointmentStatus(status),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def make_outcome(db, baby, *, treatment_type="laser"):
    from app.models.outcome import Outcome, TreatmentType
    o = Outcome(
        baby_id=baby.id,
        treatment_type=TreatmentType(treatment_type),
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


def set_enrolled_at(db, baby, dt: datetime):
    """Directly set enrolled_at since make_baby uses server_default."""
    from app.models.baby import Baby
    db.query(Baby).filter(Baby.id == baby.id).update({"enrolled_at": dt})
    db.commit()
    db.refresh(baby)


# ── Access control ────────────────────────────────────────────────────────────

class TestAccessControl:
    def test_unauthenticated_rejected(self, client):
        for path in [
            "/api/analytics/screening-volume",
            "/api/analytics/ltfu-rate",
            "/api/analytics/at-risk-trend",
            "/api/analytics/at-risk-babies",
            "/api/analytics/ltfu-babies",
        ]:
            r = client.get(path)
            assert r.status_code == 401, f"{path} should require auth"

    def test_hospital_coordinator_rejected(self, client, auth, coordinator):
        for path in [
            "/api/analytics/screening-volume",
            "/api/analytics/ltfu-rate",
            "/api/analytics/at-risk-trend",
            "/api/analytics/at-risk-babies",
            "/api/analytics/ltfu-babies",
        ]:
            r = client.get(path, headers=auth("coord@test.com"))
            assert r.status_code == 403, f"{path} should be 403 for hospital coordinator"

    def test_nurse_rejected(self, client, auth, nurse):
        r = client.get("/api/analytics/screening-volume", headers=auth("nurse@test.com"))
        assert r.status_code == 403

    def test_central_coordinator_allowed(self, client, auth, central):
        r = client.get("/api/analytics/screening-volume", headers=auth("central@test.com"))
        assert r.status_code == 200


# ── Screening volume ──────────────────────────────────────────────────────────

class TestScreeningVolume:
    def test_empty_returns_empty_list(self, client, auth, central):
        r = client.get("/api/analytics/screening-volume", headers=auth("central@test.com"))
        assert r.status_code == 200
        assert r.json()["data"] == []

    def test_counts_enrolled_babies(self, client, auth, central, hospital_a, db):
        b1 = make_baby(db, hospital_a.id, name="Baby One")
        b2 = make_baby(db, hospital_a.id, name="Baby Two")
        set_enrolled_at(db, b1, datetime(2024, 3, 10, tzinfo=timezone.utc))
        set_enrolled_at(db, b2, datetime(2024, 3, 20, tzinfo=timezone.utc))

        r = client.get("/api/analytics/screening-volume",
                       headers=auth("central@test.com"),
                       params={"group_by": "month"})
        assert r.status_code == 200
        data = r.json()["data"]
        assert len(data) == 1
        assert data[0]["period"] == "2024-03"
        assert data[0]["count"] == 2

    def test_groups_across_months(self, client, auth, central, hospital_a, db):
        b1 = make_baby(db, hospital_a.id, name="March Baby")
        b2 = make_baby(db, hospital_a.id, name="April Baby")
        set_enrolled_at(db, b1, datetime(2024, 3, 1, tzinfo=timezone.utc))
        set_enrolled_at(db, b2, datetime(2024, 4, 1, tzinfo=timezone.utc))

        r = client.get("/api/analytics/screening-volume",
                       headers=auth("central@test.com"),
                       params={"group_by": "month"})
        data = r.json()["data"]
        assert len(data) == 2
        periods = [d["period"] for d in data]
        assert "2024-03" in periods
        assert "2024-04" in periods

    def test_from_date_filter(self, client, auth, central, hospital_a, db):
        b1 = make_baby(db, hospital_a.id, name="Early Baby")
        b2 = make_baby(db, hospital_a.id, name="Late Baby")
        set_enrolled_at(db, b1, datetime(2024, 1, 1, tzinfo=timezone.utc))
        set_enrolled_at(db, b2, datetime(2024, 6, 1, tzinfo=timezone.utc))

        r = client.get("/api/analytics/screening-volume",
                       headers=auth("central@test.com"),
                       params={"from_date": "2024-05-01", "group_by": "month"})
        data = r.json()["data"]
        assert all(d["period"] >= "2024-05" for d in data)
        counts = {d["period"]: d["count"] for d in data}
        assert counts.get("2024-06", 0) == 1
        assert counts.get("2024-01", 0) == 0

    def test_group_by_year(self, client, auth, central, hospital_a, db):
        b1 = make_baby(db, hospital_a.id, name="2023 Baby")
        b2 = make_baby(db, hospital_a.id, name="2024 Baby")
        set_enrolled_at(db, b1, datetime(2023, 6, 1, tzinfo=timezone.utc))
        set_enrolled_at(db, b2, datetime(2024, 6, 1, tzinfo=timezone.utc))

        r = client.get("/api/analytics/screening-volume",
                       headers=auth("central@test.com"),
                       params={"group_by": "year"})
        data = r.json()["data"]
        by_period = {d["period"]: d["count"] for d in data}
        assert by_period["2023"] == 1
        assert by_period["2024"] == 1


# ── LTFU rate ─────────────────────────────────────────────────────────────────

class TestLtfuRate:
    def test_empty_returns_empty_list(self, client, auth, central):
        r = client.get("/api/analytics/ltfu-rate", headers=auth("central@test.com"))
        assert r.status_code == 200
        assert r.json()["data"] == []

    def test_rate_calculation(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_appointment(db, baby, due_date=date(2024, 5, 10), status="attended")
        make_appointment(db, baby, due_date=date(2024, 5, 20), status="missed")
        make_appointment(db, baby, due_date=date(2024, 5, 25), status="ltfu")

        r = client.get("/api/analytics/ltfu-rate",
                       headers=auth("central@test.com"),
                       params={"group_by": "month"})
        data = r.json()["data"]
        may = next((d for d in data if d["period"] == "2024-05"), None)
        assert may is not None
        assert may["total"] == 3
        assert may["ltfu_count"] == 2
        assert may["rate"] == round(2 / 3 * 100, 1)

    def test_zero_rate_when_all_attended(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_appointment(db, baby, due_date=date(2024, 5, 1), status="attended")
        make_appointment(db, baby, due_date=date(2024, 5, 15), status="attended")

        r = client.get("/api/analytics/ltfu-rate",
                       headers=auth("central@test.com"),
                       params={"group_by": "month"})
        data = r.json()["data"]
        may = next((d for d in data if d["period"] == "2024-05"), None)
        assert may is not None
        assert may["rate"] == 0.0

    def test_date_filter_excludes_outside_range(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_appointment(db, baby, due_date=date(2024, 1, 1), status="missed")
        make_appointment(db, baby, due_date=date(2024, 6, 1), status="missed")

        r = client.get("/api/analytics/ltfu-rate",
                       headers=auth("central@test.com"),
                       params={"from_date": "2024-05-01", "to_date": "2024-07-01", "group_by": "month"})
        data = r.json()["data"]
        periods = [d["period"] for d in data]
        assert "2024-01" not in periods
        assert "2024-06" in periods


# ── At-risk trend ─────────────────────────────────────────────────────────────

class TestAtRiskTrend:
    def test_empty_when_no_exams(self, client, auth, central):
        r = client.get("/api/analytics/at-risk-trend", headers=auth("central@test.com"))
        assert r.status_code == 200
        assert r.json()["current_count"] == 0
        assert r.json()["data"] == []

    def test_counts_untreated_at_risk_babies(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_exam(db, baby, exam_date=date(2024, 4, 1), treatment_recommended="laser")

        r = client.get("/api/analytics/at-risk-trend", headers=auth("central@test.com"))
        body = r.json()
        assert body["current_count"] == 1
        assert len(body["data"]) == 1
        assert body["data"][0]["count"] == 1

    def test_treated_babies_excluded_from_current_count(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_exam(db, baby, exam_date=date(2024, 4, 1), treatment_recommended="laser")
        make_outcome(db, baby, treatment_type="laser")

        r = client.get("/api/analytics/at-risk-trend", headers=auth("central@test.com"))
        assert r.json()["current_count"] == 0

    def test_treated_babies_excluded_from_trend_data(self, client, auth, central, hospital_a, db):
        # One treated, one untreated
        b1 = make_baby(db, hospital_a.id, name="Treated")
        b2 = make_baby(db, hospital_a.id, name="Untreated")
        make_exam(db, b1, exam_date=date(2024, 4, 1), treatment_recommended="laser")
        make_exam(db, b2, exam_date=date(2024, 4, 1), treatment_recommended="laser")
        make_outcome(db, b1, treatment_type="laser")

        r = client.get("/api/analytics/at-risk-trend", headers=auth("central@test.com"))
        body = r.json()
        assert body["current_count"] == 1
        assert body["data"][0]["count"] == 1

    def test_no_treatment_recommended_not_at_risk(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_exam(db, baby, exam_date=date(2024, 4, 1), treatment_recommended=None)

        r = client.get("/api/analytics/at-risk-trend", headers=auth("central@test.com"))
        assert r.json()["current_count"] == 0

    def test_uses_first_treatment_exam_date_for_grouping(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        # Two exams recommending treatment — should be grouped by the first one
        make_exam(db, baby, exam_date=date(2024, 3, 1), treatment_recommended="laser")
        make_exam(db, baby, exam_date=date(2024, 4, 1), treatment_recommended="laser")

        r = client.get("/api/analytics/at-risk-trend",
                       headers=auth("central@test.com"),
                       params={"group_by": "month"})
        data = r.json()["data"]
        # Baby should appear once under March (first treatment exam), not April
        periods = {d["period"]: d["count"] for d in data}
        assert periods.get("2024-03", 0) == 1
        assert periods.get("2024-04", 0) == 0


# ── At-risk babies list ───────────────────────────────────────────────────────

class TestAtRiskBabies:
    def test_empty_when_no_at_risk(self, client, auth, central):
        r = client.get("/api/analytics/at-risk-babies", headers=auth("central@test.com"))
        assert r.status_code == 200
        assert r.json() == {"babies": [], "total": 0}

    def test_returns_baby_with_full_detail(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id, name="Apio Grace")
        make_exam(db, baby, exam_date=date(2024, 4, 1),
                  treatment_recommended="laser",
                  worst_zone="zone_i", worst_stage="stage_3")

        r = client.get("/api/analytics/at-risk-babies", headers=auth("central@test.com"))
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        b = body["babies"][0]
        assert b["full_name"] == "Apio Grace"
        assert b["hospital_name"] == "Mulago National Referral Hospital"
        assert b["zone"] == "zone_i"
        assert b["stage"] == "stage_3"
        assert b["treatment_recommended"] == "laser"
        assert b["last_exam_date"] == "2024-04-01"
        assert b["days_since_diagnosis"] is not None

    def test_treated_baby_excluded(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_exam(db, baby, exam_date=date(2024, 4, 1), treatment_recommended="laser")
        make_outcome(db, baby, treatment_type="laser")

        r = client.get("/api/analytics/at-risk-babies", headers=auth("central@test.com"))
        assert r.json()["total"] == 0

    def test_outcome_none_treatment_type_still_at_risk(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_exam(db, baby, exam_date=date(2024, 4, 1), treatment_recommended="laser")
        make_outcome(db, baby, treatment_type="none")  # outcome exists but no treatment

        r = client.get("/api/analytics/at-risk-babies", headers=auth("central@test.com"))
        assert r.json()["total"] == 1

    def test_sorted_by_days_since_diagnosis_desc(self, client, auth, central, hospital_a, db):
        b1 = make_baby(db, hospital_a.id, name="Older")
        b2 = make_baby(db, hospital_a.id, name="Newer")
        make_exam(db, b1, exam_date=date(2024, 1, 1), treatment_recommended="laser")
        make_exam(db, b2, exam_date=date(2024, 6, 1), treatment_recommended="laser")

        r = client.get("/api/analytics/at-risk-babies", headers=auth("central@test.com"))
        babies = r.json()["babies"]
        assert babies[0]["full_name"] == "Older"   # oldest diagnosis first
        assert babies[1]["full_name"] == "Newer"

    def test_latest_exam_used_for_zone_stage(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_exam(db, baby, exam_date=date(2024, 3, 1),
                  treatment_recommended="laser", worst_zone="zone_ii", worst_stage="stage_2")
        make_exam(db, baby, exam_date=date(2024, 5, 1),
                  treatment_recommended="laser", worst_zone="zone_i", worst_stage="stage_3")

        r = client.get("/api/analytics/at-risk-babies", headers=auth("central@test.com"))
        b = r.json()["babies"][0]
        assert b["zone"] == "zone_i"   # from the latest exam
        assert b["stage"] == "stage_3"


# ── LTFU babies list ──────────────────────────────────────────────────────────

class TestLtfuBabies:
    def test_empty_when_no_ltfu(self, client, auth, central):
        r = client.get("/api/analytics/ltfu-babies", headers=auth("central@test.com"))
        assert r.status_code == 200
        assert r.json() == {"babies": [], "total": 0}

    def test_returns_baby_with_full_detail(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id, name="Nakato Faith")
        make_exam(db, baby, exam_date=date(2024, 3, 1),
                  worst_zone="zone_ii", worst_stage="stage_2")
        make_appointment(db, baby, due_date=date(2024, 4, 10), status="ltfu")

        r = client.get("/api/analytics/ltfu-babies", headers=auth("central@test.com"))
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        b = body["babies"][0]
        assert b["full_name"] == "Nakato Faith"
        assert b["hospital_name"] == "Mulago National Referral Hospital"
        assert b["zone"] == "zone_ii"
        assert b["stage"] == "stage_2"
        assert b["missed_appointment_date"] == "2024-04-10"
        assert b["days_overdue"] is not None

    def test_only_missed_and_ltfu_status_included(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_appointment(db, baby, due_date=date(2024, 4, 1), status="attended")
        make_appointment(db, baby, due_date=date(2024, 5, 1), status="scheduled")

        r = client.get("/api/analytics/ltfu-babies", headers=auth("central@test.com"))
        assert r.json()["total"] == 0

    def test_date_filter_from_date(self, client, auth, central, hospital_a, db):
        b1 = make_baby(db, hospital_a.id, name="January LTFU")
        b2 = make_baby(db, hospital_a.id, name="June LTFU")
        make_appointment(db, b1, due_date=date(2024, 1, 15), status="missed")
        make_appointment(db, b2, due_date=date(2024, 6, 15), status="missed")

        r = client.get("/api/analytics/ltfu-babies",
                       headers=auth("central@test.com"),
                       params={"from_date": "2024-05-01", "to_date": "2024-12-31"})
        body = r.json()
        assert body["total"] == 1
        assert body["babies"][0]["full_name"] == "June LTFU"

    def test_sorted_by_days_overdue_desc(self, client, auth, central, hospital_a, db):
        b1 = make_baby(db, hospital_a.id, name="Long Overdue")
        b2 = make_baby(db, hospital_a.id, name="Short Overdue")
        make_appointment(db, b1, due_date=date(2024, 1, 1), status="ltfu")
        make_appointment(db, b2, due_date=date(2024, 6, 1), status="ltfu")

        r = client.get("/api/analytics/ltfu-babies", headers=auth("central@test.com"))
        babies = r.json()["babies"]
        assert babies[0]["full_name"] == "Long Overdue"

    def test_each_baby_appears_once_with_latest_missed_appointment(self, client, auth, central, hospital_a, db):
        baby = make_baby(db, hospital_a.id)
        make_appointment(db, baby, due_date=date(2024, 3, 1), status="missed")
        make_appointment(db, baby, due_date=date(2024, 5, 1), status="missed")

        r = client.get("/api/analytics/ltfu-babies", headers=auth("central@test.com"))
        body = r.json()
        assert body["total"] == 1  # deduplicated by baby
        assert body["babies"][0]["missed_appointment_date"] == "2024-05-01"
