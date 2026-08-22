-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Stored Functions (002)
-- Source of truth for all authority transaction logic.
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 003_workers → 004_roles
--
-- A PL/pgSQL function invocation executes inside the caller's PostgreSQL
-- transaction. Transaction-control statements (BEGIN/COMMIT) are NOT placed
-- inside ordinary functions. Each function call executes atomically — either
-- all its statements commit or all roll back with the caller's transaction.
--
-- SECURITY: Every function uses the security-definer attribute with a
-- hardened search_path that forces pg_temp last.
-- This prevents search_path hijacking via temp-schema objects. EXECUTE is
-- revoked from PUBLIC in 004_roles_and_grants.sql and granted only to
-- specific roles by exact function signature.
--
-- SINGLE COMPLETION PATH: The separate action-completion function is REMOVED. The
-- record_capture_result, record_cancel_result, and record_refund_result
-- functions are the SOLE path for recording Stripe results. A worker claims
-- an action with a lease, calls Stripe, then calls the corresponding
-- record_*_result function which verifies lease ownership, verifies the
-- Stripe-derived result, and updates action + binding + authority + ledger
-- + incident + outbox atomically. Webhook resolution calls the SAME
-- functions — no second independent implementation.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. acquire_operation — Operation-ID Acquisition (Generic Subject) ──────
-- Uses INSERT ... ON CONFLICT DO NOTHING RETURNING to distinguish a newly
-- acquired operation from an existing one. OPERATION_ID_CONFLICT is a
-- persistent structured result — NOT an exception that would roll back the
-- ledger. The operation_id is server-derived and namespaced.
--
-- The listing_id parameter is nullable with a DEFERRABLE INITIALLY DEFERRED
-- FK. For initialize_listing, listing_id is passed so the deferred FK is
-- satisfied at COMMIT time when the authority row is inserted. For user
-- operations (anonymize), listing_id is NULL.
CREATE OR REPLACE FUNCTION authority_v1.acquire_operation(
  p_server_operation_id  TEXT,
  p_subject_type         TEXT,
  p_subject_id           TEXT,
  p_listing_id           TEXT,
  p_operation_type       TEXT,
  p_requested_state      TEXT,
  p_expected_version     INTEGER,
  p_request_hash         TEXT
) RETURNS TABLE(acquired BOOLEAN, op_status TEXT, replay_result JSONB, stored_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_inserted   TEXT;
  v_existing   reservation_operations%ROWTYPE;
BEGIN
  INSERT INTO reservation_operations
    (operation_id, subject_type, subject_id, listing_id,
     operation_type, requested_state, expected_version, request_hash, status)
  VALUES
    (p_server_operation_id, p_subject_type, p_subject_id, p_listing_id,
     p_operation_type, p_requested_state, p_expected_version, p_request_hash, 'pending')
  ON CONFLICT (operation_id) DO NOTHING
  RETURNING operation_id INTO v_inserted;

  IF v_inserted IS NOT NULL THEN
    RETURN QUERY SELECT true, 'pending'::TEXT, NULL::JSONB, p_request_hash;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM reservation_operations
  WHERE operation_id = p_server_operation_id FOR UPDATE;

  IF v_existing.request_hash = p_request_hash AND v_existing.status = 'committed' THEN
    RETURN QUERY SELECT true, 'committed'::TEXT, v_existing.result_json::JSONB, v_existing.request_hash;
  ELSIF v_existing.request_hash = p_request_hash AND v_existing.status = 'pending' THEN
    RETURN QUERY SELECT false, 'pending'::TEXT, NULL::JSONB, v_existing.request_hash;
  ELSIF v_existing.request_hash != p_request_hash THEN
    RETURN QUERY SELECT false, 'conflict'::TEXT,
      jsonb_build_object(
        'ok', false,
        'code', 'OPERATION_ID_CONFLICT',
        'operation_id', p_server_operation_id,
        'stored_hash', v_existing.request_hash,
        'received_hash', p_request_hash
      ),
      v_existing.request_hash;
  ELSE
    RETURN QUERY SELECT false, v_existing.status, v_existing.result_json::JSONB, v_existing.request_hash;
  END IF;
END;
$$;

-- ── 2. get_state — Read Authority State ────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.get_state(
  p_listing_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE v_row reservation_authority%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM reservation_authority WHERE listing_id = p_listing_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'version', v_row.version,
    'lifecycle_state', v_row.lifecycle_state,
    'seller_user_id', v_row.seller_user_id,
    'buyer_user_id', v_row.buyer_user_id,
    'reservation_revision', v_row.reservation_revision,
    'reservation_expires_at', v_row.reservation_expires_at,
    'checkout_quarantined', v_row.checkout_quarantined,
    'recovery_blocked', v_row.recovery_blocked
  );
END;
$$;

-- ── 3. initialize_listing ──────────────────────────────────────────────────
-- Verifies an existing row exactly matches the seller and initial state.
-- NEVER uses ON CONFLICT DO NOTHING and returns success for a conflicting
-- seller. The operation is acquired with subject_type='listing' and a
-- nullable listing_id (DEFERRABLE FK satisfied at COMMIT).
CREATE OR REPLACE FUNCTION authority_v1.initialize_listing(
  p_listing_id TEXT, p_seller_user_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_existing reservation_authority%ROWTYPE;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, NULL,
    'initialize', 'available', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Check if authority row already exists
  SELECT * INTO v_existing FROM reservation_authority
  WHERE listing_id = p_listing_id FOR UPDATE;

  IF FOUND THEN
    -- Verify exact match: same seller, version 0, available
    IF v_existing.seller_user_id = p_seller_user_id
       AND v_existing.version = 0
       AND v_existing.lifecycle_state = 'available' THEN
      -- Idempotent replay — exact same initialization
      UPDATE reservation_operations SET status = 'idempotent_replay',
        result_json = jsonb_build_object('ok', true, 'version', 0, 'idempotent', true)::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'version', 0, 'idempotent', true);
    ELSE
      -- Conflict — different seller or wrong state
      UPDATE reservation_operations SET status = 'rejected', error_code = 'INITIALIZE_CONFLICT',
        result_json = jsonb_build_object('ok', false, 'code', 'INITIALIZE_CONFLICT',
          'reason', 'listing already initialized by different seller or wrong state')::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'INITIALIZE_CONFLICT',
        'reason', 'listing already initialized by different seller or wrong state');
    END IF;
  END IF;

  -- Insert new authority row (deferred FK on operation will be satisfied at COMMIT)
  INSERT INTO reservation_authority (listing_id, version, lifecycle_state, seller_user_id)
  VALUES (p_listing_id, 0, 'available', p_seller_user_id);

  -- Set listing_id on the operation row (FK now satisfiable)
  UPDATE reservation_operations SET listing_id = p_listing_id,
    status = 'committed', committed_version = 0,
    result_json = jsonb_build_object('ok', true, 'version', 0)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  RETURN jsonb_build_object('ok', true, 'version', 0);
END;
$$;

-- ── 4. reserve_listing ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.reserve_listing(
  p_listing_id TEXT, p_expected_version INTEGER, p_buyer_user_id TEXT,
  p_token_hash TEXT, p_expires_at TIMESTAMPTZ,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'reserve', 'reserved', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'reserved',
      buyer_user_id = p_buyer_user_id, reservation_token_hash = p_token_hash,
      reservation_expires_at = p_expires_at, reservation_revision = v_revision,
      current_operation_id = p_server_operation_id, last_operation_type = 'reserve',
      last_operation_at = now(), last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'available' AND checkout_quarantined = false AND recovery_blocked = false
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'reserved'));

  RETURN jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision);
END;
$$;

-- ── 5. release_listing ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.release_listing(
  p_listing_id TEXT, p_expected_version INTEGER,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'release', 'available', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'available',
      buyer_user_id = NULL, reservation_token_hash = NULL,
      reservation_expires_at = NULL, reservation_revision = v_revision,
      current_operation_id = p_server_operation_id, last_operation_type = 'release',
      last_operation_at = now(), last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version AND lifecycle_state = 'reserved'
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'available'));

  RETURN jsonb_build_object('ok', true, 'version', v_new_version);
END;
$$;

-- ── 6. expire_listing ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.expire_listing(
  p_listing_id TEXT, p_expected_version INTEGER,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'expire', 'expired', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'expired',
      buyer_user_id = NULL, reservation_token_hash = NULL,
      reservation_expires_at = NULL, reservation_revision = v_revision,
      current_operation_id = p_server_operation_id, last_operation_type = 'expire',
      last_operation_at = now(), last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'reserved' AND reservation_expires_at < now()
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'expired'));

  RETURN jsonb_build_object('ok', true, 'version', v_new_version);
END;
$$;

-- ── 7. bind_payment_intent — Authoritative PI Binding ─────────────────────
CREATE OR REPLACE FUNCTION authority_v1.bind_payment_intent(
  p_listing_id TEXT, p_purchase_id TEXT, p_payment_intent_id TEXT,
  p_buyer_user_id TEXT, p_authority_version INTEGER,
  p_reservation_revision TEXT, p_token_hash TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_authority reservation_authority%ROWTYPE;
  v_existing_binding reservation_payment_bindings%ROWTYPE;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'bind_pi', 'reserved', p_authority_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Verify authority is in the expected reserved state
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id AND version = p_authority_version
    AND lifecycle_state = 'reserved' AND buyer_user_id = p_buyer_user_id
    AND reservation_revision = p_reservation_revision AND reservation_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'AUTHORITY_MISMATCH',
      result_json = jsonb_build_object('ok', false, 'code', 'AUTHORITY_MISMATCH')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORITY_MISMATCH');
  END IF;

  -- Check for existing binding by payment_intent_id (unique constraint)
  SELECT * INTO v_existing_binding FROM reservation_payment_bindings
  WHERE payment_intent_id = p_payment_intent_id FOR UPDATE;

  IF FOUND THEN
    IF v_existing_binding.purchase_id = p_purchase_id
       AND v_existing_binding.listing_id = p_listing_id
       AND v_existing_binding.buyer_user_id = p_buyer_user_id
       AND v_existing_binding.authority_version = p_authority_version
       AND v_existing_binding.reservation_revision = p_reservation_revision
       AND v_existing_binding.reservation_token_hash = p_token_hash
       AND v_existing_binding.capture_state = 'authorized' THEN
      UPDATE reservation_operations SET status = 'idempotent_replay',
        result_json = jsonb_build_object('ok', true, 'bound', true, 'idempotent', true)::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'bound', true, 'idempotent', true);
    ELSE
      UPDATE reservation_operations SET status = 'rejected', error_code = 'PAYMENT_BINDING_CONFLICT',
        result_json = jsonb_build_object('ok', false, 'code', 'PAYMENT_BINDING_CONFLICT',
          'reason', 'payment_intent_id already bound to different purchase/buyer')::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_BINDING_CONFLICT',
        'reason', 'payment_intent_id already bound to different purchase/buyer');
    END IF;
  ELSE
    INSERT INTO reservation_payment_bindings (
      purchase_id, payment_intent_id, listing_id, buyer_user_id,
      authority_version, reservation_revision, reservation_token_hash, capture_state
    ) VALUES (
      p_purchase_id, p_payment_intent_id, p_listing_id, p_buyer_user_id,
      p_authority_version, p_reservation_revision, p_token_hash, 'authorized'
    );
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = p_authority_version,
    result_json = jsonb_build_object('ok', true, 'bound', true)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  RETURN jsonb_build_object('ok', true, 'bound', true);
END;
$$;

-- ── 8. begin_capture — Durable Saga Step 1 (Freeze + Action Record) ────────
CREATE OR REPLACE FUNCTION authority_v1.begin_capture(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_buyer_user_id TEXT, p_expected_revision TEXT,
  p_action_id TEXT, p_stripe_idem_key TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
  v_frozen_token_hash TEXT; v_frozen_expires TIMESTAMPTZ;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'begin_capture', 'frozen', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Lock and verify the binding exists with capture_state = 'authorized'
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id
    AND payment_intent_id = p_payment_intent_id
    AND listing_id = p_listing_id
    AND buyer_user_id = p_buyer_user_id
    AND capture_state = 'authorized'
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'BINDING_NOT_AUTHORIZED',
      result_json = jsonb_build_object('ok', false, 'code', 'BINDING_NOT_AUTHORIZED')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'BINDING_NOT_AUTHORIZED');
  END IF;

  -- CAS: reserved → frozen (verify exact buyer + revision)
  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'frozen', reservation_revision = v_revision,
      current_operation_id = p_server_operation_id, last_operation_type = 'begin_capture',
      last_operation_at = now(), last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'reserved' AND buyer_user_id = p_buyer_user_id
    AND reservation_revision = p_expected_revision
  RETURNING version, reservation_token_hash, reservation_expires_at
  INTO v_new_version, v_frozen_token_hash, v_frozen_expires;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
      result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  -- Update binding: authorized → capture_requested, store frozen snapshot
  UPDATE reservation_payment_bindings
  SET capture_state = 'capture_requested',
      frozen_reservation_token_hash = v_frozen_token_hash,
      frozen_buyer_user_id = p_buyer_user_id,
      frozen_reservation_expires_at = v_frozen_expires,
      frozen_reservation_revision = v_revision,
      frozen_authority_version = v_new_version,
      updated_at = now()
  WHERE purchase_id = p_purchase_id AND capture_state = 'authorized';
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'BINDING_UPDATE_COUNT: expected 1, got %', v_updated_count;
  END IF;

  -- Create payment_action (durable saga record)
  INSERT INTO payment_actions (action_id, listing_id, purchase_id, payment_intent_id,
    action_type, stripe_idempotency_key, status)
  VALUES (p_action_id, p_listing_id, p_purchase_id, p_payment_intent_id,
    'capture', p_stripe_idem_key, 'pending');

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'frozen', true, 'action_id', p_action_id,
      'idempotency_key', p_stripe_idem_key, 'version', v_new_version, 'revision', v_revision)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'frozen'));

  RETURN jsonb_build_object('ok', true, 'frozen', true, 'action_id', p_action_id,
    'idempotency_key', p_stripe_idem_key, 'version', v_new_version, 'revision', v_revision);
END;
$$;

-- ── 9. record_capture_result — SINGLE Completion Path (Capture Only) ───────
-- Records the Stripe capture result. Authority remains 'frozen' on success.
-- Finalization is a SEPARATE step (finalize_sale).
--
-- SINGLE COMPLETION PATH: This is the SOLE function that updates a capture
-- payment action's status. The separate action-completion function is REMOVED. The worker
-- claims the action, calls Stripe, then calls this function. Webhook
-- resolution calls the SAME function.
--
-- LEASE VERIFICATION: If p_worker_id is provided, the function verifies
-- the worker holds a valid lease on the action. If p_worker_id is NULL,
-- the call is from a verified webhook handler (signature verified by the
-- backend function).
--
-- ACTION-NOT-FIRST: The action is looked up BEFORE acquiring the operation
-- so a null listing_id is never passed to acquire_operation.
--
-- EVERY BRANCH FINISHES WITH DETERMINISTIC RESULT: No branch leaves the
-- operation status as 'pending'. Every branch updates reservation_operations
-- with a committed result_json.
CREATE OR REPLACE FUNCTION authority_v1.record_capture_result(
  p_action_id TEXT,
  p_result_derived TEXT,
  p_stripe_response JSONB,
  p_worker_id TEXT,  -- NULL for webhook-originated calls
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
  v_updated_count INTEGER;
  v_new_version INTEGER;
  v_result_json TEXT;
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

  -- Step 2: Verify action type
  IF v_action.action_type <> 'capture' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_TYPE_MISMATCH',
      'expected', 'capture', 'got', v_action.action_type);
  END IF;

  -- Step 3: Verify action is in an allowed prior status
  IF v_action.status NOT IN ('pending','in_flight') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_STATUS_INVALID',
      'expected', 'pending or in_flight', 'got', v_action.status);
  END IF;

  -- Step 4: Verify lease ownership (worker path only)
  IF p_worker_id IS NOT NULL THEN
    IF v_action.lease_owner IS NULL OR v_action.lease_owner != p_worker_id
       OR v_action.lease_expires_at IS NULL OR v_action.lease_expires_at < now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'LEASE_NOT_HELD',
        'action_id', p_action_id, 'worker_id', p_worker_id);
    END IF;
  END IF;

  -- Step 5: Acquire operation using the action's listing_id (now guaranteed non-null)
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', v_action.listing_id, v_action.listing_id,
    'record_capture', 'frozen', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Step 6: Load and lock the binding — verify ALL fields match
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = v_action.purchase_id
    AND listing_id = v_action.listing_id
    AND payment_intent_id = v_action.payment_intent_id
  FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'BINDING_NOT_FOUND',
      result_json = jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND');
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
  UPDATE payment_actions SET status = p_result_derived,
    stripe_result_json = p_stripe_response::TEXT,
    completed_at = now(), updated_at = now(),
    lease_owner = NULL, lease_expires_at = NULL
  WHERE action_id = p_action_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'ACTION_UPDATE_COUNT: expected 1, got %', v_updated_count;
  END IF;

  -- Step 9: Branch on result — every branch finishes with deterministic result
  IF p_result_derived = 'succeeded' THEN
    -- Binding → captured (exactly one transition). Authority remains FROZEN.
    UPDATE reservation_payment_bindings SET capture_state = 'captured', updated_at = now()
    WHERE purchase_id = v_action.purchase_id
      AND capture_state IN ('capture_requested','capture_unknown');
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'CAPTURE_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    v_result_json := jsonb_build_object('ok', true, 'captured', true, 'action_id', p_action_id)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', true, 'captured', true, 'action_id', p_action_id);

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

    -- Release authority: frozen → available (exactly one transition)
    v_new_version := v_authority.version + 1;
    UPDATE reservation_authority
    SET version = v_new_version, lifecycle_state = 'available',
        buyer_user_id = NULL, reservation_token_hash = NULL,
        reservation_expires_at = NULL, reservation_revision = gen_random_uuid()::TEXT,
        current_operation_id = p_server_operation_id, last_operation_type = 'record_capture',
        last_operation_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id AND lifecycle_state = 'frozen'
      AND version = v_authority.version;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'FAILED_AUTHORITY_COUNT: expected 1, got %', v_updated_count;
    END IF;

    v_result_json := jsonb_build_object('ok', true, 'captured', false, 'failed', true,
      'released', true, 'version', v_new_version)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;

    -- Mirror projection event
    INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
    VALUES (gen_random_uuid()::TEXT, p_server_operation_id, v_action.listing_id, v_new_version, 'mirror_project',
      jsonb_build_object('version', v_new_version, 'state', 'available'));

    RETURN jsonb_build_object('ok', true, 'captured', false, 'failed', true,
      'released', true, 'version', v_new_version);

  ELSE
    -- Unknown/timeout → binding → capture_unknown, authority frozen + recovery_blocked
    UPDATE reservation_payment_bindings SET capture_state = 'capture_unknown', updated_at = now()
    WHERE purchase_id = v_action.purchase_id
      AND capture_state IN ('capture_requested','capture_unknown');
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
      'frozen', true, 'recovery_blocked', true)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;

    RETURN jsonb_build_object('ok', true, 'capture_unknown', true,
      'frozen', true, 'recovery_blocked', true);
  END IF;
END;
$$;

-- ── 10. finalize_sale — Separate Finalization (frozen + captured → sold) ───
-- Requires a succeeded capture action matching the EXACT listing, purchase,
-- PaymentIntent, and binding — not merely any succeeded capture for the purchase.
CREATE OR REPLACE FUNCTION authority_v1.finalize_sale(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_buyer_user_id TEXT, p_frozen_revision TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_authority reservation_authority%ROWTYPE;
  v_capture_action payment_actions%ROWTYPE;
  v_new_version INTEGER; v_revision TEXT; v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'finalize', 'sold', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Load and lock the binding — must be 'captured' with ALL fields matching
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id
    AND payment_intent_id = p_payment_intent_id
    AND listing_id = p_listing_id
    AND buyer_user_id = p_buyer_user_id
    AND frozen_authority_version = p_expected_version
    AND frozen_reservation_revision = p_frozen_revision
    AND capture_state = 'captured'
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'FINALIZE_REJECTED',
      result_json = jsonb_build_object('ok', false, 'code', 'FINALIZE_REJECTED',
        'reason', 'binding not captured or field mismatch')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'FINALIZE_REJECTED',
      'reason', 'binding not captured or field mismatch');
  END IF;

  -- Verify a succeeded capture action exists matching EXACT listing, purchase, PI
  SELECT * INTO v_capture_action FROM payment_actions
  WHERE purchase_id = p_purchase_id
    AND listing_id = p_listing_id
    AND payment_intent_id = p_payment_intent_id
    AND action_type = 'capture'
    AND status = 'succeeded'
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'FINALIZE_REJECTED',
      result_json = jsonb_build_object('ok', false, 'code', 'FINALIZE_REJECTED',
        'reason', 'no succeeded capture action matching exact listing, purchase, PI')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'FINALIZE_REJECTED',
      'reason', 'no succeeded capture action matching exact listing, purchase, PI');
  END IF;

  -- Load and lock the authority — must be 'frozen' with matching version + revision
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id
    AND version = p_expected_version
    AND lifecycle_state = 'frozen'
    AND buyer_user_id = p_buyer_user_id
    AND reservation_revision = p_frozen_revision
    AND reservation_token_hash = v_binding.frozen_reservation_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'FINALIZE_REJECTED',
      result_json = jsonb_build_object('ok', false, 'code', 'FINALIZE_REJECTED',
        'reason', 'authority not in expected frozen state')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'FINALIZE_REJECTED',
      'reason', 'authority not in expected frozen state');
  END IF;

  -- Mark finalization started (before any mutation)
  UPDATE reservation_payment_bindings SET finalization_started_at = now()
  WHERE purchase_id = p_purchase_id AND capture_state = 'captured';

  -- CAS: frozen → sold (exactly one row)
  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'sold',
      buyer_user_id = NULL, reservation_token_hash = NULL,
      reservation_expires_at = NULL, reservation_revision = v_revision,
      current_operation_id = p_server_operation_id, last_operation_type = 'finalize',
      last_operation_at = now(), updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'frozen' AND reservation_revision = p_frozen_revision
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINALIZE_CAS_FAILED: zero authority rows updated';
  END IF;

  -- Update binding: captured → finalized (exactly one row)
  UPDATE reservation_payment_bindings
  SET capture_state = 'finalized', freeze_finalized_at = now(), finalization_started_at = NULL,
      updated_at = now()
  WHERE purchase_id = p_purchase_id AND capture_state = 'captured';
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'FINALIZE_BINDING_COUNT: expected 1 row, got %', v_updated_count;
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'finalized', true, 'version', v_new_version)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  -- Outbox: mirror_project + notification_dispatch + point_award
  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  SELECT gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, effect_type, payload
  FROM (VALUES
    ('mirror_project', jsonb_build_object('version', v_new_version, 'state', 'sold')),
    ('notification_dispatch', jsonb_build_object('type', 'sale_completed')),
    ('point_award', jsonb_build_object('type', 'sale_completed'))
  ) AS t(effect_type, payload);

  RETURN jsonb_build_object('ok', true, 'finalized', true, 'version', v_new_version);
END;
$$;

-- ── 11. begin_cancel — Durable Cancellation Saga Step 1 ─────────────────────
-- Verifies the exact authority and binding snapshot. Accepts two flows:
--   1. Cancel authorized-but-not-captured PI (authority is reserved)
--   2. Cancel capture-requested/unknown PI (authority is frozen)
CREATE OR REPLACE FUNCTION authority_v1.begin_cancel(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_buyer_user_id TEXT, p_expected_revision TEXT,
  p_action_id TEXT, p_stripe_idem_key TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_authority reservation_authority%ROWTYPE;
  v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'begin_cancel', 'frozen', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Lock and verify binding is in a cancellable state
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id
    AND payment_intent_id = p_payment_intent_id
    AND listing_id = p_listing_id
    AND buyer_user_id = p_buyer_user_id
    AND capture_state IN ('authorized','capture_requested','capture_unknown')
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'CANCEL_REJECTED',
      result_json = jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED',
        'reason', 'binding not in cancellable state')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED',
      'reason', 'binding not in cancellable state');
  END IF;

  -- Lock and verify authority matches the expected version and revision
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id
    AND version = p_expected_version
    AND buyer_user_id = p_buyer_user_id
    AND lifecycle_state IN ('reserved','frozen')
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'CANCEL_REJECTED',
      result_json = jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED',
        'reason', 'authority not in expected state')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED',
      'reason', 'authority not in expected state');
  END IF;

  -- Verify revision matches (frozen_authority_revision for frozen, reservation_revision for reserved)
  IF v_authority.lifecycle_state = 'frozen' AND v_authority.reservation_revision = p_expected_revision THEN
    -- OK: frozen with matching revision
  ELSIF v_authority.lifecycle_state = 'reserved' AND v_binding.reservation_revision = p_expected_revision THEN
    -- OK: reserved with matching binding revision
  ELSE
    UPDATE reservation_operations SET status = 'rejected', error_code = 'CANCEL_REJECTED',
      result_json = jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED',
        'reason', 'revision mismatch')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED',
      'reason', 'revision mismatch');
  END IF;

  -- Update binding → cancel_requested (exactly one row)
  UPDATE reservation_payment_bindings SET capture_state = 'cancel_requested', updated_at = now()
  WHERE purchase_id = p_purchase_id
    AND capture_state IN ('authorized','capture_requested','capture_unknown');
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'CANCEL_BINDING_COUNT: expected 1, got %', v_updated_count;
  END IF;

  -- Create payment_action
  INSERT INTO payment_actions (action_id, listing_id, purchase_id, payment_intent_id,
    action_type, stripe_idempotency_key, status)
  VALUES (p_action_id, p_listing_id, p_purchase_id, p_payment_intent_id,
    'cancel', p_stripe_idem_key, 'pending');

  UPDATE reservation_operations SET status = 'committed',
    result_json = jsonb_build_object('ok', true, 'cancel_requested', true,
      'action_id', p_action_id, 'idempotency_key', p_stripe_idem_key)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  RETURN jsonb_build_object('ok', true, 'cancel_requested', true,
    'action_id', p_action_id, 'idempotency_key', p_stripe_idem_key);
END;
$$;

-- ── 12. record_cancel_result — SINGLE Completion Path + Reconciliation ─────
-- Succeeded: binding → canceled, authority → available (release from reserved
--   or frozen). Persist result. Create mirror event.
-- Failed: binding → cancel_failed (unsettled — preserves obligation).
--   Authority stays reserved/frozen + recovery_blocked. Incident. Persist.
-- Unknown (first observation): binding → cancel_unknown, authority frozen +
--   recovery_blocked. Incident. Persist.
-- Unknown (reconciliation): no state change — stays cancel_unknown, frozen,
--   recovery_blocked. Idempotent no-op. Persist operation only.
--
-- RECONCILIATION: When the action is already in 'unknown' status (from a prior
-- timeout), a later trusted webhook or reconciliation observation can resolve
-- it. The recorder/reconciler calls this SAME function with a new operation_id
-- and a provider-confirmed result:
--   cancel_unknown ──recon(succeeded)──→ canceled (release exactly once,
--     clear recovery_blocked, resolve incident)
--   cancel_unknown ──recon(failed)──→ cancel_failed (stays blocked,
--     obligation preserved, resolve cancel_unknown incident + create
--     cancel_failed incident)
--   cancel_unknown ──recon(unknown)──→ stays cancel_unknown (no-op, stays
--     frozen + recovery_blocked)
--
-- IDEMPOTENT REPLAY FIRST: The operation_id is acquired BEFORE the action
-- status check, so a duplicate call with the same operation_id + request_hash
-- returns the stored result even after the action is already completed.
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
  -- Step 1: Look up the action for listing_id (needed for acquire_operation).
  SELECT * INTO v_action FROM payment_actions WHERE action_id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_NOT_FOUND', 'action_id', p_action_id);
  END IF;
  IF v_action.action_type <> 'cancel' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_TYPE_MISMATCH',
      'expected', 'cancel', 'got', v_action.action_type);
  END IF;

  -- Step 2: Acquire operation BEFORE checking action status — so a duplicate
  -- call with the same operation_id + request_hash returns the stored result
  -- even after the action is already completed (idempotent replay).
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', v_action.listing_id, v_action.listing_id,
    'record_cancel', 'frozen', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Step 3: Verify action is in an allowed prior status.
  -- 'pending'/'in_flight' = first observation; 'unknown' = reconciliation.
  IF v_action.status NOT IN ('pending','in_flight','unknown') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_STATUS_INVALID',
      'expected', 'pending, in_flight, or unknown', 'got', v_action.status);
  END IF;

  -- Determine if this is a reconciliation (action was already 'unknown')
  v_is_reconciliation := (v_action.status = 'unknown');
  IF v_is_reconciliation THEN
    v_expected_binding_state := 'cancel_unknown';
  ELSE
    v_expected_binding_state := 'cancel_requested';
  END IF;

  -- Step 4: Verify lease ownership (worker path only)
  IF p_worker_id IS NOT NULL THEN
    IF v_action.lease_owner IS NULL OR v_action.lease_owner != p_worker_id
       OR v_action.lease_expires_at IS NULL OR v_action.lease_expires_at < now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'LEASE_NOT_HELD',
        'action_id', p_action_id, 'worker_id', p_worker_id);
    END IF;
  END IF;

  -- Load and lock binding — must be in expected state for the action status
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

  -- Load and lock authority
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

  -- Record the cancel result on the action (exactly one row)
  -- Skip for 'unknown' reconciliation (action already 'unknown', no change needed)
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
    -- Binding → canceled (exactly one transition)
    UPDATE reservation_payment_bindings SET capture_state = 'canceled', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = v_expected_binding_state;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'CANCEL_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    -- Authority → available (release from reserved or frozen, exactly one transition)
    -- Clear recovery_blocked on successful cancellation/reconciliation
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

    -- If reconciliation: resolve the cancel_unknown incident
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
    -- Cancel failure → cancel_failed (unsettled — preserves obligation).
    -- Authority stays reserved/frozen + recovery_blocked. Incident.
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

    -- If reconciliation: resolve cancel_unknown incident, then create cancel_failed
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
    -- Unknown/timeout
    IF v_is_reconciliation THEN
      -- Reconciliation with still-unknown result: no state change.
      -- Binding stays cancel_unknown, authority stays frozen + recovery_blocked.
      -- The action status was already 'unknown' and stays 'unknown'.
      -- No incident change (already exists). Idempotent no-op.
      -- Only the operation ledger is updated.
      v_result_json := jsonb_build_object('ok', true, 'cancel_unknown', true,
        'recovery_blocked', true, 'reconciliation', true, 'resolved', false)::TEXT;
      UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;

      RETURN jsonb_build_object('ok', true, 'cancel_unknown', true,
        'recovery_blocked', true, 'reconciliation', true, 'resolved', false);
    ELSE
      -- First observation with unknown: binding → cancel_unknown, authority blocked
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

-- ── 13. begin_refund — Durable Refund Saga Step 1 ──────────────────────────
-- Only accepts captured or finalized states. NOT capture_unknown — resolve
-- whether capture succeeded first. Verifies exact authority and binding.
CREATE OR REPLACE FUNCTION authority_v1.begin_refund(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_buyer_user_id TEXT, p_expected_revision TEXT,
  p_action_id TEXT, p_stripe_idem_key TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_authority reservation_authority%ROWTYPE;
  v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'begin_refund', 'frozen', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Lock and verify binding is in a refundable state (captured or finalized only)
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id
    AND payment_intent_id = p_payment_intent_id
    AND listing_id = p_listing_id
    AND buyer_user_id = p_buyer_user_id
    AND capture_state IN ('captured','finalized')
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'REFUND_REJECTED',
      result_json = jsonb_build_object('ok', false, 'code', 'REFUND_REJECTED',
        'reason', 'binding not in captured or finalized state')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'REFUND_REJECTED',
      'reason', 'binding not in captured or finalized state');
  END IF;

  -- Lock and verify authority matches
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id
    AND version = p_expected_version
    AND buyer_user_id = p_buyer_user_id
    AND lifecycle_state IN ('frozen','sold')
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'REFUND_REJECTED',
      result_json = jsonb_build_object('ok', false, 'code', 'REFUND_REJECTED',
        'reason', 'authority not in expected state')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'REFUND_REJECTED',
      'reason', 'authority not in expected state');
  END IF;

  -- Verify revision matches
  IF v_authority.lifecycle_state = 'frozen' AND v_authority.reservation_revision = p_expected_revision THEN
    -- OK: frozen with matching revision
  ELSIF v_authority.lifecycle_state = 'sold' THEN
    -- OK: sold (refund after finalization)
  ELSE
    UPDATE reservation_operations SET status = 'rejected', error_code = 'REFUND_REJECTED',
      result_json = jsonb_build_object('ok', false, 'code', 'REFUND_REJECTED',
        'reason', 'revision mismatch')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'REFUND_REJECTED', 'reason', 'revision mismatch');
  END IF;

  -- Update binding → refund_requested (exactly one row)
  UPDATE reservation_payment_bindings SET capture_state = 'refund_requested', updated_at = now()
  WHERE purchase_id = p_purchase_id AND capture_state IN ('captured','finalized');
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'REFUND_BINDING_COUNT: expected 1, got %', v_updated_count;
  END IF;

  INSERT INTO payment_actions (action_id, listing_id, purchase_id, payment_intent_id,
    action_type, stripe_idempotency_key, status)
  VALUES (p_action_id, p_listing_id, p_purchase_id, p_payment_intent_id,
    'refund', p_stripe_idem_key, 'pending');

  UPDATE reservation_operations SET status = 'committed',
    result_json = jsonb_build_object('ok', true, 'refund_requested', true,
      'action_id', p_action_id, 'idempotency_key', p_stripe_idem_key)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  RETURN jsonb_build_object('ok', true, 'refund_requested', true,
    'action_id', p_action_id, 'idempotency_key', p_stripe_idem_key);
END;
$$;

-- ── 14. record_refund_result — SINGLE Completion Path ──────────────────────
-- Succeeded: binding → refunded. Authority stays in current state (sold or
--   frozen). Persist result.
-- Failed: binding → refund_failed (unsettled — preserves captured/finalized
--   obligation). Authority stays + recovery_blocked. Incident. Persist.
-- Unknown: binding → refund_unknown, authority frozen + recovery_blocked.
--   Incident. Persist.
CREATE OR REPLACE FUNCTION authority_v1.record_refund_result(
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
  v_updated_count INTEGER;
  v_result_json TEXT;
BEGIN
  -- Action-not-found handled BEFORE acquiring operation
  SELECT * INTO v_action FROM payment_actions WHERE action_id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_NOT_FOUND', 'action_id', p_action_id);
  END IF;
  IF v_action.action_type <> 'refund' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_TYPE_MISMATCH',
      'expected', 'refund', 'got', v_action.action_type);
  END IF;
  IF v_action.status NOT IN ('pending','in_flight') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTION_STATUS_INVALID',
      'expected', 'pending or in_flight', 'got', v_action.status);
  END IF;

  -- Verify lease ownership (worker path only)
  IF p_worker_id IS NOT NULL THEN
    IF v_action.lease_owner IS NULL OR v_action.lease_owner != p_worker_id
       OR v_action.lease_expires_at IS NULL OR v_action.lease_expires_at < now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'LEASE_NOT_HELD',
        'action_id', p_action_id, 'worker_id', p_worker_id);
    END IF;
  END IF;

  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', v_action.listing_id, v_action.listing_id,
    'record_refund', 'frozen', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Load and lock binding
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = v_action.purchase_id
    AND listing_id = v_action.listing_id
    AND payment_intent_id = v_action.payment_intent_id
  FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'BINDING_NOT_FOUND',
      result_json = jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'BINDING_NOT_FOUND');
  END IF;

  -- Load and lock authority
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = v_action.listing_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'AUTHORITY_NOT_FOUND',
      result_json = jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_FOUND')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORITY_NOT_FOUND');
  END IF;

  -- Record the refund result on the action (exactly one row)
  UPDATE payment_actions SET status = p_result_derived,
    stripe_result_json = p_stripe_response::TEXT, completed_at = now(), updated_at = now(),
    lease_owner = NULL, lease_expires_at = NULL
  WHERE action_id = p_action_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'ACTION_UPDATE_COUNT: expected 1, got %', v_updated_count;
  END IF;

  IF p_result_derived = 'succeeded' THEN
    -- Binding → refunded (exactly one transition). Authority stays in current state.
    UPDATE reservation_payment_bindings SET capture_state = 'refunded', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = 'refund_requested';
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'REFUND_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    v_result_json := jsonb_build_object('ok', true, 'refunded', true)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', true, 'refunded', true);

  ELSIF p_result_derived = 'failed' THEN
    -- Refund failure → refund_failed (unsettled — preserves captured/finalized
    -- obligation). Authority stays + recovery_blocked. Incident.
    UPDATE reservation_payment_bindings SET capture_state = 'refund_failed', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = 'refund_requested';
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'REFUND_FAILED_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    UPDATE reservation_authority
    SET recovery_blocked = true, recovery_blocked_reason = 'refund_failed',
        recovery_blocked_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id;

    INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
    VALUES ('refund_failed:' || v_action.listing_id, 'refund_failed', 'critical',
      'Refund Result Failed', 'Stripe refund returned failure — obligation preserved', v_action.listing_id, 'listing')
    ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
      last_occurred_at = now();

    v_result_json := jsonb_build_object('ok', true, 'refunded', false, 'refund_failed', true,
      'recovery_blocked', true)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', true, 'refunded', false, 'refund_failed', true,
      'recovery_blocked', true);

  ELSE
    -- Unknown/timeout → refund_unknown, authority frozen + recovery_blocked
    UPDATE reservation_payment_bindings SET capture_state = 'refund_unknown', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = 'refund_requested';
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'REFUND_UNKNOWN_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    UPDATE reservation_authority
    SET recovery_blocked = true, recovery_blocked_reason = 'refund_unknown',
        recovery_blocked_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id;

    INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
    VALUES ('refund_unknown:' || v_action.listing_id, 'refund_unknown', 'critical',
      'Refund Result Unknown', 'Stripe refund returned unknown result', v_action.listing_id, 'listing')
    ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
      last_occurred_at = now();

    v_result_json := jsonb_build_object('ok', true, 'refund_unknown', true,
      'recovery_blocked', true)::TEXT;
    UPDATE reservation_operations SET status = 'committed', result_json = v_result_json,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', true, 'refund_unknown', true, 'recovery_blocked', true);
  END IF;
END;
$$;

-- ── 15. abort_binding ──────────────────────────────────────────────────────
-- Supports the valid post-cancel state without incorrectly requiring
-- authority to be frozen. If the legitimate pre-capture cancel occurred
-- while reserved, the authority may already be available (released by
-- record_cancel_result). Abort releases frozen/reserved → available and
-- updates binding → aborted.
CREATE OR REPLACE FUNCTION authority_v1.abort_binding(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_authority reservation_authority%ROWTYPE;
  v_new_version INTEGER; v_revision TEXT;
  v_refund_exists BOOLEAN; v_updated_count INTEGER;
  v_result_json TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'abort', 'available', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id FOR UPDATE;

  IF v_binding.capture_state IN ('captured','finalized') THEN
    SELECT EXISTS(SELECT 1 FROM payment_actions
      WHERE listing_id = p_listing_id AND purchase_id = p_purchase_id
        AND action_type = 'refund' AND status = 'succeeded') INTO v_refund_exists;
    IF NOT v_refund_exists THEN
      UPDATE reservation_operations SET status = 'rejected', error_code = 'ABORT_REJECTED',
        result_json = jsonb_build_object('ok', false, 'code', 'ABORT_REJECTED',
          'reason', 'binding is captured/finalized without confirmed refund')::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'ABORT_REJECTED',
        'reason', 'binding is captured/finalized without confirmed refund');
    END IF;
  END IF;

  -- Lock authority
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = p_listing_id FOR UPDATE;

  v_new_version := p_expected_version;
  -- Release authority if frozen or reserved (not already available/sold/terminal)
  IF v_authority.lifecycle_state IN ('frozen','reserved') THEN
    v_revision := gen_random_uuid()::TEXT;
    UPDATE reservation_authority
    SET version = version + 1, lifecycle_state = 'available',
        buyer_user_id = NULL, reservation_token_hash = NULL,
        reservation_expires_at = NULL, reservation_revision = v_revision,
        current_operation_id = p_server_operation_id, last_operation_type = 'abort',
        last_operation_at = now(), updated_at = now()
    WHERE listing_id = p_listing_id AND version = p_expected_version
      AND lifecycle_state IN ('frozen','reserved')
    RETURNING version INTO v_new_version;

    IF NOT FOUND THEN
      UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
        result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
    END IF;
  END IF;

  -- Update binding → aborted (exactly one row)
  UPDATE reservation_payment_bindings SET capture_state = 'aborted', updated_at = now()
  WHERE purchase_id = p_purchase_id
    AND capture_state IN ('authorized','cancel_requested','cancel_unknown','cancel_failed',
                          'canceled','failed','refunded');
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'ABORT_BINDING_COUNT: expected 1, got %', v_updated_count;
  END IF;

  v_result_json := jsonb_build_object('ok', true, 'aborted', true, 'version', v_new_version)::TEXT;
  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = v_result_json, committed_at = now()
  WHERE operation_id = p_server_operation_id;

  -- Mirror event only if authority was released
  IF v_authority.lifecycle_state IN ('frozen','reserved') THEN
    INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
    VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
      jsonb_build_object('version', v_new_version, 'state', 'available'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'aborted', true, 'version', v_new_version);
END;
$$;

-- ── 16. cancel_listing — Simple Seller Cancel (not for frozen) ─────────────
CREATE OR REPLACE FUNCTION authority_v1.cancel_listing(
  p_listing_id TEXT, p_expected_version INTEGER,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'cancel', 'cancelled', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'cancelled',
      buyer_user_id = NULL, reservation_token_hash = NULL,
      reservation_expires_at = NULL, reservation_revision = v_revision,
      seller_cancel_requested_at = now(), current_operation_id = p_server_operation_id,
      last_operation_type = 'cancel', last_operation_at = now(), updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state IN ('available','reserved') AND checkout_quarantined = false
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM reservation_authority WHERE listing_id = p_listing_id AND lifecycle_state = 'frozen') THEN
      UPDATE reservation_operations SET status = 'rejected', error_code = 'CANCEL_REJECTED_FROZEN',
        result_json = jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED_FROZEN')::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED_FROZEN');
    ELSE
      UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT',
        result_json = jsonb_build_object('ok', false, 'code', 'CONFLICT')::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
    END IF;
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'cancelled', true, 'version', v_new_version)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'cancelled'));

  RETURN jsonb_build_object('ok', true, 'cancelled', true, 'version', v_new_version);
END;
$$;

-- ── 17. quarantine_listing ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.quarantine_listing(
  p_listing_id TEXT, p_reason TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_incident_key TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'listing', p_listing_id, p_listing_id,
    'quarantine', 'frozen', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  UPDATE reservation_authority
  SET checkout_quarantined = true, checkout_quarantine_reason = p_reason,
      checkout_quarantined_at = now(), recovery_blocked = true,
      recovery_blocked_reason = p_reason, recovery_blocked_at = now(), updated_at = now()
  WHERE listing_id = p_listing_id;

  v_incident_key := 'quarantine:' || p_listing_id;
  INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
  VALUES (v_incident_key, 'verification_mismatch', 'critical',
    'Listing Quarantined', p_reason, p_listing_id, 'listing')
  ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
    last_occurred_at = now();

  UPDATE reservation_operations SET status = 'committed',
    result_json = jsonb_build_object('ok', true, 'quarantined', true)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  RETURN jsonb_build_object('ok', true, 'quarantined', true);
END;
$$;

-- ── 18. check_user_obligations ─────────────────────────────────────────────
-- Includes cancel_failed and refund_failed in unsettled obligations.
CREATE OR REPLACE FUNCTION authority_v1.check_user_obligations(
  p_user_id TEXT
) RETURNS TABLE(listing_id TEXT, role TEXT, lifecycle_state TEXT, capture_state TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT ra.listing_id, 'seller'::TEXT, ra.lifecycle_state, b.capture_state::TEXT
  FROM reservation_authority ra
  LEFT JOIN reservation_payment_bindings b ON b.listing_id = ra.listing_id
  WHERE ra.seller_user_id = p_user_id
    AND (ra.lifecycle_state IN ('reserved','frozen')
         OR b.capture_state IN ('authorized','capture_requested','capture_unknown','captured',
                                 'cancel_requested','cancel_unknown','cancel_failed',
                                 'refund_requested','refund_unknown','refund_failed'))

  UNION ALL

  SELECT ra.listing_id, 'buyer'::TEXT, ra.lifecycle_state, b.capture_state::TEXT
  FROM reservation_authority ra
  LEFT JOIN reservation_payment_bindings b ON b.listing_id = ra.listing_id
  WHERE ra.buyer_user_id = p_user_id
    AND (ra.lifecycle_state IN ('reserved','frozen')
         OR b.capture_state IN ('authorized','capture_requested','capture_unknown','captured',
                                 'cancel_requested','cancel_unknown','cancel_failed',
                                 'refund_requested','refund_unknown','refund_failed'));
END;
$$;

-- ── 19. anonymize_user ────────────────────────────────────────────────────
-- Uses subject_type='user', listing_id=NULL (no FK to reservation_authority).
CREATE OR REPLACE FUNCTION authority_v1.anonymize_user(
  p_user_id TEXT, p_pseudonymous_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_temp
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, 'user', p_user_id, NULL,
    'anonymize', 'anonymized', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  IF EXISTS(SELECT 1 FROM check_user_obligations(p_user_id)) THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'DELETION_BLOCKED',
      result_json = jsonb_build_object('ok', false, 'code', 'DELETION_BLOCKED',
        'reason', 'user has unsettled obligations')::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'DELETION_BLOCKED',
      'reason', 'user has unsettled obligations');
  END IF;

  UPDATE reservation_authority SET seller_user_id = p_pseudonymous_id, updated_at = now()
  WHERE seller_user_id = p_user_id AND lifecycle_state IN ('sold','cancelled','expired');

  UPDATE reservation_authority SET buyer_user_id = p_pseudonymous_id, updated_at = now()
  WHERE buyer_user_id = p_user_id AND lifecycle_state IN ('sold','cancelled','expired');

  UPDATE reservation_operations SET status = 'committed',
    result_json = jsonb_build_object('ok', true, 'anonymized', true,
      'pseudonymous_id', p_pseudonymous_id)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  RETURN jsonb_build_object('ok', true, 'anonymized', true, 'pseudonymous_id', p_pseudonymous_id);
END;
$$;