"""add anterior segment and retinal vessel fields to exams

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing = {c['name'] for c in insp.get_columns('exams')}

    def add_bool(col):
        if col not in existing:
            op.add_column('exams', sa.Column(col, sa.Boolean(), nullable=True))

    def add_str(col, length=200):
        if col not in existing:
            op.add_column('exams', sa.Column(col, sa.String(length), nullable=True))

    # Anterior segment — boolean per eye
    add_bool('ant_right_active_iris')
    add_bool('ant_left_active_iris')
    add_bool('ant_right_tvl')
    add_bool('ant_left_tvl')
    add_bool('ant_right_rigid_pupil')
    add_bool('ant_left_rigid_pupil')
    add_bool('ant_right_others')
    add_bool('ant_left_others')
    add_str('ant_right_others_specify')
    add_str('ant_left_others_specify')

    # Retinal vessel maturity
    add_str('rv_right', 20)
    add_str('rv_left', 20)


def downgrade():
    for col in [
        'ant_right_active_iris', 'ant_left_active_iris',
        'ant_right_tvl', 'ant_left_tvl',
        'ant_right_rigid_pupil', 'ant_left_rigid_pupil',
        'ant_right_others', 'ant_left_others',
        'ant_right_others_specify', 'ant_left_others_specify',
        'rv_right', 'rv_left',
    ]:
        op.drop_column('exams', col)
