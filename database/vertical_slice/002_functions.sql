-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Vertical Slice Stored Functions (Phase 1B live proof)
-- 5 functions: initialize_listing, get_state, reserve_listing, release_listing,
-- create_incident.
-- All SECURITY DEFINER with search_path = authority_v1, pg_temp.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── initialize_listing ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.initialize_listing(
  p_listing_id    TEXT,
  p_seller_user_id TEXT,
  p_operation_id  TEXT,
  p_request_hash  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_existing reservation_operations%ROWTYPE;
BEGIN
  INSERT INTO reservation_operations (operation_id, subject_type, subject_id, listing_id, operation_type, requested_state, expected_version, request_hash, status)
  VALUES (p_operation_id, 'listing', p_listing_id, p_listing_id, 'initialize', 'available', 0, p_request_hash, 'pending')
  ON CONFLICT (operation_id) DO NOTHING;

  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;

  IF v_existing.request_hash = p_request_hash AND v_existing.status = 'committed' THEN
    RETURN v_existing.result_json::JSONB;
  ELSIF v_existing.request_hash != p_request_hash THEN
    RAISE EXCEPTION 'OPERATION_ID_CONFLICT';
  END IF;

  IF EXISTS (SELECT 1 FROM reservation_authority WHERE listing_id = p_listing_id) THEN
    IF EXISTS (SELECT 1 FROM reservation_authority WHERE listing_id = p_listing_id AND seller_user_id = p_seller_user_id) THEN
      UPDATE reservation_operations SET status = 'committed', committed_version = 0,
        result_json = jsonb_build_object('ok', true, 'version', 0, 'already_exists', true),
        committed_at = now()
      WHERE operation_id = p_operation_id;
      RETURN jsonb_build_object('ok', true, 'version', 0, 'already_exists', true);
    ELSE
      RAISE EXCEPTION 'INITIALIZE_CONFLICT';
    END IF;
  END IF;

  INSERT INTO reservation_authority (listing_id, version, lifecycle_state, seller_user_id)
  VALUES (p_listing_id, 0, 'available', p_seller_user_id);

  UPDATE reservation_operations SET status = 'committed', committed_version = 0,
    result_json = jsonb_build_object('ok', true, 'version', 0),
    committed_at = now()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('ok', true, 'version', 0);
END;
$$;

-- ── get_state ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.get_state(
  p_listing_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp
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

-- ── reserve_listing ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.reserve_listing(
  p_listing_id      TEXT,
  p_expected_version INTEGER,
  p_buyer_user_id   TEXT,
  p_token_hash      TEXT,
  p_expires_at      TIMESTAMPTZ,
  p_operation_id    TEXT,
  p_request_hash    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_new_version INTEGER;
  v_revision    TEXT;
  v_existing    reservation_operations%ROWTYPE;
BEGIN
  INSERT INTO reservation_operations (operation_id, subject_type, subject_id, listing_id, operation_type, requested_state, expected_version, request_hash, status)
  VALUES (p_operation_id, 'listing', p_listing_id, p_listing_id, 'reserve', 'reserved', p_expected_version, p_request_hash, 'pending')
  ON CONFLICT (operation_id) DO NOTHING;

  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;

  IF v_existing.request_hash = p_request_hash AND v_existing.status = 'committed' THEN
    RETURN v_existing.result_json::JSONB;
  ELSIF v_existing.request_hash != p_request_hash THEN
    RAISE EXCEPTION 'OPERATION_ID_CONFLICT';
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'reserved',
      buyer_user_id = p_buyer_user_id, reservation_token_hash = p_token_hash,
      reservation_expires_at = p_expires_at, reservation_revision = v_revision,
      updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version AND lifecycle_state = 'available'
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT'
    WHERE operation_id = p_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision),
    committed_at = now()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision);
END;
$$;

-- ── release_listing ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.release_listing(
  p_listing_id      TEXT,
  p_expected_version INTEGER,
  p_buyer_user_id   TEXT,
  p_operation_id    TEXT,
  p_request_hash    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_new_version INTEGER;
  v_revision    TEXT;
  v_existing    reservation_operations%ROWTYPE;
BEGIN
  INSERT INTO reservation_operations (operation_id, subject_type, subject_id, listing_id, operation_type, requested_state, expected_version, request_hash, status)
  VALUES (p_operation_id, 'listing', p_listing_id, p_listing_id, 'release', 'available', p_expected_version, p_request_hash, 'pending')
  ON CONFLICT (operation_id) DO NOTHING;

  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;

  IF v_existing.request_hash = p_request_hash AND v_existing.status = 'committed' THEN
    RETURN v_existing.result_json::JSONB;
  ELSIF v_existing.request_hash != p_request_hash THEN
    RAISE EXCEPTION 'OPERATION_ID_CONFLICT';
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
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT'
    WHERE operation_id = p_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version),
    committed_at = now()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('ok', true, 'version', v_new_version);
END;
$$;

-- ── create_incident ────────────────────────────────────────────────────────
-- No ON CONFLICT — the UNIQUE constraint on incident_key is the authority.
-- Concurrent duplicates raise a unique_violation (23505) which the caller catches.
CREATE OR REPLACE FUNCTION authority_v1.create_incident(
  p_incident_key  TEXT,
  p_incident_type TEXT,
  p_priority      TEXT,
  p_title         TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO operational_incidents (incident_key, incident_type, priority, title)
  VALUES (p_incident_key, p_incident_type, p_priority, p_title)
  RETURNING incident_id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id::TEXT);
END;
$$;

-- ── reserve_and_fail ───────────────────────────────────────────────────────
-- Calls reserve_listing then raises an exception if it succeeded.
-- Tests that a post-update failure within a stored function rolls back all
-- database changes (transactional integrity of SECURITY DEFINER functions).
CREATE OR REPLACE FUNCTION authority_v1.reserve_and_fail(
  p_listing_id      TEXT,
  p_expected_version INTEGER,
  p_buyer_user_id   TEXT,
  p_token_hash      TEXT,
  p_expires_at      TIMESTAMPTZ,
  p_operation_id    TEXT,
  p_request_hash    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  v_result := reserve_listing(
    p_listing_id, p_expected_version, p_buyer_user_id,
    p_token_hash, p_expires_at, p_operation_id, p_request_hash
  );

  IF (v_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'INJECTED_FAILURE';
  END IF;

  RETURN v_result;
END;
$$;