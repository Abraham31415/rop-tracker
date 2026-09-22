"""
Reset the password of the known demo/seed accounts to rop2024, on whichever
database DATABASE_URL points at.

seed.py only *creates* missing users and never updates existing ones, so a
database that was already seeded before rop2024 became the standard demo
password (see backend/seed.py, supabase_migration.sql) is stuck with its
original password on these accounts until something updates them directly.
This script is that update, intentionally scoped to only the exact demo
emails below - it will never touch a real hospital staff account, even if
one happens to be on the same database.

Run against a deployed database by overriding DATABASE_URL for the
invocation - it is read fresh from the environment, never edited in .env:

    # dry run (default) - shows what would change, writes nothing
    DATABASE_URL=<deployed-database-url> python scripts/reset_demo_passwords.py

    # actually write
    DATABASE_URL=<deployed-database-url> python scripts/reset_demo_passwords.py --commit

Never paste the DATABASE_URL anywhere other than your own shell - it carries
production database credentials.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.user import User
from app.auth.jwt import hash_password, verify_password

DEMO_PASSWORD = "rop2024"

# Exact allow-list, mirrors backend/seed.py's users_data - never widen this to
# a pattern match (e.g. "@rop.ug"), since a real hospital account could use
# the same domain.
DEMO_EMAILS = [
    "central@rop.ug",
    "coordinator.mulago@rop.ug",
    "coordinator.kiruddu@rop.ug",
    "coordinator.mbarara@rop.ug",
    "coordinator.gulu@rop.ug",
    "coordinator.lacor@rop.ug",
    "coordinator.mbale@rop.ug",
    "ophth.mulago@rop.ug",
    "ophth.mbarara@rop.ug",
    "nurse.mulago@rop.ug",
    "nurse.kiruddu@rop.ug",
    "nurse.mbarara@rop.ug",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--commit", action="store_true", help="Actually write to the database (default is dry-run)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        already_correct, changed, missing = [], [], []

        for email in DEMO_EMAILS:
            user = db.query(User).filter(User.email == email).first()
            if not user:
                missing.append(email)
                continue
            if verify_password(DEMO_PASSWORD, user.hashed_password):
                already_correct.append(email)
                continue
            changed.append(email)
            if args.commit:
                user.hashed_password = hash_password(DEMO_PASSWORD)

        if args.commit:
            db.commit()

        print(f"Mode: {'COMMIT (wrote to database)' if args.commit else 'DRY RUN (no changes written)'}\n")
        print(f"Already {DEMO_PASSWORD!r}: {len(already_correct)}")
        for e in already_correct:
            print(f"  {e}")
        print(f"\n{'Updated' if args.commit else 'Would update'}: {len(changed)}")
        for e in changed:
            print(f"  {e}")
        if missing:
            print(f"\nNot found in this database ({len(missing)}) - not created, seed.py handles creation:")
            for e in missing:
                print(f"  {e}")

        if not args.commit and changed:
            print(f"\nRe-run with --commit to actually reset {len(changed)} account(s) to {DEMO_PASSWORD!r}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
