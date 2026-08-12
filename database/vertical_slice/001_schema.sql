-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Vertical Slice Schema (Phase 1B live proof)
-- Minimal tables to prove: monotonic versioning, operation-id idempotency,
-- row locking/atomic transition, unique incident keys, rollback.
-- NOT the full production design — see database/authority_v1/ for that.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS authority_v1;

-- ── 1. reservation_authority — Authoritative Reservation State ──────────────
CREATE TABLE IF NOT EXISTS authority_v1.reservation_authority (
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

ALTER TABLE authority_v1.reservation_authority
  DROP CONSTRAINT IF EXISTS reserved_requires_full_tuple;
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT reserved_requires_full_tuple
  CHECK (lifecycle_state <> 'reserved'
    OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL
        AND reservation_expires_at IS NOT NULL AND reservation_revision IS NOT NULL));

ALTER TABLE authority_v1.reservation_authority
  DROP CONSTRAINT IF EXISTS available_clears_tuple;
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT available_clears_tuple
  CHECK (lifecycle_state <> 'available'
    OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL
        AND reservation_expires_at IS NULL));

-- ── 2. reservation_operations — Operation Ledger ───────────────────────────
CREATE TABLE IF NOT EXISTS authority_v1.reservation_operations (
  operation_id      TEXT        PRIMARY KEY,
  subject_type      TEXT        NOT NULL CHECK (subject_type IN ('listing','user')),
  subject_id        TEXT        NOT NULL,
  listing_id        TEXT        REFERENCES authority_v1.reservation_authority(listing_id)
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

-- ── 3. operational_incidents — Unique Incident Keys ────────────────────────
CREATE TABLE IF NOT EXISTS authority_v1.operational_incidents (
  incident_id    BIGSERIAL   PRIMARY KEY,
  incident_key   TEXT        UNIQUE NOT NULL,
  incident_type  TEXT        NOT NULL,
  priority       TEXT        NOT NULL DEFAULT 'medium',
  title          TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);