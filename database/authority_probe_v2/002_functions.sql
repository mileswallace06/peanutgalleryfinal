-- ═══════════════════════════════════════════════════════════════════════════
-- authority_probe_v2 — Stored Functions (002)
--
-- Key changes from authority_v1:
--   1. NO caller-supplied request_hash — canonical_payload computed inside Postgres
--   2. ALL terminal outcomes persisted (conflict, not_found stored, not raised)
--   3. Idempotent incident upsert (ON CONFLICT DO UPDATE, structured success)
--   4. reserve_and_fail is test-only — NOT granted to executor
-- ═══════════════════════════════════════════════════════════════════════════

-- ── initialize_listing ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_probe_v2.initialize_listing(
  p_listing_id     TEXT,
  p_seller_user_id TEXT,
  p_operation_id   TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp
AS $$
DECLARE
  v_canonical_payload JSONB;
  v_existing reservation_operations%ROWTYPE;
  v_result JSONB;
BEGIN
  v_canonical_payload := jsonb_build_object(
    'operation_type', 'initialize',
    'listing_id', p_listing_id,
    'seller_user_id', p_seller_user_id
  );

  INSERT INTO reservation_operations (operation_id, subject_type, subject_id, listing_id,
    operation_type, requested_state, expected_version, canonical_payload, status)
  VALUES (p_operation_id, 'listing', p_listing_id, p_listing_id,
    'initialize', 'available', 0, v_canonical_payload, 'pending')
  ON CONFLICT (operation_id) DO NOTHING;

  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;

  IF v_existing.status IN ('committed','conflict','rejected','not_found','invalid_transition') THEN
    IF v_existing.canonical_payload = v_canonical_payload THEN
      UPDATE reservation_operations SET status = 'idempotent_replay'
        WHERE operation_id = p_operation_id AND status <> 'idempotent_replay';
      RETURN v_existing.result_json::JSONB;
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT');
    END IF;
  END IF;

  BEGIN
    INSERT INTO reservation_authority (listing_id, version, lifecycle_state, seller_user_id)
    VALUES (p_listing_id, 0, 'available', p_seller_user_id);
  EXCEPTION WHEN unique_violation THEN
    v_result := jsonb_build_object('ok', false, 'code', 'ALREADY_EXISTS');
    UPDATE reservation_operations SET status = 'conflict', result_json = v_result::TEXT,
      error_code = 'ALREADY_EXISTS', committed_at = now()
      WHERE operation_id = p_operation_id;
    RETURN v_result;
  END;

  v_result := jsonb_build_object('ok', true, 'version', 0);
  UPDATE reservation_operations SET status = 'committed', result_json = v_result::TEXT,
    committed_at = now()
    WHERE operation_id = p_operation_id;
  RETURN v_result;
END;
$$;

-- ── reserve_listing ────────────────────────────────────────────────────────
-- CAS: available → reserved. All terminal outcomes persisted.
-- A stale-version CONFLICT is stored permanently — future replays with the
-- same operation_id + same canonical_payload return the stored CONFLICT,
-- even if the listing later reaches the originally requested version.
CREATE OR REPLACE FUNCTION authority_probe_v2.reserve_listing(
  p_listing_id      TEXT,
  p_expected_version INTEGER,
  p_buyer_user_id   TEXT,
  p_token_hash      TEXT,
  p_expires_at      TIMESTAMPTZ,
  p_operation_id    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp
AS $$
DECLARE
  v_canonical_payload JSONB;
  v_existing reservation_operations%ROWTYPE;
  v_new_version INTEGER;
  v_revision TEXT;
  v_result JSONB;
BEGIN
  v_canonical_payload := jsonb_build_object(
    'operation_type', 'reserve',
    'requested_state', 'reserved',
    'listing_id', p_listing_id,
    'expected_version', p_expected_version,
    'buyer_user_id', p_buyer_user_id,
    'token_hash', p_token_hash,
    'expires_at', p_expires_at
  );

  INSERT INTO reservation_operations (operation_id, subject_type, subject_id, listing_id,
    operation_type, requested_state, expected_version, canonical_payload, status)
  VALUES (p_operation_id, 'listing', p_listing_id, p_listing_id,
    'reserve', 'reserved', p_expected_version, v_canonical_payload, 'pending')
  ON CONFLICT (operation_id) DO NOTHING;

  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;

  IF v_existing.status IN ('committed','conflict','rejected','not_found','invalid_transition') THEN
    IF v_existing.canonical_payload = v_canonical_payload THEN
      UPDATE reservation_operations SET status = 'idempotent_replay'
        WHERE operation_id = p_operation_id AND status <> 'idempotent_replay';
      RETURN v_existing.result_json::JSONB;
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT');
    END IF;
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
    IF EXISTS(SELECT 1 FROM reservation_authority WHERE listing_id = p_listing_id) THEN
      v_result := jsonb_build_object('ok', false, 'code', 'CONFLICT');
      UPDATE reservation_operations SET status = 'conflict', result_json = v_result::TEXT,
        error_code = 'CONFLICT', committed_at = now()
        WHERE operation_id = p_operation_id;
    ELSE
      v_result := jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
      UPDATE reservation_operations SET status = 'not_found', result_json = v_result::TEXT,
        error_code = 'NOT_FOUND', committed_at = now()
        WHERE operation_id = p_operation_id;
    END IF;
    RETURN v_result;
  END IF;

  v_result := jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision);
  UPDATE reservation_operations SET status = 'committed', result_json = v_result::TEXT,
    committed_at = now()
    WHERE operation_id = p_operation_id;
  RETURN v_result;
END;
$$;

-- ── release_listing ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_probe_v2.release_listing(
  p_listing_id      TEXT,
  p_expected_version INTEGER,
  p_buyer_user_id   TEXT,
  p_operation_id    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp
AS $$
DECLARE
  v_canonical_payload JSONB;
  v_existing reservation_operations%ROWTYPE;
  v_new_version INTEGER;
  v_revision TEXT;
  v_result JSONB;
BEGIN
  v_canonical_payload := jsonb_build_object(
    'operation_type', 'release',
    'requested_state', 'available',
    'listing_id', p_listing_id,
    'expected_version', p_expected_version,
    'buyer_user_id', p_buyer_user_id
  );

  INSERT INTO reservation_operations (operation_id, subject_type, subject_id, listing_id,
    operation_type, requested_state, expected_version, canonical_payload, status)
  VALUES (p_operation_id, 'listing', p_listing_id, p_listing_id,
    'release', 'available', p_expected_version, v_canonical_payload, 'pending')
  ON CONFLICT (operation_id) DO NOTHING;

  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;

  IF v_existing.status IN ('committed','conflict','rejected','not_found','invalid_transition') THEN
    IF v_existing.canonical_payload = v_canonical_payload THEN
      UPDATE reservation_operations SET status = 'idempotent_replay'
        WHERE operation_id = p_operation_id AND status <> 'idempotent_replay';
      RETURN v_existing.result_json::JSONB;
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT');
    END IF;
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
    IF EXISTS(SELECT 1 FROM reservation_authority WHERE listing_id = p_listing_id) THEN
      v_result := jsonb_build_object('ok', false, 'code', 'CONFLICT');
      UPDATE reservation_operations SET status = 'conflict', result_json = v_result::TEXT,
        error_code = 'CONFLICT', committed_at = now()
        WHERE operation_id = p_operation_id;
    ELSE
      v_result := jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
      UPDATE reservation_operations SET status = 'not_found', result_json = v_result::TEXT,
        error_code = 'NOT_FOUND', committed_at = now()
        WHERE operation_id = p_operation_id;
    END IF;
    RETURN v_result;
  END IF;

  v_result := jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision);
  UPDATE reservation_operations SET status = 'committed', result_json = v_result::TEXT,
    committed_at = now()
    WHERE operation_id = p_operation_id;
  RETURN v_result;
END;
$$;

-- ── get_state ─────────────────────────────────────────────────────────────
-- State read through a stored function — executor has no direct table SELECT.
CREATE OR REPLACE FUNCTION authority_probe_v2.get_state(p_listing_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp
AS $$
DECLARE v_row reservation_authority%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM reservation_authority WHERE listing_id = p_listing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'version', v_row.version,
    'listing_id', v_row.listing_id,
    'buyer_user_id', v_row.buyer_user_id,
    'seller_user_id', v_row.seller_user_id,
    'lifecycle_state', v_row.lifecycle_state,
    'reservation_revision', v_row.reservation_revision
  );
END;
$$;

-- ── get_operation ──────────────────────────────────────────────────────────
-- Operation lookup/recovery by operation ID.
CREATE OR REPLACE FUNCTION authority_probe_v2.get_operation(p_operation_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp
AS $$
DECLARE v_row reservation_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM reservation_operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'operation_id', v_row.operation_id,
    'status', v_row.status,
    'result', CASE WHEN v_row.result_json IS NOT NULL THEN v_row.result_json::JSONB ELSE NULL END,
    'canonical_payload', v_row.canonical_payload,
    'error_code', v_row.error_code
  );
END;
$$;

-- ── create_incident ────────────────────────────────────────────────────────
-- Idempotent upsert: ON CONFLICT DO UPDATE. All 100 concurrent callers
-- receive a structured successful result referencing the same incident ID.
-- occurrence_count accurately records repeated detections.
CREATE OR REPLACE FUNCTION authority_probe_v2.create_incident(
  p_incident_key  TEXT,
  p_incident_type TEXT,
  p_priority      TEXT,
  p_title         TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp
AS $$
DECLARE v_id BIGINT; v_count INTEGER;
BEGIN
  INSERT INTO operational_incidents (incident_key, incident_type, priority, title)
  VALUES (p_incident_key, p_incident_type, p_priority, p_title)
  ON CONFLICT (incident_key) DO UPDATE
    SET occurrence_count = operational_incidents.occurrence_count + 1,
        updated_at = now()
  RETURNING incident_id, occurrence_count INTO v_id, v_count;

  RETURN jsonb_build_object('ok', true, 'id', v_id::TEXT, 'occurrence_count', v_count);
END;
$$;

-- ── reserve_and_fail (TEST ONLY — NOT granted to executor) ──────────────────
-- Calls reserve_listing then raises an exception if it succeeded.
-- Tests that a post-update failure within a stored function rolls back
-- all database changes (transactional integrity).
CREATE OR REPLACE FUNCTION authority_probe_v2.reserve_and_fail(
  p_listing_id      TEXT,
  p_expected_version INTEGER,
  p_buyer_user_id   TEXT,
  p_token_hash      TEXT,
  p_expires_at      TIMESTAMPTZ,
  p_operation_id    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  v_result := reserve_listing(
    p_listing_id, p_expected_version, p_buyer_user_id,
    p_token_hash, p_expires_at, p_operation_id
  );
  IF (v_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'INJECTED_FAILURE';
  END IF;
  RETURN v_result;
END;
$$;

-- ── cleanup_synthetic (TEST ONLY — NOT granted to executor) ───────────────
CREATE OR REPLACE FUNCTION authority_probe_v2.cleanup_synthetic(p_prefix TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp
AS $$
DECLARE v_auth INTEGER; v_ops INTEGER; v_inc INTEGER;
BEGIN
  DELETE FROM reservation_authority WHERE listing_id LIKE p_prefix || '%';
  GET DIAGNOSTICS v_auth = ROW_COUNT;
  DELETE FROM reservation_operations WHERE operation_id LIKE p_prefix || '%';
  GET DIAGNOSTICS v_ops = ROW_COUNT;
  DELETE FROM operational_incidents WHERE incident_key LIKE p_prefix || '%';
  GET DIAGNOSTICS v_inc = ROW_COUNT;
  RETURN jsonb_build_object('authority', v_auth, 'operations', v_ops, 'incidents', v_inc);
END;
$$;