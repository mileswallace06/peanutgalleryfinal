-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Active Capture Context (002e) — P0-01T-CORRECTIVE-2
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 002b_transfer_functions
--                     → 002c_proof_assessment → 002d_buyer_confirmation → 002e_active_capture_context
--                     → 003_workers → 004_roles_and_grants
--
-- Dedicated executor-only function to retrieve the active capture payment
-- action's action_id and Stripe idempotency key. These values are sensitive
-- operational credentials used to compose capture after buyer confirmation
-- (P0-01T). They MUST NOT be exposed through the general get_state function,
-- which is callable by broader consumers and projected to mirrors.
--
-- P0-01T-CORRECTIVE-2: Replaced the one-argument overload with a four-argument
-- version that validates the complete authoritative tuple (listing_id,
-- purchase_id, payment_intent_id, buyer_user_id) across both
-- reservation_payment_bindings and payment_actions. An active context is
-- returned ONLY when the binding matches all four fields AND a matching
-- capture action exists in a non-terminal status.
--
-- SECURITY:
--   - SECURITY DEFINER with hardened search_path (pg_temp last).
--   - Granted ONLY to authority_executor in 004_roles_and_grants.sql.
--   - NOT granted to authority_stripe_recorder, authority_worker, or PUBLIC.
--   - EXECUTE revoked from PUBLIC in 004_roles_and_grants.sql.
--   - Returns action_id + stripe_idempotency_key ONLY for active (non-terminal)
--     capture actions matching the complete tuple. Terminal or mismatched
--     actions return null credentials.
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
BEGIN
  -- Validate the complete authoritative tuple: binding must match ALL four fields.
  -- This prevents a mismatched purchase/payment_intent/buyer from retrieving
  -- credentials for a different capture action.
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE listing_id = p_listing_id
    AND purchase_id = p_purchase_id
    AND payment_intent_id = p_payment_intent_id
    AND buyer_user_id = p_buyer_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Binding not found: wrong buyer, wrong purchase, or wrong payment_intent.
    -- The orchestrator uses this to return 403 NOT_BUYER (not CAPTURE_CONTEXT_MISMATCH).
    RETURN jsonb_build_object(
      'ok', true,
      'has_active_capture', false,
      'binding_found', false,
      'action_id', null,
      'stripe_idempotency_key', null,
      'capture_state', null
    );
  END IF;

  -- Find the most recent capture action matching this listing + purchase.
  -- Only active (non-terminal) actions expose credentials.
  SELECT * INTO v_action
  FROM payment_actions
  WHERE listing_id = p_listing_id
    AND purchase_id = p_purchase_id
    AND action_type = 'capture'
    AND status IN ('pending', 'in_flight', 'unknown')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Binding found but no active capture action (terminal or never created).
    -- The orchestrator uses this to return 409 CAPTURE_CONTEXT_MISMATCH.
    RETURN jsonb_build_object(
      'ok', true,
      'has_active_capture', false,
      'binding_found', true,
      'action_id', null,
      'stripe_idempotency_key', null,
      'capture_state', null
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'has_active_capture', true,
    'binding_found', true,
    'action_id', v_action.action_id,
    'stripe_idempotency_key', v_action.stripe_idempotency_key,
    'capture_state', v_action.status
  );
END;
$$;