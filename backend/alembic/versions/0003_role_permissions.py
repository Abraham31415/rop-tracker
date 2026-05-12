"""Add dilation status, contact_logs, and screening_requests tables.

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-12 00:00:00.000000

New in this migration:
  - dilation_status enum type
  - contact_log_type enum type
  - screening_request_status enum type
  - babies.dilation_status / dilation_updated_at / dilation_updated_by_id columns
  - contact_logs table
  - screening_requests table
"""
from __future__ import annotations
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── New enum types (idempotent via DO block) ───────────────────────────────
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE dilation_status AS ENUM ('dilated', 'not_dilated', 'dilation_refused');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE contact_log_type AS ENUM ('sms', 'phone_call', 'caregiver_edit', 'screening_request', 'note');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE screening_request_status AS ENUM ('pending', 'claimed', 'completed', 'escalated');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    # ── Dilation columns on babies (IF NOT EXISTS) ────────────────────────────
    op.execute("""
        ALTER TABLE babies
            ADD COLUMN IF NOT EXISTS dilation_status dilation_status,
            ADD COLUMN IF NOT EXISTS dilation_updated_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS dilation_updated_by_id UUID REFERENCES users(id)
    """)

    # ── contact_logs table ────────────────────────────────────────────────────
    op.create_table(
        "contact_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("baby_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("babies.id"), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("log_type", postgresql.ENUM(name="contact_log_type", create_type=False), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("field_name", sa.String(), nullable=True),
        sa.Column("old_value", sa.String(), nullable=True),
        sa.Column("new_value", sa.String(), nullable=True),
        if_not_exists=True,
    )
    op.create_index("ix_contact_logs_baby_id", "contact_logs", ["baby_id"], if_not_exists=True)

    # ── screening_requests table ──────────────────────────────────────────────
    op.create_table(
        "screening_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("baby_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("babies.id"), nullable=False),
        sa.Column("hospital_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hospitals.id"), nullable=False),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("claimed_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", postgresql.ENUM(name="screening_request_status", create_type=False),
                  nullable=False, server_default="pending"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True),
        if_not_exists=True,
    )
    op.create_index("ix_screening_requests_baby_id", "screening_requests", ["baby_id"], if_not_exists=True)
    op.create_index("ix_screening_requests_hospital_id", "screening_requests", ["hospital_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_table("screening_requests")
    op.drop_table("contact_logs")

    op.drop_column("babies", "dilation_updated_by_id")
    op.drop_column("babies", "dilation_updated_at")
    op.drop_column("babies", "dilation_status")

    op.execute("DROP TYPE IF EXISTS screening_request_status")
    op.execute("DROP TYPE IF EXISTS contact_log_type")
    op.execute("DROP TYPE IF EXISTS dilation_status")
