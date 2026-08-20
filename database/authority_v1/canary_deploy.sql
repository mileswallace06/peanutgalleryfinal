-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Canary Deploy (focused subset for [AUTH_CANARY] integration)
--
-- Deploys the MINIMUM authority_v1 surface needed to test reserve + release
-- through the executor-only client for synthetic [AUTH_CANARY] listings:
--   Tables:  reservation_authority, reservation_operations, reservation_outbox
--   Funcs:   acquire_operation, get_state, initialize_listing,
--            reserve_listing, release_listing
--
-- This is a faithful subset of 001_schema.sql + 002_functions.sql. Table
-- definitions and function bodies are copied verbatim from the canonical
-- artifacts so the canary exercises the real authority_v1 contract.
--
-- Deployment owner: neondb_owner (database owner, CREATEROLE).
-- Executor role:    authority_probe_executor (existing LOGIN role used by
--   AUTHORITY_DB_URL_DEV_EXECUTOR). EXECUTE is granted to this role so the
--   existing executor connection can call the canary functions.
--
-- SECURITY: EXECUTE revoked from PUBLIC. Only authority_probe_executor may call.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS authority_v1;

-- ── 1. reservation_authority ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS authority_v1.reservation_authority (
  listing_id                   TEXT        PRIMARY KEY,
  version                      INTEGER     NOT NULL DEFAULT 0,
  lifecycle_state              TEXT        NOT NULL DEFAULT 'available'
    CHECK (lifecycle_state IN ('available','reserved','frozen','sold','cancelled','expired')),
  seller_user_id               TEXT        NOT NULL,
  buyer_user_id                TEXT,
  reservation_token_hash       TEXT,
  reservation_expires_at      TIMESTAMPTZ,
  reservation_revision         TEXT,
  checkout_quarantined         BOOLEAN     NOT NULL DEFAULT false,
  checkout_quarantine_reason   TEXT,
  checkout_quarantined_at       TIMESTAMPTZ,
  recovery_blocked             BOOLEAN     NOT NULL DEFAULT false,
  recovery_blocked_reason      TEXT,
  recovery_blocked_at          TIMESTAMPTZ,
  recovery_not_before          TIMESTAMPTZ,
  seller_cancel_requested_at   TIMESTAMPTZ,
  seller_pause_requested_at    TIMESTAMPTZ,
  current_operation_id         TEXT,
  last_operation_type          TEXT,
  last_operation_at            TIMESTAMPTZ,
  last_operation_payload_hash  TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_authority
    ADD CONSTRAINT quarantine_reason_required
    CHECK (NOT checkout_quarantined OR checkout_quarantine_reason IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_authority
    ADD CONSTRAINT quarantine_timestamp_required
    CHECK (NOT checkout_quarantined OR checkout_quarantined_at IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_authority
    ADD CONSTRAINT recovery_block_reason_required
    CHECK (NOT recovery_blocked OR recovery_blocked_reason IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_authority
    ADD CONSTRAINT recovery_block_timestamp_required
    CHECK (NOT recovery_blocked OR recovery_blocked_at IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_authority
    ADD CONSTRAINT frozen_requires_full_tuple
    CHECK (lifecycle_state <> 'frozen'
      OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL
          AND reservation_expires_at IS NOT NULL AND reservation_revision IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_authority
    ADD CONSTRAINT reserved_requires_full_tuple
    CHECK (lifecycle_state <> 'reserved'
      OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL
          AND reservation_expires_at IS NOT NULL AND reservation_revision IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_authority
    ADD CONSTRAINT available_clears_tuple
    CHECK (lifecycle_state <> 'available'
      OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL
          AND reservation_expires_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_authority
    ADD CONSTRAINT terminal_states_clear_tuple
    CHECK (lifecycle_state NOT IN ('sold','cancelled','expired')
      OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL
          AND reservation_expires_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_authority_stale_reserved
  ON authority_v1.reservation_authority (reservation_expires_at)
  WHERE lifecycle_state = 'reserved' AND checkout_quarantined = false;

CREATE INDEX IF NOT EXISTS idx_authority_seller
  ON authority_v1.reservation_authority (seller_user_id);

-- ── 2. reservation_operations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS authority_v1.reservation_operations (
  operation_id      TEXT        PRIMARY KEY,
  subject_type      TEXT        NOT NULL
    CHECK (subject_type IN ('listing','user')),
  subject_id        TEXT        NOT NULL,
  listing_id        TEXT        REFERENCES authority_v1.reservation_authority(listing_id)
    DEFERRABLE INITIALLY DEFERRED,
  operation_type    TEXT        NOT NULL
    CHECK (operation_type IN (
      'reserve','release','freeze','bind_pi',
      'begin_capture','record_capture','finalize',
      'begin_cancel','record_cancel',
      'begin_refund','record_refund',
      'abort','cancel','expire','initialize','quarantine','anonymize'
    )),
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

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_operations
    ADD CONSTRAINT valid_operation_subject_combination
    CHECK (
      (subject_type = 'listing' AND operation_type IN (
        'reserve','release','freeze','bind_pi',
        'begin_capture','record_capture','finalize',
        'begin_cancel','record_cancel',
        'begin_refund','record_refund',
        'abort','cancel','expire','initialize','quarantine'))
      OR
      (subject_type = 'user' AND operation_type = 'anonymize')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_operations
    ADD CONSTRAINT listing_ops_require_listing_id
    CHECK (subject_type <> 'listing'
      OR operation_type = 'initialize'
      OR listing_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_operations
    ADD CONSTRAINT user_ops_no_listing_id
    CHECK (subject_type <> 'user' OR listing_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ops_listing
  ON authority_v1.reservation_operations (listing_id, created_at DESC)
  WHERE listing_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ops_pending
  ON authority_v1.reservation_operations (status)
  WHERE status = 'pending';

-- ── 3. reservation_outbox ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS authority_v1.reservation_outbox (
  outbox_id          BIGSERIAL   PRIMARY KEY,
  event_id           TEXT        UNIQUE NOT NULL,
  operation_id       TEXT        NOT NULL REFERENCES authority_v1.reservation_operations(operation_id),
  listing_id         TEXT        NOT NULL,
  committed_version  INTEGER     NOT NULL,
  effect_type        TEXT        NOT NULL
    CHECK (effect_type IN (
      'mirror_project','notification_dispatch','point_award',
      'email_send','push_send','inventory_sync','incident_create'
    )),
  payload            JSONB       NOT NULL,
  delivery_status    TEXT        NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','in_flight','delivered','dead_letter')),
  attempt_count      INTEGER     NOT NULL DEFAULT 0,
  max_attempts       INTEGER     NOT NULL DEFAULT 10
    CHECK (max_attempts > 0 AND max_attempts <= 100),
  next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error         TEXT,
  delivered_at       TIMESTAMPTZ,
  lease_owner        TEXT,
  lease_expires_at   TIMESTAMPTZ,
  claimed_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE authority_v1.reservation_outbox
    ADD CONSTRAINT delivered_events_have_timestamp
    CHECK (delivery_status <> 'delivered' OR delivered_at IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_outbox_claimable
  ON authority_v1.reservation_outbox (next_attempt_at)
  WHERE delivery_status IN ('pending','in_flight');

-- ── Functions (copied verbatim from 002_functions.sql) ─────────────────────

CREATE OR REPLACE FUNCTION authority_v1.acquire_operation(
  p_server_operation_id  TEXT,
  p_subject_type         TEXT,
  p_subject_id           TEXT,
  p_listing_id           TEXT,
  p_operation_type       TEXT,
  p_requested_state      TEXT,
  p_expected_version     INTEGER,
  p_request_hash         TEXT
) RETURNS TABLE(acquired BOOLEAN, op_status TEXT, replay_result JSONB, stored_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_inserted   TEXT;
  v_existing   reservation_operations%ROWTYPE;
BEGIN
  INSERT INTO reservation_operations
    (operation_id, subject_type, subject_id, listing_id,
     operation_type, requested_state, expected_version, request_hash, status)
  VALUES
    (p_server_operation_id, p_subject_type, p_subject_id, p_listing_id,
     p_operation_type, p_requested_state, p_expected_version, p_request_hash, 'pending')
  ON CONFLICT (operation_id) DO NOTHING
  RETURNING operation_id INTO v_inserted;

  IF v_inserted IS NOT NULL THEN
    RETURN QUERY SELECT true, 'pending'::TEXT, NULL::JSONB, p_request_hash;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM reservation_operations
  WHERE operation_id = p_server_operation_id FOR UPDATE;

  IF v_existing.request_hash = p_request_hash AND v_existing.status = 'committed' THEN
    RETURN QUERY SELECT true, 'committed'::TEXT, v_existing.result_json::JSONB, v_existing.request_hash;
  ELSIF v_existing.request_hash = p_request_hash AND v_existing.status = 'pending' THEN
    RETURN QUERY SELECT false, 'pending'::TEXT, NULL::JSONB, v_existing.request_hash;
  ELSIF v_existing.request_hash != p_request_hash THEN
    RETURN QUERY SELECT false, 'conflict'::TEXT,
      jsonb_build_object(
        'ok', false,
        'code', 'OPERATION_ID_CONFLICT',
        'operation_id', p_server_operation_id,
        'stored_hash', v_existing.request_hash,
        'received_hash', p_request_hash
      ),
      v_existing.request_hash;
  ELSE
    RETURN QUERY SELECT false, v_existing.status, v_existing.result_json::JSONB, v_existing.request_hash;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION authority_v1.get_state(
  p_listing_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_row reservation_authority%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM reservation_authority WHERE listing_id = p_listing_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'version', v_row.version,
    'lifecycle_state', v_row.lifecycle_state,
    'seller_user_id', v_row.seller_user_id,
    'buyer_user_id', v_row.buyer_user_id,
    'reservation_revision', v_row.reservation_revision,
    'reservation_expires_at', v_row.reservation_expires_at,
    'checkout_quarantined', v_row.checkout_quarantined,
    'recovery_blocked', v_row.recovery_blocked
  );
END;
$$;

CREATE OR REPLACE FUNCTION authority_v1.initialize_listing(
  p_listing_id TEXT, p_seller_user_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_existing reservation_authority%ROWTYPE;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, NULL,
    'initialize', 'available', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  SELECT * INTO v_existing FROM reservation_authority
  WHERE listing_id = p_listing_id FOR UPDATE;

  IF FOUND THEN
    IF v_existing.seller_user_id = p_seller_user_id
       AND v_existing.version = 0
       AND v_existing.lifecycle_state = 'available' THEN
      UPDATE reservation_operations SET status = 'idempotent_replay',
        result_json = jsonb_build_object('ok', true, 'version', 0, 'idempotent', true)::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'version', 0, 'idempotent', true);
    ELSE
      UPDATE reservation_operations SET status = 'rejected', error_code = 'INITIALIZE_CONFLICT',
        result_json = jsonb_build_object('ok', false, 'code', 'INITIALIZE_CONFLICT',
          'reason', 'listing already initialized by different seller or wrong state')::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'INITIALIZE_CONFLICT',
        'reason', 'listing already initialized by different seller or wrong state');
    END IF;
  END IF;

  INSERT INTO reservation_authority (listing_id, version, lifecycle_state, seller_user_id)
  VALUES (p_listing_id, 0, 'available', p_seller_user_id);

  UPDATE reservation_operations SET listing_id = p_listing_id,
    status = 'committed', committed_version = 0,
    result_json = jsonb_build_object('ok', true, 'version', 0)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  RETURN jsonb_build_object('ok', true, 'version', 0);
END;
$$;

CREATE OR REPLACE FUNCTION authority_v1.reserve_listing(
  p_listing_id TEXT, p_expected_version INTEGER, p_buyer_user_id TEXT,
  p_token_hash TEXT, p_expires_at TIMESTAMPTZ,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'reserve', 'reserved', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'reserved',
      buyer_user_id = p_buyer_user_id, reservation_token_hash = p_token_hash,
      reservation_expires_at = p_expires_at, reservation_revision = v_revision,
      current_operation_id = p_server_operation_id, last_operation_type = 'reserve',
      last_operation_at = now(), last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'available' AND checkout_quarantined = false AND recovery_blocked = false
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'reserved'));

  RETURN jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision);
END;
$$;

CREATE OR REPLACE FUNCTION authority_v1.release_listing(
  p_listing_id TEXT, p_expected_version INTEGER,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'release', 'available', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'available',
      buyer_user_id = NULL, reservation_token_hash = NULL,
      reservation_expires_at = NULL, reservation_revision = v_revision,
      current_operation_id = p_server_operation_id, last_operation_type = 'release',
      last_operation_at = now(), last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version AND lifecycle_state = 'reserved'
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'available'));

  RETURN jsonb_build_object('ok', true, 'version', v_new_version);
END;
$$;

-- ── Grants (executor-only) ─────────────────────────────────────────────────
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA authority_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA authority_v1 TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_v1.acquire_operation(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_v1.get_state(TEXT) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_v1.initialize_listing(TEXT,TEXT,TEXT,TEXT) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_v1.reserve_listing(TEXT,INTEGER,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_v1.release_listing(TEXT,INTEGER,TEXT,TEXT) TO authority_probe_executor;