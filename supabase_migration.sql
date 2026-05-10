-- ============================================================
-- ROP Tracker — Supabase Migration Script
-- Run this entire script in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- After running, update DATABASE_URL in your .env and run:
--   python seed.py
-- to create demo users and babies.
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE userrole AS ENUM (
    'nicu_nurse',
    'ophthalmologist',
    'hospital_coordinator',
    'central_coordinator'
);

CREATE TYPE sex AS ENUM ('male', 'female');

CREATE TYPE language AS ENUM (
    'english', 'luganda', 'runyankole', 'acholi', 'ateso'
);

CREATE TYPE babystatus AS ENUM ('active', 'discharged', 'ltfu', 'treated');

CREATE TYPE zone AS ENUM ('zone_i', 'zone_ii', 'zone_iii');

CREATE TYPE stage AS ENUM (
    'no_rop', 'stage_1', 'stage_2', 'stage_3',
    'stage_4', 'stage_5', 'immature'
);

CREATE TYPE plusdisease AS ENUM ('none', 'pre_plus', 'plus');

CREATE TYPE vffixation AS ENUM ('central', 'eccentric', 'none_unable');

CREATE TYPE vffollowing AS ENUM (
    'follows_smoothly', 'follows_partially',
    'does_not_follow', 'unable_to_assess'
);

CREATE TYPE vfcsm AS ENUM (
    'csm', 'cs', 'c', 'not_central', 'unable_to_assess'
);

CREATE TYPE nystagmus AS ENUM ('absent', 'pendular', 'jerk', 'latent');

CREATE TYPE strabismus AS ENUM (
    'absent', 'esotropia', 'exotropia', 'suspected'
);

CREATE TYPE vffunctionalimpression AS ENUM (
    'age_appropriate', 'mildly_delayed',
    'significantly_delayed', 'unable_to_assess'
);

CREATE TYPE appointmentstatus AS ENUM (
    'scheduled', 'attended', 'missed', 'ltfu'
);

CREATE TYPE remindertype AS ENUM (
    'sms', 'whatsapp', 'in_app', 'phone_call'
);

CREATE TYPE remindertrigger AS ENUM (
    't_minus_3', 't_minus_1', 'day_of', 'ltfu_48h', 'manual_call'
);

CREATE TYPE reminderstatus AS ENUM (
    'pending', 'sent', 'failed', 'acknowledged'
);

CREATE TYPE alerttype AS ENUM ('ltfu_flagged');

CREATE TYPE treatmenttype AS ENUM (
    'none', 'laser', 'anti_vegf', 'surgery', 'combination'
);

CREATE TYPE treatmenteye AS ENUM ('right', 'left', 'both');

CREATE TYPE visualoutcome AS ENUM (
    'good_vision', 'mild_impairment', 'severe_impairment',
    'blind', 'too_young', 'ltfu_before_outcome'
);

CREATE TYPE dischargestatus AS ENUM (
    'completed_no_rop', 'completed_treated',
    'referred_national', 'referred_abroad',
    'died', 'lost', 'ongoing'
);

CREATE TYPE referralreason AS ENUM (
    'laser_not_available', 'surgery_needed', 'second_opinion', 'other'
);

CREATE TYPE referralstatus AS ENUM (
    'pending', 'arrived_treated', 'did_not_arrive', 'unknown'
);

-- ============================================================
-- TABLES (in dependency order)
-- ============================================================

CREATE TABLE hospitals (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR NOT NULL UNIQUE,
    district   VARCHAR NOT NULL,
    region     VARCHAR NOT NULL,
    is_active  BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR NOT NULL UNIQUE,
    full_name       VARCHAR NOT NULL,
    hashed_password VARCHAR NOT NULL,
    role            userrole NOT NULL,
    hospital_id     UUID REFERENCES hospitals(id),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

CREATE TABLE babies (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id          UUID NOT NULL REFERENCES hospitals(id),
    full_name            VARCHAR NOT NULL,
    date_of_birth        DATE NOT NULL,
    sex                  sex NOT NULL,
    birth_weight_grams   FLOAT NOT NULL,
    gestational_age_weeks FLOAT NOT NULL,
    postnatal_age_days   INTEGER,
    oxygen_therapy       BOOLEAN DEFAULT FALSE,
    blood_transfusion    BOOLEAN DEFAULT FALSE,
    sepsis               BOOLEAN DEFAULT FALSE,
    inotropes            BOOLEAN DEFAULT FALSE,
    anaemia              BOOLEAN DEFAULT FALSE,
    caregiver_name       VARCHAR NOT NULL,
    mtn_phone            VARCHAR,
    airtel_phone         VARCHAR,
    language_preference  language DEFAULT 'english',
    status               babystatus DEFAULT 'active',
    notes                TEXT,
    enrolled_at          TIMESTAMPTZ DEFAULT NOW(),
    enrolled_by_id       UUID REFERENCES users(id),
    updated_at           TIMESTAMPTZ
);

CREATE TABLE exams (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baby_id                 UUID NOT NULL REFERENCES babies(id),
    examiner_id             UUID REFERENCES users(id),
    exam_date               DATE NOT NULL,
    postnatal_age_days      INTEGER,
    postmenstrual_age_weeks VARCHAR,
    right_zone              zone,
    right_stage             stage,
    right_plus              plusdisease DEFAULT 'none',
    left_zone               zone,
    left_stage              stage,
    left_plus               plusdisease DEFAULT 'none',
    worst_zone              zone,
    worst_stage             stage,
    has_plus_disease        VARCHAR,
    next_exam_weeks         INTEGER,
    treatment_recommended   VARCHAR,
    notes                   TEXT,
    vf_right_fixation       vffixation,
    vf_right_following      vffollowing,
    vf_right_csm            vfcsm,
    vf_right_teller_acuity  FLOAT,
    vf_right_vep            FLOAT,
    vf_left_fixation        vffixation,
    vf_left_following       vffollowing,
    vf_left_csm             vfcsm,
    vf_left_teller_acuity   FLOAT,
    vf_left_vep             FLOAT,
    vf_nystagmus            nystagmus,
    vf_strabismus           strabismus,
    vf_functional_impression vffunctionalimpression,
    vf_notes                TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE appointments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baby_id             UUID NOT NULL REFERENCES babies(id),
    exam_id             UUID REFERENCES exams(id),
    due_date            DATE NOT NULL,
    status              appointmentstatus DEFAULT 'scheduled',
    attended_at         TIMESTAMPTZ,
    missed_at           TIMESTAMPTZ,
    ltfu_at             TIMESTAMPTZ,
    coordinator_alerted TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reminders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baby_id             UUID NOT NULL REFERENCES babies(id),
    appointment_id      UUID NOT NULL REFERENCES appointments(id),
    reminder_type       remindertype NOT NULL,
    trigger             remindertrigger NOT NULL,
    language            VARCHAR NOT NULL DEFAULT 'english',
    recipient_phone     VARCHAR,
    message_body        TEXT,
    status              reminderstatus DEFAULT 'pending',
    provider_message_id VARCHAR,
    error_message       TEXT,
    scheduled_at        TIMESTAMPTZ NOT NULL,
    sent_at             TIMESTAMPTZ,
    acknowledged_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id     UUID NOT NULL REFERENCES hospitals(id),
    baby_id         UUID NOT NULL REFERENCES babies(id),
    appointment_id  UUID REFERENCES appointments(id),
    alert_type      alerttype NOT NULL DEFAULT 'ltfu_flagged',
    title           VARCHAR NOT NULL,
    body            TEXT,
    is_dismissed    BOOLEAN NOT NULL DEFAULT FALSE,
    dismissed_at    TIMESTAMPTZ,
    dismissed_by_id UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE outcomes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baby_id                 UUID NOT NULL UNIQUE REFERENCES babies(id),
    treatment_type          treatmenttype,
    treatment_eye           treatmenteye,
    treatment_date          DATE,
    treatment_hospital_id   UUID REFERENCES hospitals(id),
    treating_ophthalmologist VARCHAR,
    visual_outcome          visualoutcome,
    discharge_status        dischargestatus,
    discharge_date          DATE,
    notes                   TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ
);

CREATE TABLE referrals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baby_id          UUID NOT NULL REFERENCES babies(id),
    from_hospital_id UUID REFERENCES hospitals(id),
    to_hospital_id   UUID REFERENCES hospitals(id),
    to_external      BOOLEAN DEFAULT FALSE,
    reason           referralreason NOT NULL,
    referral_date    DATE NOT NULL,
    status           referralstatus DEFAULT 'pending',
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ
);

-- ============================================================
-- HOSPITAL SEED DATA (53 Ugandan hospitals)
-- ============================================================

INSERT INTO hospitals (name, district, region) VALUES
    -- National Referral Hospitals
    ('Mulago National Referral Hospital',    'Kampala',    'Central'),
    ('Kiruddu National Referral Hospital',   'Kampala',    'Central'),
    ('Kawempe National Referral Hospital',   'Kampala',    'Central'),

    -- Regional Referral Hospitals
    ('Arua Regional Referral Hospital',      'Arua',       'West Nile'),
    ('Fort Portal Regional Referral Hospital','Kabarole',  'Western'),
    ('Gulu Regional Referral Hospital',      'Gulu',       'Northern'),
    ('Hoima Regional Referral Hospital',     'Hoima',      'Western'),
    ('Jinja Regional Referral Hospital',     'Jinja',      'Eastern'),
    ('Kabale Regional Referral Hospital',    'Kabale',     'Western'),
    ('Lira Regional Referral Hospital',      'Lira',       'Northern'),
    ('Masaka Regional Referral Hospital',    'Masaka',     'Central'),
    ('Mbarara Regional Referral Hospital',   'Mbarara',    'Western'),
    ('Mbale Regional Referral Hospital',     'Mbale',      'Eastern'),
    ('Moroto Regional Referral Hospital',    'Moroto',     'Karamoja'),
    ('Mubende Regional Referral Hospital',   'Mubende',    'Central'),
    ('Rukungiri Regional Referral Hospital', 'Rukungiri',  'Western'),
    ('Soroti Regional Referral Hospital',    'Soroti',     'Eastern'),

    -- Other Government Hospitals with NICUs
    ('Entebbe Regional Referral Hospital',   'Wakiso',     'Central'),
    ('Naguru Regional Referral Hospital',    'Kampala',    'Central'),
    ('Iganga General Hospital',              'Iganga',     'Eastern'),
    ('Tororo General Hospital',              'Tororo',     'Eastern'),
    ('Kitgum General Hospital',              'Kitgum',     'Northern'),
    ('Masindi General Hospital',             'Masindi',    'Western'),
    ('Pallisa General Hospital',             'Pallisa',    'Eastern'),
    ('Apac General Hospital',                'Apac',       'Northern'),
    ('Nebbi General Hospital',               'Nebbi',      'West Nile'),
    ('Adjumani General Hospital',            'Adjumani',   'West Nile'),
    ('Bundibugyo General Hospital',          'Bundibugyo', 'Western'),
    ('Bushenyi General Hospital',            'Bushenyi',   'Western'),
    ('Kapchorwa General Hospital',           'Kapchorwa',  'Eastern'),
    ('Rakai General Hospital',               'Rakai',      'Central'),

    -- PNFP Hospitals
    ('St. Mary''s Hospital Lacor',           'Gulu',       'Northern'),
    ('Uganda Martyrs Hospital Lubaga',       'Kampala',    'Central'),
    ('Mengo Hospital',                       'Kampala',    'Central'),
    ('St. Francis Hospital Nsambya',         'Kampala',    'Central'),
    ('Kitovu Hospital',                      'Masaka',     'Central'),
    ('Virika Hospital',                      'Kabarole',   'Western'),
    ('Comboni Hospital Wairaka',             'Jinja',      'Eastern'),
    ('Holy Family Hospital Kisubi',          'Wakiso',     'Central'),
    ('Matany Hospital',                      'Moroto',     'Karamoja'),
    ('St. Joseph''s Hospital Kitgum',        'Kitgum',     'Northern'),
    ('Nyakibale Hospital',                   'Rukungiri',  'Western'),
    ('Bwindi Community Hospital',            'Kanungu',    'Western'),
    ('Kisiizi Hospital',                     'Rukungiri',  'Western'),
    ('Kagando Hospital',                     'Kasese',     'Western'),
    ('Kumi Hospital',                        'Kumi',       'Eastern'),
    ('Ngora Freda Carr Hospital',            'Ngora',      'Eastern'),
    ('St. Anthony''s Hospital Tororo',       'Tororo',     'Eastern'),

    -- Private Hospitals with NICUs
    ('International Hospital Kampala',       'Kampala',    'Central'),
    ('Case Hospital',                        'Kampala',    'Central'),
    ('Norvik Hospital',                      'Kampala',    'Central'),
    ('Nakasero Hospital',                    'Kampala',    'Central'),
    ('Kampala Hospital',                     'Kampala',    'Central'),
    ('Victoria Hospital',                    'Entebbe',    'Central');

-- ============================================================
-- NOTE: Demo users and babies are seeded via seed.py
-- After deploying the backend, run:
--   DATABASE_URL=<your-supabase-url> python seed.py
-- All demo accounts use password: password123
-- Central login: central@rop.ug
-- ============================================================
