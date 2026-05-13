"""Add type, physical_address, contact_phone to hospitals table.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-12
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Add hospital_type
    has_type = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='hospitals' AND column_name='hospital_type'"
    )).fetchone()
    if not has_type:
        op.add_column('hospitals', sa.Column('hospital_type', sa.String(), nullable=True))

    # Add physical_address
    has_addr = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='hospitals' AND column_name='physical_address'"
    )).fetchone()
    if not has_addr:
        op.add_column('hospitals', sa.Column('physical_address', sa.String(), nullable=True))

    # Add contact_phone
    has_phone = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='hospitals' AND column_name='contact_phone'"
    )).fetchone()
    if not has_phone:
        op.add_column('hospitals', sa.Column('contact_phone', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('hospitals', 'contact_phone')
    op.drop_column('hospitals', 'physical_address')
    op.drop_column('hospitals', 'hospital_type')
