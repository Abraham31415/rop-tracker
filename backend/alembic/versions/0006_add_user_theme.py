"""add user theme preference

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    # Idempotent: only add the column if it does not already exist
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'users' AND column_name = 'theme'"
    )).scalar()
    if not exists:
        op.add_column(
            'users',
            sa.Column('theme', sa.String(), nullable=False, server_default='system'),
        )


def downgrade():
    op.drop_column('users', 'theme')
