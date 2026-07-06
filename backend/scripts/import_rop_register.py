"""
One-time bulk import of the Mulago/Kawempe historical ROP register (Excel) into the database.

Run from the backend directory:
    python scripts/import_rop_register.py                 # dry run (default) - writes nothing
    python scripts/import_rop_register.py --commit         # actually writes to the database

Safe to re-run: existing babies/exams are detected and skipped (idempotent), and nothing is
ever deleted or overwritten. Twin babies (same caregiver name + hospital, different S/T slot)
are disambiguated across runs via a hidden marker appended to Baby.notes at creation time,
since the schema has no separate "twin slot" column.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import openpyxl

from app.database import SessionLocal
from app.models.baby import Baby, BabyStatus, Sex
from app.models.exam import Exam, Zone, Stage
from app.models.appointment import Appointment, AppointmentStatus
from app.models.hospital import Hospital
from app.services.rop_id import generate_rop_id
from app.services.scheduling import derive_worst_finding

DEFAULT_FILE = r"C:\Users\HP\OneDrive\Desktop\ROP excel.xlsx"
SHEET_NAME = "Main Register"

TWIN_MARKER_RE = re.compile(r"\[register-import: twin_slot=(\w+)\]")


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def clean(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s not in ("-", "--", "N/A", "n/a") else None


def parse_duration_days(raw: str) -> int | None:
    """Parse PN-Age/GA style durations into total days.

    Handles: 'Nw', 'NwDd' (e.g. '13w5d'), 'N+Dd' / 'N+D' (weeks+days, e.g. '9+5d', '3+5'),
    'Nd' (bare days, e.g. '29d'). Returns None for anything else (e.g. malformed
    multi-plus values like '2+4+6d').
    """
    s = clean(raw)
    if s is None:
        return None
    s = s.replace(" ", "")

    m = re.fullmatch(r"(\d+)w(\d+)d", s, re.IGNORECASE)
    if m:
        return int(m.group(1)) * 7 + int(m.group(2))

    m = re.fullmatch(r"(\d+)w\+(\d+)d?", s, re.IGNORECASE)
    if m:
        return int(m.group(1)) * 7 + int(m.group(2))

    m = re.fullmatch(r"(\d+)w", s, re.IGNORECASE)
    if m:
        return int(m.group(1)) * 7

    m = re.fullmatch(r"(\d+)\+(\d+)d?", s, re.IGNORECASE)
    if m:
        return int(m.group(1)) * 7 + int(m.group(2))

    m = re.fullmatch(r"(\d+)d", s, re.IGNORECASE)
    if m:
        return int(m.group(1))

    return None


def days_to_weeks(days: int | None) -> float | None:
    return round(days / 7, 2) if days is not None else None


def parse_date_ddmmyyyy(raw) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = clean(raw)
    if s is None:
        return None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_phone(raw: str) -> tuple[str | None, str | None, str | None]:
    """Returns (mtn_phone, airtel_phone, flag)."""
    s = clean(raw)
    if s is None:
        return None, None, "No contact - manual follow-up needed"
    digits = re.sub(r"[^\d]", "", s)
    if digits.startswith("256") and len(digits) == 12:
        digits = "0" + digits[3:]
    if len(digits) != 10 or not digits.startswith("0"):
        return None, None, "Unrecognized phone prefix - stored in notes"
    prefix = digits[:3]
    if prefix in ("076", "077", "078", "079"):
        return digits, None, None
    if prefix in ("070", "074", "075"):
        return None, digits, None
    return None, None, "Unrecognized phone prefix - stored in notes"


def parse_followup_interval(raw: str, exam_date: date) -> date | None:
    s = clean(raw)
    if s is None:
        return None
    s = s.strip()

    m = re.fullmatch(r"(\d+)\s*/\s*52", s)
    if m:
        return exam_date + timedelta(weeks=int(m.group(1)))

    m = re.fullmatch(r"(\d+)\s*/\s*12", s)
    if m:
        return exam_date + timedelta(days=int(m.group(1)) * 30)

    m = re.fullmatch(r"(\d+)\s*/\s*7", s)
    if m:
        return exam_date + timedelta(days=int(m.group(1)))

    m = re.fullmatch(r"(\d+)\s*days?", s, re.IGNORECASE)
    if m:
        return exam_date + timedelta(days=int(m.group(1)))

    return None


ZONE_MAP = {"I": Zone.ZONE_I, "II": Zone.ZONE_II, "III": Zone.ZONE_III}
STAGE_NUM_MAP = {"1": Stage.STAGE_1, "2": Stage.STAGE_2, "3": Stage.STAGE_3, "4": Stage.STAGE_4, "5": Stage.STAGE_5}
STAGE_ROMAN_MAP = {"I": Stage.STAGE_1, "II": Stage.STAGE_2, "III": Stage.STAGE_3, "IV": Stage.STAGE_4, "V": Stage.STAGE_5}


def parse_finding(raw: str) -> tuple[Zone | None, Stage | None, str | None]:
    """Returns (zone, stage, flag). Raw text is preserved by the caller regardless."""
    s = clean(raw)
    if s is None:
        return None, None, None

    if re.search(r"\bAROP\b", s, re.IGNORECASE):
        return None, None, "Complex/unstructured finding - see raw finding text"

    if re.search(r"\bNo\s*ROP\b", s, re.IGNORECASE):
        return None, Stage.NO_ROP, None

    m = re.search(r"\bIVZ\s*(III|II|I)\b", s)
    if m:
        return ZONE_MAP[m.group(1)], Stage.IMMATURE, None

    m = re.search(r"\bMVZ\s*(III|II|I)\b", s)
    if m:
        return ZONE_MAP[m.group(1)], Stage.NO_ROP, None

    m = re.search(r"\bStage\s*(IV|V|III|II|I|[1-5])\b", s, re.IGNORECASE)
    if m:
        token = m.group(1).upper()
        stage = STAGE_NUM_MAP.get(token) or STAGE_ROMAN_MAP.get(token)
        zm = re.search(r"\bZ(III|II|I)\b", s)
        zone = ZONE_MAP[zm.group(1)] if zm else None
        return zone, stage, None

    return None, None, "Complex/unstructured finding - see raw finding text"


def strip_bo_prefix(raw: str) -> str:
    s = clean(raw) or ""
    return re.sub(r"^B/O\s+", "", s, flags=re.IGNORECASE).strip()


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

class Importer:
    def __init__(self, db, commit: bool):
        self.db = db
        self.commit = commit
        self.hospital_by_prefix = self._load_hospitals()
        self.baby_map: dict[tuple, Baby] = {}      # (name, hospital_id, twin_slot) -> Baby - used for "N" creation dedup
        self.name_twin_map: dict[tuple, list] = {}  # (name, twin_slot) -> [Baby, ...] - used for "R" fallback matching across hospitals
        self.phone_to_names: dict[str, set[str]] = {}
        self._seed_existing_babies()

        self.babies_created = 0
        self.exams_created = 0
        self.reviews_matched = 0
        self.flags: list[tuple[int, str, str]] = []  # (entry_no, baby_label, reason)
        self.critical: list[tuple[int, str, str]] = []  # (entry_no, baby_label, note)
        self.sample_rows: list[dict] = []

    def _load_hospitals(self):
        mulago = self.db.query(Hospital).filter(Hospital.name == "Mulago National Referral Hospital").first()
        kawempe = self.db.query(Hospital).filter(Hospital.name == "Kawempe National Referral Hospital").first()
        if not mulago or not kawempe:
            raise RuntimeError("Expected hospitals not found in database")
        return {"mulago": mulago, "kawempe": kawempe}

    def hospital_for_location(self, location: str) -> Hospital | None:
        s = (clean(location) or "").lower()
        if s.startswith("mulago"):
            return self.hospital_by_prefix["mulago"]
        if s.startswith("kawempe"):
            return self.hospital_by_prefix["kawempe"]
        return None

    def _seed_existing_babies(self):
        for baby in self.db.query(Baby).filter(Baby.hospital_id.in_([h.id for h in self.hospital_by_prefix.values()])).all():
            slot = "S"
            if baby.twins_or_multiple:
                m = TWIN_MARKER_RE.search(baby.notes or "")
                slot = m.group(1) if m else "T"
            key = (baby.caregiver_name.strip().lower(), baby.hospital_id, slot)
            self.baby_map[key] = baby
            self.name_twin_map.setdefault((baby.caregiver_name.strip().lower(), slot), []).append(baby)
            for phone in (baby.mtn_phone, baby.airtel_phone):
                if phone:
                    self.phone_to_names.setdefault(phone, set()).add(baby.caregiver_name.strip())

    def _existing_exam(self, baby: Baby, exam_date: date) -> Exam | None:
        return (
            self.db.query(Exam)
            .filter(Exam.baby_id == baby.id, Exam.exam_date == exam_date)
            .first()
        )

    def flag(self, entry_no, label, reason):
        self.flags.append((entry_no, label, reason))

    def process_row(self, row: dict):
        entry_no = row.get("Entry No")
        name_raw = row.get("Name")
        caregiver_name = strip_bo_prefix(name_raw)
        label = f"B/O {caregiver_name}" if caregiver_name else "(unknown name)"

        hospital = self.hospital_for_location(row.get("Location"))
        if hospital is None:
            self.flag(entry_no, label, f"Unrecognized location '{row.get('Location')}' - row skipped")
            return

        twin_slot = (clean(row.get("S/T")) or "S").upper()
        nr = (clean(row.get("N/R")) or "").upper()
        exam_date = parse_date_ddmmyyyy(row.get("Session Date"))
        if exam_date is None:
            self.flag(entry_no, label, "Missing/unparseable Session Date - row skipped")
            return

        key = (caregiver_name.lower(), hospital.id, twin_slot)
        notes_raw = clean(row.get("Notes")) or ""
        if "baby name" in notes_raw.lower():
            self.flag(entry_no, label, "Baby's own name recorded instead of caregiver name - verify manually")
        if "critical" in notes_raw.lower():
            self.critical.append((entry_no, label, notes_raw))

        pn_age_raw = row.get("PN Age")
        pn_days = parse_duration_days(pn_age_raw)
        ga_days = parse_duration_days(row.get("GA"))
        ga_weeks = days_to_weeks(ga_days)
        pn_weeks = days_to_weeks(pn_days)

        if pn_age_raw and pn_days is None:
            self.flag(entry_no, label, f"Cannot compute DOB/PN age - unparseable postnatal age value '{pn_age_raw}'")
        if row.get("GA") and ga_days is None:
            self.flag(entry_no, label, f"Cannot compute PCA - unparseable gestational age value '{row.get('GA')}'")

        pca_weeks = round(ga_weeks + pn_weeks, 1) if (ga_weeks is not None and pn_weeks is not None) else None
        if pca_weeks is None:
            self.flag(entry_no, label, "Cannot compute PCA - missing GA or postnatal age")

        baby = self.baby_map.get(key)

        if nr == "N":
            if baby is not None:
                # Already exists (idempotent re-run) - fall through to review-style exam handling.
                pass
            else:
                baby = self._create_baby(
                    entry_no, label, caregiver_name, hospital, twin_slot,
                    row, exam_date, pn_days, ga_weeks,
                )
                if baby is None:
                    return  # creation blocked + flagged inside _create_baby
                self.baby_map[key] = baby
        elif nr == "R":
            if baby is None:
                # Fall back to name+twin match across hospitals (Mulago/Kawempe are sister
                # facilities and patients are sometimes reviewed at either one).
                candidates = self.name_twin_map.get((caregiver_name.lower(), twin_slot), [])
                if len(candidates) == 1:
                    baby = candidates[0]
                    self.flag(entry_no, label, f"Review matched across hospitals - recorded at '{row.get('Location')}' but baby enrolled at a different hospital")
                elif len(candidates) > 1:
                    self.flag(entry_no, label, "Unmatched review - multiple cross-hospital name matches, check manually")
                    return
                else:
                    self.flag(entry_no, label, "Unmatched review - check manually")
                    return
            self.reviews_matched += 1
        else:
            self.flag(entry_no, label, f"Unrecognized N/R value '{row.get('N/R')}' - row skipped")
            return

        status_raw = (clean(row.get("Status")) or "").lower()
        if status_raw == "discharged":
            baby.status = BabyStatus.DISCHARGED
        elif status_raw in ("active", "reviewed", "ebne"):
            baby.status = BabyStatus.ACTIVE

        if status_raw == "ebne":
            self.flag(entry_no, label, "Enrolled but not examined (EBNE) - no exam record created")
            return

        if self._existing_exam(baby, exam_date) is not None:
            return  # idempotent: this exam already imported on a previous run

        self._create_exam(entry_no, label, baby, row, exam_date, pn_days, pca_weeks, notes_raw)

        if len(self.sample_rows) < 5 and baby.date_of_birth is not None:
            self.sample_rows.append({
                "entry_no": entry_no, "label": label, "exam_date": exam_date,
                "pn_age_raw": pn_age_raw, "dob": baby.date_of_birth,
                "ga_weeks": ga_weeks, "pn_weeks": pn_weeks, "pca_weeks": pca_weeks,
            })

    def _create_baby(self, entry_no, label, caregiver_name, hospital, twin_slot, row, exam_date, pn_days, ga_weeks):
        missing = []
        sex_raw = (clean(row.get("Sex")) or "").upper()
        sex = {"M": Sex.MALE, "F": Sex.FEMALE}.get(sex_raw)
        bwt_raw = clean(row.get("BWT"))
        bwt = None
        if bwt_raw:
            m = re.fullmatch(r"(\d+)\s*g?", bwt_raw, re.IGNORECASE)
            bwt = int(m.group(1)) if m else None

        if sex is None:
            missing.append("sex")
        if ga_weeks is None:
            missing.append("GA")
        if bwt is None:
            missing.append("BWT")
        if missing:
            self.flag(entry_no, label, "Demographics incomplete (" + ", ".join(missing) + ") - baby created, fields left blank for manual completion")

        dob = None
        if pn_days is not None:
            dob = exam_date - timedelta(days=pn_days)
        else:
            self.flag(entry_no, label, "DOB estimated from postnatal age - NOT AVAILABLE (postnatal age unparseable/missing), date of birth left blank")

        mtn, airtel, phone_flag = parse_phone(row.get("Contact"))
        if phone_flag:
            self.flag(entry_no, label, phone_flag)
        if mtn or airtel:
            phone = mtn or airtel
            others = self.phone_to_names.get(phone, set())
            if others and caregiver_name not in others:
                self.flag(entry_no, label, f"Possible duplicate (bonus check) - phone {phone} also used under name(s): {', '.join(others)}")
            self.phone_to_names.setdefault(phone, set()).add(caregiver_name)

        baby_notes_parts = []
        contact_raw = clean(row.get("Contact"))
        if phone_flag and contact_raw:
            baby_notes_parts.append(f"Original contact number: {contact_raw}")
        is_twin = twin_slot in ("T", "T1", "T2")
        if is_twin:
            baby_notes_parts.append(f"[register-import: twin_slot={twin_slot}]")

        baby = Baby(
            hospital_id=hospital.id,
            full_name=caregiver_name,
            caregiver_name=caregiver_name,
            date_of_birth=dob,
            sex=sex,
            birth_weight_grams=(float(bwt) if bwt is not None else None),
            gestational_age_weeks=ga_weeks,
            postnatal_age_days=pn_days,
            twins_or_multiple=is_twin,
            mtn_phone=mtn,
            airtel_phone=airtel,
            status=BabyStatus.ACTIVE,
            notes="\n".join(baby_notes_parts) or None,
        )
        self.db.add(baby)
        self.db.flush()

        if hospital.hospital_code:
            baby.rop_id = generate_rop_id(self.db, hospital, exam_date.year)

        self.babies_created += 1
        self.name_twin_map.setdefault((caregiver_name.lower(), twin_slot), []).append(baby)
        print(f"Created baby {baby.rop_id or '(no ID)'} for {label} (entry {entry_no})")
        return baby

    def _create_exam(self, entry_no, label, baby, row, exam_date, pn_days, pca_weeks, notes_raw):
        right_zone, right_stage, right_flag = parse_finding(row.get("RE Findings"))
        left_zone, left_stage, left_flag = parse_finding(row.get("LE Findings"))
        if right_flag:
            self.flag(entry_no, label, f"RE: {right_flag}")
        if left_flag:
            self.flag(entry_no, label, f"LE: {left_flag}")

        exam_notes_parts = []
        followup_raw = clean(row.get("Follow-up"))
        if followup_raw:
            exam_notes_parts.append(f"Follow-up: {followup_raw}")
        if notes_raw:
            exam_notes_parts.append(notes_raw)

        exam = Exam(
            baby_id=baby.id,
            exam_date=exam_date,
            postnatal_age_days=pn_days,
            postmenstrual_age_weeks=(f"{pca_weeks:.1f}" if pca_weeks is not None else None),
            right_zone=right_zone,
            right_stage=right_stage,
            left_zone=left_zone,
            left_stage=left_stage,
            right_raw_finding=clean(row.get("RE Findings")),
            left_raw_finding=clean(row.get("LE Findings")),
            dob_estimated=baby.date_of_birth is not None,  # this import always derives DOB from postnatal age, never records it directly
            notes="\n".join(exam_notes_parts) or None,
        )
        worst_zone, worst_stage, has_plus = derive_worst_finding(exam)
        exam.worst_zone = worst_zone
        exam.worst_stage = worst_stage
        exam.has_plus_disease = "yes" if has_plus else "no"

        self.db.add(exam)
        self.db.flush()
        self.exams_created += 1
        print(f"Added exam for {label} (entry {entry_no})")

        # Mirror record_exam(): close prior open appointments, create exactly one new one.
        open_appts = (
            self.db.query(Appointment)
            .filter(Appointment.baby_id == baby.id, Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.MISSED]))
            .all()
        )
        for a in open_appts:
            a.status = AppointmentStatus.ATTENDED

        due_date = parse_date_ddmmyyyy(row.get("Review Date"))
        if due_date is None:
            due_date = parse_followup_interval(followup_raw, exam_date)

        if due_date is not None:
            appt = Appointment(baby_id=baby.id, exam_id=exam.id, due_date=due_date, status=AppointmentStatus.SCHEDULED, date_source="auto")
            self.db.add(appt)
        else:
            fu_lower = (followup_raw or "").lower()
            status_lower = (clean(row.get("Status")) or "").lower()
            if status_lower == "discharged" or "d/c" in fu_lower:
                baby.status = BabyStatus.DISCHARGED
            else:
                self.flag(entry_no, label, "Review date unclear")
        self.db.flush()


def load_rows(path: str) -> list[dict]:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[SHEET_NAME]
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    rows = []
    for r in range(2, ws.max_row + 1):
        values = [ws.cell(row=r, column=c).value for c in range(1, ws.max_column + 1)]
        row = dict(zip(headers, values))
        if any(v is not None for v in values):
            rows.append(row)
    return rows


def print_report(importer: Importer):
    print("\n" + "=" * 70)
    print("IMPORT SUMMARY")
    print("=" * 70)
    print(f"Babies created:          {importer.babies_created}")
    print(f"Exams imported:          {importer.exams_created}")
    print(f"Reviews matched:         {importer.reviews_matched}")
    print(f"Records flagged:         {len(importer.flags)}")

    print("\n--- FLAGGED ENTRIES ---")
    if not importer.flags:
        print("(none)")
    for entry_no, label, reason in importer.flags:
        print(f"  Entry {entry_no} ({label}): {reason}")

    print("\n--- CRITICAL CASES (from Notes column) ---")
    if not importer.critical:
        print("(none)")
    for entry_no, label, note in importer.critical:
        print(f"  *** Entry {entry_no} - {label}: {note}")

    print("\n--- SAMPLE: imputed DOB and calculated PCA (first 5 with data) ---")
    for s in importer.sample_rows:
        print(
            f"  Entry {s['entry_no']} ({s['label']}): exam_date={s['exam_date']}, "
            f"PN Age raw='{s['pn_age_raw']}' -> DOB={s['dob']}, "
            f"GA={s['ga_weeks']}w + PN={s['pn_weeks']}w -> PCA={s['pca_weeks']}w"
        )
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=DEFAULT_FILE)
    parser.add_argument("--commit", action="store_true", help="Actually write to the database (default is dry-run)")
    args = parser.parse_args()

    print(f"Reading '{args.file}' [{SHEET_NAME}]...")
    rows = load_rows(args.file)
    print(f"Loaded {len(rows)} data rows.\n")
    print(f"Mode: {'COMMIT (writing to database)' if args.commit else 'DRY RUN (no database writes)'}\n")

    db = SessionLocal()
    try:
        importer = Importer(db, commit=args.commit)
        for row in rows:
            importer.process_row(row)

        print_report(importer)

        if args.commit:
            db.commit()
            print("\nCommitted to database.")
        else:
            db.rollback()
            print("\nDry run complete - no changes were written. Re-run with --commit to write.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
