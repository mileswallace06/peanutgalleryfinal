-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Transfer Functions (002b)
-- P0-01T: begin_transfer + record_seller_report with precise frozen-version
-- invariant.
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 002b_transfer_functions → 002c_proof_assessment → 002d_buyer_confirmation → 002e_active_capture_context → 003_workers → 004_roles
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 23. begin_transfer — P0-01M Authoritative Transfer-Start ──────────────
-- transfer_state: not_started → in_progress. CAS on version prevents both
-- cancellation and transfer-start from committing the same not-started version.
-- Seller identity verified against authority's seller_user_id.
--
-- FROZEN-VERSION INVARIANT (P0-01T): When the listing is frozen (post-
-- begin_capture), a capture_requested binding exists whose
-- frozen_authority_version equals the authority's pre-mutation version. This
-- function locks that binding BEFORE the authority (matching
-- record_capture_result's lock order: binding → authority) to prevent
-- deadlocks. The binding's frozen_authority_version is then synced to the
-- new authority version so record_capture_result's AUTHORITY_FROZEN_MISMATCH
-- check passes when capture is composed after the transfer sequence.
--
-- If the listing is frozen but no matching binding is found, returns
-- CAPTURE_CONTEXT_MISMATCH with no mutation.
CREATE OR REPLACE FUNCTION authority_v1.begin_transfer(
  p_listing_id TEXT, p_expected_version INTEGER, p_seller_user_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_authority reservation_authority%ROWTYPE;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_new_version INTEGER;
  v_binding_found BOOLEAN;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'begin_transfer', 'in_progress', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- ── Precise invariant: lock the single capture_requested binding whose ──
  -- frozen_authority_version matches the pre-mutation version. Lock order
  -- matches record_capture_result (binding → authority) to prevent deadlocks.
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE listing_id = p_listing_id
    AND capture_state = 'capture_requested'
    AND frozen_authority_version = p_expected_version
  FOR UPDATE;
  v_binding_found := FOUND;

  -- Lock the authority
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id
    AND version = p_expected_version
    AND seller_user_id = p_seller_user_id
    AND lifecycle_state IN ('reserved','frozen')
    AND transfer_state = 'not_started'
    AND recovery_blocked = false
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_authority FROM reservation_authority
    WHERE listing_id = p_listing_id FOR UPDATE;
    IF FOUND AND v_authority.transfer_state = 'in_progress'
       AND v_authority.seller_user_id = p_seller_user_id THEN
      UPDATE reservation_operations SET status = 'idempotent_replay',
        result_json = jsonb_build_object('ok', true, 'transfer_state', 'in_progress',
          'version', v_authority.version, 'idempotent', true)::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'transfer_state', 'in_progress',
        'version', v_authority.version, 'idempotent', true);
    END IF;
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT',
        'reason', 'version mismatch, wrong seller, or transfer already started')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT',
      'reason', 'version mismatch, wrong seller, or transfer already started');
  END IF;

  -- If frozen, require the capture_requested binding with matching version
  IF v_authority.lifecycle_state = 'frozen' AND NOT v_binding_found THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'CAPTURE_CONTEXT_MISMATCH',
      result_json = jsonb_build_object('ok', false, 'code', 'CAPTURE_CONTEXT_MISMATCH',
        'reason', 'frozen listing has no capture_requested binding with matching frozen_authority_version')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CAPTURE_CONTEXT_MISMATCH',
      'reason', 'frozen listing has no capture_requested binding with matching frozen_authority_version');
  END IF;

  -- If binding found, verify buyer context matches authority
  IF v_binding_found AND v_binding.buyer_user_id <> v_authority.buyer_user_id THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'CAPTURE_CONTEXT_MISMATCH',
      result_json = jsonb_build_object('ok', false, 'code', 'CAPTURE_CONTEXT_MISMATCH',
        'reason', 'binding buyer does not match authority buyer')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CAPTURE_CONTEXT_MISMATCH',
      'reason', 'binding buyer does not match authority buyer');
  END IF;

  -- CAS: transfer_state not_started → in_progress
  v_new_version := v_authority.version + 1;
  UPDATE reservation_authority
  SET version = v_new_version, transfer_state = 'in_progress',
      transfer_state_updated_at = now(),
      current_operation_id = p_server_operation_id,
      last_operation_type = 'begin_transfer',
      last_operation_at = now(),
      last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND transfer_state = 'not_started';

  -- Frozen-version invariant: sync the binding's frozen_authority_version
  -- to the new authority version. Update by purchase_id (exact binding).
  IF v_binding_found THEN
    UPDATE reservation_payment_bindings
    SET frozen_authority_version = v_new_version, updated_at = now()
    WHERE purchase_id = v_binding.purchase_id
      AND capture_state = 'capture_requested';
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'transfer_state', 'in_progress',
      'version', v_new_version)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;
  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'transfer_state', 'in_progress'));
  RETURN jsonb_build_object('ok', true, 'transfer_state', 'in_progress',
    'version', v_new_version);
END;
$$;

-- ── 24. record_seller_report — P0-01M Seller Self-Report (Never Provider-Verified) ─
-- transfer_state: in_progress → seller_reported_sent. Seller's attestation only —
-- NEVER provider-verified. Seller identity verified against authority's seller_user_id.
--
-- FROZEN-VERSION INVARIANT (P0-01T): Same as begin_transfer — locks the
-- capture_requested binding before the authority, syncs frozen_authority_version.
CREATE OR REPLACE FUNCTION authority_v1.record_seller_report(
  p_listing_id TEXT, p_expected_version INTEGER, p_seller_user_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_authority reservation_authority%ROWTYPE;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_new_version INTEGER;
  v_binding_found BOOLEAN;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'record_seller_report', 'seller_reported_sent', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- ── Precise invariant: lock the single capture_requested binding whose ──
  -- frozen_authority_version matches the pre-mutation version. Lock order
  -- matches record_capture_result (binding → authority) to prevent deadlocks.
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE listing_id = p_listing_id
    AND capture_state = 'capture_requested'
    AND frozen_authority_version = p_expected_version
  FOR UPDATE;
  v_binding_found := FOUND;

  -- Lock the authority
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id
    AND version = p_expected_version
    AND seller_user_id = p_seller_user_id
    AND transfer_state = 'in_progress'
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_authority FROM reservation_authority
    WHERE listing_id = p_listing_id FOR UPDATE;
    IF FOUND AND v_authority.transfer_state = 'seller_reported_sent'
       AND v_authority.seller_user_id = p_seller_user_id THEN
      UPDATE reservation_operations SET status = 'idempotent_replay',
        result_json = jsonb_build_object('ok', true, 'transfer_state', 'seller_reported_sent',
          'version', v_authority.version, 'idempotent', true)::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'transfer_state', 'seller_reported_sent',
        'version', v_authority.version, 'idempotent', true);
    END IF;
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT',
        'reason', 'version mismatch, wrong seller, or transfer not in progress')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT',
      'reason', 'version mismatch, wrong seller, or transfer not in progress');
  END IF;

  -- If frozen, require the capture_requested binding with matching version
  IF v_authority.lifecycle_state = 'frozen' AND NOT v_binding_found THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'CAPTURE_CONTEXT_MISMATCH',
      result_json = jsonb_build_object('ok', false, 'code', 'CAPTURE_CONTEXT_MISMATCH',
        'reason', 'frozen listing has no capture_requested binding with matching frozen_authority_version')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CAPTURE_CONTEXT_MISMATCH',
      'reason', 'frozen listing has no capture_requested binding with matching frozen_authority_version');
  END IF;

  -- If binding found, verify buyer context matches authority
  IF v_binding_found AND v_binding.buyer_user_id <> v_authority.buyer_user_id THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'CAPTURE_CONTEXT_MISMATCH',
      result_json = jsonb_build_object('ok', false, 'code', 'CAPTURE_CONTEXT_MISMATCH',
        'reason', 'binding buyer does not match authority buyer')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CAPTURE_CONTEXT_MISMATCH',
      'reason', 'binding buyer does not match authority buyer');
  END IF;

  -- CAS: transfer_state in_progress → seller_reported_sent
  v_new_version := v_authority.version + 1;
  UPDATE reservation_authority
  SET version = v_new_version, transfer_state = 'seller_reported_sent',
      transfer_state_updated_at = now(),
      current_operation_id = p_server_operation_id,
      last_operation_type = 'record_seller_report',
      last_operation_at = now(),
      last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND transfer_state = 'in_progress';

  -- Frozen-version invariant: sync the binding's frozen_authority_version
  -- to the new authority version. Update by purchase_id (exact binding).
  IF v_binding_found THEN
    UPDATE reservation_payment_bindings
    SET frozen_authority_version = v_new_version, updated_at = now()
    WHERE purchase_id = v_binding.purchase_id
      AND capture_state = 'capture_requested';
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'transfer_state', 'seller_reported_sent',
      'version', v_new_version, 'provider_verified', false)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;
  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'transfer_state', 'seller_reported_sent',
      'provider_verified', false));
  RETURN jsonb_build_object('ok', true, 'transfer_state', 'seller_reported_sent',
    'version', v_new_version, 'provider_verified', false);
END;
$$;