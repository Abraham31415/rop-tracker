"""backfill rop_ids for existing babies

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Assign ROP IDs to all existing babies that don't have one yet,
    # ordered by enrolled_at within each (hospital, year) group.
    conn.execute(sa.text("""
        WITH ranked AS (
            SELECT
                b.id,
                h.hospital_code,
                EXTRACT(YEAR FROM b.enrolled_at)::int AS yr,
                ROW_NUMBER() OVER (
                    PARTITION BY b.hospital_id, EXTRACT(YEAR FROM b.enrolled_at)
                    ORDER BY b.enrolled_at, b.id
                ) AS seq
            FROM babies b
            JOIN hospitals h ON h.id = b.hospital_id
            WHERE b.rop_id IS NULL
              AND h.hospital_code IS NOT NULL
        )
        UPDATE babies b
        SET rop_id = r.hospital_code
                  || '-'
                  || RIGHT(r.yr::text, 2)
                  || '-'
                  || LPAD(r.seq::text, 5, '0')
        FROM ranked r
        WHERE b.id = r.id
    """))


def downgrade():
    # Clear backfilled IDs — only safe if you know which were backfilled;
    # in practice just leave them.
    pass
