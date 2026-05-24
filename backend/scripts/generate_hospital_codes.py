"""
Auto-generate 3-letter hospital codes for hospitals that have none.

Run from the backend directory:
    python scripts/generate_hospital_codes.py

Prints a review table first and asks for confirmation before writing.
"""
from __future__ import annotations
import sys
import os
import re
from itertools import combinations

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.hospital import Hospital


# ── Stop-words ignored when building initials ─────────────────────────────────
SKIP_WORDS = frozenset({
    'of', 'the', 'and', 'a', 'an', 'in', 'at', 'for', 'to', 'by',
})

# Words that carry little location information — deprioritised for fallbacks
GENERIC_WORDS = frozenset({
    'GENERAL', 'REGIONAL', 'REFERRAL', 'HOSPITAL', 'HEALTH',
    'CENTRE', 'CENTER', 'COMMUNITY', 'MEDICAL', 'NATIONAL', 'DISTRICT',
})

VOWELS = frozenset('AEIOU')


def _normalize(name: str) -> str:
    """Remove punctuation and collapse whitespace."""
    return re.sub(r'[^\w\s]', ' ', name).strip()


def _significant_words(name: str) -> list[str]:
    """Return uppercase significant words (stop-words removed)."""
    return [
        w.upper()
        for w in _normalize(name).split()
        if w.lower() not in SKIP_WORDS and w
    ]


def _suggest_primary(name: str) -> str:
    """
    Primary suggestion: first letter of each significant word (up to 3).
    E.g. 'Bundibugyo General Hospital' -> BGH
    """
    words = _significant_words(name)
    letters = [w[0] for w in words if w]
    if len(letters) >= 3:
        return ''.join(letters[:3])
    # Pad to 3 using subsequent letters of the first word
    code = ''.join(letters)
    if words:
        first = words[0]
        i = 1
        while len(code) < 3 and i < len(first):
            code += first[i]
            i += 1
    return code[:3].upper()


def _all_candidates(name: str) -> list[str]:
    """
    Return candidate codes in priority order (no duplicates, all unique to try).
    """
    words = _significant_words(name)
    if not words:
        return []

    seen: set[str] = set()
    out: list[str] = []

    def add(c: str) -> None:
        c = c.upper()
        if len(c) == 3 and c.isalpha() and c not in seen:
            seen.add(c)
            out.append(c)

    # Strategy 1 — initials of first 3 significant words
    add(_suggest_primary(name))

    # Strategy 2 — all combinations of 3 from any word's initial letter
    initials = [w[0] for w in words]
    for i, j, k in combinations(range(len(initials)), 3):
        add(initials[i] + initials[j] + initials[k])

    # Strategy 3 — first 2 letters of first word + initial of each other word
    if words:
        prefix = words[0][:2]
        for w in words[1:]:
            add(prefix + w[0])

    # Strategy 4 — first letter + first 2 consonants of each location word
    location_words = [w for w in words if w not in GENERIC_WORDS] or words
    for lw in location_words:
        consonants = [c for c in lw[1:] if c not in VOWELS]
        for i in range(len(consonants)):
            for j in range(i + 1, len(consonants)):
                add(lw[0] + consonants[i] + consonants[j])

    # Strategy 5 — first 3 letters of the first location word
    if location_words:
        add(location_words[0][:3])

    # Strategy 6 — brute-force over all letters actually in the name
    all_letters = ''.join(dict.fromkeys(''.join(words)))  # unique, order-preserving
    for i in range(len(all_letters)):
        for j in range(len(all_letters)):
            for k in range(len(all_letters)):
                if i != j and j != k and i != k:
                    add(all_letters[i] + all_letters[j] + all_letters[k])

    return out


def generate_code(name: str, taken: set[str]) -> str:
    """
    Pick the first candidate not already in `taken`.
    Raises ValueError if all candidates are exhausted (extremely unlikely).
    """
    for c in _all_candidates(name):
        if c not in taken:
            return c
    raise ValueError(f"Could not generate a unique code for: {name!r}")


# ── Pretty table helpers ──────────────────────────────────────────────────────

def _col(s: str, w: int) -> str:
    return str(s)[:w].ljust(w)


def _print_table(rows: list[tuple[str, str | None, str, str]]) -> None:
    """rows: (name, old_code, new_code, strategy_note)"""
    hdr = f"  {'Hospital name':<45}  {'Old':>5}  {'New':>5}  {'Note'}"
    print(hdr)
    print("  " + "-" * (len(hdr) - 2))
    for name, old, new, note in rows:
        old_s = old if old else "-"
        print(f"  {_col(name, 45)}  {old_s:>5}  {new:>5}  {note}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    db = SessionLocal()
    try:
        all_hospitals: list[Hospital] = db.query(Hospital).order_by(Hospital.name).all()

        # Build set of codes already in use
        taken: set[str] = {
            h.hospital_code.upper()
            for h in all_hospitals
            if h.hospital_code
        }

        # Find hospitals without a code
        need_code = [h for h in all_hospitals if not h.hospital_code]

        if not need_code:
            print("All hospitals already have codes. Nothing to do.")
            return

        print(f"\n{len(need_code)} hospital(s) without a code (out of {len(all_hospitals)} total).\n")

        # Generate codes
        assignments: list[tuple[Hospital, str]] = []
        rows_for_review: list[tuple[str, str | None, str, str]] = []

        for h in need_code:
            code = generate_code(h.name, taken)
            taken.add(code)
            assignments.append((h, code))
            note = "generated"
            rows_for_review.append((h.name, h.hospital_code, code, note))

        # Print review table
        print("Proposed code assignments:")
        print()
        _print_table(rows_for_review)

        # Also show hospitals that already have codes for context
        existing_rows = [
            (h.name, h.hospital_code, h.hospital_code or "-", "already set")
            for h in all_hospitals
            if h.hospital_code
        ]
        if existing_rows:
            print()
            print(f"  ({len(existing_rows)} hospitals already have codes and will not be changed)")

        # Confirm
        print()
        answer = input(
            f"Save these {len(assignments)} code(s) to the database? [yes/no]: "
        ).strip().lower()

        if answer not in ("yes", "y"):
            print("Aborted. No changes written.")
            return

        # Apply
        for h, code in assignments:
            h.hospital_code = code

        db.commit()
        print(f"\nDone. {len(assignments)} hospital(s) updated.")

    except Exception as exc:
        db.rollback()
        print(f"\nError: {exc}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
