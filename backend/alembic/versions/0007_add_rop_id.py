"""add hospital_code and rop_id

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None

# Hospital codes to seed for the named hospitals
HOSPITAL_CODES = {
    "Mulago National Referral Hospital":      "MNR",
    "Kawempe National Referral Hospital":     "KNR",
    "Kiruddu National Referral Hospital":     "KDR",
    "Mbarara Regional Referral Hospital":     "MBR",
    "Gulu Regional Referral Hospital":        "GRR",
    "Fort Portal Regional Referral Hospital": "FPR",
    "Jinja Regional Referral Hospital":       "JRR",
    "Soroti Regional Referral Hospital":      "SRR",
    "Arua Regional Referral Hospital":        "ARR",
    "Lira Regional Referral Hospital":        "LRR",
    "Masaka Regional Referral Hospital":      "MKR",
    "Kabale Regional Referral Hospital":      "KBR",
    "Moroto Regional Referral Hospital":      "MTR",
    "Hoima Regional Referral Hospital":       "HRR",
}


def upgrade():
    conn = op.get_bind()

    # ── hospitals.hospital_code ───────────────────────────────────────────────
    col_exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'hospitals' AND column_name = 'hospital_code'"
    )).scalar()
    if not col_exists:
        op.add_column('hospitals', sa.Column('hospital_code', sa.String(3), nullable=True))
        op.create_unique_constraint('uq_hospitals_hospital_code', 'hospitals', ['hospital_code'])

    # Seed known codes (idempotent — only sets rows that still have NULL)
    for name, code in HOSPITAL_CODES.items():
        conn.execute(sa.text(
            "UPDATE hospitals SET hospital_code = :code "
            "WHERE name = :name AND hospital_code IS NULL"
        ).bindparams(code=code, name=name))

    # ── babies.rop_id ─────────────────────────────────────────────────────────
    col_exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'babies' AND column_name = 'rop_id'"
    )).scalar()
    if not col_exists:
        op.add_column('babies', sa.Column('rop_id', sa.String(20), nullable=True))
        op.create_unique_constraint('uq_babies_rop_id', 'babies', ['rop_id'])


def downgrade():
    op.drop_constraint('uq_babies_rop_id', 'babies', type_='unique')
    op.drop_column('babies', 'rop_id')
    op.drop_constraint('uq_hospitals_hospital_code', 'hospitals', type_='unique')
    op.drop_column('hospitals', 'hospital_code')
