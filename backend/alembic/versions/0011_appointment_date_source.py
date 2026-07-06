"""track whether an appointment's review date was auto-scheduled or manually set

Revision ID: 0011
Revises: 0010

Adds columns so a manually overridden next-review date is distinguishable from an
auto-scheduled one, and records who changed it, when, and why. Existing rows are
backfilled to 'auto' since every date so far was computed by the scheduler.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing = {c['name'] for c in insp.get_columns('appointments')}

    if 'date_source' not in existing:
        op.add_column('appointments', sa.Column('date_source', sa.String(), nullable=False, server_default='auto'))
    if 'date_change_reason' not in existing:
        op.add_column('appointments', sa.Column('date_change_reason', sa.Text(), nullable=True))
    if 'date_changed_at' not in existing:
        op.add_column('appointments', sa.Column('date_changed_at', sa.DateTime(timezone=True), nullable=True))
    if 'date_changed_by_id' not in existing:
        op.add_column(
            'appointments',
            sa.Column('date_changed_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        )

    # Backfill any pre-existing rows explicitly (server_default covers new inserts).
    op.execute("UPDATE appointments SET date_source = 'auto' WHERE date_source IS NULL")


def downgrade():
    for col in ['date_changed_by_id', 'date_changed_at', 'date_change_reason', 'date_source']:
        op.drop_column('appointments', col)
