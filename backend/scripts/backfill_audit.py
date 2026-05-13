"""
Backfill audit_logs from existing database records.

Run once from the backend directory:
    python scripts/backfill_audit.py

Idempotent: skips any entity that already has an audit entry of that action type.
"""
from __future__ import annotations
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.audit_log import AuditLog
from app.models.user import User
from app.models.baby import Baby
from app.models.exam import Exam
from app.models.hospital import Hospital
from app.models.outcome import Outcome, TreatmentType
from sqlalchemy import cast, String, text


def already_logged(db, action_type: str, entity_type: str, entity_id: str) -> bool:
    return db.query(AuditLog).filter(
        AuditLog.action_type == action_type,
        AuditLog.entity_type == entity_type,
        AuditLog.entity_id == entity_id,
    ).first() is not None


def backfill_users(db) -> int:
    users = db.query(User).all()
    count = 0
    for u in users:
        if already_logged(db, "CREATE", "User", str(u.id)):
            continue
        entry = AuditLog(
            created_at=u.created_at,
            user_id=u.id,
            user_name=u.full_name,
            user_role=u.role.value,
            action_type="CREATE",
            entity_type="User",
            entity_id=str(u.id),
            details={"email": u.email, "role": u.role.value},
        )
        db.add(entry)
        count += 1
    return count


def backfill_hospitals(db) -> int:
    # Check if hospitals have created_at
    has_created_at = False
    try:
        db.execute(text("SELECT created_at FROM hospitals LIMIT 1"))
        has_created_at = True
    except Exception:
        db.rollback()

    hospitals = db.query(Hospital).all()
    count = 0
    for h in hospitals:
        if already_logged(db, "CREATE", "Hospital", str(h.id)):
            continue
        created_at = getattr(h, "created_at", None) if has_created_at else None
        entry = AuditLog(
            created_at=created_at,
            user_name="System",
            user_role="central_coordinator",
            action_type="CREATE",
            entity_type="Hospital",
            entity_id=str(h.id),
            details={"name": h.name, "district": h.district},
        )
        db.add(entry)
        count += 1
    return count


def backfill_babies(db) -> int:
    babies = db.query(Baby).all()
    user_cache: dict = {}
    count = 0
    for baby in babies:
        if already_logged(db, "ENROLL", "Baby", str(baby.id)):
            continue
        enroller = None
        if baby.enrolled_by_id:
            if baby.enrolled_by_id not in user_cache:
                user_cache[baby.enrolled_by_id] = db.query(User).filter(User.id == baby.enrolled_by_id).first()
            enroller = user_cache[baby.enrolled_by_id]

        entry = AuditLog(
            created_at=baby.enrolled_at,
            user_id=enroller.id if enroller else None,
            user_name=enroller.full_name if enroller else "Unknown",
            user_role=enroller.role.value if enroller else "nicu_nurse",
            action_type="ENROLL",
            entity_type="Baby",
            entity_id=str(baby.id),
            details={"full_name": baby.full_name, "hospital_id": str(baby.hospital_id)},
        )
        db.add(entry)
        count += 1
    return count


def backfill_exams(db) -> int:
    exams = db.query(Exam).all()
    user_cache: dict = {}
    count = 0
    for exam in exams:
        if already_logged(db, "EXAM", "Exam", str(exam.id)):
            continue
        examiner = None
        if exam.examiner_id:
            if exam.examiner_id not in user_cache:
                user_cache[exam.examiner_id] = db.query(User).filter(User.id == exam.examiner_id).first()
            examiner = user_cache[exam.examiner_id]

        entry = AuditLog(
            created_at=getattr(exam, "created_at", None),
            user_id=examiner.id if examiner else None,
            user_name=examiner.full_name if examiner else "Unknown",
            user_role=examiner.role.value if examiner else "ophthalmologist",
            action_type="EXAM",
            entity_type="Exam",
            entity_id=str(exam.id),
            details={
                "baby_id": str(exam.baby_id),
                "exam_date": str(exam.exam_date),
                "worst_zone": str(exam.worst_zone) if exam.worst_zone else None,
                "worst_stage": str(exam.worst_stage) if exam.worst_stage else None,
                "treatment_recommended": exam.treatment_recommended,
            },
        )
        db.add(entry)
        count += 1
    return count


def backfill_treatments(db) -> int:
    outcomes = (
        db.query(Outcome)
        .filter(cast(Outcome.treatment_type, String).notin_(["NONE", "none"]))
        .filter(Outcome.treatment_type != None)
        .all()
    )
    count = 0
    for outcome in outcomes:
        if already_logged(db, "TREATMENT", "Outcome", str(outcome.baby_id)):
            continue
        entry = AuditLog(
            user_name="System",
            user_role="ophthalmologist",
            action_type="TREATMENT",
            entity_type="Outcome",
            entity_id=str(outcome.baby_id),
            details={
                "treatment_type": outcome.treatment_type.value if outcome.treatment_type else None,
                "treatment_eye": outcome.treatment_eye.value if outcome.treatment_eye else None,
            },
        )
        db.add(entry)
        count += 1
    return count


def main():
    db = SessionLocal()
    try:
        print("Backfilling audit log...")
        u = backfill_users(db)
        print(f"  Users (CREATE):     {u}")
        h = backfill_hospitals(db)
        print(f"  Hospitals (CREATE): {h}")
        b = backfill_babies(db)
        print(f"  Babies (ENROLL):    {b}")
        e = backfill_exams(db)
        print(f"  Exams (EXAM):       {e}")
        t = backfill_treatments(db)
        print(f"  Treatments:         {t}")
        db.commit()
        print(f"Done. {u + h + b + e + t} entries inserted.")
    except Exception as exc:
        db.rollback()
        print(f"Error: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
