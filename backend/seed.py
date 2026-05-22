from __future__ import annotations
"""
Seed the database with all major Ugandan hospitals, demo users, babies, and appointments.
Run: python seed.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import date, timedelta
from app.database import SessionLocal, engine, Base
import app.models

from app.models.hospital import Hospital
from app.models.user import User, UserRole
from app.models.baby import Baby, Sex, Language, BabyStatus
from app.models.exam import Exam, Zone, Stage, PlusDisease
from app.models.appointment import Appointment, AppointmentStatus
from app.auth.jwt import hash_password

Base.metadata.create_all(bind=engine)
db = SessionLocal()

# ── Hospitals ─────────────────────────────────────────────────────────────────
# All major Ugandan hospitals with NICUs / neonatal units
hospitals_data = [

    # ── National Referral Hospitals ──────────────────────────────────────────
    {"name": "Mulago National Referral Hospital",    "district": "Kampala",  "region": "Central",    "hospital_code": "MNR"},
    {"name": "Kiruddu National Referral Hospital",   "district": "Kampala",  "region": "Central",    "hospital_code": "KDR"},
    {"name": "Kawempe National Referral Hospital",   "district": "Kampala",  "region": "Central",    "hospital_code": "KNR"},

    # ── Regional Referral Hospitals (14) ─────────────────────────────────────
    {"name": "Arua Regional Referral Hospital",      "district": "Arua",     "region": "West Nile",  "hospital_code": "ARR"},
    {"name": "Fort Portal Regional Referral Hospital","district": "Kabarole", "region": "Western",    "hospital_code": "FPR"},
    {"name": "Gulu Regional Referral Hospital",      "district": "Gulu",     "region": "Northern",   "hospital_code": "GRR"},
    {"name": "Hoima Regional Referral Hospital",     "district": "Hoima",    "region": "Western",    "hospital_code": "HRR"},
    {"name": "Jinja Regional Referral Hospital",     "district": "Jinja",    "region": "Eastern",    "hospital_code": "JRR"},
    {"name": "Kabale Regional Referral Hospital",    "district": "Kabale",   "region": "Western",    "hospital_code": "KBR"},
    {"name": "Lira Regional Referral Hospital",      "district": "Lira",     "region": "Northern",   "hospital_code": "LRR"},
    {"name": "Masaka Regional Referral Hospital",    "district": "Masaka",   "region": "Central",    "hospital_code": "MKR"},
    {"name": "Mbarara Regional Referral Hospital",   "district": "Mbarara",  "region": "Western",    "hospital_code": "MBR"},
    {"name": "Mbale Regional Referral Hospital",     "district": "Mbale",    "region": "Eastern"},
    {"name": "Moroto Regional Referral Hospital",    "district": "Moroto",   "region": "Karamoja",   "hospital_code": "MTR"},
    {"name": "Mubende Regional Referral Hospital",   "district": "Mubende",  "region": "Central"},
    {"name": "Rukungiri Regional Referral Hospital", "district": "Rukungiri","region": "Western"},
    {"name": "Soroti Regional Referral Hospital",    "district": "Soroti",   "region": "Eastern",    "hospital_code": "SRR"},

    # ── Other Government Hospitals with NICUs ────────────────────────────────
    {"name": "Entebbe Regional Referral Hospital",   "district": "Wakiso",   "region": "Central"},
    {"name": "Naguru Regional Referral Hospital",    "district": "Kampala",  "region": "Central"},
    {"name": "Iganga General Hospital",              "district": "Iganga",   "region": "Eastern"},
    {"name": "Tororo General Hospital",              "district": "Tororo",   "region": "Eastern"},
    {"name": "Kitgum General Hospital",              "district": "Kitgum",   "region": "Northern"},
    {"name": "Masindi General Hospital",             "district": "Masindi",  "region": "Western"},
    {"name": "Pallisa General Hospital",             "district": "Pallisa",  "region": "Eastern"},
    {"name": "Apac General Hospital",                "district": "Apac",     "region": "Northern"},
    {"name": "Nebbi General Hospital",               "district": "Nebbi",    "region": "West Nile"},
    {"name": "Adjumani General Hospital",            "district": "Adjumani", "region": "West Nile"},
    {"name": "Bundibugyo General Hospital",          "district": "Bundibugyo","region": "Western"},
    {"name": "Bushenyi General Hospital",            "district": "Bushenyi", "region": "Western"},
    {"name": "Kapchorwa General Hospital",           "district": "Kapchorwa","region": "Eastern"},
    {"name": "Rakai General Hospital",               "district": "Rakai",    "region": "Central"},

    # ── PNFP (Private Not-For-Profit) Hospitals ───────────────────────────────
    {"name": "St. Mary's Hospital Lacor",            "district": "Gulu",     "region": "Northern"},
    {"name": "Uganda Martyrs Hospital Lubaga",       "district": "Kampala",  "region": "Central"},
    {"name": "Mengo Hospital",                       "district": "Kampala",  "region": "Central"},
    {"name": "St. Francis Hospital Nsambya",         "district": "Kampala",  "region": "Central"},
    {"name": "Kitovu Hospital",                      "district": "Masaka",   "region": "Central"},
    {"name": "Virika Hospital",                      "district": "Kabarole", "region": "Western"},
    {"name": "Comboni Hospital Wairaka",             "district": "Jinja",    "region": "Eastern"},
    {"name": "Holy Family Hospital Kisubi",          "district": "Wakiso",   "region": "Central"},
    {"name": "Matany Hospital",                      "district": "Moroto",   "region": "Karamoja"},
    {"name": "St. Joseph's Hospital Kitgum",         "district": "Kitgum",   "region": "Northern"},
    {"name": "Nyakibale Hospital",                   "district": "Rukungiri","region": "Western"},
    {"name": "Bwindi Community Hospital",            "district": "Kanungu",  "region": "Western"},
    {"name": "Kisiizi Hospital",                     "district": "Rukungiri","region": "Western"},
    {"name": "Kagando Hospital",                     "district": "Kasese",   "region": "Western"},
    {"name": "Kumi Hospital",                        "district": "Kumi",     "region": "Eastern"},
    {"name": "Ngora Freda Carr Hospital",            "district": "Ngora",    "region": "Eastern"},
    {"name": "St. Anthony's Hospital Tororo",        "district": "Tororo",   "region": "Eastern"},

    # ── Private Hospitals with NICUs ─────────────────────────────────────────
    {"name": "International Hospital Kampala",       "district": "Kampala",  "region": "Central"},
    {"name": "Case Hospital",                        "district": "Kampala",  "region": "Central"},
    {"name": "Norvik Hospital",                      "district": "Kampala",  "region": "Central"},
    {"name": "Nakasero Hospital",                    "district": "Kampala",  "region": "Central"},
    {"name": "Kampala Hospital",                     "district": "Kampala",  "region": "Central"},
    {"name": "Victoria Hospital",                    "district": "Entebbe",  "region": "Central"},
]

hospitals = {}
added = 0
for h in hospitals_data:
    existing = db.query(Hospital).filter(Hospital.name == h["name"]).first()
    if not existing:
        obj = Hospital(**h)
        db.add(obj)
        db.flush()
        hospitals[h["name"]] = obj
        added += 1
    else:
        # Backfill hospital_code on existing rows if not already set
        if "hospital_code" in h and not existing.hospital_code:
            existing.hospital_code = h["hospital_code"]
        hospitals[h["name"]] = existing

db.commit()
print(f"Hospitals: {added} added, {len(hospitals_data) - added} already existed ({len(hospitals_data)} total)")

# ── Demo Users ────────────────────────────────────────────────────────────────
mulago  = hospitals["Mulago National Referral Hospital"]
mbarara = hospitals["Mbarara Regional Referral Hospital"]
gulu    = hospitals["Gulu Regional Referral Hospital"]
lacor   = hospitals["St. Mary's Hospital Lacor"]
mbale   = hospitals["Mbale Regional Referral Hospital"]
kiruddu = hospitals["Kiruddu National Referral Hospital"]

users_data = [
    # Central
    {"email": "central@rop.ug",
     "full_name": "Dr. Central Admin",
     "password": "password123",
     "role": UserRole.CENTRAL_COORDINATOR,
     "hospital_id": None},

    # Hospital Coordinators
    {"email": "coordinator.mulago@rop.ug",
     "full_name": "Nurse Sarah Nakato",
     "password": "password123",
     "role": UserRole.HOSPITAL_COORDINATOR,
     "hospital_id": mulago.id},
    {"email": "coordinator.kiruddu@rop.ug",
     "full_name": "Nurse Florence Nambi",
     "password": "password123",
     "role": UserRole.HOSPITAL_COORDINATOR,
     "hospital_id": kiruddu.id},
    {"email": "coordinator.mbarara@rop.ug",
     "full_name": "Nurse James Tumuhairwe",
     "password": "password123",
     "role": UserRole.HOSPITAL_COORDINATOR,
     "hospital_id": mbarara.id},
    {"email": "coordinator.gulu@rop.ug",
     "full_name": "Nurse Agnes Acen",
     "password": "password123",
     "role": UserRole.HOSPITAL_COORDINATOR,
     "hospital_id": gulu.id},
    {"email": "coordinator.lacor@rop.ug",
     "full_name": "Nurse Mary Akello",
     "password": "password123",
     "role": UserRole.HOSPITAL_COORDINATOR,
     "hospital_id": lacor.id},
    {"email": "coordinator.mbale@rop.ug",
     "full_name": "Nurse Christine Nabirye",
     "password": "password123",
     "role": UserRole.HOSPITAL_COORDINATOR,
     "hospital_id": mbale.id},

    # Ophthalmologists
    {"email": "ophth.mulago@rop.ug",
     "full_name": "Dr. Grace Atim",
     "password": "password123",
     "role": UserRole.OPHTHALMOLOGIST,
     "hospital_id": mulago.id},
    {"email": "ophth.mbarara@rop.ug",
     "full_name": "Dr. Robert Byarugaba",
     "password": "password123",
     "role": UserRole.OPHTHALMOLOGIST,
     "hospital_id": mbarara.id},

    # NICU Nurses
    {"email": "nurse.mulago@rop.ug",
     "full_name": "Nurse Betty Auma",
     "password": "password123",
     "role": UserRole.NICU_NURSE,
     "hospital_id": mulago.id},
    {"email": "nurse.kiruddu@rop.ug",
     "full_name": "Nurse Patricia Namutebi",
     "password": "password123",
     "role": UserRole.NICU_NURSE,
     "hospital_id": kiruddu.id},
    {"email": "nurse.mbarara@rop.ug",
     "full_name": "Nurse Juliet Atuhaire",
     "password": "password123",
     "role": UserRole.NICU_NURSE,
     "hospital_id": mbarara.id},
]

users = {}
u_added = 0
for u in users_data:
    existing = db.query(User).filter(User.email == u["email"]).first()
    if not existing:
        obj = User(
            email=u["email"],
            full_name=u["full_name"],
            hashed_password=hash_password(u["password"]),
            role=u["role"].value,
            hospital_id=u["hospital_id"],
        )
        db.add(obj)
        db.flush()
        users[u["email"]] = obj
        u_added += 1
    else:
        users[u["email"]] = existing

db.commit()
print(f"Users: {u_added} added ({len(users_data)} total)")

today = date.today()

# ── Demo Babies (spread across hospitals) ────────────────────────────────────
babies_seed = [
    # Mulago — LTFU
    {"full_name": "Baby Nakamya A.", "date_of_birth": today - timedelta(weeks=8),
     "sex": Sex.FEMALE, "birth_weight_grams": 1100, "gestational_age_weeks": 28,
     "caregiver_name": "Prossy Nakamya", "mtn_phone": "+256772000001",
     "language_preference": Language.LUGANDA, "status": BabyStatus.LTFU,
     "hospital": mulago, "oxygen_therapy": True, "blood_transfusion": False,
     "sepsis": True, "inotropes": False, "anaemia": True,
     "appt_date": today - timedelta(days=10), "appt_status": AppointmentStatus.MISSED},

    {"full_name": "Baby Otim B.", "date_of_birth": today - timedelta(weeks=10),
     "sex": Sex.MALE, "birth_weight_grams": 950, "gestational_age_weeks": 26,
     "caregiver_name": "David Otim", "mtn_phone": "+256772000002",
     "language_preference": Language.ACHOLI, "status": BabyStatus.LTFU,
     "hospital": mulago, "oxygen_therapy": True, "blood_transfusion": True,
     "sepsis": False, "inotropes": True, "anaemia": False,
     "appt_date": today - timedelta(days=8), "appt_status": AppointmentStatus.MISSED},

    # Mulago — Due today
    {"full_name": "Baby Tumusiime C.", "date_of_birth": today - timedelta(weeks=7),
     "sex": Sex.MALE, "birth_weight_grams": 1300, "gestational_age_weeks": 30,
     "caregiver_name": "Rose Tumusiime", "airtel_phone": "+256752000003",
     "language_preference": Language.RUNYANKOLE, "status": BabyStatus.ACTIVE,
     "hospital": mulago, "oxygen_therapy": True, "blood_transfusion": False,
     "sepsis": False, "inotropes": False, "anaemia": False,
     "appt_date": today, "appt_status": AppointmentStatus.SCHEDULED},

    # Mulago — Due soon
    {"full_name": "Baby Okello D.", "date_of_birth": today - timedelta(weeks=6),
     "sex": Sex.MALE, "birth_weight_grams": 1450, "gestational_age_weeks": 31,
     "caregiver_name": "Margaret Okello", "mtn_phone": "+256772000004",
     "language_preference": Language.ENGLISH, "status": BabyStatus.ACTIVE,
     "hospital": mulago, "oxygen_therapy": False, "blood_transfusion": False,
     "sepsis": False, "inotropes": False, "anaemia": True,
     "appt_date": today + timedelta(days=2), "appt_status": AppointmentStatus.SCHEDULED},

    # Mulago — On track
    {"full_name": "Baby Namukasa E.", "date_of_birth": today - timedelta(weeks=4),
     "sex": Sex.FEMALE, "birth_weight_grams": 1800, "gestational_age_weeks": 33,
     "caregiver_name": "Fatuma Namukasa", "mtn_phone": "+256772000005",
     "language_preference": Language.LUGANDA, "status": BabyStatus.ACTIVE,
     "hospital": mulago, "oxygen_therapy": False, "blood_transfusion": False,
     "sepsis": False, "inotropes": False, "anaemia": False,
     "appt_date": today + timedelta(weeks=2), "appt_status": AppointmentStatus.SCHEDULED},

    # Kiruddu — LTFU
    {"full_name": "Baby Ssebunya F.", "date_of_birth": today - timedelta(weeks=9),
     "sex": Sex.MALE, "birth_weight_grams": 1020, "gestational_age_weeks": 27,
     "caregiver_name": "Hamida Ssebunya", "mtn_phone": "+256772000006",
     "language_preference": Language.LUGANDA, "status": BabyStatus.LTFU,
     "hospital": kiruddu, "oxygen_therapy": True, "blood_transfusion": True,
     "sepsis": True, "inotropes": False, "anaemia": True,
     "appt_date": today - timedelta(days=6), "appt_status": AppointmentStatus.MISSED},

    # Kiruddu — Due today
    {"full_name": "Baby Nanteza G.", "date_of_birth": today - timedelta(weeks=6),
     "sex": Sex.FEMALE, "birth_weight_grams": 1250, "gestational_age_weeks": 29,
     "caregiver_name": "Annet Nanteza", "airtel_phone": "+256752000007",
     "language_preference": Language.LUGANDA, "status": BabyStatus.ACTIVE,
     "hospital": kiruddu, "oxygen_therapy": True, "blood_transfusion": False,
     "sepsis": False, "inotropes": False, "anaemia": False,
     "appt_date": today, "appt_status": AppointmentStatus.SCHEDULED},

    # Mbarara — LTFU
    {"full_name": "Baby Kagoro H.", "date_of_birth": today - timedelta(weeks=9),
     "sex": Sex.MALE, "birth_weight_grams": 1050, "gestational_age_weeks": 27,
     "caregiver_name": "Grace Kagoro", "mtn_phone": "+256772000008",
     "language_preference": Language.RUNYANKOLE, "status": BabyStatus.LTFU,
     "hospital": mbarara, "oxygen_therapy": True, "blood_transfusion": True,
     "sepsis": True, "inotropes": False, "anaemia": True,
     "appt_date": today - timedelta(days=5), "appt_status": AppointmentStatus.MISSED},

    # Mbarara — On track
    {"full_name": "Baby Ayebare I.", "date_of_birth": today - timedelta(weeks=4),
     "sex": Sex.FEMALE, "birth_weight_grams": 1700, "gestational_age_weeks": 32,
     "caregiver_name": "Alice Ayebare", "airtel_phone": "+256752000009",
     "language_preference": Language.RUNYANKOLE, "status": BabyStatus.ACTIVE,
     "hospital": mbarara, "oxygen_therapy": False, "blood_transfusion": False,
     "sepsis": False, "inotropes": False, "anaemia": False,
     "appt_date": today + timedelta(weeks=3), "appt_status": AppointmentStatus.SCHEDULED},

    # Gulu — LTFU
    {"full_name": "Baby Ojara J.", "date_of_birth": today - timedelta(weeks=11),
     "sex": Sex.MALE, "birth_weight_grams": 900, "gestational_age_weeks": 25,
     "caregiver_name": "Monica Ojara", "mtn_phone": "+256772000010",
     "language_preference": Language.ACHOLI, "status": BabyStatus.LTFU,
     "hospital": gulu, "oxygen_therapy": True, "blood_transfusion": True,
     "sepsis": True, "inotropes": True, "anaemia": True,
     "appt_date": today - timedelta(days=14), "appt_status": AppointmentStatus.MISSED},

    # Gulu — Due soon
    {"full_name": "Baby Akello K.", "date_of_birth": today - timedelta(weeks=5),
     "sex": Sex.FEMALE, "birth_weight_grams": 1350, "gestational_age_weeks": 30,
     "caregiver_name": "Susan Akello", "mtn_phone": "+256772000011",
     "language_preference": Language.ACHOLI, "status": BabyStatus.ACTIVE,
     "hospital": gulu, "oxygen_therapy": True, "blood_transfusion": False,
     "sepsis": False, "inotropes": False, "anaemia": True,
     "appt_date": today + timedelta(days=1), "appt_status": AppointmentStatus.SCHEDULED},

    # Lacor — On track
    {"full_name": "Baby Onen L.", "date_of_birth": today - timedelta(weeks=3),
     "sex": Sex.MALE, "birth_weight_grams": 1550, "gestational_age_weeks": 31,
     "caregiver_name": "Joseph Onen", "airtel_phone": "+256752000012",
     "language_preference": Language.ACHOLI, "status": BabyStatus.ACTIVE,
     "hospital": lacor, "oxygen_therapy": False, "blood_transfusion": False,
     "sepsis": False, "inotropes": False, "anaemia": False,
     "appt_date": today + timedelta(weeks=4), "appt_status": AppointmentStatus.SCHEDULED},

    # Mbale — LTFU
    {"full_name": "Baby Wafula M.", "date_of_birth": today - timedelta(weeks=8),
     "sex": Sex.MALE, "birth_weight_grams": 1150, "gestational_age_weeks": 28,
     "caregiver_name": "Esther Wafula", "mtn_phone": "+256772000013",
     "language_preference": Language.ENGLISH, "status": BabyStatus.LTFU,
     "hospital": mbale, "oxygen_therapy": True, "blood_transfusion": False,
     "sepsis": True, "inotropes": False, "anaemia": False,
     "appt_date": today - timedelta(days=7), "appt_status": AppointmentStatus.MISSED},

    # Mbale — Due today
    {"full_name": "Baby Nabirye N.", "date_of_birth": today - timedelta(weeks=5),
     "sex": Sex.FEMALE, "birth_weight_grams": 1400, "gestational_age_weeks": 30,
     "caregiver_name": "Rehema Nabirye", "airtel_phone": "+256752000014",
     "language_preference": Language.ENGLISH, "status": BabyStatus.ACTIVE,
     "hospital": mbale, "oxygen_therapy": False, "blood_transfusion": False,
     "sepsis": False, "inotropes": False, "anaemia": True,
     "appt_date": today, "appt_status": AppointmentStatus.SCHEDULED},
]

b_added = 0
for b in babies_seed:
    if db.query(Baby).filter(Baby.full_name == b["full_name"]).first():
        continue
    hosp       = b.pop("hospital")
    appt_date  = b.pop("appt_date")
    appt_status = b.pop("appt_status")

    import enum as _enum
    b_converted = {k: v.value if isinstance(v, _enum.Enum) else v for k, v in b.items()}
    baby = Baby(**b_converted, hospital_id=hosp.id)
    db.add(baby)
    db.flush()

    appt = Appointment(baby_id=baby.id, due_date=appt_date, status=appt_status.value)
    db.add(appt)
    b_added += 1

db.commit()
print(f"Babies: {b_added} added ({len(babies_seed)} total)")

print("\nSeed complete.")
print("\nDemo logins (all passwords: password123):")
print("  central@rop.ug                  Central Coordinator")
print("  coordinator.mulago@rop.ug       Hospital Coordinator - Mulago")
print("  coordinator.kiruddu@rop.ug      Hospital Coordinator - Kiruddu")
print("  coordinator.mbarara@rop.ug      Hospital Coordinator - Mbarara")
print("  coordinator.gulu@rop.ug         Hospital Coordinator - Gulu")
print("  coordinator.lacor@rop.ug        Hospital Coordinator - Lacor")
print("  coordinator.mbale@rop.ug        Hospital Coordinator - Mbale")
print("  ophth.mulago@rop.ug             Ophthalmologist - Mulago")
print("  ophth.mbarara@rop.ug            Ophthalmologist - Mbarara")
print("  nurse.mulago@rop.ug             NICU Nurse - Mulago")
print("  nurse.kiruddu@rop.ug            NICU Nurse - Kiruddu")
print("  nurse.mbarara@rop.ug            NICU Nurse - Mbarara")
db.close()
