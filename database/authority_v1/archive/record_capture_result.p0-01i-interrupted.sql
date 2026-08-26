-- ═══════════════════════════════════════════════════════════════════════════
-- archive/record_capture_result.p0-01i-interrupted.sql
--
-- Preserved live function definition of authority_v1.record_capture_result
-- captured BEFORE artifact reconciliation on 2026-08-26.
--
-- Reason: P0-01I was interrupted. The live function had drifted from the
-- artifact (database/authority_v1/002_functions.sql) — the live body contained
-- a v_expected_binding_state + BINDING_STATE_MISMATCH early-return check
-- (mirroring record_cancel_result's reconciliation pattern) that was never
-- backported to the artifact. This file preserves the drifted live state.
--
-- Live definition SHA-256 (pg_get_functiondef output): 40a13e6872ed200b3d08aac2481cf53504cd19a670e565198e4b508f735f6918
-- No credentials included.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION authority_v1.record_capture_result(p_action_id text, p_result_derived text, p_stripe_response jsonb, p_worker_id text, p_server_operation_id text, p_request_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'authority_v1', 'pg_temp'
AS $function$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_action payment_actions%ROWTYPE;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_authority reservation_authority%ROWTYPE;
  v_updated_count INTEGER;
  v_new_version INTEGER;
  v_result_json TEXT;
  v_is_reconciliation BOOLEAN;
  v_expected_binding_state TEXT;
BEGIN
  -- Step 1: Look up the action BEFORE acquiring the operation.
  -- This handles action-not-found without passing a null listing_id.
  SELECT * INTO v_action FROM payment_actions WHERE action_id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Action not found — return error without acquiring operation.
    -- Do NOT attempt to acquire an operation with a null listing_id.
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_NOT_FOUND',
      'action_id', p_action_id);
  END IF;

  -- Step 2: Acquire operation BEFORE checking action status — so a duplicate
  -- call with the same operation_id + request_hash returns the stored result
  -- even after the action is already completed (idempotent replay).
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', v_action.listing_id, v_action.listing_id,
    'record_capture', 'frozen', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Step 3: Verify action type
  IF v_action.action_type <> 'capture' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_TYPE_MISMATCH',
      'expected', 'capture', 'got', v_action.action_type);
  END IF;

  -- Step 4: Verify action is in an allowed prior status.
  -- 'pending'/'in_flight' = first observation; 'unknown' = reconciliation.
  IF v_action.status NOT IN ('pending','in_flight','unknown') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_STATUS_INVALID',
      'expected', 'pending, in_flight, or unknown', 'got', v_action.status);
  END IF;

  -- Determine if this is a reconciliation (action was already 'unknown')
  v_is_reconciliation := (v_action.status = 'unknown');
  IF v_is_reconciliation THEN
    v_expected_binding_state := 'capture_unknown';
  ELSE
    v_expected_binding_state := 'capture_requested';
  END IF;

  -- Step 5: Verify lease ownership (worker path only)
  IF p_worker_id IS NOT NULL THEN
    IF v_action.lease_owner IS NULL OR v_action.lease_owner != p_worker_id
       OR v_action.lease_expires_at IS NULL OR v_action.lease_expires_at < now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'LEASE_NOT_HELD',
        'action_id', p_action_id, 'worker_id', p_worker_id);
    END IF;
  END IF;

  -- Step 6: Load and lock the binding — must be in expected state for the action status
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = v_action.purchase_id
    AND listing_id = v_action.listing_id
    AND payment_intent_id = v_action.payment_intent_id
    AND capture_state = v_expected_binding_state
  FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'BINDING_STATE_MISMATCH',
      result_json = jsonb_build_object('ok', false, 'code', 'BINDING_STATE_MISMATCH',
        'expected', v_expected_binding_state)::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'BINDING_STATE_MISMATCH',
      'expected', v_expected_binding_state);
  END IF;

  -- Step 7: Load and lock the authority — verify frozen with matching fields
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = v_action.listing_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'AUTHORITY_NOT_FOUND',
      result_json = jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_FOUND')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_FOUND');
  END IF;

  -- For reconciliation: verify authority is recovery_blocked
  IF v_is_reconciliation AND NOT v_authority.recovery_blocked THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'AUTHORITY_NOT_BLOCKED',
      result_json = jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_BLOCKED',
        'reason', 'reconciliation requires recovery_blocked authority')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_BLOCKED',
      'reason', 'reconciliation requires recovery_blocked authority');
  END IF;

  IF v_authority.lifecycle_state <> 'frozen'
     OR v_authority.buyer_user_id <> v_binding.buyer_user_id
     OR v_authority.version <> v_binding.frozen_authority_version
     OR v_authority.reservation_revision <> v_binding.frozen_reservation_revision
     OR v_authority.reservation_token_hash <> v_binding.frozen_reservation_token_hash THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'AUTHORITY_FROZEN_MISMATCH',
      result_json = jsonb_build_object('ok', false, 'code', 'AUTHORITY_FROZEN_MISMATCH')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORITY_FROZEN_MISMATCH');
  END IF;

  -- Step 8: Record the capture result on the action (exactly one row)
  -- Skip for 'unknown' reconciliation (action already 'unknown', no change needed)
  IF NOT (v_is_reconciliation AND p_result_derived = 'unknown') THEN
    UPDATE payment_actions SET status = p_result_derived,
      stripe_result_json = p_stripe_response::TEXT,
      completed_at = now(), updated_at = now(),
      lease_owner = NULL, lease_expires_at = NULL
    WHERE action_id = p_action_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'ACTION_UPDATE_COUNT: expected 1, got %', v_updated_count;
    END IF;
  END IF;

  -- Step 9: Branch on result — every branch finishes with deterministic result
  IF p_result_derived = 'succeeded' THEN
    -- ATOMIC FINALIZATION: binding → finalized, authority frozen → sold,
    -- outbox events — all in one transaction. No separate finalize_sale call.
    UPDATE reservation_payment_bindings
    SET capture_state = 'finalized', freeze_finalized_at = now(), updated_at = now()
    WHERE purchase_id = v_action.purchase_id
      AND capture_state IN ('capture_requested','capture_unknown');
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'CAPTURE_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    -- CAS: frozen → sold (exactly one transition). Clear recovery_blocked on
    -- succeeded reconciliation (capture_unknown → succeeded finalizes the sale).
    v_new_version := v_authority.version + 1;
    UPDATE reservation_authority
    SET version = v_new_version, lifecycle_state = 'sold',
        buyer_user_id = NULL, reservation_token_hash = NULL,
        reservation_expires_at = NULL, reservation_revision = gen_random_uuid()::TEXT,
        recovery_blocked = false, recovery_blocked_reason = NULL, recovery_blocked_at = NULL,
        current_operation_id = p_server_operation_id, last_operation_type = 'record_capture',
        last_operation_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id
      AND lifecycle_state = 'frozen'
      AND version = v_authority.version;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'CAPTURE_AUTHORITY_COUNT: expected 1, got %', v_updated_count;
    END IF;

    -- If reconciliation: resolve the capture_unknown incident
    IF v_is_reconciliation THEN
      UPDATE operational_incidents
      SET resolved = true, resolved_at = now(),
          resolution_notes = 'Resolved by reconciliation: capture succeeded'
      WHERE incident_key = 'capture_unknown:' || v_action.listing_id
        AND resolved = false;
    END IF;

    v_result_json := jsonb_build_object('ok', true, 'captured', true, 'finalized', true,
      'version', v_new_version, 'action_id', p_action_id,
      'reconciliation', v_is_reconciliation)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;

    -- Outbox: mirror_project + notification_dispatch + point_award
    INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
    SELECT gen_random_uuid()::TEXT, p_server_operation_id, v_action.listing_id, v_new_version, effect_type, payload
    FROM (VALUES
      ('mirror_project', jsonb_build_object('version', v_new_version, 'state', 'sold')),
      ('notification_dispatch', jsonb_build_object('type', 'sale_completed')),
      ('point_award', jsonb_build_object('type', 'sale_completed'))
    ) AS t(effect_type, payload);

    RETURN jsonb_build_object('ok', true, 'captured', true, 'finalized', true,
      'version', v_new_version, 'action_id', p_action_id,
      'reconciliation', v_is_reconciliation);

  ELSIF p_result_derived = 'failed' THEN
    -- Known failure → exactly one binding transition (→failed), exactly one
    -- authority transition (frozen → available, clear tuple), persist result,
    -- create mirror event. Return success only when all rows updated.
    UPDATE reservation_payment_bindings SET capture_state = 'failed', updated_at = now()
    WHERE purchase_id = v_action.purchase_id
      AND capture_state IN ('capture_requested','capture_unknown');
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'FAILED_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    -- Release authority: frozen → available (exactly one transition). Clear
    -- recovery_blocked on failed reconciliation (capture_unknown → failed
    -- releases the reservation, the obligation is settled by the failed capture).
    v_new_version := v_authority.version + 1;
    UPDATE reservation_authority
    SET version = v_new_version, lifecycle_state = 'available',
        buyer_user_id = NULL, reservation_token_hash = NULL,
        reservation_expires_at = NULL, reservation_revision = gen_random_uuid()::TEXT,
        recovery_blocked = false, recovery_blocked_reason = NULL, recovery_blocked_at = NULL,
        current_operation_id = p_server_operation_id, last_operation_type = 'record_capture',
        last_operation_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id AND lifecycle_state = 'frozen'
      AND version = v_authority.version;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'FAILED_AUTHORITY_COUNT: expected 1, got %', v_updated_count;
    END IF;

    -- If reconciliation: resolve capture_unknown incident, then create capture_failed incident
    IF v_is_reconciliation THEN
      UPDATE operational_incidents
      SET resolved = true, resolved_at = now(),
          resolution_notes = 'Escalated to capture_failed by reconciliation'
      WHERE incident_key = 'capture_unknown:' || v_action.listing_id
        AND resolved = false;
    END IF;

    v_result_json := jsonb_build_object('ok', true, 'captured', false, 'failed', true,
      'released', true, 'version', v_new_version,
      'reconciliation', v_is_reconciliation)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;

    -- Mirror projection event
    INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
    VALUES (gen_random_uuid()::TEXT, p_server_operation_id, v_action.listing_id, v_new_version, 'mirror_project',
      jsonb_build_object('version', v_new_version, 'state', 'available'));

    RETURN jsonb_build_object('ok', true, 'captured', false, 'failed', true,
      'released', true, 'version', v_new_version,
      'reconciliation', v_is_reconciliation);

  ELSE
    -- Unknown/timeout
    IF v_is_reconciliation THEN
      -- Reconciliation with still-unknown result: no state change.
      -- Binding stays capture_unknown, authority stays frozen + recovery_blocked.
      -- The action status was already 'unknown' and stays 'unknown'.
      -- No incident change (already exists). Idempotent no-op.
      -- Only the operation ledger is updated.
      v_result_json := jsonb_build_object('ok', true, 'capture_unknown', true,
        'recovery_blocked', true, 'reconciliation', true, 'resolved', false)::TEXT;
      UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;

      RETURN jsonb_build_object('ok', true, 'capture_unknown', true,
        'recovery_blocked', true, 'reconciliation', true, 'resolved', false);
    ELSE
      -- First observation with unknown: binding → capture_unknown, authority blocked
      UPDATE reservation_payment_bindings SET capture_state = 'capture_unknown', updated_at = now()
      WHERE purchase_id = v_action.purchase_id
        AND capture_state = v_expected_binding_state;
      GET DIAGNOSTICS v_updated_count = ROW_COUNT;
      IF v_updated_count != 1 THEN
        RAISE EXCEPTION 'UNKNOWN_BINDING_COUNT: expected 1, got %', v_updated_count;
      END IF;

      UPDATE reservation_authority
      SET recovery_blocked = true, recovery_blocked_reason = 'capture_unknown',
          recovery_blocked_at = now(), updated_at = now()
      WHERE listing_id = v_action.listing_id;

      INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
      VALUES ('capture_unknown:' || v_action.listing_id, 'capture_unknown', 'critical',
        'Capture Result Unknown', 'Stripe capture returned unknown result', v_action.listing_id, 'listing')
      ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
        last_occurred_at = now();

      v_result_json := jsonb_build_object('ok', true, 'capture_unknown', true,
        'frozen', true, 'recovery_blocked', true, 'reconciliation', false)::TEXT;
      UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;

      RETURN jsonb_build_object('ok', true, 'capture_unknown', true,
        'frozen', true, 'recovery_blocked', true, 'reconciliation', false);
    END IF;
  END IF;
END;
$function$

