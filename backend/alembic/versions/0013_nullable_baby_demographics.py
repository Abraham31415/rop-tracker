"""allow babies to be enrolled with incomplete birth demographics

Revision ID: 0013
Revises: 0012

The historical register import (and, going forward, real paper-register data entry) can
have a baby's sex/DOB/gestational age/birth weight arrive after enrollment rather than at
it. These columns become nullable, matching how the rest of the schema already represents
"unknown" clinical values (e.g. Exam.right_zone/right_stage). No existing rows are affected
since they were all already NOT NULL and remain populated.
"""
from alembic import op
import sqlalchemy as sa

revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('babies', 'sex', nullable=True)
    op.alter_column('babies', 'date_of_birth', nullable=True)
    op.alter_column('babies', 'gestational_age_weeks', nullable=True)
    op.alter_column('babies', 'birth_weight_grams', nullable=True)


def downgrade():
    op.alter_column('babies', 'birth_weight_grams', nullable=False)
    op.alter_column('babies', 'gestational_age_weeks', nullable=False)
    op.alter_column('babies', 'date_of_birth', nullable=False)
    op.alter_column('babies', 'sex', nullable=False)
