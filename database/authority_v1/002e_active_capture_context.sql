-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Active Capture Context (002e) — P0-01T-CORRECTIVE-3
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 002b_transfer_functions
--                     → 002c_proof_assessment → 002d_buyer_confirmation → 002e_active_capture_context
--                     → 002f_no_relist_invariant → 003_workers → 004_roles_and_grants
--
-- Dedicated executor-only function to retrieve the active capture payment
-- action's action_id and Stripe idempotency key. These values are sensitive
-- operational credentials used to compose capture after buyer confirmation
-- (P0-01T). They MUST NOT be exposed through the general get_state function,
-- which is callable by broader consumers and projected to mirrors.
--
-- P0-01T-CORRECTIVE-3: Exact capture context validation.
--   - Validates the binding against ALL four values (listing_id, purchase_id,
--     payment_intent_id, buyer_user_id).
--   - Validates the payment action against listing_id, purchase_id,
--     payment_intent_id, action_type = 'capture'.
--   - Returns binding_capture_state and action_status as SEPARATE fields.
--     Does NOT label the action status as capture_state.
--   - Only treats these state pairs as valid (returns credentials):
--       Normal capture:         binding=capture_requested, action=pending|in_flight
--       Unknown reconciliation: binding=capture_unknown,   action=unknown
--   - Every other combination returns no action ID, no Stripe idempotency
--     key, and no active context (has_active_capture=false).
--
-- SECURITY:
--   - SECURITY DEFINER with hardened search_path (pg_temp last).
--   - Granted ONLY to authority_executor in 004_roles_and_grants.sql.
--   - NOT granted to authority_stripe_recorder, authority_worker, or PUBLIC.
--   - EXECUTE revoked from PUBLIC in 004_roles_and_grants.sql.
--   - Returns action_id + stripe_idempotency_key ONLY for valid state pairs.
--     Terminal or mismatched actions return null credentials.
--   - Never logs or exposes the idempotency key outside the return value.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the obsolete one-argument overload (P0-01T-CORRECTIVE-2)
DROP FUNCTION IF EXISTS authority_v1.get_active_capture_context(TEXT);

CREATE OR REPLACE FUNCTION authority_v1.get_active_capture_context(
  p_listing_id TEXT,
  p_purchase_id TEXT,
  p_payment_intent_id TEXT,
  p_buyer_user_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_action  payment_actions%ROWTYPE;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_binding_found BOOLEAN := false;
  v_action_found BOOLEAN := false;
  v_valid_pair BOOLEAN := false;
BEGIN
  -- ── 1. Validate the binding against ALL four values ──────────────────────
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE listing_id = p_listing_id
    AND purchase_id = p_purchase_id
    AND payment_intent_id = p_payment_intent_id
    AND buyer_user_id = p_buyer_user_id
  FOR UPDATE;

  v_binding_found := FOUND;

  IF NOT v_binding_found THEN
    -- Binding not found: wrong buyer, wrong purchase, or wrong payment_intent.
    -- The orchestrator uses this to return 403 NOT_BUYER (not CAPTURE_CONTEXT_MISMATCH).
    RETURN jsonb_build_object(
      'ok', true,
      'has_active_capture', false,
      'binding_found', false,
      'binding_capture_state', null,
      'action_status', null,
      'action_id', null,
      'stripe_idempotency_key', null
    );
  END IF;

  -- ── 2. Validate the payment action against listing, purchase, PI, type=capture ─
  SELECT * INTO v_action
  FROM payment_actions
  WHERE listing_id = p_listing_id
    AND purchase_id = p_purchase_id
    AND payment_intent_id = p_payment_intent_id
    AND action_type = 'capture'
  ORDER BY created_at DESC
  LIMIT 1;

  v_action_found := FOUND;

  IF NOT v_action_found THEN
    -- Binding found but no capture action at all.
    RETURN jsonb_build_object(
      'ok', true,
      'has_active_capture', false,
      'binding_found', true,
      'binding_capture_state', v_binding.capture_state,
      'action_status', null,
      'action_id', null,
      'stripe_idempotency_key', null
    );
  END IF;

  -- ── 3. Determine if this is a valid state pair ─────────────────────────────
  -- Only these pairs are valid for returning credentials:
  --   Normal capture:         binding=capture_requested, action=pending|in_flight
  --   Unknown reconciliation: binding=capture_unknown,   action=unknown
  IF v_binding.capture_state = 'capture_requested'
     AND v_action.status IN ('pending', 'in_flight') THEN
    v_valid_pair := true;
  ELSIF v_binding.capture_state = 'capture_unknown'
        AND v_action.status = 'unknown' THEN
    v_valid_pair := true;
  END IF;

  IF NOT v_valid_pair THEN
    -- Mismatched or terminal state pair — no credentials returned.
    RETURN jsonb_build_object(
      'ok', true,
      'has_active_capture', false,
      'binding_found', true,
      'binding_capture_state', v_binding.capture_state,
      'action_status', v_action.status,
      'action_id', null,
      'stripe_idempotency_key', null
    );
  END IF;

  -- ── 4. Valid state pair — return credentials ───────────────────────────────
  RETURN jsonb_build_object(
    'ok', true,
    'has_active_capture', true,
    'binding_found', true,
    'binding_capture_state', v_binding.capture_state,
    'action_status', v_action.status,
    'action_id', v_action.action_id,
    'stripe_idempotency_key', v_action.stripe_idempotency_key
  );
END;
$$;