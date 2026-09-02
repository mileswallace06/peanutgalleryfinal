-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Transfer Functions (002b)
-- Extracted from 002_functions.sql to manage file size.
-- INSTALLATION ORDER: 001_schema → 002_functions → 002b_transfer_functions → 003_workers → 004_roles
-- All functions here must exist before 004 grants EXECUTE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 23. begin_transfer — P0-01M Authoritative Transfer-Start ──────────────
-- Transitions transfer_state: not_started → in_progress. This is the
-- "transfer-start" operation that races with cancellation. Both operations
-- use the same reservation_authority row lock (FOR UPDATE) and CAS on
-- version — only one can commit from the same not-started version.
--
-- INVARIANTS:
--   1. cancellation and transfer-start cannot both commit from the same
--      not-started version (CAS on version prevents this)
--   2. if cancellation commits first (version incremented), a later
--      transfer-start with the old version is rejected (CONFLICT)
--   3. if transfer-start commits first (version incremented), cancellation
--      must re-read and retry with the new version — cancellation may still
--      proceed but inventory remains quarantined
--   4. no transfer state permits automatic relisting
--
-- Seller identity is verified against the authority's seller_user_id —
-- never from client-supplied data.
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
  v_new_version INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'begin_transfer', 'in_progress', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Lock and verify authority: must be reserved/frozen, not_started, matching seller
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id
    AND version = p_expected_version
    AND seller_user_id = p_seller_user_id
    AND lifecycle_state IN ('reserved','frozen')
    AND transfer_state = 'not_started'
    AND recovery_blocked = false
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Check if transfer_state is already not not_started (idempotent replay
    -- of a prior transfer-start, or transfer already in progress)
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

  -- CAS: not_started → in_progress (version increments)
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
-- Transitions transfer_state: in_progress → seller_reported_sent.
-- This is the seller's self-report that they have sent the tickets. It is
-- NEVER labeled or treated as provider-verified delivery. The state
-- 'seller_reported_sent' is the seller's attestation only — it does not
-- prove that the transfer was received by the buyer or verified by the
-- ticketing platform. Seller identity is verified against the authority's
-- seller_user_id.
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
  v_new_version INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'record_seller_report', 'seller_reported_sent', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Lock and verify: must be in_progress, matching seller
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id
    AND version = p_expected_version
    AND seller_user_id = p_seller_user_id
    AND transfer_state = 'in_progress'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Check if already seller_reported_sent (idempotent replay)
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

  -- CAS: in_progress → seller_reported_sent (version increments)
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

-- ── 25. record_transfer_proof_assessment — P0-01S Advisory AI Proof Assessment ──
-- Records an ADVISORY AI proof assessment on reservation_payment_bindings.
-- CRITICAL: AI analysis is advisory evidence. This function MUST NEVER mark a
-- transfer completed, release payment, trigger payout, refund, cancel, relist
-- inventory, or change transfer_state. It locks reservation_authority FOR UPDATE
-- (same lock order as begin_transfer/record_seller_report) to verify the seller
-- linkage and eligible transfer state, but does NOT increment version or change
-- transfer_state. The assessment is recorded on reservation_payment_bindings only.
-- Assessment states: 'ai_likely_valid','ai_uncertain','ai_suspicious' (advisory only).
CREATE OR REPLACE FUNCTION authority_v1.record_transfer_proof_assessment(
  p_listing_id TEXT, p_expected_version INTEGER, p_seller_user_id TEXT,
  p_purchase_id TEXT, p_proof_asset_id_hash TEXT,
  p_assessment_state TEXT, p_assessment_data JSONB,
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
  v_row_count INTEGER;
BEGIN
  IF p_assessment_state NOT IN ('ai_likely_valid','ai_uncertain','ai_suspicious') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ASSESSMENT_STATE', 'received', p_assessment_state);
  END IF;
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'record_proof_assessment', p_assessment_state, p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired AND v_op_status = 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONCURRENT_ASSESSMENT');
  END IF;
  IF NOT v_acquired THEN RETURN jsonb_build_object('ok', false, 'code', v_op_status); END IF;
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND seller_user_id = p_seller_user_id
    AND lifecycle_state NOT IN ('cancelled','expired')
    AND transfer_state <> 'terminal_cancelled'
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_authority FROM reservation_authority WHERE listing_id = p_listing_id FOR UPDATE;
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT',
        'reason', 'version mismatch, wrong seller, or ineligible state')::TEXT, committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT',
      'reason', 'version mismatch, wrong seller, or ineligible state');
  END IF;
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id AND listing_id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'BINDING_NOT_FOUND',
      result_json = jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND')::TEXT, committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND');
  END IF;
  UPDATE reservation_payment_bindings
  SET proof_assessment_state = p_assessment_state, proof_assessment_data = p_assessment_data,
      proof_asset_id_hash = p_proof_asset_id_hash, proof_assessment_at = now(), updated_at = now()
  WHERE purchase_id = p_purchase_id AND listing_id = p_listing_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF NOT v_row_count THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'BINDING_UPDATE_FAILED',
      result_json = jsonb_build_object('ok', false, 'code', 'BINDING_UPDATE_FAILED')::TEXT, committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'BINDING_UPDATE_FAILED');
  END IF;
  UPDATE reservation_operations SET status = 'committed', committed_version = p_expected_version,
    result_json = jsonb_build_object('ok', true, 'assessment_state', p_assessment_state,
      'transfer_state', v_authority.transfer_state, 'transfer_state_unchanged', true,
      'version', v_authority.version, 'version_unchanged', true)::TEXT, committed_at = now()
  WHERE operation_id = p_server_operation_id;
  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, p_expected_version, 'mirror_project',
    jsonb_build_object('assessment_state', p_assessment_state, 'transfer_state', v_authority.transfer_state,
      'transfer_state_unchanged', true, 'advisory_only', true));
  RETURN jsonb_build_object('ok', true, 'assessment_state', p_assessment_state,
    'transfer_state', v_authority.transfer_state, 'transfer_state_unchanged', true,
    'version', v_authority.version, 'version_unchanged', true);
END;
$$;