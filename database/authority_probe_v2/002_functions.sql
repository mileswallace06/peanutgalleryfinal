-- ═══════════════════════════════════════════════════════════════════════════
-- authority_probe_v2 — Stored Functions (002)
-- Phase 1B F.3 RETAIN-AND-CERTIFY gate.
--
-- 10 functions: acquire_operation, get_state, initialize_listing,
-- reserve_listing, release_listing, upsert_incident, reserve_and_fail
-- (test-only), get_operation_result, cleanup_synthetic, count_synthetic.
--
-- All SECURITY DEFINER with search_path = authority_probe_v2, pg_catalog.
-- pgcrypto's digest() is schema-qualified as public.digest() — discovered
-- from pg_extension/pg_namespace at setup time. No untrusted schema in
-- search_path; pg_catalog is trusted and required for gen_random_uuid().
-- Canonical request identity computed inside Postgres via pgcrypto digest()
-- — the caller passes a JSONB payload, the function derives the SHA-256 hash.
-- Terminal outcomes (conflict, rejected) are persisted in the operation ledger
-- without raising exceptions and are replayed idempotently on retry.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. acquire_operation — Operation-ID Acquisition ─────────────────────────
-- Computes request_hash inside Postgres from p_payload via digest().
-- Terminal outcomes (committed, conflict, rejected) are all replayed
-- idempotently — same operation_id + same hash returns the stored result.
-- Same operation_id + different hash → OPERATION_ID_CONFLICT (persistent).
CREATE OR REPLACE FUNCTION authority_probe_v2.acquire_operation(
  p_operation_id    TEXT,
  p_subject_type   TEXT,
  p_subject_id     TEXT,
  p_listing_id     TEXT,
  p_operation_type TEXT,
  p_requested_state TEXT,
  p_expected_version INTEGER,
  p_payload        JSONB
) RETURNS TABLE(acquired BOOLEAN, op_status TEXT, replay_result JSONB, stored_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE
  v_request_hash  TEXT;
  v_inserted      TEXT;
  v_existing      reservation_operations%ROWTYPE;
BEGIN
  v_request_hash := encode(public.digest(p_payload::text, 'sha256'), 'hex');

  INSERT INTO reservation_operations
    (operation_id, subject_type, subject_id, listing_id,
     operation_type, requested_state, expected_version, request_hash, status)
  VALUES
    (p_operation_id, p_subject_type, p_subject_id, p_listing_id,
     p_operation_type, p_requested_state, p_expected_version, v_request_hash, 'pending')
  ON CONFLICT (operation_id) DO NOTHING
  RETURNING operation_id INTO v_inserted;

  IF v_inserted IS NOT NULL THEN
    RETURN QUERY SELECT true, 'pending'::TEXT, NULL::JSONB, v_request_hash;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM reservation_operations
  WHERE operation_id = p_operation_id FOR UPDATE;

  IF v_existing.request_hash = v_request_hash AND v_existing.status IN ('committed','conflict','rejected','idempotent_replay') THEN
    RETURN QUERY SELECT true, v_existing.status, v_existing.result_json::JSONB, v_existing.request_hash;
  ELSIF v_existing.request_hash = v_request_hash AND v_existing.status = 'pending' THEN
    RETURN QUERY SELECT false, 'pending'::TEXT, NULL::JSONB, v_existing.request_hash;
  ELSIF v_existing.request_hash != v_request_hash THEN
    RETURN QUERY SELECT false, 'conflict'::TEXT,
      jsonb_build_object(
        'ok', false,
        'code', 'OPERATION_ID_CONFLICT',
        'operation_id', p_operation_id
      ),
      v_existing.request_hash;
  ELSE
    RETURN QUERY SELECT false, v_existing.status, v_existing.result_json::JSONB, v_existing.request_hash;
  END IF;
END;
$$;

-- ── 2. get_state — Read Authority State ────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_probe_v2.get_state(
  p_listing_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE v_row reservation_authority%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM reservation_authority WHERE listing_id = p_listing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'listing_id', v_row.listing_id,
    'version', v_row.version,
    'lifecycle_state', v_row.lifecycle_state,
    'seller_user_id', v_row.seller_user_id,
    'buyer_user_id', v_row.buyer_user_id,
    'reservation_revision', v_row.reservation_revision
  );
END;
$$;

-- ── 3. initialize_listing ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_probe_v2.initialize_listing(
  p_listing_id     TEXT,
  p_seller_user_id TEXT,
  p_operation_id   TEXT,
  p_payload        JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_existing reservation_authority%ROWTYPE;
  v_payload_hash TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_operation_id, 'listing', p_listing_id, NULL,
    'initialize', 'available', 0, p_payload);
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
        result_json = jsonb_build_object('ok', true, 'version', 0, 'already_exists', true)::TEXT,
        committed_at = now()
      WHERE operation_id = p_operation_id;
      RETURN jsonb_build_object('ok', true, 'version', 0, 'already_exists', true);
    ELSE
      UPDATE reservation_operations SET status = 'rejected', error_code = 'INITIALIZE_CONFLICT',
        result_json = jsonb_build_object('ok', false, 'code', 'INITIALIZE_CONFLICT')::TEXT,
        committed_at = now()
      WHERE operation_id = p_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'INITIALIZE_CONFLICT');
    END IF;
  END IF;

  INSERT INTO reservation_authority (listing_id, version, lifecycle_state, seller_user_id)
  VALUES (p_listing_id, 0, 'available', p_seller_user_id);

  UPDATE reservation_operations SET listing_id = p_listing_id,
    status = 'committed', committed_version = 0,
    result_json = jsonb_build_object('ok', true, 'version', 0)::TEXT,
    committed_at = now()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('ok', true, 'version', 0);
END;
$$;

-- ── 4. reserve_listing — CAS available → reserved ──────────────────────────
CREATE OR REPLACE FUNCTION authority_probe_v2.reserve_listing(
  p_listing_id      TEXT,
  p_expected_version INTEGER,
  p_buyer_user_id   TEXT,
  p_token_hash      TEXT,
  p_expires_at      TIMESTAMPTZ,
  p_operation_id    TEXT,
  p_payload         JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_operation_id, 'listing', p_listing_id, p_listing_id,
    'reserve', 'reserved', p_expected_version, p_payload);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'reserved',
      buyer_user_id = p_buyer_user_id, reservation_token_hash = p_token_hash,
      reservation_expires_at = p_expires_at, reservation_revision = v_revision,
      updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'available'
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
      committed_at = now()
    WHERE operation_id = p_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision)::TEXT,
    committed_at = now()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision);
END;
$$;

-- ── 5. release_listing — CAS reserved → available ──────────────────────────
CREATE OR REPLACE FUNCTION authority_probe_v2.release_listing(
  p_listing_id      TEXT,
  p_expected_version INTEGER,
  p_buyer_user_id   TEXT,
  p_operation_id    TEXT,
  p_payload         JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_operation_id, 'listing', p_listing_id, p_listing_id,
    'release', 'available', p_expected_version, p_payload);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'available',
      buyer_user_id = NULL, reservation_token_hash = NULL,
      reservation_expires_at = NULL, reservation_revision = v_revision,
      updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'reserved' AND buyer_user_id = p_buyer_user_id
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
      committed_at = now()
    WHERE operation_id = p_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version)::TEXT,
    committed_at = now()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('ok', true, 'version', v_new_version);
END;
$$;

-- ── 6. upsert_incident — Concurrent Incident Upsert ────────────────────────
-- ON CONFLICT DO UPDATE serializes concurrent calls via the unique index.
-- 100 concurrent calls → 1 row, occurrence_count = 100, 1 stable incident_id.
CREATE OR REPLACE FUNCTION authority_probe_v2.upsert_incident(
  p_incident_key  TEXT,
  p_incident_type TEXT,
  p_priority      TEXT,
  p_title         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE v_id BIGINT; v_count INTEGER;
BEGIN
  INSERT INTO operational_incidents (incident_key, incident_type, priority, title)
  VALUES (p_incident_key, p_incident_type, p_priority, p_title)
  ON CONFLICT (incident_key) DO UPDATE SET
    occurrence_count = operational_incidents.occurrence_count + 1,
    last_occurred_at = now(),
    updated_at = now()
  RETURNING incident_id INTO v_id;

  SELECT occurrence_count INTO v_count FROM operational_incidents WHERE incident_id = v_id;

  RETURN jsonb_build_object('ok', true, 'incident_id', v_id::TEXT, 'occurrence_count', v_count);
END;
$$;

-- ── 7. reserve_and_fail — TEST-ONLY (NOT granted to executor) ──────────────
-- Calls reserve_listing then raises an exception if it succeeded.
-- Proves that a post-update failure within a SECURITY DEFINER function rolls
-- back all database changes (transactional integrity).
CREATE OR REPLACE FUNCTION authority_probe_v2.reserve_and_fail(
  p_listing_id      TEXT,
  p_expected_version INTEGER,
  p_buyer_user_id   TEXT,
  p_token_hash      TEXT,
  p_expires_at      TIMESTAMPTZ,
  p_operation_id    TEXT,
  p_payload         JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE v_result JSONB;
BEGIN
  v_result := reserve_listing(
    p_listing_id, p_expected_version, p_buyer_user_id,
    p_token_hash, p_expires_at, p_operation_id, p_payload
  );
  IF (v_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'INJECTED_FAILURE';
  END IF;
  RETURN v_result;
END;
$$;

-- ── 8. get_operation_result — Recover Committed Result by Operation ID ─────
-- Used to recover the committed result after an unknown client response
-- (e.g., network timeout). The client queries by operation_id to retrieve
-- the stored result from the operation ledger.
CREATE OR REPLACE FUNCTION authority_probe_v2.get_operation_result(
  p_operation_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE v_op reservation_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM reservation_operations
  WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'operation_id', v_op.operation_id,
    'status', v_op.status,
    'result_json', v_op.result_json::JSONB,
    'committed_version', v_op.committed_version,
    'error_code', v_op.error_code
  );
END;
$$;

-- ── 9. cleanup_synthetic — Remove All Synthetic Rows ────────────────────────
-- Deletes all rows from all probe tables. Does NOT drop the schema.
-- The schema, functions, and privileges are retained for canary integration.
CREATE OR REPLACE FUNCTION authority_probe_v2.cleanup_synthetic()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE
  v_authority_count INTEGER;
  v_operations_count INTEGER;
  v_incidents_count INTEGER;
BEGIN
  DELETE FROM reservation_operations;
  DELETE FROM operational_incidents;
  DELETE FROM reservation_authority;

  SELECT count(*) INTO v_authority_count FROM reservation_authority;
  SELECT count(*) INTO v_operations_count FROM reservation_operations;
  SELECT count(*) INTO v_incidents_count FROM operational_incidents;

  RETURN jsonb_build_object(
    'ok', true,
    'authority_remaining', v_authority_count,
    'operations_remaining', v_operations_count,
    'incidents_remaining', v_incidents_count,
    'total_remaining', v_authority_count + v_operations_count + v_incidents_count
  );
END;
$$;

-- ── 10. count_synthetic — Verify Zero Synthetic Rows ───────────────────────
CREATE OR REPLACE FUNCTION authority_probe_v2.count_synthetic()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_probe_v2, pg_catalog
AS $$
DECLARE
  v_authority_count INTEGER;
  v_operations_count INTEGER;
  v_incidents_count INTEGER;
BEGIN
  SELECT count(*) INTO v_authority_count FROM reservation_authority;
  SELECT count(*) INTO v_operations_count FROM reservation_operations;
  SELECT count(*) INTO v_incidents_count FROM operational_incidents;

  RETURN jsonb_build_object(
    'ok', true,
    'authority_count', v_authority_count,
    'operations_count', v_operations_count,
    'incidents_count', v_incidents_count,
    'total', v_authority_count + v_operations_count + v_incidents_count
  );
END;
$$;