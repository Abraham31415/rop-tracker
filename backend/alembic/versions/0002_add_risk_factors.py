"""Add extended risk factor columns to babies table.

Revision ID: 0002
Revises: 0001
Create Date: 2025-01-02 00:00:00.000000
"""
from __future__ import annotations
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_COLUMNS = [
    "mechanical_ventilation",
    "surfactant_therapy",
    "apnoea",
    "nec",
    "twins_or_multiple",
    "phototherapy",
]


def upgrade() -> None:
    for col in NEW_COLUMNS:
        op.add_column("babies", sa.Column(col, sa.Boolean(), nullable=True, server_default="false"))


def downgrade() -> None:
    for col in reversed(NEW_COLUMNS):
        op.drop_column("babies", col)
