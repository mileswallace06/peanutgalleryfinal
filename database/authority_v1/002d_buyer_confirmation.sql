-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Buyer Transfer Confirmation Function (002d)
-- P0-01T: Authoritative Buyer Confirmation
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 002b_transfer_functions → 002c_proof_assessment → 002d_buyer_confirmation → 002e_active_capture_context → 003_workers → 004_roles_and_grants
-- This file must exist before 004 grants EXECUTE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 26. record_buyer_transfer_confirmation — P0-01T Authoritative Buyer Confirmation ──
-- Records the authenticated buyer's confirmation of ticket receipt as an
-- explicit transfer_state: 'buyer_confirmed_received'. This means ONLY that
-- the authenticated buyer confirmed receipt — it is NOT provider verification.
--
-- CRITICAL: This function MUST NEVER trigger payout, capture, refund, release,
-- relist, or recovery-unblock. It records the buyer's confirmation in the
-- authority and creates a mirror outbox event. No financial side effects.
--
-- CAS: Transitions transfer_state from 'in_progress' or 'seller_reported_sent'
-- to 'buyer_confirmed_received' with version increment. Stale version → CONFLICT.
--
-- BUYER IDENTITY: Derived from the authenticated session (p_buyer_user_id) and
-- verified against reservation_payment_bindings.buyer_user_id. The binding
-- retains buyer_user_id even after terminal transitions (sold/available) where
-- authority.buyer_user_id is cleared. Never trusts request-supplied identity.
--
-- TERMINAL REPLAY (P0-01T-CORRECTIVE-2): When lifecycle_state is 'sold' or
-- 'available', authority.buyer_user_id is cleared on terminal transition.
-- The binding still holds buyer_user_id. This function validates buyer identity
-- via the binding and returns an idempotent replay for authorized buyers.
-- A different user → 403 NOT_BUYER. buyer_user_id is NEVER returned in any
-- response (do not expose buyer email publicly).
--
-- LOCK ORDER: reservation_payment_bindings FOR UPDATE before
-- reservation_authority FOR UPDATE (canonical: binding → authority).
--
-- IDEMPOTENT REPLAY: Same operation_id + request_hash → returns stored result.
-- A different operation attempting to re-confirm → ALREADY_CONFIRMED (no
-- silent overwrite).
CREATE OR REPLACE FUNCTION authority_v1.record_buyer_transfer_confirmation(
  p_listing_id TEXT, p_expected_version INTEGER, p_buyer_user_id TEXT,
  p_purchase_id TEXT, p_server_operation_id TEXT, p_request_hash TEXT
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
  v_row_count INTEGER;
BEGIN
  -- Acquire operation (idempotent replay safety)
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'record_buyer_confirmation', 'buyer_confirmed_received', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay || jsonb_build_object('idempotent', true);
  END IF;
  IF NOT v_acquired AND v_op_status = 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONCURRENT_CONFIRMATION');
  END IF;
  IF NOT v_acquired THEN RETURN jsonb_build_object('ok', false, 'code', v_op_status); END IF;

  -- Lock binding BEFORE authority (canonical lock order: binding → authority)
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id AND listing_id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'BINDING_NOT_FOUND',
      result_json = jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND');
  END IF;

  -- Verify buyer identity against the binding (defense-in-depth).
  -- The binding retains buyer_user_id even after terminal transitions (sold/available)
  -- where authority.buyer_user_id is cleared by record_capture_result.
  IF v_binding.buyer_user_id <> p_buyer_user_id THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'NOT_BUYER',
      result_json = jsonb_build_object('ok', false, 'code', 'NOT_BUYER',
        'reason', 'Authenticated user does not match binding buyer')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_BUYER',
      'reason', 'Authenticated user does not match binding buyer');
  END IF;

  -- Lock authority: verify buyer linkage and eligible state
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND buyer_user_id = p_buyer_user_id
    AND lifecycle_state = 'frozen'
    AND transfer_state IN ('in_progress', 'seller_reported_sent')
    AND recovery_blocked = false
  FOR UPDATE;
  IF NOT FOUND THEN
    -- Re-lock without version filter to determine conflict reason
    SELECT * INTO v_authority FROM reservation_authority
    WHERE listing_id = p_listing_id FOR UPDATE;

    -- Terminal replay (P0-01T-CORRECTIVE-2): sold or available.
    -- authority.buyer_user_id was cleared on terminal transition, but the
    -- binding buyer was already verified above. This is an authorized replay.
    -- buyer_user_id is NOT returned (do not expose buyer email publicly).
    IF FOUND AND v_authority.lifecycle_state IN ('sold', 'available') THEN
      UPDATE reservation_operations SET status = 'idempotent_replay',
        result_json = jsonb_build_object('ok', true, 'transfer_state', v_authority.transfer_state,
          'version', v_authority.version, 'idempotent', true,
          'lifecycle_state', v_authority.lifecycle_state,
          'buyer_confirmed_at', v_authority.buyer_confirmed_at,
          'no_financial_effects', true)::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'transfer_state', v_authority.transfer_state,
        'version', v_authority.version, 'idempotent', true,
        'lifecycle_state', v_authority.lifecycle_state,
        'buyer_confirmed_at', v_authority.buyer_confirmed_at,
        'no_financial_effects', true);
    END IF;

    -- Idempotent: already buyer_confirmed_received by this buyer (different op).
    -- authority.buyer_user_id may be null (if sold) — binding buyer was verified.
    IF FOUND AND v_authority.transfer_state = 'buyer_confirmed_received' THEN
      UPDATE reservation_operations SET status = 'idempotent_replay',
        result_json = jsonb_build_object('ok', true, 'transfer_state', 'buyer_confirmed_received',
          'version', v_authority.version, 'idempotent', true,
          'buyer_confirmed_at', v_authority.buyer_confirmed_at,
          'no_financial_effects', true)::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'transfer_state', 'buyer_confirmed_received',
        'version', v_authority.version, 'idempotent', true,
        'buyer_confirmed_at', v_authority.buyer_confirmed_at,
        'no_financial_effects', true);
    END IF;

    -- Wrong buyer (authority buyer is non-null and differs — data inconsistency).
    -- Binding already matched, but authority disagrees. Fail-closed.
    IF FOUND AND v_authority.buyer_user_id IS NOT NULL
       AND v_authority.buyer_user_id <> p_buyer_user_id THEN
      UPDATE reservation_operations SET status = 'conflict', error_code = 'NOT_BUYER',
        result_json = jsonb_build_object('ok', false, 'code', 'NOT_BUYER',
          'reason', 'Authenticated user does not match authority buyer')::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_BUYER',
        'reason', 'Authenticated user does not match authority buyer');
    END IF;

    -- Stale version, ineligible lifecycle, or ineligible transfer state
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT',
        'reason', 'version mismatch, wrong buyer, or ineligible state',
        'lifecycle_state', v_authority.lifecycle_state,
        'transfer_state', v_authority.transfer_state)::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT',
      'reason', 'version mismatch, wrong buyer, or ineligible state',
      'lifecycle_state', v_authority.lifecycle_state,
      'transfer_state', v_authority.transfer_state);
  END IF;

  -- CAS transition: in_progress/seller_reported_sent → buyer_confirmed_received
  v_new_version := v_authority.version + 1;
  UPDATE reservation_authority
  SET version = v_new_version,
      transfer_state = 'buyer_confirmed_received',
      transfer_state_updated_at = now(),
      buyer_confirmed_at = now(),
      current_operation_id = p_server_operation_id,
      last_operation_type = 'record_buyer_confirmation',
      last_operation_at = now(),
      last_operation_payload_hash = p_request_hash,
      updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND transfer_state IN ('in_progress', 'seller_reported_sent');
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'STALE_VERSION',
      result_json = jsonb_build_object('ok', false, 'code', 'STALE_VERSION',
        'reason', 'Version changed — retry with current version')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_VERSION',
      'reason', 'Version changed — retry with current version');
  END IF;

  -- Keep binding's frozen_authority_version in sync with the new authority version.
  UPDATE reservation_payment_bindings
  SET frozen_authority_version = v_new_version, updated_at = now()
  WHERE purchase_id = p_purchase_id AND listing_id = p_listing_id;

  -- Commit operation ledger (buyer_user_id NOT included — do not expose buyer email)
  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'transfer_state', 'buyer_confirmed_received',
      'version', v_new_version,
      'buyer_confirmed_at', now(),
      'no_financial_effects', true)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  -- Create mirror outbox event (buyer_user_id NOT included in payload)
  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('transfer_state', 'buyer_confirmed_received', 'buyer_confirmed', true,
      'buyer_confirmed_at', now(),
      'no_financial_effects', true));

  RETURN jsonb_build_object('ok', true, 'transfer_state', 'buyer_confirmed_received',
    'version', v_new_version,
    'buyer_confirmed_at', now(),
    'no_financial_effects', true);
END;
$$;