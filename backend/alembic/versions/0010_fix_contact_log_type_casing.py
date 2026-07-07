"""fix contact_log_type enum casing to match app convention

Revision ID: 0010
Revises: 0009

The contact_log_type enum was created in 0003 with lowercase labels
(e.g. 'caregiver_edit'), but every other enum in this schema — and the
SQLAlchemy Column(Enum(..., values_callable=lambda x: [e.name for e in x]))
convention used throughout app/models — stores the Python enum's
UPPERCASE member name. This mismatch made any write of
ContactLogType.CAREGIVER_EDIT (and friends) fail with
"invalid input value for enum contact_log_type".

The underlying Postgres enum type's name isn't assumed to be literally
"contact_log_type": some environments have it as SQLAlchemy's
auto-derived "contactlogtype" (no underscore) instead, depending on how
the table was originally created. This looks up the real type name from
the column itself rather than hardcoding it, so it works either way.
"""
from alembic import op

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None

_RENAMES = [
    ('sms', 'SMS'),
    ('phone_call', 'PHONE_CALL'),
    ('caregiver_edit', 'CAREGIVER_EDIT'),
    ('screening_request', 'SCREENING_REQUEST'),
    ('note', 'NOTE'),
]


def _enum_type_name():
    conn = op.get_bind()
    result = conn.exec_driver_sql(
        "SELECT udt_name FROM information_schema.columns "
        "WHERE table_name = 'contact_logs' AND column_name = 'log_type'"
    ).scalar()
    if not result:
        raise RuntimeError("Could not find contact_logs.log_type column to determine its enum type name")
    return result


def _existing_labels(type_name):
    conn = op.get_bind()
    rows = conn.exec_driver_sql(
        "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = %(name)s",
        {"name": type_name},
    ).fetchall()
    return {r[0] for r in rows}


def upgrade():
    type_name = _enum_type_name()
    labels = _existing_labels(type_name)
    for old, new in _RENAMES:
        # Some environments' tables were seeded with the uppercase labels already
        # (e.g. via a direct create_all() using the current model), so there's
        # nothing to rename there - only touch labels that are still lowercase.
        if old in labels:
            op.execute(f'ALTER TYPE "{type_name}" RENAME VALUE \'{old}\' TO \'{new}\'')


def downgrade():
    type_name = _enum_type_name()
    labels = _existing_labels(type_name)
    for old, new in _RENAMES:
        if new in labels:
            op.execute(f'ALTER TYPE "{type_name}" RENAME VALUE \'{new}\' TO \'{old}\'')
