-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Proof Assessment Function (002c)
-- P0-01S: Advisory AI Proof Assessment
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 002c_proof_assessment → 002d_buyer_confirmation → 003_workers → 004_roles
-- This file must exist before 004 grants EXECUTE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 25. record_transfer_proof_assessment — P0-01S Advisory AI Proof Assessment ──
-- Records an ADVISORY AI proof assessment on reservation_payment_bindings.
-- CRITICAL: AI analysis is advisory evidence. This function MUST NEVER mark a
-- transfer completed, release payment, trigger payout, refund, cancel, relist
-- inventory, or change transfer_state. It locks reservation_authority FOR UPDATE
-- (same lock order as begin_transfer/record_seller_report) to verify the seller
-- linkage and eligible transfer state, but does NOT increment version or change
-- transfer_state. The assessment is recorded on reservation_payment_bindings only.
--
-- CONFLICT DETECTION: A second assessment with a DIFFERENT proof_asset_id_hash
-- is rejected with PROOF_ASSET_CONFLICT — it does NOT silently overwrite the
-- first assessment. A replay with the SAME proof_asset_id_hash (e.g. re-processing
-- the same proof after a transient failure) is allowed and updates the assessment
-- data (idempotent re-assessment of the same proof).
--
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

  -- Lock authority: verify seller linkage and eligible (non-terminal) state
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

  -- Lock binding
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id AND listing_id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'BINDING_NOT_FOUND',
      result_json = jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND')::TEXT, committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND');
  END IF;

  -- CONFLICT DETECTION: a different proof asset was already assessed — reject
  IF v_binding.proof_asset_id_hash IS NOT NULL
     AND v_binding.proof_asset_id_hash <> p_proof_asset_id_hash THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'PROOF_ASSET_CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'PROOF_ASSET_CONFLICT',
        'reason', 'A different proof asset was already assessed for this purchase',
        'existing_proof_asset_id_hash', v_binding.proof_asset_id_hash,
        'attempted_proof_asset_id_hash', p_proof_asset_id_hash)::TEXT, committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'PROOF_ASSET_CONFLICT',
      'reason', 'A different proof asset was already assessed for this purchase',
      'existing_proof_asset_id_hash', v_binding.proof_asset_id_hash,
      'attempted_proof_asset_id_hash', p_proof_asset_id_hash);
  END IF;

  -- CONFLICT DETECTION: same proof already assessed by a different operation — reject.
  -- An exact replay (same operation_id + request_hash) is handled by acquire_operation
  -- above and returns the original result. Reaching here with a non-null assessment
  -- means a DIFFERENT operation is attempting to re-assess the same proof. This must
  -- NOT silently overwrite — return PROOF_ALREADY_ASSESSED. An explicit versioned
  -- reassessment path would be required to override (not yet implemented).
  IF v_binding.proof_asset_id_hash = p_proof_asset_id_hash
     AND v_binding.proof_assessment_state IS NOT NULL THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'PROOF_ALREADY_ASSESSED',
      result_json = jsonb_build_object('ok', false, 'code', 'PROOF_ALREADY_ASSESSED',
        'reason', 'This proof asset was already assessed by a different operation',
        'existing_assessment_state', v_binding.proof_assessment_state,
        'existing_proof_asset_id_hash', v_binding.proof_asset_id_hash)::TEXT, committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'PROOF_ALREADY_ASSESSED',
      'reason', 'This proof asset was already assessed by a different operation',
      'existing_assessment_state', v_binding.proof_assessment_state,
      'existing_proof_asset_id_hash', v_binding.proof_asset_id_hash);
  END IF;

  -- Record advisory assessment (first assessment of this proof — no prior assessment exists)
  UPDATE reservation_payment_bindings
  SET proof_assessment_state = p_assessment_state, proof_assessment_data = p_assessment_data,
      proof_asset_id_hash = p_proof_asset_id_hash, proof_assessment_at = now(), updated_at = now()
  WHERE purchase_id = p_purchase_id AND listing_id = p_listing_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'BINDING_UPDATE_FAILED',
      result_json = jsonb_build_object('ok', false, 'code', 'BINDING_UPDATE_FAILED')::TEXT, committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'BINDING_UPDATE_FAILED');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = p_expected_version,
    result_json = jsonb_build_object('ok', true, 'assessment_state', p_assessment_state,
      'transfer_state', v_authority.transfer_state, 'transfer_state_unchanged', true,
      'version', v_authority.version, 'version_unchanged', true,
      'proof_asset_id_hash', p_proof_asset_id_hash,
      'idempotent_reassessment', v_binding.proof_asset_id_hash IS NOT NULL)::TEXT, committed_at = now()
  WHERE operation_id = p_server_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, p_expected_version, 'mirror_project',
    jsonb_build_object('assessment_state', p_assessment_state, 'transfer_state', v_authority.transfer_state,
      'transfer_state_unchanged', true, 'advisory_only', true,
      'proof_asset_id_hash', p_proof_asset_id_hash));

  RETURN jsonb_build_object('ok', true, 'assessment_state', p_assessment_state,
    'transfer_state', v_authority.transfer_state, 'transfer_state_unchanged', true,
    'version', v_authority.version, 'version_unchanged', true,
    'proof_asset_id_hash', p_proof_asset_id_hash,
    'idempotent_reassessment', v_binding.proof_asset_id_hash IS NOT NULL);
END;
$$;