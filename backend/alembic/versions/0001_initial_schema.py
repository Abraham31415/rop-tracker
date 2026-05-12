"""Initial schema — all tables and enum types.

Revision ID: 0001
Revises:
Create Date: 2025-01-01 00:00:00.000000

For an existing deployment whose schema was created by create_all() + the old
_migrate_enums() / _migrate_visual_function() calls, stamp this revision as
already applied without running upgrade():

    alembic stamp 0001

For a fresh deployment, run normally:

    alembic upgrade head
"""
from __future__ import annotations
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Helper — create a named PostgreSQL enum type
# ---------------------------------------------------------------------------

def _create_enum(name: str, *values: str) -> None:
    vals = ", ".join(f"'{v}'" for v in values)
    op.execute(f"CREATE TYPE {name} AS ENUM ({vals})")


def _drop_enum(name: str) -> None:
    op.execute(f"DROP TYPE IF EXISTS {name}")


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    # ── Enum types ──────────────────────────────────────────────────────────
    _create_enum("userrole", "nicu_nurse", "ophthalmologist", "hospital_coordinator", "central_coordinator")
    _create_enum("sex", "male", "female")
    _create_enum("language", "english", "luganda", "runyankole", "acholi", "ateso")
    _create_enum("babystatus", "active", "discharged", "ltfu", "treated")
    _create_enum("zone", "zone_i", "zone_ii", "zone_iii")
    _create_enum("stage", "no_rop", "stage_1", "stage_2", "stage_3", "stage_4", "stage_5", "immature")
    _create_enum("plusdisease", "none", "pre_plus", "plus")
    _create_enum("vffixation", "central", "eccentric", "none_unable")
    _create_enum("vffollowing", "follows_smoothly", "follows_partially", "does_not_follow", "unable_to_assess")
    _create_enum("vfcsm", "csm", "cs", "c", "not_central", "unable_to_assess")
    _create_enum("nystagmus", "absent", "pendular", "jerk", "latent")
    _create_enum("strabismus", "absent", "esotropia", "exotropia", "suspected")
    _create_enum("vffunctionalimpression", "age_appropriate", "mildly_delayed", "significantly_delayed", "unable_to_assess")
    _create_enum("appointmentstatus", "scheduled", "attended", "missed", "ltfu")
    _create_enum("remindertype", "sms", "whatsapp", "in_app", "phone_call")
    _create_enum("remindertrigger", "t_minus_3", "t_minus_1", "day_of", "ltfu_48h", "manual_call")
    _create_enum("reminderstatus", "pending", "sent", "failed", "acknowledged")
    _create_enum("alerttype", "ltfu_flagged")
    _create_enum("treatmenttype", "none", "laser", "anti_vegf", "surgery", "combination")
    _create_enum("treatmenteye", "right", "left", "both")
    _create_enum("visualoutcome", "good_vision", "mild_impairment", "severe_impairment", "blind", "too_young", "ltfu_before_outcome")
    _create_enum("dischargestatus", "completed_no_rop", "completed_treated", "referred_national", "referred_abroad", "died", "lost", "ongoing")
    _create_enum("referralreason", "laser_not_available", "surgery_needed", "second_opinion", "other")
    _create_enum("referralstatus", "pending", "arrived_treated", "did_not_arrive", "unknown")

    # ── hospitals ────────────────────────────────────────────────────────────
    op.create_table(
        "hospitals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("district", sa.String(), nullable=False),
        sa.Column("region", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # ── users ────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("role", postgresql.ENUM(name="userrole", create_type=False), nullable=False),
        sa.Column("hospital_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hospitals.id"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # ── babies ───────────────────────────────────────────────────────────────
    op.create_table(
        "babies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("hospital_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hospitals.id"), nullable=False),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=False),
        sa.Column("sex", postgresql.ENUM(name="sex", create_type=False), nullable=False),
        sa.Column("birth_weight_grams", sa.Float(), nullable=False),
        sa.Column("gestational_age_weeks", sa.Float(), nullable=False),
        sa.Column("postnatal_age_days", sa.Integer(), nullable=True),
        sa.Column("oxygen_therapy", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("blood_transfusion", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("sepsis", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("inotropes", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("anaemia", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("caregiver_name", sa.String(), nullable=False),
        sa.Column("mtn_phone", sa.String(), nullable=True),
        sa.Column("airtel_phone", sa.String(), nullable=True),
        sa.Column("language_preference", postgresql.ENUM(name="language", create_type=False), nullable=True),
        sa.Column("status", postgresql.ENUM(name="babystatus", create_type=False), nullable=True, server_default="'active'"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("enrolled_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── exams ────────────────────────────────────────────────────────────────
    op.create_table(
        "exams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("baby_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("babies.id"), nullable=False),
        sa.Column("examiner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("exam_date", sa.Date(), nullable=False),
        sa.Column("postnatal_age_days", sa.Integer(), nullable=True),
        sa.Column("postmenstrual_age_weeks", sa.String(), nullable=True),
        sa.Column("right_zone", postgresql.ENUM(name="zone", create_type=False), nullable=True),
        sa.Column("right_stage", postgresql.ENUM(name="stage", create_type=False), nullable=True),
        sa.Column("right_plus", postgresql.ENUM(name="plusdisease", create_type=False), nullable=True),
        sa.Column("left_zone", postgresql.ENUM(name="zone", create_type=False), nullable=True),
        sa.Column("left_stage", postgresql.ENUM(name="stage", create_type=False), nullable=True),
        sa.Column("left_plus", postgresql.ENUM(name="plusdisease", create_type=False), nullable=True),
        sa.Column("worst_zone", postgresql.ENUM(name="zone", create_type=False), nullable=True),
        sa.Column("worst_stage", postgresql.ENUM(name="stage", create_type=False), nullable=True),
        sa.Column("has_plus_disease", sa.String(), nullable=True),
        sa.Column("next_exam_weeks", sa.Integer(), nullable=True),
        sa.Column("treatment_recommended", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        # Visual Function columns
        sa.Column("vf_right_fixation", postgresql.ENUM(name="vffixation", create_type=False), nullable=True),
        sa.Column("vf_right_following", postgresql.ENUM(name="vffollowing", create_type=False), nullable=True),
        sa.Column("vf_right_csm", postgresql.ENUM(name="vfcsm", create_type=False), nullable=True),
        sa.Column("vf_right_teller_acuity", sa.Float(), nullable=True),
        sa.Column("vf_right_vep", sa.Float(), nullable=True),
        sa.Column("vf_left_fixation", postgresql.ENUM(name="vffixation", create_type=False), nullable=True),
        sa.Column("vf_left_following", postgresql.ENUM(name="vffollowing", create_type=False), nullable=True),
        sa.Column("vf_left_csm", postgresql.ENUM(name="vfcsm", create_type=False), nullable=True),
        sa.Column("vf_left_teller_acuity", sa.Float(), nullable=True),
        sa.Column("vf_left_vep", sa.Float(), nullable=True),
        sa.Column("vf_nystagmus", postgresql.ENUM(name="nystagmus", create_type=False), nullable=True),
        sa.Column("vf_strabismus", postgresql.ENUM(name="strabismus", create_type=False), nullable=True),
        sa.Column("vf_functional_impression", postgresql.ENUM(name="vffunctionalimpression", create_type=False), nullable=True),
        sa.Column("vf_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # ── appointments ─────────────────────────────────────────────────────────
    op.create_table(
        "appointments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("baby_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("babies.id"), nullable=False),
        sa.Column("exam_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("exams.id"), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("status", postgresql.ENUM(name="appointmentstatus", create_type=False), nullable=True, server_default="'scheduled'"),
        sa.Column("attended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("missed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ltfu_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("coordinator_alerted", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # ── reminders ────────────────────────────────────────────────────────────
    op.create_table(
        "reminders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("baby_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("babies.id"), nullable=False),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("appointments.id"), nullable=False),
        sa.Column("reminder_type", postgresql.ENUM(name="remindertype", create_type=False), nullable=False),
        sa.Column("trigger", postgresql.ENUM(name="remindertrigger", create_type=False), nullable=False),
        sa.Column("language", sa.String(), nullable=False, server_default="'english'"),
        sa.Column("recipient_phone", sa.String(), nullable=True),
        sa.Column("message_body", sa.Text(), nullable=True),
        sa.Column("status", postgresql.ENUM(name="reminderstatus", create_type=False), nullable=True, server_default="'pending'"),
        sa.Column("provider_message_id", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # ── alerts ───────────────────────────────────────────────────────────────
    op.create_table(
        "alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("hospital_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hospitals.id"), nullable=False),
        sa.Column("baby_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("babies.id"), nullable=False),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("appointments.id"), nullable=True),
        sa.Column("alert_type", postgresql.ENUM(name="alerttype", create_type=False), nullable=False, server_default="'ltfu_flagged'"),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("is_dismissed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # ── outcomes ─────────────────────────────────────────────────────────────
    op.create_table(
        "outcomes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("baby_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("babies.id"), unique=True, nullable=False),
        sa.Column("treatment_type", postgresql.ENUM(name="treatmenttype", create_type=False), nullable=True),
        sa.Column("treatment_eye", postgresql.ENUM(name="treatmenteye", create_type=False), nullable=True),
        sa.Column("treatment_date", sa.Date(), nullable=True),
        sa.Column("treatment_hospital_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hospitals.id"), nullable=True),
        sa.Column("treating_ophthalmologist", sa.String(), nullable=True),
        sa.Column("visual_outcome", postgresql.ENUM(name="visualoutcome", create_type=False), nullable=True),
        sa.Column("discharge_status", postgresql.ENUM(name="dischargestatus", create_type=False), nullable=True),
        sa.Column("discharge_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── referrals ────────────────────────────────────────────────────────────
    op.create_table(
        "referrals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("baby_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("babies.id"), nullable=False),
        sa.Column("from_hospital_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hospitals.id"), nullable=True),
        sa.Column("to_hospital_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hospitals.id"), nullable=True),
        sa.Column("to_external", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("reason", postgresql.ENUM(name="referralreason", create_type=False), nullable=False),
        sa.Column("referral_date", sa.Date(), nullable=False),
        sa.Column("status", postgresql.ENUM(name="referralstatus", create_type=False), nullable=True, server_default="'pending'"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


# ---------------------------------------------------------------------------
# downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:
    # Drop tables in reverse dependency order
    op.drop_table("referrals")
    op.drop_table("outcomes")
    op.drop_table("alerts")
    op.drop_table("reminders")
    op.drop_table("appointments")
    op.drop_table("exams")
    op.drop_table("babies")
    op.drop_table("users")
    op.drop_table("hospitals")

    # Drop enum types
    for name in [
        "referralstatus", "referralreason",
        "dischargestatus", "visualoutcome",
        "treatmenteye", "treatmenttype",
        "alerttype",
        "reminderstatus", "remindertrigger", "remindertype",
        "appointmentstatus",
        "vffunctionalimpression", "strabismus", "nystagmus",
        "vfcsm", "vffollowing", "vffixation",
        "plusdisease", "stage", "zone",
        "babystatus", "language", "sex", "userrole",
    ]:
        _drop_enum(name)
