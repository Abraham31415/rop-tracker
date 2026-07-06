"""preserve raw eye-finding text and whether a baby's DOB was estimated

Revision ID: 0012
Revises: 0011

Adds columns needed by the historical register bulk import: the exact original
RE/LE finding text (kept alongside any structured zone/stage parsed from it),
and a flag marking exams whose baby's date_of_birth was imputed from postnatal
age rather than recorded directly.
"""
from alembic import op
import sqlalchemy as sa

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing = {c['name'] for c in insp.get_columns('exams')}

    if 'right_raw_finding' not in existing:
        op.add_column('exams', sa.Column('right_raw_finding', sa.Text(), nullable=True))
    if 'left_raw_finding' not in existing:
        op.add_column('exams', sa.Column('left_raw_finding', sa.Text(), nullable=True))
    if 'dob_estimated' not in existing:
        op.add_column('exams', sa.Column('dob_estimated', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    for col in ['dob_estimated', 'left_raw_finding', 'right_raw_finding']:
        op.drop_column('exams', col)
