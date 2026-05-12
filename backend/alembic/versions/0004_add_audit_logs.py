"""Add audit_logs table.

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-12 00:00:00.000000
"""
from __future__ import annotations
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_name", sa.String(), nullable=False),
        sa.Column("user_role", sa.String(), nullable=False),
        sa.Column("action_type", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.String(), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=True),
        sa.Column("ip_address", sa.String(), nullable=True),
        if_not_exists=True,
    )
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"], if_not_exists=True)
    op.create_index("ix_audit_logs_entity_type", "audit_logs", ["entity_type"], if_not_exists=True)
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_table("audit_logs")
