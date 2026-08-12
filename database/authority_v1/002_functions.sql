-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Stored Functions (002)
-- Source of truth for all authority transaction logic.
--
-- IMPORTANT: A PL/pgSQL function invocation executes inside the caller's
-- PostgreSQL transaction. Transaction-control statements (BEGIN/COMMIT) are
-- NOT placed inside ordinary functions. Each function call executes
-- atomically — either all its statements commit or all roll back with the
-- caller's transaction.
--
-- Every function is defined with a hardened search_path and executes
-- with the owner's privileges (not the caller's). All referenced objects
-- are schema-qualified via the search_path.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. acquire_operation — Operation-ID Acquisition ─────────────────────────
-- Uses INSERT ... ON CONFLICT DO NOTHING RETURNING to distinguish a newly
-- acquired operation from an existing one. OPERATION_ID_CONFLICT is a
-- persistent structured result — NOT an exception that would roll back the
-- ledger. The operation_id is server-derived and namespaced; the stored
-- function never trusts an arbitrary raw client operation ID.
CREATE OR REPLACE FUNCTION authority_v1.acquire_operation(
  p_server_operation_id  TEXT,
  p_listing_id           TEXT,
  p_operation_type       TEXT,
  p_requested_state      TEXT,
  p_expected_version     INTEGER,
  p_request_hash         TEXT
) RETURNS TABLE(acquired BOOLEAN, op_status TEXT, replay_result JSONB, stored_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_inserted   TEXT;
  v_existing   reservation_operations%ROWTYPE;
BEGIN
  -- Attempt to insert. RETURNING gives a row ONLY if THIS request inserted it.
  INSERT INTO reservation_operations
    (operation_id, listing_id, operation_type, requested_state, expected_version, request_hash, status)
  VALUES
    (p_server_operation_id, p_listing_id, p_operation_type, p_requested_state, p_expected_version, p_request_hash, 'pending')
  ON CONFLICT (operation_id) DO NOTHING
  RETURNING operation_id INTO v_inserted;

  IF v_inserted IS NOT NULL THEN
    -- Newly inserted → acquired
    RETURN QUERY SELECT true, 'pending'::TEXT, NULL::JSONB, p_request_hash;
    RETURN;
  END IF;

  -- Already existed — load and classify
  SELECT * INTO v_existing FROM reservation_operations
  WHERE operation_id = p_server_operation_id FOR UPDATE;

  IF v_existing.request_hash = p_request_hash AND v_existing.status = 'committed' THEN
    -- Deterministic replay: return stored result
    RETURN QUERY SELECT true, 'committed'::TEXT, v_existing.result_json::JSONB, v_existing.request_hash;
  ELSIF v_existing.request_hash = p_request_hash AND v_existing.status = 'pending' THEN
    -- Same hash, still pending → in-progress
    RETURN QUERY SELECT false, 'pending'::TEXT, NULL::JSONB, v_existing.request_hash;
  ELSIF v_existing.request_hash != p_request_hash THEN
    -- Same operation_id, different request hash → persistent structured conflict.
    -- Do NOT raise an exception — that would roll back any ledger result that
    -- must persist. Return a structured JSON result instead.
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
    -- Same hash, other status (rejected, conflict, idempotent_replay)
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
SET search_path = authority_v1, pg_catalog
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
CREATE OR REPLACE FUNCTION authority_v1.initialize_listing(
  p_listing_id TEXT, p_seller_user_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'initialize', 'available', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  INSERT INTO reservation_authority (listing_id, version, lifecycle_state, seller_user_id)
  VALUES (p_listing_id, 0, 'available', p_seller_user_id)
  ON CONFLICT (listing_id) DO NOTHING;

  UPDATE reservation_operations SET status = 'committed', committed_version = 0,
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
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT; v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'reserve', 'reserved', p_expected_version, p_request_hash);
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
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT'
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
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'release', 'available', p_expected_version, p_request_hash);
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
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT'
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
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'expire', 'expired', p_expected_version, p_request_hash);
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
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT'
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
-- Called after idempotent Stripe PaymentIntent creation. Atomically binds
-- the PI to the reservation. If Stripe PI creation succeeds but binding fails,
-- the backend function must use a durable cancellation action and
-- quarantine/recovery block until cancellation is confirmed.
CREATE OR REPLACE FUNCTION authority_v1.bind_payment_intent(
  p_listing_id TEXT, p_purchase_id TEXT, p_payment_intent_id TEXT,
  p_buyer_user_id TEXT, p_authority_version INTEGER,
  p_reservation_revision TEXT, p_token_hash TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_authority reservation_authority%ROWTYPE;
  v_existing_binding reservation_payment_bindings%ROWTYPE;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'bind_pi', 'reserved', p_authority_version, p_request_hash);
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
    UPDATE reservation_operations SET status = 'rejected', error_code = 'AUTHORITY_MISMATCH'
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORITY_MISMATCH');
  END IF;

  -- Check for existing binding by payment_intent_id (unique constraint)
  SELECT * INTO v_existing_binding FROM reservation_payment_bindings
  WHERE payment_intent_id = p_payment_intent_id FOR UPDATE;

  IF FOUND THEN
    -- Existing binding: verify ALL fields match (idempotent replay) or conflict
    IF v_existing_binding.purchase_id = p_purchase_id
       AND v_existing_binding.listing_id = p_listing_id
       AND v_existing_binding.buyer_user_id = p_buyer_user_id
       AND v_existing_binding.authority_version = p_authority_version
       AND v_existing_binding.reservation_revision = p_reservation_revision
       AND v_existing_binding.reservation_token_hash = p_token_hash
       AND v_existing_binding.capture_state = 'authorized' THEN
      -- Exact same idempotent binding → return stored result
      UPDATE reservation_operations SET status = 'idempotent_replay',
        result_json = jsonb_build_object('ok', true, 'bound', true, 'idempotent', true)::TEXT,
        committed_at = now()
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', true, 'bound', true, 'idempotent', true);
    ELSE
      -- Mismatch → fail closed. The backend must cancel the PI and quarantine.
      UPDATE reservation_operations SET status = 'rejected', error_code = 'PAYMENT_BINDING_CONFLICT'
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_BINDING_CONFLICT',
        'reason', 'payment_intent_id already bound to different purchase/buyer');
    END IF;
  ELSE
    -- No existing binding → insert
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
-- Verifies the binding exists with capture_state = 'authorized'. Does NOT
-- create the binding — that is done by bind_payment_intent.
CREATE OR REPLACE FUNCTION authority_v1.begin_capture(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_buyer_user_id TEXT, p_expected_revision TEXT,
  p_action_id TEXT, p_stripe_idem_key TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
  v_frozen_token_hash TEXT; v_frozen_expires TIMESTAMPTZ;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'begin_capture', 'frozen', p_expected_version, p_request_hash);
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
    UPDATE reservation_operations SET status = 'rejected', error_code = 'BINDING_NOT_AUTHORIZED'
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
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT'
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

-- ── 9. record_capture_result — Durable Saga Step 3 (Capture Only, NO Finalize)
-- Records the Stripe capture result. Authority remains 'frozen' on success.
-- Finalization is a SEPARATE step (finalize_sale).
--
-- SECURITY: p_result_derived is derived by the backend function from a
-- verified Stripe SDK response or a signature-verified webhook — NEVER from
-- the frontend request body. The stored function verifies the action and
-- binding before recording.
CREATE OR REPLACE FUNCTION authority_v1.record_capture_result(
  p_action_id TEXT,
  p_result_derived TEXT,  -- 'succeeded' | 'failed' | 'unknown' — from verified Stripe SDK/webhook
  p_stripe_response JSONB,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_action payment_actions%ROWTYPE;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_authority reservation_authority%ROWTYPE;
  v_updated_count INTEGER;
BEGIN
  -- Acquire operation_id (listing_id derived from the action)
  SELECT listing_id INTO v_action.listing_id FROM payment_actions WHERE action_id = p_action_id;

  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, v_action.listing_id, 'record_capture', 'frozen', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Load and lock the payment action
  SELECT * INTO v_action FROM payment_actions WHERE action_id = p_action_id FOR UPDATE;

  -- Verify: action exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_NOT_FOUND';
  END IF;

  -- Verify: action type is 'capture'
  IF v_action.action_type <> 'capture' THEN
    RAISE EXCEPTION 'ACTION_TYPE_MISMATCH: expected capture, got %', v_action.action_type;
  END IF;

  -- Verify: action is in an allowed prior status
  IF v_action.status NOT IN ('pending','in_flight') THEN
    RAISE EXCEPTION 'ACTION_STATUS_INVALID: expected pending or in_flight, got %', v_action.status;
  END IF;

  -- Load and lock the binding
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = v_action.purchase_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BINDING_NOT_FOUND';
  END IF;

  -- Verify: all fields match
  IF v_binding.listing_id <> v_action.listing_id
     OR v_binding.payment_intent_id <> v_action.payment_intent_id THEN
    RAISE EXCEPTION 'BINDING_FIELD_MISMATCH';
  END IF;

  -- Load and lock the authority
  SELECT * INTO v_authority FROM reservation_authority
  WHERE listing_id = v_action.listing_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUTHORITY_NOT_FOUND';
  END IF;

  -- Verify: authority is frozen with matching buyer, version, revision, token hash
  IF v_authority.lifecycle_state <> 'frozen'
     OR v_authority.buyer_user_id <> v_binding.buyer_user_id
     OR v_authority.version <> v_binding.frozen_authority_version
     OR v_authority.reservation_revision <> v_binding.frozen_reservation_revision
     OR v_authority.reservation_token_hash <> v_binding.frozen_reservation_token_hash THEN
    RAISE EXCEPTION 'AUTHORITY_FROZEN_MISMATCH';
  END IF;

  -- Record the capture result
  UPDATE payment_actions SET status = p_result_derived,
    stripe_result_json = p_stripe_response::TEXT,
    completed_at = now(), updated_at = now()
  WHERE action_id = p_action_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'ACTION_UPDATE_COUNT: expected 1, got %', v_updated_count;
  END IF;

  IF p_result_derived = 'succeeded' THEN
    -- Binding → captured. Authority remains FROZEN. Finalization is separate.
    UPDATE reservation_payment_bindings SET capture_state = 'captured', updated_at = now()
    WHERE purchase_id = v_action.purchase_id
      AND capture_state IN ('capture_requested','capture_unknown');
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'CAPTURE_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    UPDATE reservation_operations SET status = 'committed',
      result_json = jsonb_build_object('ok', true, 'captured', true,
        'action_id', p_action_id)::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;

    RETURN jsonb_build_object('ok', true, 'captured', true, 'action_id', p_action_id);

  ELSIF p_result_derived = 'failed' THEN
    -- Known failure → binding failed, release reservation (frozen → available)
    UPDATE reservation_payment_bindings SET capture_state = 'failed', updated_at = now()
    WHERE purchase_id = v_action.purchase_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN
      RAISE EXCEPTION 'FAILED_BINDING_COUNT: expected 1, got %', v_updated_count;
    END IF;

    -- Release reservation (frozen → available)
    UPDATE reservation_authority
    SET version = version + 1, lifecycle_state = 'available',
        buyer_user_id = NULL, reservation_token_hash = NULL,
        reservation_expires_at = NULL, reservation_revision = gen_random_uuid()::TEXT,
        current_operation_id = p_server_operation_id, last_operation_type = 'record_capture',
        last_operation_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id AND lifecycle_state = 'frozen';

    UPDATE reservation_payment_bindings SET capture_state = 'aborted', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = 'failed';

    UPDATE reservation_operations SET status = 'committed',
      result_json = jsonb_build_object('ok', true, 'captured', false, 'failed', true, 'released', true)::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;

    RETURN jsonb_build_object('ok', true, 'captured', false, 'failed', true, 'released', true);

  ELSE
    -- Unknown/timeout → capture_unknown, authority remains frozen, recovery_blocked
    UPDATE reservation_payment_bindings SET capture_state = 'capture_unknown', updated_at = now()
    WHERE purchase_id = v_action.purchase_id;
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

    UPDATE reservation_operations SET status = 'committed',
      result_json = jsonb_build_object('ok', true, 'capture_unknown', true,
        'frozen', true, 'recovery_blocked', true)::TEXT,
      committed_at = now()
    WHERE operation_id = p_server_operation_id;

    RETURN jsonb_build_object('ok', true, 'capture_unknown', true, 'frozen', true, 'recovery_blocked', true);
  END IF;
END;
$$;

-- ── 10. finalize_sale — Separate Finalization (frozen + captured → sold) ───
-- Verifies the exact captured binding and frozen authority snapshot, then
-- atomically transitions to sold/finalized and creates financial outbox
-- effects. A reconciler can safely call this for a captured-but-not-finalized
-- binding.
CREATE OR REPLACE FUNCTION authority_v1.finalize_sale(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_buyer_user_id TEXT, p_frozen_revision TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_binding reservation_payment_bindings%ROWTYPE;
  v_authority reservation_authority%ROWTYPE;
  v_capture_action payment_actions%ROWTYPE;
  v_new_version INTEGER; v_revision TEXT; v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'finalize', 'sold', p_expected_version, p_request_hash);
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
    UPDATE reservation_operations SET status = 'rejected', error_code = 'FINALIZE_REJECTED'
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'FINALIZE_REJECTED',
      'reason', 'binding not captured or field mismatch');
  END IF;

  -- Verify a succeeded capture action exists for this purchase
  SELECT * INTO v_capture_action FROM payment_actions
  WHERE purchase_id = p_purchase_id
    AND action_type = 'capture'
    AND status = 'succeeded'
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'FINALIZE_REJECTED'
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'FINALIZE_REJECTED',
      'reason', 'no succeeded capture action');
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
    UPDATE reservation_operations SET status = 'rejected', error_code = 'FINALIZE_REJECTED'
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'FINALIZE_REJECTED',
      'reason', 'authority not in expected frozen state');
  END IF;

  -- Mark finalization started (before any mutation)
  UPDATE reservation_payment_bindings SET finalization_started_at = now()
  WHERE purchase_id = p_purchase_id AND capture_state = 'captured';

  -- CAS: frozen → sold
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
    RAISE EXCEPTION 'FINALIZE_CAS_FAILED';
  END IF;

  -- Update binding: captured → finalized (exactly one row must update)
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
CREATE OR REPLACE FUNCTION authority_v1.begin_cancel(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_action_id TEXT, p_stripe_idem_key TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_binding reservation_payment_bindings%ROWTYPE; v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'begin_cancel', 'frozen', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  -- Lock and verify binding is in a cancellable state
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id AND payment_intent_id = p_payment_intent_id
    AND capture_state IN ('authorized','capture_requested','capture_unknown')
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'CANCEL_REJECTED'
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED');
  END IF;

  -- Update binding → cancel_requested
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

-- ── 12. record_cancel_result ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.record_cancel_result(
  p_action_id TEXT, p_result_derived TEXT, p_stripe_response JSONB,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_action payment_actions%ROWTYPE; v_updated_count INTEGER;
  v_listing_id TEXT;
BEGIN
  SELECT listing_id INTO v_listing_id FROM payment_actions WHERE action_id = p_action_id;
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, v_listing_id, 'record_cancel', 'frozen', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  SELECT * INTO v_action FROM payment_actions WHERE action_id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTION_NOT_FOUND'; END IF;
  IF v_action.action_type <> 'cancel' THEN RAISE EXCEPTION 'ACTION_TYPE_MISMATCH'; END IF;
  IF v_action.status NOT IN ('pending','in_flight') THEN RAISE EXCEPTION 'ACTION_STATUS_INVALID'; END IF;

  UPDATE payment_actions SET status = p_result_derived,
    stripe_result_json = p_stripe_response::TEXT, completed_at = now(), updated_at = now()
  WHERE action_id = p_action_id;

  IF p_result_derived = 'succeeded' THEN
    UPDATE reservation_payment_bindings SET capture_state = 'canceled', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = 'cancel_requested';
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN RAISE EXCEPTION 'CANCEL_BINDING_COUNT: expected 1, got %', v_updated_count; END IF;
    RETURN jsonb_build_object('ok', true, 'canceled', true);
  ELSIF p_result_derived = 'failed' THEN
    UPDATE reservation_payment_bindings SET capture_state = 'failed', updated_at = now()
    WHERE purchase_id = v_action.purchase_id;
    RETURN jsonb_build_object('ok', true, 'canceled', false, 'failed', true);
  ELSE
    UPDATE reservation_payment_bindings SET capture_state = 'cancel_unknown', updated_at = now()
    WHERE purchase_id = v_action.purchase_id;
    UPDATE reservation_authority SET recovery_blocked = true,
      recovery_blocked_reason = 'cancel_unknown', recovery_blocked_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id;
    INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
    VALUES ('cancel_unknown:' || v_action.listing_id, 'cancel_unknown', 'critical',
      'Cancel Result Unknown', 'Stripe cancel returned unknown result', v_action.listing_id, 'listing')
    ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1, last_occurred_at = now();
    RETURN jsonb_build_object('ok', true, 'cancel_unknown', true, 'recovery_blocked', true);
  END IF;
END;
$$;

-- ── 13. begin_refund — Durable Refund Saga Step 1 ──────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.begin_refund(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_action_id TEXT, p_stripe_idem_key TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_binding reservation_payment_bindings%ROWTYPE; v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'begin_refund', 'frozen', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id AND payment_intent_id = p_payment_intent_id
    AND capture_state IN ('captured','capture_unknown')
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'REFUND_REJECTED'
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'REFUND_REJECTED');
  END IF;

  UPDATE reservation_payment_bindings SET capture_state = 'refund_requested', updated_at = now()
  WHERE purchase_id = p_purchase_id AND capture_state IN ('captured','capture_unknown');
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN RAISE EXCEPTION 'REFUND_BINDING_COUNT: expected 1, got %', v_updated_count; END IF;

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

-- ── 14. record_refund_result ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.record_refund_result(
  p_action_id TEXT, p_result_derived TEXT, p_stripe_response JSONB,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_action payment_actions%ROWTYPE; v_updated_count INTEGER; v_listing_id TEXT;
BEGIN
  SELECT listing_id INTO v_listing_id FROM payment_actions WHERE action_id = p_action_id;
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, v_listing_id, 'record_refund', 'frozen', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  SELECT * INTO v_action FROM payment_actions WHERE action_id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTION_NOT_FOUND'; END IF;
  IF v_action.action_type <> 'refund' THEN RAISE EXCEPTION 'ACTION_TYPE_MISMATCH'; END IF;
  IF v_action.status NOT IN ('pending','in_flight') THEN RAISE EXCEPTION 'ACTION_STATUS_INVALID'; END IF;

  UPDATE payment_actions SET status = p_result_derived,
    stripe_result_json = p_stripe_response::TEXT, completed_at = now(), updated_at = now()
  WHERE action_id = p_action_id;

  IF p_result_derived = 'succeeded' THEN
    UPDATE reservation_payment_bindings SET capture_state = 'refunded', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = 'refund_requested';
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count != 1 THEN RAISE EXCEPTION 'REFUND_BINDING_COUNT: expected 1, got %', v_updated_count; END IF;
    RETURN jsonb_build_object('ok', true, 'refunded', true);
  ELSIF p_result_derived = 'failed' THEN
    UPDATE reservation_payment_bindings SET capture_state = 'failed', updated_at = now()
    WHERE purchase_id = v_action.purchase_id;
    RETURN jsonb_build_object('ok', true, 'refunded', false, 'failed', true);
  ELSE
    UPDATE reservation_payment_bindings SET capture_state = 'refund_unknown', updated_at = now()
    WHERE purchase_id = v_action.purchase_id;
    UPDATE reservation_authority SET recovery_blocked = true,
      recovery_blocked_reason = 'refund_unknown', recovery_blocked_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id;
    INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
    VALUES ('refund_unknown:' || v_action.listing_id, 'refund_unknown', 'critical',
      'Refund Result Unknown', 'Stripe refund returned unknown result', v_action.listing_id, 'listing')
    ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1, last_occurred_at = now();
    RETURN jsonb_build_object('ok', true, 'refund_unknown', true, 'recovery_blocked', true);
  END IF;
END;
$$;

-- ── 15. abort_binding ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.abort_binding(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_binding reservation_payment_bindings%ROWTYPE; v_new_version INTEGER; v_revision TEXT;
  v_refund_exists BOOLEAN; v_updated_count INTEGER;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'abort', 'available', p_expected_version, p_request_hash);
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
      UPDATE reservation_operations SET status = 'rejected', error_code = 'ABORT_REJECTED'
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'ABORT_REJECTED',
        'reason', 'binding is captured/finalized without confirmed refund');
    END IF;
  END IF;

  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'available',
      buyer_user_id = NULL, reservation_token_hash = NULL,
      reservation_expires_at = NULL, reservation_revision = v_revision,
      current_operation_id = p_server_operation_id, last_operation_type = 'abort',
      last_operation_at = now(), updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version AND lifecycle_state = 'frozen'
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT'
    WHERE operation_id = p_server_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  UPDATE reservation_payment_bindings SET capture_state = 'aborted', updated_at = now()
  WHERE purchase_id = p_purchase_id
    AND capture_state IN ('authorized','cancel_requested','cancel_unknown','canceled','failed','refunded');
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'ABORT_BINDING_COUNT: expected 1, got %', v_updated_count;
  END IF;

  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'aborted', true, 'version', v_new_version)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_server_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'available'));

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
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'cancel', 'cancelled', p_expected_version, p_request_hash);
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
      UPDATE reservation_operations SET status = 'rejected', error_code = 'CANCEL_REJECTED_FROZEN'
      WHERE operation_id = p_server_operation_id;
      RETURN jsonb_build_object('ok', false, 'code', 'CANCEL_REJECTED_FROZEN');
    ELSE
      UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT'
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
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
  v_incident_key TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_listing_id, 'quarantine', 'frozen', 0, p_request_hash);
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
  ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1, last_occurred_at = now();

  UPDATE reservation_operations SET status = 'committed',
    result_json = jsonb_build_object('ok', true, 'quarantined', true)::TEXT,
    committed_at = now()
  WHERE operation_id = p_server_operation_id;

  RETURN jsonb_build_object('ok', true, 'quarantined', true);
END;
$$;

-- ── 18. check_user_obligations ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.check_user_obligations(
  p_user_id TEXT
) RETURNS TABLE(listing_id TEXT, role TEXT, lifecycle_state TEXT, capture_state TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT ra.listing_id, 'seller'::TEXT, ra.lifecycle_state, b.capture_state::TEXT
  FROM reservation_authority ra
  LEFT JOIN reservation_payment_bindings b ON b.listing_id = ra.listing_id
  WHERE ra.seller_user_id = p_user_id
    AND (ra.lifecycle_state IN ('reserved','frozen')
         OR b.capture_state IN ('authorized','capture_requested','capture_unknown','captured',
                                 'cancel_requested','cancel_unknown',
                                 'refund_requested','refund_unknown'))

  UNION ALL

  SELECT ra.listing_id, 'buyer'::TEXT, ra.lifecycle_state, b.capture_state::TEXT
  FROM reservation_authority ra
  LEFT JOIN reservation_payment_bindings b ON b.listing_id = ra.listing_id
  WHERE ra.buyer_user_id = p_user_id
    AND (ra.lifecycle_state IN ('reserved','frozen')
         OR b.capture_state IN ('authorized','capture_requested','capture_unknown','captured',
                                 'cancel_requested','cancel_unknown',
                                 'refund_requested','refund_unknown'));
END;
$$;

-- ── 19. anonymize_user ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION authority_v1.anonymize_user(
  p_user_id TEXT, p_pseudonymous_id TEXT,
  p_server_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_op_status TEXT; v_replay JSONB; v_stored_hash TEXT;
BEGIN
  SELECT * INTO v_acquired, v_op_status, v_replay, v_stored_hash FROM acquire_operation(
    p_server_operation_id, p_user_id, 'anonymize', 'anonymized', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', v_op_status);
  END IF;

  IF EXISTS(SELECT 1 FROM check_user_obligations(p_user_id)) THEN
    UPDATE reservation_operations SET status = 'rejected', error_code = 'DELETION_BLOCKED'
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