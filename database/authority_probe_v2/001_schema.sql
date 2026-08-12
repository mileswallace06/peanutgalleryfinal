-- ═══════════════════════════════════════════════════════════════════════════
-- authority_probe_v2 — Schema (001)
-- Phase 1B F.3 RETAIN-AND-CERTIFY gate.
--
-- Minimal tables to prove: monotonic versioning, operation-id idempotency,
-- row locking/atomic CAS transition, unique incident keys, transactional
-- rollback, privilege matrix, and canonical request identity derived
-- inside Postgres via pgcrypto digest().
--
-- This schema is RETAINED after certification to support the first canary
-- integration. Cleanup means synthetic rows only — never DROP SCHEMA.
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 003_roles
-- ═══════════════════════════════════════════════════════════════════════════

-- pgcrypto for digest() — canonical request identity computed inside Postgres.
-- pgcrypto installs into the `public` schema by default. The SECURITY DEFINER
-- functions schema-qualify digest() as public.digest() and use
-- search_path = authority_probe_v2, pg_catalog (no untrusted schema).
-- The actual installation schema is discovered at runtime from pg_extension
-- joined to pg_namespace; public is the verified default on Neon.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Schema ──────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS authority_probe_v2;

-- ── 1. reservation_authority — Authoritative Reservation State ──────────────
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

-- reserved requires buyer, token hash, expiry, and revision
ALTER TABLE authority_probe_v2.reservation_authority
  DROP CONSTRAINT IF EXISTS probe_reserved_requires_full_tuple;
ALTER TABLE authority_probe_v2.reservation_authority
  ADD CONSTRAINT probe_reserved_requires_full_tuple
  CHECK (lifecycle_state <> 'reserved'
    OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL
        AND reservation_expires_at IS NOT NULL AND reservation_revision IS NOT NULL));

-- available has a cleared tuple
ALTER TABLE authority_probe_v2.reservation_authority
  DROP CONSTRAINT IF EXISTS probe_available_clears_tuple;
ALTER TABLE authority_probe_v2.reservation_authority
  ADD CONSTRAINT probe_available_clears_tuple
  CHECK (lifecycle_state <> 'available'
    OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL
        AND reservation_expires_at IS NULL));

-- Terminal states (sold/cancelled/expired) must have cleared tuple
ALTER TABLE authority_probe_v2.reservation_authority
  DROP CONSTRAINT IF EXISTS probe_terminal_states_clear_tuple;
ALTER TABLE authority_probe_v2.reservation_authority
  ADD CONSTRAINT probe_terminal_states_clear_tuple
  CHECK (lifecycle_state NOT IN ('sold','cancelled','expired')
    OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL
        AND reservation_expires_at IS NULL));

-- ── 2. reservation_operations — Operation Ledger ───────────────────────────
-- Generic subject model with DEFERRABLE FK so initialize_listing can acquire
-- the operation before the authority row exists.
CREATE TABLE IF NOT EXISTS authority_probe_v2.reservation_operations (
  operation_id      TEXT        PRIMARY KEY,
  subject_type      TEXT        NOT NULL CHECK (subject_type IN ('listing','user')),
  subject_id        TEXT        NOT NULL,
  listing_id        TEXT        REFERENCES authority_probe_v2.reservation_authority(listing_id)
    DEFERRABLE INITIALLY DEFERRED,
  operation_type    TEXT        NOT NULL,
  requested_state    TEXT        NOT NULL,
  expected_version   INTEGER     NOT NULL,
  committed_version  INTEGER,
  request_hash       TEXT        NOT NULL,
  result_json        TEXT,
  status             TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','committed','rejected','conflict','idempotent_replay')),
  error_code         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_probe_ops_listing
  ON authority_probe_v2.reservation_operations (listing_id, created_at DESC)
  WHERE listing_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_probe_ops_subject
  ON authority_probe_v2.reservation_operations (subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_probe_ops_pending
  ON authority_probe_v2.reservation_operations (status)
  WHERE status = 'pending';

-- ── 3. operational_incidents — Unique Incident Keys ────────────────────────
CREATE TABLE IF NOT EXISTS authority_probe_v2.operational_incidents (
  incident_id          BIGSERIAL   PRIMARY KEY,
  incident_key         TEXT        UNIQUE NOT NULL,
  incident_type        TEXT        NOT NULL,
  priority             TEXT        NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('critical','high','medium','low')),
  title                TEXT        NOT NULL,
  occurrence_count     INTEGER     NOT NULL DEFAULT 1,
  last_occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_probe_incidents_key
  ON authority_probe_v2.operational_incidents (incident_key);