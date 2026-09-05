-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — No-Relist Invariant Patch (002f) — P0-01T-CORRECTIVE-4
--
-- INSTALLATION ORDER: ... → 002_functions → 002b → 002c → 002d → 002e → 002f_no_relist_invariant → 003 → 004
--
-- P0-01T-CORRECTIVE-4B: The no-relist invariant must cover not only capture
-- failure (already in 002_functions.sql record_capture_result) but also
-- abort_binding, begin_cancel, and record_cancel_result. If the buyer has
-- confirmed receipt (transfer_state = 'buyer_confirmed_received'), the
-- listing must NEVER be released back to available — the ticket may have
-- been delivered.
--
-- This file contains the CANONICAL record_cancel_result definition with the
-- no-relist check. The old definition was removed from 002_functions.sql
-- (replaced with DROP FUNCTION IF EXISTS) to ensure exactly one definition.
-- abort_binding and begin_cancel no-relist checks are in 002_functions.sql.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION authority_v1.record_cancel_result(
  p_action_id TEXT,
  p_result_derived TEXT,
  p_stripe_response JSONB,
  p_worker_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_action payment_actions%ROWTYPE;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_authority reservation_authority%ROWTYPE;
  v_updated_count INTEGER; v_new_version INTEGER;
  v_result_json TEXT;
  v_is_reconciliation BOOLEAN;
  v_expected_binding_state TEXT;
BEGIN
  SELECT * INTO v_action FROM payment_actions WHERE action_id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_NOT_FOUND', 'action_id', p_action_id);
  END IF;
  IF v_action.action_type <> 'cancel' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_TYPE_MISMATCH',
      'expected', 'cancel', 'got', v_action.action_type);
  END IF;

  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', v_action.listing_id, v_action.listing_id,
    'record_cancel', 'frozen', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  IF v_action.status NOT IN ('pending','in_flight','unknown') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_STATUS_INVALID',
      'expected', 'pending, in_flight, or unknown', 'got', v_action.status);
  END IF;

  v_is_reconciliation := (v_action.status = 'unknown');
  IF v_is_reconciliation THEN
    v_expected_binding_state := 'cancel_unknown';
  ELSE
    v_expected_binding_state := 'cancel_requested';
  END IF;

  IF p_worker_id IS NOT NULL THEN
    IF v_action.lease_owner IS NULL OR v_action.lease_owner != p_worker_id
       OR v_action.lease_expires_at IS NULL OR v_action.lease_expires_at < now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'LEASE_NOT_HELD',
        'action_id', p_action_id, 'worker_id', p_worker_id);
    END IF;
  END IF;

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

  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = v_action.listing_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'AUTHORITY_NOT_FOUND',
      result_json = jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_FOUND')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_FOUND');
  END IF;

  IF v_is_reconciliation AND NOT v_authority.recovery_blocked THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'AUTHORITY_NOT_BLOCKED',
      result_json = jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_BLOCKED',
        'reason', 'reconciliation requires recovery_blocked authority')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_BLOCKED',
      'reason', 'reconciliation requires recovery_blocked authority');
  END IF;

  IF NOT (v_is_reconciliation AND p_result_derived = 'unknown') THEN
    UPDATE payment_actions SET status = p_result_derived,
      stripe_result_json = p_stripe_response::TEXT, completed_at = now(), updated_at = now(),
      lease_owner = NULL, lease_expires_at = NULL
    WHERE action_id = p_action_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'ACTION_UPDATE_COUNT: expected 1, got %', v_updated_count;
    END IF;
  END IF;

  IF p_result_derived = 'succeeded' THEN
    -- P0-01T-CORRECTIVE-4: No-relist invariant. If the buyer has confirmed
    -- receipt (transfer_state = 'buyer_confirmed_received'), NEVER release
    -- the listing back to available. Binding → canceled, but authority stays
    -- frozen + recovery_blocked.
    IF v_authority.transfer_state = 'buyer_confirmed_received'
       OR v_authority.buyer_confirmed_at IS NOT NULL THEN
      UPDATE reservation_payment_bindings SET capture_state = 'canceled', updated_at = now()
      WHERE purchase_id = v_action.purchase_id AND capture_state = v_expected_binding_state;
      GET DIAGNOSTICS v_updated_count = ROW_COUNT;
      IF v_updated_count != 1 THEN
        RAISE EXCEPTION 'CANCEL_BINDING_COUNT: expected 1, got %', v_updated_count;
      END IF;

      UPDATE reservation_authority
      SET recovery_blocked = true,
          recovery_blocked_reason = 'cancel_succeeded_after_buyer_confirmation',
          recovery_blocked_at = now(), updated_at = now()
      WHERE listing_id = v_action.listing_id;

      IF v_is_reconciliation THEN
        UPDATE operational_incidents
        SET resolved = true, resolved_at = now(),
            resolution_notes = 'Escalated to cancel_succeeded_after_buyer_confirmation by reconciliation'
        WHERE incident_key = 'cancel_unknown:' || v_action.listing_id
          AND resolved = false;
      END IF;

      INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
      VALUES ('cancel_succeeded_after_buyer_confirmation:' || v_action.listing_id, 'failed_transfer_after_payment', 'critical',
        'Cancel Succeeded After Buyer Confirmation',
        'Stripe cancel succeeded after buyer confirmed ticket receipt. Listing kept frozen and recovery-blocked to prevent relisting a delivered ticket.',
        v_action.listing_id, 'listing')
      ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
        last_occurred_at = now(), updated_at = now();

      v_result_json := jsonb_build_object('ok', true, 'canceled', true,
        'released', false, 'recovery_blocked', true,
        'recovery_blocked_reason', 'cancel_succeeded_after_buyer_confirmation',
        'reconciliation', v_is_reconciliation)::TEXT;
      UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;

      RETURN jsonb_build_object('ok', true, 'canceled', true,
        'released', false, 'recovery_blocked', true,
        'recovery_blocked_reason', 'cancel_succeeded_after_buyer_confirmation',
        'reconciliation', v_is_reconciliation);
    END IF;

    -- Ordinary cancel succeeded → release authority
    UPDATE reservation_payment_bindings SET capture_state = 'canceled', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = v_expected_binding_state;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'CANCEL_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    v_new_version := v_authority.version + 1;
    UPDATE reservation_authority
    SET version = v_new_version, lifecycle_state = 'available',
        buyer_user_id = NULL, reservation_token_hash = NULL,
        reservation_expires_at = NULL, reservation_revision = gen_random_uuid()::TEXT,
        recovery_blocked = false, recovery_blocked_reason = NULL, recovery_blocked_at = NULL,
        current_operation_id = p_server_operation_id, last_operation_type = 'record_cancel',
        last_operation_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id
      AND lifecycle_state IN ('reserved','frozen')
      AND version = v_authority.version;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'CANCEL_AUTHORITY_COUNT: expected 1, got %', v_updated_count;
    END IF;

    IF v_is_reconciliation THEN
      UPDATE operational_incidents
      SET resolved = true, resolved_at = now(),
          resolution_notes = 'Resolved by reconciliation: cancel succeeded'
      WHERE incident_key = 'cancel_unknown:' || v_action.listing_id
        AND resolved = false;
    END IF;

    v_result_json := jsonb_build_object('ok', true, 'canceled', true,
      'released', true, 'version', v_new_version,
      'reconciliation', v_is_reconciliation)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;

    INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
    VALUES (gen_random_uuid()::TEXT, p_server_operation_id, v_action.listing_id, v_new_version, 'mirror_project',
      jsonb_build_object('version', v_new_version, 'state', 'available'));

    RETURN jsonb_build_object('ok', true, 'canceled', true,
      'released', true, 'version', v_new_version,
      'reconciliation', v_is_reconciliation);

  ELSIF p_result_derived = 'failed' THEN
    UPDATE reservation_payment_bindings SET capture_state = 'cancel_failed', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = v_expected_binding_state;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'CANCEL_FAILED_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    UPDATE reservation_authority
    SET recovery_blocked = true, recovery_blocked_reason = 'cancel_failed',
        recovery_blocked_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id;

    IF v_is_reconciliation THEN
      UPDATE operational_incidents
      SET resolved = true, resolved_at = now(),
          resolution_notes = 'Escalated to cancel_failed by reconciliation'
      WHERE incident_key = 'cancel_unknown:' || v_action.listing_id
        AND resolved = false;
    END IF;

    INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
    VALUES ('cancel_failed:' || v_action.listing_id, 'cancel_failed', 'critical',
      'Cancel Result Failed', 'Stripe cancel returned failure — obligation preserved', v_action.listing_id, 'listing')
    ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
      last_occurred_at = now();

    v_result_json := jsonb_build_object('ok', true, 'canceled', false, 'cancel_failed', true,
      'recovery_blocked', true, 'reconciliation', v_is_reconciliation)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;

    RETURN jsonb_build_object('ok', true, 'canceled', false, 'cancel_failed', true,
      'recovery_blocked', true, 'reconciliation', v_is_reconciliation);

  ELSE
    IF v_is_reconciliation THEN
      v_result_json := jsonb_build_object('ok', true, 'cancel_unknown', true,
        'recovery_blocked', true, 'reconciliation', true, 'resolved', false)::TEXT;
      UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'cancel_unknown', true,
        'recovery_blocked', true, 'reconciliation', true, 'resolved', false);
    ELSE
      UPDATE reservation_payment_bindings SET capture_state = 'cancel_unknown', updated_at = now()
      WHERE purchase_id = v_action.purchase_id AND capture_state = v_expected_binding_state;
      GET DIAGNOSTICS v_updated_count = ROW_COUNT;
      IF v_updated_count != 1 THEN
        RAISE EXCEPTION 'CANCEL_UNKNOWN_BINDING_COUNT: expected 1, got %', v_updated_count;
      END IF;

      UPDATE reservation_authority
      SET recovery_blocked = true, recovery_blocked_reason = 'cancel_unknown',
          recovery_blocked_at = now(), updated_at = now()
      WHERE listing_id = v_action.listing_id;

      INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
      VALUES ('cancel_unknown:' || v_action.listing_id, 'cancel_unknown', 'critical',
        'Cancel Result Unknown', 'Stripe cancel returned unknown result', v_action.listing_id, 'listing')
      ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
        last_occurred_at = now();

      v_result_json := jsonb_build_object('ok', true, 'cancel_unknown', true,
        'recovery_blocked', true, 'reconciliation', false)::TEXT;
      UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'cancel_unknown', true,
        'recovery_blocked', true, 'reconciliation', false);
    END IF;
  END IF;
END;
$$;