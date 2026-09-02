-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Active Capture Context (002e)
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 002c_proof_assessment
--                     → 002d_buyer_confirmation → 002e_active_capture_context
--                     → 003_workers → 004_roles
--
-- Dedicated executor-only function to retrieve the active capture payment
-- action's action_id and Stripe idempotency key. These values are sensitive
-- operational credentials used to compose capture after buyer confirmation
-- (P0-01T). They MUST NOT be exposed through the general get_state function,
-- which is callable by broader consumers and projected to mirrors.
--
-- SECURITY:
--   - SECURITY DEFINER with hardened search_path (pg_temp last).
--   - Granted ONLY to authority_executor in 004_roles_and_grants.sql.
--   - NOT granted to authority_stripe_recorder, authority_worker, or PUBLIC.
--   - EXECUTE revoked from PUBLIC in 004_roles_and_grants.sql.
--   - Returns action_id + stripe_idempotency_key ONLY for active (non-terminal)
--     capture actions. Terminal actions return null credentials.
--   - Never logs or exposes the idempotency key outside the return value.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION authority_v1.get_active_capture_context(
  p_listing_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_action      payment_actions%ROWTYPE;
BEGIN
  -- Find the most recent capture action for this listing.
  -- Only active (non-terminal) actions expose credentials.
  SELECT * INTO v_action
  FROM payment_actions
  WHERE listing_id = p_listing_id
    AND action_type = 'capture'
    AND status IN ('pending', 'in_flight', 'unknown')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'has_active_capture', false,
      'action_id', null,
      'stripe_idempotency_key', null,
      'capture_state', null
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'has_active_capture', true,
    'action_id', v_action.action_id,
    'stripe_idempotency_key', v_action.stripe_idempotency_key,
    'capture_state', v_action.status
  );
END;
$$;