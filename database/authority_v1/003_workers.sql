-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Worker Functions (003)
-- Source of truth for outbox/action/webhook worker claiming, lease recovery,
-- and exhausted-lease escalation.
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 002b_transfer_functions → 002c_proof_assessment → 002d_buyer_confirmation → 002e_active_capture_context → 003_workers → 004_roles_and_grants
--
-- A crash after begin_capture, begin_cancel, or begin_refund cannot
-- permanently strand an action: the payment_actions leasing fields and
-- recover_expired_payment_action_leases() ensure that an in_flight action
-- whose lease has expired is returned to pending for reprocessing.
--
-- EXHAUSTED LEASE ESCALATION: When a payment action exhausts max_attempts,
-- escalate_exhausted_payment_action() atomically transitions the binding to
-- the appropriate unknown state, keeps the authority frozen/non-reservable,
-- sets recovery_blocked, creates an operational incident, and preserves the
-- Stripe idempotency key for reconciliation. Merely changing the action
-- status to 'unknown' is NOT sufficient. Comparable durable handling is
-- applied to exhausted webhook processing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Outbox worker claiming — FOR UPDATE SKIP LOCKED ────────────────────
CREATE OR REPLACE FUNCTION authority_v1.claim_outbox_batch(
  p_worker_id TEXT, p_batch_size INTEGER, p_lease_seconds INTEGER
) RETURNS SETOF authority_v1.reservation_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
BEGIN
  IF p_batch_size <= 0 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'INVALID_BATCH_SIZE: must be 1..100, got %', p_batch_size;
  END IF;
  IF p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_LEASE_SECONDS: must be 1..3600, got %', p_lease_seconds;
  END IF;

  RETURN QUERY
  UPDATE reservation_outbox
  SET lease_owner = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::INTERVAL,
      claimed_at = now(),
      delivery_status = 'in_flight',
      attempt_count = attempt_count + 1
  WHERE outbox_id IN (
    SELECT outbox_id FROM reservation_outbox
    WHERE delivery_status IN ('pending','in_flight')
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
      AND next_attempt_at <= now()
    ORDER BY outbox_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING *;
END;
$$;

-- ── 2. Complete outbox event ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.complete_outbox_event(
  p_outbox_id BIGINT, p_delivered BOOLEAN, p_error TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF p_delivered THEN
    UPDATE reservation_outbox
    SET delivery_status = 'delivered', delivered_at = now(),
        lease_owner = NULL, lease_expires_at = NULL, claimed_at = NULL, last_error = NULL
    WHERE outbox_id = p_outbox_id AND delivery_status = 'in_flight';
  ELSE
    UPDATE reservation_outbox
    SET delivery_status = CASE WHEN attempt_count >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
        lease_owner = NULL, lease_expires_at = NULL, claimed_at = NULL,
        last_error = p_error,
        next_attempt_at = now() + (60 || ' seconds')::INTERVAL
    WHERE outbox_id = p_outbox_id AND delivery_status = 'in_flight';
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count != 1 THEN RAISE EXCEPTION 'OUTBOX_COMPLETE_COUNT: expected 1, got %', v_count; END IF;
  RETURN jsonb_build_object('ok', true, 'delivered', p_delivered);
END;
$$;

-- ── 3. Recover expired outbox leases ──────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.recover_expired_outbox_leases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE reservation_outbox
  SET delivery_status = 'pending', lease_owner = NULL, lease_expires_at = NULL, claimed_at = NULL
  WHERE delivery_status = 'in_flight' AND lease_expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 4. Payment action worker claiming — FOR UPDATE SKIP LOCKED ────────────
-- Claims a pending or expired-lease payment action for processing.
-- A crash after begin_capture/begin_cancel/begin_refund leaves the action
-- in 'pending' or 'in_flight'. This function claims it for retry.
CREATE OR REPLACE FUNCTION authority_v1.claim_payment_action(
  p_worker_id TEXT, p_action_type TEXT, p_lease_seconds INTEGER
) RETURNS SETOF authority_v1.payment_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
BEGIN
  IF p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_LEASE_SECONDS: must be 1..3600, got %', p_lease_seconds;
  END IF;

  RETURN QUERY
  UPDATE payment_actions
  SET lease_owner = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::INTERVAL,
      claimed_at = now(),
      status = 'in_flight',
      attempt_count = attempt_count + 1,
      attempted_at = now(),
      updated_at = now()
  WHERE action_id IN (
    SELECT action_id FROM payment_actions
    WHERE action_type = p_action_type
      AND status IN ('pending','in_flight','unknown')
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
      AND next_attempt_at <= now()
      AND attempt_count < max_attempts
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *;
END;
$$;

-- ── 5. Recover expired payment action leases ──────────────────────────────
-- Returns expired in_flight actions to pending so they can be retried.
-- Actions that have exhausted max_attempts are NOT returned to pending —
-- they are escalated by escalate_exhausted_payment_action().
CREATE OR REPLACE FUNCTION authority_v1.recover_expired_payment_action_leases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE payment_actions
  SET status = 'pending',
      lease_owner = NULL, lease_expires_at = NULL, claimed_at = NULL,
      next_attempt_at = now(),
      last_error = 'lease_expired',
      updated_at = now()
  WHERE status = 'in_flight' AND lease_expires_at < now()
    AND attempt_count < max_attempts;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 6. Escalate exhausted payment actions ─────────────────────────────────
-- When a payment action exhausts max_attempts, this function atomically:
--   1. Transitions the binding to the appropriate unknown state
--      (capture_unknown, cancel_unknown, or refund_unknown)
--   2. Keeps the authority frozen or non-reservable
--   3. Sets recovery_blocked
--   4. Creates/upserts an operational incident
--   5. Preserves the Stripe idempotency key and evidence in the action row
-- Merely changing payment_actions.status to 'unknown' is NOT sufficient.
CREATE OR REPLACE FUNCTION authority_v1.escalate_exhausted_payment_action()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_count INTEGER;
  v_action payment_actions%ROWTYPE;
  v_target_binding_state TEXT;
  v_incident_type TEXT;
  v_incident_key TEXT;
  v_incident_title TEXT;
  v_escalated INTEGER := 0;
BEGIN
  FOR v_action IN
    SELECT * FROM payment_actions
    WHERE status = 'in_flight'
      AND lease_expires_at < now()
      AND attempt_count >= max_attempts
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Determine target binding state and incident type based on action_type
    v_target_binding_state := CASE v_action.action_type
      WHEN 'capture' THEN 'capture_unknown'
      WHEN 'cancel' THEN 'cancel_unknown'
      WHEN 'refund' THEN 'refund_unknown'
    END;

    v_incident_type := CASE v_action.action_type
      WHEN 'capture' THEN 'exhausted_capture'
      WHEN 'cancel' THEN 'exhausted_cancel'
      WHEN 'refund' THEN 'exhausted_refund'
    END;

    v_incident_key := v_incident_type || ':' || v_action.listing_id;
    v_incident_title := CASE v_action.action_type
      WHEN 'capture' THEN 'Capture Action Exhausted Retries'
      WHEN 'cancel' THEN 'Cancel Action Exhausted Retries'
      WHEN 'refund' THEN 'Refund Action Exhausted Retries'
    END;

    -- 1. Update action status to 'unknown', clear lease, preserve idempotency key
    UPDATE payment_actions
    SET status = 'unknown',
        lease_owner = NULL, lease_expires_at = NULL, claimed_at = NULL,
        last_error = 'max_attempts_exceeded',
        completed_at = now(), updated_at = now()
    WHERE action_id = v_action.action_id;

    -- 2. Transition binding to the appropriate unknown state
    UPDATE reservation_payment_bindings
    SET capture_state = v_target_binding_state, updated_at = now()
    WHERE purchase_id = v_action.purchase_id
      AND capture_state IN (
        CASE v_action.action_type
          WHEN 'capture' THEN 'capture_requested'
          WHEN 'cancel' THEN 'cancel_requested'
          WHEN 'refund' THEN 'refund_requested'
        END
      );

    -- 3. Keep authority frozen/non-reservable, set recovery_blocked
    UPDATE reservation_authority
    SET recovery_blocked = true,
        recovery_blocked_reason = v_incident_type,
        recovery_blocked_at = now(),
        updated_at = now()
    WHERE listing_id = v_action.listing_id;

    -- 4. Create/upsert operational incident
    INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
    VALUES (v_incident_key, v_incident_type, 'critical',
      v_incident_title,
      'Payment action exhausted max_attempts — Stripe idempotency key preserved for reconciliation: '
        || v_action.stripe_idempotency_key,
      v_action.listing_id, 'listing')
    ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
      last_occurred_at = now();

    v_escalated := v_escalated + 1;
  END LOOP;

  RETURN v_escalated;
END;
$$;

-- ── 7. Webhook event worker claiming — FOR UPDATE SKIP LOCKED ─────────────
CREATE OR REPLACE FUNCTION authority_v1.claim_webhook_event(
  p_worker_id TEXT, p_lease_seconds INTEGER
) RETURNS SETOF authority_v1.stripe_webhook_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
BEGIN
  IF p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_LEASE_SECONDS: must be 1..3600, got %', p_lease_seconds;
  END IF;

  RETURN QUERY
  UPDATE stripe_webhook_events
  SET lease_owner = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::INTERVAL,
      claimed_at = now(),
      processing_status = 'processing',
      attempt_count = attempt_count + 1,
      next_attempt_at = now()
  WHERE webhook_event_id IN (
    SELECT webhook_event_id FROM stripe_webhook_events
    WHERE processing_status IN ('pending','processing')
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
      AND next_attempt_at <= now()
      AND attempt_count < max_attempts
    ORDER BY received_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *;
END;
$$;

-- ── 8. Complete webhook event ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.complete_webhook_event(
  p_webhook_event_id TEXT, p_processed BOOLEAN, p_error TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF p_processed THEN
    UPDATE stripe_webhook_events
    SET processing_status = 'processed', processed_at = now(),
        lease_owner = NULL, lease_expires_at = NULL, claimed_at = NULL, error_message = NULL
    WHERE webhook_event_id = p_webhook_event_id AND processing_status = 'processing';
  ELSE
    UPDATE stripe_webhook_events
    SET processing_status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
        lease_owner = NULL, lease_expires_at = NULL, claimed_at = NULL,
        error_message = p_error,
        next_attempt_at = now() + (30 || ' seconds')::INTERVAL
    WHERE webhook_event_id = p_webhook_event_id AND processing_status = 'processing';
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count != 1 THEN RAISE EXCEPTION 'WEBHOOK_COMPLETE_COUNT: expected 1, got %', v_count; END IF;
  RETURN jsonb_build_object('ok', true, 'processed', p_processed);
END;
$$;

-- ── 9. Recover expired webhook event leases ──────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.recover_expired_webhook_leases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE stripe_webhook_events
  SET processing_status = 'pending',
      lease_owner = NULL, lease_expires_at = NULL, claimed_at = NULL,
      next_attempt_at = now(),
      last_error = 'lease_expired'
  WHERE processing_status = 'processing' AND lease_expires_at < now()
    AND attempt_count < max_attempts;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 10. Escalate exhausted webhook events ─────────────────────────────────
-- Comparable durable handling for exhausted webhook processing.
CREATE OR REPLACE FUNCTION authority_v1.escalate_exhausted_webhook_event()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_event stripe_webhook_events%ROWTYPE;
  v_escalated INTEGER := 0;
  v_incident_key TEXT;
BEGIN
  FOR v_event IN
    SELECT * FROM stripe_webhook_events
    WHERE processing_status = 'processing'
      AND lease_expires_at < now()
      AND attempt_count >= max_attempts
    ORDER BY received_at
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Mark webhook as failed
    UPDATE stripe_webhook_events
    SET processing_status = 'failed',
        lease_owner = NULL, lease_expires_at = NULL, claimed_at = NULL,
        last_error = 'max_attempts_exceeded',
        processed_at = now()
    WHERE webhook_event_id = v_event.webhook_event_id;

    -- Create/upsert operational incident
    v_incident_key := 'exhausted_webhook:' || v_event.webhook_event_id;
    INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
    VALUES (v_incident_key, 'exhausted_webhook', 'critical',
      'Webhook Processing Exhausted Retries',
      'Webhook event exhausted max_attempts — event_id: ' || v_event.webhook_event_id
        || ', event_type: ' || v_event.event_type,
      v_event.webhook_event_id, 'webhook')
    ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
      last_occurred_at = now();

    v_escalated := v_escalated + 1;
  END LOOP;

  RETURN v_escalated;
END;
$$;