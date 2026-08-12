-- ═══════════════════════════════════════════════════════════════════════════
-- authority_probe_v2 — Schema (001)
-- Corrected vertical-slice probe schema.
--
-- Key changes from authority_v1:
--   1. canonical_payload JSONB replaces caller-supplied request_hash
--      — computed INSIDE Postgres from actual operation arguments
--   2. All terminal outcomes persisted (committed, conflict, rejected,
--      not_found, invalid_transition) — domain rejections are stored, not raised
--   3. operational_incidents has occurrence_count for idempotent upsert
--
-- INSTALLATION ORDER:
--   001_schema.sql    — tables, constraints
--   002_functions.sql  — all stored functions
--   003_roles.sql      — roles, grants, revokes (password set dynamically)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS authority_probe_v2;

-- ── 1. reservation_authority ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS authority_probe_v2.reservation_authority (
  listing_id              TEXT        PRIMARY KEY,
  version                 INTEGER     NOT NULL DEFAULT 0,
  lifecycle_state         TEXT        NOT NULL DEFAULT 'available'
    CHECK (lifecycle_state IN ('available','reserved','sold','cancelled','expired')),
  seller_user_id          TEXT        NOT NULL,
  buyer_user_id           TEXT,
  reservation_token_hash  TEXT,
  reservation_expires_at  TIMESTAMPTZ,
  reservation_revision    TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE authority_probe_v2.reservation_authority
  DROP CONSTRAINT IF EXISTS reserved_requires_full_tuple;
ALTER TABLE authority_probe_v2.reservation_authority
  ADD CONSTRAINT reserved_requires_full_tuple
  CHECK (lifecycle_state <> 'reserved'
    OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL
        AND reservation_expires_at IS NOT NULL AND reservation_revision IS NOT NULL));

ALTER TABLE authority_probe_v2.reservation_authority
  DROP CONSTRAINT IF EXISTS available_clears_tuple;
ALTER TABLE authority_probe_v2.reservation_authority
  ADD CONSTRAINT available_clears_tuple
  CHECK (lifecycle_state <> 'available'
    OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL
        AND reservation_expires_at IS NULL));

ALTER TABLE authority_probe_v2.reservation_authority
  DROP CONSTRAINT IF EXISTS terminal_states_clear_tuple;
ALTER TABLE authority_probe_v2.reservation_authority
  ADD CONSTRAINT terminal_states_clear_tuple
  CHECK (lifecycle_state NOT IN ('sold','cancelled','expired')
    OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL
        AND reservation_expires_at IS NULL));

-- ── 2. reservation_operations ──────────────────────────────────────────────
-- canonical_payload JSONB replaces request_hash. Computed inside Postgres
-- from actual operation arguments. Compared using JSONB equality.
-- All terminal outcomes persisted: committed, conflict, rejected, not_found,
-- invalid_transition. Domain rejections are stored, not raised as exceptions.
CREATE TABLE IF NOT EXISTS authority_probe_v2.reservation_operations (
  operation_id      TEXT        PRIMARY KEY,
  subject_type      TEXT        NOT NULL CHECK (subject_type IN ('listing','user')),
  subject_id        TEXT        NOT NULL,
  listing_id        TEXT        REFERENCES authority_probe_v2.reservation_authority(listing_id)
    DEFERRABLE INITIALLY DEFERRED,
  operation_type    TEXT        NOT NULL,
  requested_state   TEXT        NOT NULL,
  expected_version  INTEGER     NOT NULL,
  canonical_payload JSONB       NOT NULL,
  result_json       TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','committed','conflict','rejected','not_found','invalid_transition','idempotent_replay')),
  error_code        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at      TIMESTAMPTZ
);

-- ── 3. operational_incidents ────────────────────────────────────────────────
-- occurrence_count supports idempotent upsert (ON CONFLICT DO UPDATE).
-- All concurrent callers receive a structured successful result.
CREATE TABLE IF NOT EXISTS authority_probe_v2.operational_incidents (
  incident_id       BIGSERIAL   PRIMARY KEY,
  incident_key      TEXT        UNIQUE NOT NULL,
  incident_type     TEXT        NOT NULL,
  priority          TEXT        NOT NULL DEFAULT 'medium',
  title             TEXT        NOT NULL,
  occurrence_count  INTEGER     NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);