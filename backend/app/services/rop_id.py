"""
ROP Tracker ID generation service.

Format: [HOSPITAL_CODE]-[YY]-[NNNNN]
  e.g.  MNR-26-00001

Rules:
  - HOSPITAL_CODE  : 3-letter code set on the Hospital record
  - YY             : last 2 digits of the enrollment year
  - NNNNN          : zero-padded sequence, resets to 00001 each year per hospital
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.hospital import Hospital


def generate_rop_id(db: Session, hospital: Hospital, year: int) -> str:
    """Return the next available ROP ID for *hospital* in *year*.

    Raises ValueError if the hospital has no code assigned yet.
    """
    from app.models.baby import Baby  # local import avoids circular dependency

    if not hospital.hospital_code:
        raise ValueError(
            f"Hospital '{hospital.name}' has no hospital code assigned. "
            "Please set a 3-letter code in the admin panel before enrolling babies."
        )

    code = hospital.hospital_code.upper()
    yy   = str(year)[-2:]
    prefix = f"{code}-{yy}-"

    # Find the highest existing sequence for this hospital in this year.
    # Zero-padded 5-digit strings order correctly under lexicographic sort.
    last = (
        db.query(Baby.rop_id)
        .filter(
            Baby.hospital_id == hospital.id,
            Baby.rop_id.like(f"{prefix}%"),
        )
        .order_by(Baby.rop_id.desc())
        .first()
    )

    if last and last[0]:
        try:
            seq = int(last[0].split("-")[2]) + 1
        except (IndexError, ValueError):
            seq = 1
    else:
        seq = 1

    return f"{code}-{yy}-{seq:05d}"
