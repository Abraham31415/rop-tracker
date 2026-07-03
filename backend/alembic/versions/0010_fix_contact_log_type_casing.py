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


def upgrade():
    for old, new in _RENAMES:
        op.execute(f"ALTER TYPE contact_log_type RENAME VALUE '{old}' TO '{new}'")


def downgrade():
    for old, new in _RENAMES:
        op.execute(f"ALTER TYPE contact_log_type RENAME VALUE '{new}' TO '{old}'")
