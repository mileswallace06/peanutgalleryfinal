-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Worker Functions (004)
-- Source of truth for outbox/action/webhook worker claiming and lease recovery.
--
-- A crash after begin_capture, begin_cancel, or begin_refund cannot
-- permanently strand an action: the payment_actions leasing fields and
-- recover_expired_payment_action_leases() ensure that an in_flight action
-- whose lease has expired is returned to pending for reprocessing.
-- Equivalent stuck-processing recovery is applied to stripe_webhook_events.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Outbox worker claiming — FOR UPDATE SKIP LOCKED ────────────────────
CREATE OR REPLACE FUNCTION authority_v1.claim_outbox_batch(
  p_worker_id TEXT, p_batch_size INTEGER, p_lease_seconds INTEGER
) RETURNS SETOF authority_v1.reservation_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
BEGIN
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
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF p_delivered THEN
    UPDATE reservation_outbox
    SET delivery_status = 'delivered', delivered_at = now(),
        lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
    WHERE outbox_id = p_outbox_id AND delivery_status = 'in_flight';
  ELSE
    UPDATE reservation_outbox
    SET delivery_status = CASE WHEN attempt_count >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
        lease_owner = NULL, lease_expires_at = NULL,
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
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE reservation_outbox
  SET delivery_status = 'pending', lease_owner = NULL, lease_expires_at = NULL
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
SET search_path = authority_v1, pg_catalog
AS $$
BEGIN
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

-- ── 5. Complete payment action ────────────────────────────────────────────
-- Called by the worker after the Stripe SDK call returns. The result is
-- derived from the verified Stripe SDK response — never from a request body.
CREATE OR REPLACE FUNCTION authority_v1.complete_payment_action(
  p_action_id TEXT, p_result TEXT, p_stripe_response JSONB, p_error_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE payment_actions
  SET status = p_result,
      stripe_result_json = p_stripe_response::TEXT,
      stripe_error_code = p_error_code,
      completed_at = now(),
      lease_owner = NULL, lease_expires_at = NULL,
      updated_at = now()
  WHERE action_id = p_action_id AND status = 'in_flight';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count != 1 THEN RAISE EXCEPTION 'ACTION_COMPLETE_COUNT: expected 1, got %', v_count; END IF;
  RETURN jsonb_build_object('ok', true, 'action_id', p_action_id, 'result', p_result);
END;
$$;

-- ── 6. Recover expired payment action leases ──────────────────────────────
-- Returns expired in_flight actions to pending so they can be retried.
-- This proves that a crash after begin_capture, begin_cancel, or begin_refund
-- cannot permanently strand an action — the lease expires and the action
-- is returned to pending for reprocessing.
CREATE OR REPLACE FUNCTION authority_v1.recover_expired_payment_action_leases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE payment_actions
  SET status = 'pending',
      lease_owner = NULL, lease_expires_at = NULL,
      next_attempt_at = now(),
      last_error = 'lease_expired',
      updated_at = now()
  WHERE status = 'in_flight' AND lease_expires_at < now()
    AND attempt_count < max_attempts;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Actions that have exhausted max_attempts are marked as 'unknown' for
  -- manual resolution — they are NOT silently retried forever.
  UPDATE payment_actions
  SET status = 'unknown',
      lease_owner = NULL, lease_expires_at = NULL,
      last_error = 'max_attempts_exceeded',
      updated_at = now()
  WHERE status = 'in_flight' AND lease_expires_at < now()
    AND attempt_count >= max_attempts;

  RETURN v_count;
END;
$$;

-- ── 7. Webhook event worker claiming — FOR UPDATE SKIP LOCKED ─────────────
-- Equivalent stuck-processing recovery for stripe_webhook_events.
CREATE OR REPLACE FUNCTION authority_v1.claim_webhook_event(
  p_worker_id TEXT, p_lease_seconds INTEGER
) RETURNS SETOF authority_v1.stripe_webhook_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
BEGIN
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
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF p_processed THEN
    UPDATE stripe_webhook_events
    SET processing_status = 'processed', processed_at = now(),
        lease_owner = NULL, lease_expires_at = NULL, error_message = NULL
    WHERE webhook_event_id = p_webhook_event_id AND processing_status = 'processing';
  ELSE
    UPDATE stripe_webhook_events
    SET processing_status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
        lease_owner = NULL, lease_expires_at = NULL,
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
-- Equivalent to recover_expired_payment_action_leases for webhook events.
CREATE OR REPLACE FUNCTION authority_v1.recover_expired_webhook_leases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE stripe_webhook_events
  SET processing_status = 'pending',
      lease_owner = NULL, lease_expires_at = NULL,
      next_attempt_at = now(),
      last_error = 'lease_expired'
  WHERE processing_status = 'processing' AND lease_expires_at < now()
    AND attempt_count < max_attempts;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE stripe_webhook_events
  SET processing_status = 'failed',
      lease_owner = NULL, lease_expires_at = NULL,
      last_error = 'max_attempts_exceeded'
  WHERE processing_status = 'processing' AND lease_expires_at < now()
    AND attempt_count >= max_attempts;

  RETURN v_count;
END;
$$;