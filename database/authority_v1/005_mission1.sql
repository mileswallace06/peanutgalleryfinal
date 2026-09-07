-- After 001b, canonical 002..003 and role setup 004. All runtime access is
-- through allowlisted SECURITY DEFINER functions. No direct table privileges.

CREATE OR REPLACE FUNCTION authority_v1.m1_begin_checkout(
  p_listing TEXT, p_version INTEGER, p_buyer TEXT, p_token_hash TEXT,
  p_expiry TIMESTAMPTZ, p_operation TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE a reservation_authority%ROWTYPE; e JSONB; rev TEXT;
BEGIN
  SELECT * INTO a FROM reservation_authority WHERE listing_id = p_listing FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','AUTHORITY_NOT_FOUND'); END IF;
  SELECT recovery_evidence INTO e FROM reservation_operations WHERE operation_id = p_operation;
  IF FOUND THEN
    IF e->>'listing_id' IS DISTINCT FROM p_listing OR e->>'buyer_id' IS DISTINCT FROM p_buyer
       OR e->>'token_hash' IS DISTINCT FROM p_token_hash THEN
      RETURN jsonb_build_object('ok',false,'code','OPERATION_ID_CONFLICT');
    END IF;
    RETURN jsonb_build_object('ok',true,'context',e);
  END IF;
  IF a.version <> p_version OR a.lifecycle_state NOT IN ('available','reserved')
     OR (a.lifecycle_state = 'reserved' AND a.buyer_user_id IS DISTINCT FROM p_buyer)
     OR a.checkout_quarantined OR a.recovery_blocked OR a.checkout_operation_id IS NOT NULL
     OR a.payment_release_operation_id IS NOT NULL OR p_expiry <= now()
     OR EXISTS(SELECT 1 FROM reservation_outbox WHERE listing_id=p_listing AND event_id LIKE 'm1-%'
       AND effect_type='mirror_project' AND delivery_status<>'delivered')
     OR EXISTS (SELECT 1 FROM reservation_payment_bindings WHERE listing_id=p_listing
         AND capture_state NOT IN ('canceled','refunded','aborted','failed')) THEN
    RETURN jsonb_build_object('ok',false,'code','CHECKOUT_AUTHORITY_CONFLICT');
  END IF;
  rev := gen_random_uuid()::TEXT;
  e := jsonb_build_object('operation_id',p_operation,'listing_id',p_listing,'buyer_id',p_buyer,
    'token_hash',p_token_hash,'version',a.version+1,'revision',rev,'phase','checkout_prepared',
    'stripe_idempotency_key','pg-checkout:'||p_operation,'previous_token_hash',a.reservation_token_hash,
    'previous_revision',a.reservation_revision);
  INSERT INTO reservation_operations(operation_id,subject_type,subject_id,listing_id,operation_type,
    requested_state,expected_version,request_hash,status,recovery_evidence,committed_at)
  VALUES(p_operation,'listing',p_listing,p_listing,'bind_pi','reserved',p_version,p_token_hash,'committed',e,now());
  UPDATE reservation_authority SET version=version+1,lifecycle_state='reserved',buyer_user_id=p_buyer,
    reservation_token_hash=p_token_hash,reservation_expires_at=p_expiry,reservation_revision=rev,
    checkout_operation_id=p_operation,updated_at=now() WHERE listing_id=p_listing;
  RETURN jsonb_build_object('ok',true,'context',e);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_release_reservation(p_listing TEXT,p_version INTEGER,p_operation TEXT,p_buyer TEXT,p_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE r JSONB; e JSONB;
BEGIN
  PERFORM 1 FROM reservation_authority WHERE listing_id=p_listing FOR UPDATE;
  SELECT recovery_evidence INTO e FROM reservation_operations WHERE operation_id=p_operation;
  IF e->>'phase' IN ('committed','completed') AND e->>'buyer_id'=p_buyer AND e->>'token_hash'=p_hash THEN
    RETURN jsonb_build_object('ok',true,'context',e);
  END IF;
  PERFORM 1 FROM reservation_authority WHERE listing_id=p_listing AND version=p_version
    AND buyer_user_id=p_buyer AND reservation_token_hash=p_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','AUTHORITY_OWNERSHIP_CHANGED'); END IF;
  r := release_listing(p_listing,p_version,p_operation,p_operation);
  IF r->>'ok' <> 'true' THEN RETURN r; END IF;
  e := jsonb_build_object('operation_id',p_operation,'listing_id',p_listing,'phase','committed',
    'buyer_id',p_buyer,'token_hash',p_hash,'authority_version',p_version+1,'kind','unpaid_release');
  UPDATE reservation_operations SET recovery_evidence=e WHERE operation_id=p_operation;
  UPDATE reservation_authority SET payment_release_operation_id=p_operation,checkout_quarantined=true,
    checkout_quarantine_reason='unpaid_release_projection',checkout_quarantined_at=now(),
    recovery_blocked=true,recovery_blocked_reason='unpaid_release_projection',recovery_blocked_at=now() WHERE listing_id=p_listing;
  UPDATE reservation_outbox SET event_id=p_operation,payload=e
    WHERE operation_id=p_operation AND effect_type='mirror_project';
  RETURN jsonb_build_object('ok',true,'context',e);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_operation_context(p_operation TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
  SELECT COALESCE((SELECT jsonb_build_object('ok',true,'context',recovery_evidence)
    FROM reservation_operations WHERE operation_id=p_operation),'{"ok":true,"context":null}'::JSONB)
$$;

CREATE OR REPLACE FUNCTION authority_v1.m1_attach_checkout_intent(p_operation TEXT,p_pi TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE e JSONB;
BEGIN
  SELECT recovery_evidence INTO e FROM reservation_operations WHERE operation_id=p_operation;
  PERFORM 1 FROM reservation_authority WHERE listing_id=e->>'listing_id' AND checkout_operation_id=p_operation FOR UPDATE;
  IF NOT FOUND OR (e ? 'payment_intent_id' AND e->>'payment_intent_id' IS DISTINCT FROM p_pi) THEN
    RETURN jsonb_build_object('ok',false,'code','CHECKOUT_OWNERSHIP_CHANGED');
  END IF;
  UPDATE reservation_operations SET recovery_evidence=recovery_evidence||jsonb_build_object('payment_intent_id',p_pi)
    WHERE operation_id=p_operation;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_bind_checkout(p_operation TEXT,p_purchase TEXT,p_pi TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE e JSONB; r JSONB;
BEGIN
  SELECT recovery_evidence INTO e FROM reservation_operations WHERE operation_id=p_operation;
  IF e->>'phase'='bound' AND e->>'purchase_id'=p_purchase AND e->>'payment_intent_id'=p_pi THEN
    RETURN jsonb_build_object('ok',true,'bound',true,'idempotent',true);
  END IF;
  PERFORM 1 FROM reservation_authority WHERE listing_id=e->>'listing_id' AND checkout_operation_id=p_operation FOR UPDATE;
  IF NOT FOUND OR e->>'payment_intent_id' IS DISTINCT FROM p_pi THEN
    RETURN jsonb_build_object('ok',false,'code','CHECKOUT_OWNERSHIP_CHANGED');
  END IF;
  r := bind_payment_intent(e->>'listing_id',p_purchase,p_pi,e->>'buyer_id',
    (e->>'version')::INTEGER,e->>'revision',e->>'token_hash',p_operation||':binding',p_purchase||':'||p_pi);
  IF r->>'ok' <> 'true' THEN RETURN r; END IF;
  UPDATE reservation_operations SET recovery_evidence=e||jsonb_build_object('purchase_id',p_purchase,'phase','bound')
    WHERE operation_id=p_operation;
  UPDATE reservation_authority SET checkout_operation_id=NULL WHERE listing_id=e->>'listing_id';
  INSERT INTO reservation_outbox(event_id,operation_id,listing_id,committed_version,effect_type,payload)
    VALUES(p_operation,p_operation,e->>'listing_id',(e->>'version')::INTEGER,'mirror_project',
      e||jsonb_build_object('purchase_id',p_purchase,'payment_intent_id',p_pi,'phase','bound','kind','checkout','authority_version',(e->>'version')::INTEGER));
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_release_context(p_purchase TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
  SELECT COALESCE((SELECT jsonb_build_object('ok',true,'context',recovery_evidence,
      'epoch',recovery_epoch,'owner',recovery_owner,'dispatched',recovery_dispatch_started)
    FROM reservation_operations WHERE operation_id='m1-release:'||p_purchase), '{"ok":true,"context":null}'::JSONB)
$$;

CREATE OR REPLACE FUNCTION authority_v1.m1_prepare_release(
  p_purchase TEXT,p_listing TEXT,p_pi TEXT,p_snapshot JSONB,p_owner TEXT,p_recover BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE b reservation_payment_bindings%ROWTYPE; a reservation_authority%ROWTYPE;
  o reservation_operations%ROWTYPE; op TEXT := 'm1-release:'||p_purchase; e JSONB;
BEGIN
  SELECT * INTO b FROM reservation_payment_bindings WHERE purchase_id=p_purchase FOR UPDATE;
  IF NOT FOUND OR b.listing_id IS DISTINCT FROM p_listing OR b.payment_intent_id IS DISTINCT FROM p_pi THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORITATIVE_BINDING_REQUIRED');
  END IF;
  SELECT * INTO a FROM reservation_authority WHERE listing_id=p_listing FOR UPDATE;
  SELECT * INTO o FROM reservation_operations WHERE operation_id=op FOR UPDATE;
  IF FOUND THEN
    IF o.recovery_evidence->>'phase' IN ('committed','completed') THEN RETURN m1_release_context(p_purchase); END IF;
    IF o.recovery_owner IS NOT NULL AND p_recover IS NOT TRUE THEN
      RETURN jsonb_build_object('ok',false,'code','CLEANUP_IN_PROGRESS');
    END IF;
    -- Recovery invalidates old persistence authority. A dispatched command is
    -- NEVER reissued by recovery: fresh provider reads must prove settlement.
    UPDATE reservation_operations SET recovery_owner=p_owner,recovery_epoch=recovery_epoch+1 WHERE operation_id=op;
    RETURN m1_release_context(p_purchase);
  END IF;
  IF a.payment_release_operation_id IS NOT NULL OR a.checkout_operation_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM reservation_outbox WHERE listing_id=p_listing AND event_id LIKE 'm1-%'
       AND effect_type='mirror_project' AND delivery_status<>'delivered')
     OR a.lifecycle_state NOT IN ('reserved','frozen')
     OR a.buyer_user_id IS DISTINCT FROM b.buyer_user_id
     OR a.reservation_token_hash IS DISTINCT FROM b.reservation_token_hash
     OR b.reservation_token_hash IS DISTINCT FROM p_snapshot->>'token_hash'
     OR b.reservation_revision IS DISTINCT FROM p_snapshot->>'reservation_revision'
     OR a.reservation_revision IS DISTINCT FROM b.reservation_revision
     OR a.transfer_state <> 'not_started' OR a.buyer_confirmed_at IS NOT NULL
     OR a.seller_pause_requested_at IS NOT NULL OR a.seller_cancel_requested_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM reservation_payment_bindings WHERE listing_id=p_listing AND purchase_id<>p_purchase
       AND capture_state NOT IN ('canceled','refunded','aborted','failed')) THEN
    RETURN jsonb_build_object('ok',false,'code','RELEASE_OWNERSHIP_OR_FULFILLMENT_CONFLICT');
  END IF;
  e := jsonb_build_object('operation_id',op,'purchase_id',p_purchase,'listing_id',p_listing,
    'payment_intent_id',p_pi,'snapshot',p_snapshot,'phase','prepared','prepared_at',now(),'authority_version',a.version);
  INSERT INTO reservation_operations(operation_id,subject_type,subject_id,listing_id,operation_type,
    requested_state,expected_version,request_hash,recovery_evidence,recovery_owner,recovery_epoch)
  VALUES(op,'listing',p_listing,p_listing,'abort','available',a.version,p_purchase||':'||p_pi,e,p_owner,1);
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_PERSISTED'; END IF;
  -- Ownership is durable BEFORE inventory release or any external action.
  UPDATE reservation_authority SET payment_release_operation_id=op,checkout_quarantined=true,
    checkout_quarantine_reason='payment_release',checkout_quarantined_at=now(),recovery_blocked=true,
    recovery_blocked_reason='payment_release',recovery_blocked_at=now(),updated_at=now() WHERE listing_id=p_listing;
  RETURN m1_release_context(p_purchase);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_dispatch_release(p_purchase TEXT,p_owner TEXT,p_epoch BIGINT,p_kind TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE o reservation_operations%ROWTYPE; e JSONB; key TEXT;
BEGIN
  SELECT * INTO o FROM reservation_operations WHERE operation_id='m1-release:'||p_purchase FOR UPDATE;
  IF NOT FOUND OR p_owner IS NULL OR o.recovery_owner IS DISTINCT FROM p_owner OR o.recovery_epoch IS DISTINCT FROM p_epoch
     OR o.recovery_dispatch_started OR o.recovery_evidence->>'phase' NOT IN ('prepared','blocked')
     OR p_kind IS NULL OR p_kind NOT IN ('cancel','refund') THEN
    RETURN jsonb_build_object('ok',false,'code','DISPATCH_FENCED_OR_ALREADY_STARTED');
  END IF;
  e := o.recovery_evidence; key := 'pg-release-'||p_kind||'-'||(e->>'payment_intent_id');
  INSERT INTO payment_actions(action_id,listing_id,purchase_id,payment_intent_id,action_type,stripe_idempotency_key,status,
    lease_owner,lease_expires_at,claimed_at)
  VALUES(o.operation_id||':'||p_kind,e->>'listing_id',p_purchase,e->>'payment_intent_id',p_kind,key,'in_flight',
    p_owner,'infinity'::TIMESTAMPTZ,now());
  UPDATE reservation_operations SET recovery_dispatch_started=true,
    recovery_evidence=e||jsonb_build_object('phase','dispatched','action_type',p_kind,'stripe_idempotency_key',key)
    WHERE operation_id=o.operation_id;
  RETURN jsonb_build_object('ok',true,'idempotency_key',key);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_release_failure(p_purchase TEXT,p_owner TEXT,p_epoch BIGINT,p_error TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE o reservation_operations%ROWTYPE; e JSONB;
BEGIN
  SELECT * INTO o FROM reservation_operations WHERE operation_id='m1-release:'||p_purchase FOR UPDATE;
  IF NOT FOUND OR p_owner IS NULL OR o.recovery_owner IS DISTINCT FROM p_owner OR o.recovery_epoch IS DISTINCT FROM p_epoch THEN
    RETURN jsonb_build_object('ok',false,'code','STALE_WORKER');
  END IF;
  e := o.recovery_evidence;
  INSERT INTO operational_incidents(incident_key,incident_type,priority,title,description,reference_id,reference_type)
  VALUES(o.operation_id,'admin_action_required','critical','Payment release requires recovery',
    (e||jsonb_build_object('error',p_error))::TEXT,p_purchase,'purchase')
  ON CONFLICT(incident_key) DO UPDATE SET description=EXCLUDED.description,resolved=false,resolved_at=NULL,last_occurred_at=now();
  UPDATE reservation_operations SET recovery_owner=NULL,
    recovery_evidence=e||jsonb_build_object('phase','blocked','error',p_error) WHERE operation_id=o.operation_id;
  RETURN jsonb_build_object('ok',true,'block_proven',true,'alert_proven',true);
END $$;

-- Recorder-only: input is the result of independent provider retrieval, never
-- caller-supplied status or an AdminAlert resolution. Uses the existing binding
-- states and action ledger for externally settled / historically refunded PIs.
CREATE OR REPLACE FUNCTION authority_v1.m1_commit_release(p_purchase TEXT,p_owner TEXT,p_epoch BIGINT,p_evidence JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE b reservation_payment_bindings%ROWTYPE; a reservation_authority%ROWTYPE;
  o reservation_operations%ROWTYPE; e JSONB; settlement TEXT;
BEGIN
  SELECT * INTO b FROM reservation_payment_bindings WHERE purchase_id=p_purchase FOR UPDATE;
  SELECT * INTO a FROM reservation_authority WHERE listing_id=b.listing_id FOR UPDATE;
  SELECT * INTO o FROM reservation_operations WHERE operation_id='m1-release:'||p_purchase FOR UPDATE;
  IF NOT FOUND OR p_owner IS NULL OR o.recovery_owner IS DISTINCT FROM p_owner OR o.recovery_epoch IS DISTINCT FROM p_epoch
     OR a.payment_release_operation_id IS DISTINCT FROM o.operation_id THEN
    RETURN jsonb_build_object('ok',false,'code','STALE_WORKER');
  END IF;
  IF a.transfer_state <> 'not_started' OR a.buyer_confirmed_at IS NOT NULL
     OR a.seller_pause_requested_at IS NOT NULL OR a.seller_cancel_requested_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'code','FULFILLMENT_REQUIRES_REVIEW');
  END IF;
  settlement := p_evidence->>'status';
  IF p_evidence->>'payment_intent_id' IS DISTINCT FROM b.payment_intent_id
     OR p_evidence->>'verified_at' IS NULL
     OR NOT COALESCE((settlement='canceled' AND p_evidence->>'pi_status'='canceled'
       OR settlement='refunded' AND p_evidence->>'pi_status'='succeeded'
         AND p_evidence->>'charge_payment_intent' = b.payment_intent_id
         AND p_evidence->>'charge_refunded'='true' AND (p_evidence->>'amount')::BIGINT>0
         AND (p_evidence->>'amount_refunded')::BIGINT=(p_evidence->>'amount')::BIGINT),false) THEN
    RETURN jsonb_build_object('ok',false,'code','SETTLEMENT_UNVERIFIED');
  END IF;
  IF EXISTS(SELECT 1 FROM payment_actions WHERE purchase_id=p_purchase
       AND action_id NOT IN(o.operation_id||':cancel',o.operation_id||':refund')
       AND status IN ('pending','in_flight','unknown')) THEN
    RETURN jsonb_build_object('ok',false,'code','OTHER_FINANCIAL_ACTION_REQUIRES_RECONCILIATION');
  END IF;
  UPDATE reservation_payment_bindings SET capture_state=settlement,updated_at=now() WHERE purchase_id=p_purchase;
  UPDATE payment_actions SET status='succeeded',stripe_result_json=p_evidence::TEXT,completed_at=now(),
    lease_owner=NULL,lease_expires_at=NULL,claimed_at=NULL WHERE action_id IN(o.operation_id||':cancel',o.operation_id||':refund');
  UPDATE reservation_authority SET version=version+1,lifecycle_state='available',buyer_user_id=NULL,
    reservation_token_hash=NULL,reservation_expires_at=NULL,reservation_revision=o.operation_id,updated_at=now()
    WHERE listing_id=b.listing_id RETURNING * INTO a;
  e := o.recovery_evidence||jsonb_build_object('phase','committed','settlement',p_evidence,
    'committed_at',now(),'authority_version',a.version);
  UPDATE reservation_operations SET status='committed',committed_version=a.version,committed_at=now(),
    recovery_evidence=e,recovery_owner=NULL,recovery_epoch=recovery_epoch+1 WHERE operation_id=o.operation_id;
  INSERT INTO reservation_outbox(event_id,operation_id,listing_id,committed_version,effect_type,payload)
    VALUES(o.operation_id,o.operation_id,b.listing_id,a.version,'mirror_project',e);
  -- Still unavailable to checkout until the ordered mirror worker acknowledges
  -- every projection. No new reservation can enter the release/completion gap.
  RETURN m1_release_context(p_purchase);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_ack_projection(op TEXT,p_version INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE e JSONB;
BEGIN
  SELECT recovery_evidence INTO e FROM reservation_operations WHERE operation_id=op;
  IF e->>'phase'='completed' THEN RETURN m1_operation_context(op); END IF;
  PERFORM 1 FROM reservation_authority WHERE listing_id=e->>'listing_id' FOR UPDATE;
  UPDATE reservation_authority SET payment_release_operation_id=NULL,checkout_quarantined=false,
    checkout_quarantine_reason=NULL,checkout_quarantined_at=NULL,recovery_blocked=false,
    recovery_blocked_reason=NULL,recovery_blocked_at=NULL
    WHERE listing_id=e->>'listing_id' AND payment_release_operation_id=op AND version=p_version
      AND e->>'phase'='committed';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','PROJECTION_VERSION_CONFLICT'); END IF;
  UPDATE reservation_outbox SET delivery_status='delivered',delivered_at=now(),
    lease_owner=NULL,lease_expires_at=NULL,claimed_at=NULL WHERE event_id=op;
  UPDATE reservation_operations SET recovery_evidence=e||'{"phase":"completed"}'::JSONB WHERE operation_id=op;
  UPDATE operational_incidents SET resolved=true,resolved_at=now(),resolution_notes='Provider settlement and complete projection verified'
    WHERE incident_key=op;
  RETURN m1_operation_context(op);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_ack_release_projection(p_purchase TEXT,p_version INTEGER)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
  SELECT m1_ack_projection('m1-release:'||p_purchase,p_version)
$$;

CREATE OR REPLACE FUNCTION authority_v1.m1_settle_checkout_admission(p_operation TEXT,p_evidence JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE e JSONB; a reservation_authority%ROWTYPE; pi TEXT := p_evidence->>'payment_intent_id';
BEGIN
  SELECT recovery_evidence INTO e FROM reservation_operations WHERE operation_id=p_operation;
  SELECT * INTO a FROM reservation_authority WHERE listing_id=e->>'listing_id' FOR UPDATE;
  SELECT recovery_evidence INTO e FROM reservation_operations WHERE operation_id=p_operation FOR UPDATE;
  IF e->>'phase' IN ('committed','completed') THEN RETURN m1_operation_context(p_operation); END IF;
  IF e->>'phase' IS DISTINCT FROM 'checkout_prepared' OR a.checkout_operation_id IS DISTINCT FROM p_operation
     OR (e ? 'payment_intent_id' AND e->>'payment_intent_id' IS DISTINCT FROM pi)
     OR p_evidence->>'checkout_operation_id' IS DISTINCT FROM p_operation
     OR p_evidence->>'token_hash' IS DISTINCT FROM e->>'token_hash'
     OR pi IS NULL OR p_evidence->>'verified_at' IS NULL
     OR NOT COALESCE((p_evidence->>'status'='canceled' AND p_evidence->>'pi_status'='canceled'
       OR p_evidence->>'status'='refunded' AND p_evidence->>'pi_status'='succeeded'
         AND p_evidence->>'charge_payment_intent'=pi AND p_evidence->>'charge_refunded'='true'
         AND (p_evidence->>'amount')::BIGINT>0
         AND (p_evidence->>'amount_refunded')::BIGINT=(p_evidence->>'amount')::BIGINT),false)
     OR EXISTS(SELECT 1 FROM reservation_payment_bindings WHERE listing_id=a.listing_id
       AND capture_state NOT IN ('canceled','refunded','aborted','failed')) THEN
    RETURN jsonb_build_object('ok',false,'code','ADMISSION_SETTLEMENT_UNPROVEN');
  END IF;
  UPDATE reservation_authority SET version=version+1,lifecycle_state='available',buyer_user_id=NULL,
    reservation_token_hash=NULL,reservation_expires_at=NULL,reservation_revision=p_operation,
    checkout_operation_id=NULL,payment_release_operation_id=p_operation,checkout_quarantined=true,
    checkout_quarantine_reason='admission_recovery_projection',checkout_quarantined_at=now(),
    recovery_blocked=true,recovery_blocked_reason='admission_recovery_projection',recovery_blocked_at=now()
    WHERE listing_id=a.listing_id RETURNING * INTO a;
  e := e||jsonb_build_object('phase','committed','kind','checkout_admission_recovery','payment_intent_id',pi,
    'settlement',p_evidence,'authority_version',a.version);
  UPDATE reservation_operations SET recovery_evidence=e,committed_version=a.version WHERE operation_id=p_operation;
  INSERT INTO reservation_outbox(event_id,operation_id,listing_id,committed_version,effect_type,payload)
    VALUES(p_operation,p_operation,a.listing_id,a.version,'mirror_project',e);
  RETURN m1_operation_context(p_operation);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_record_historical_settlement(p_user TEXT,p_purchase TEXT,p_pi TEXT,p_evidence JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_temp AS $$
DECLARE b reservation_payment_bindings%ROWTYPE;
BEGIN
  IF p_evidence->>'payment_intent_id' IS DISTINCT FROM p_pi OR p_evidence->>'verified_at' IS NULL
     OR NOT COALESCE((p_evidence->>'status'='canceled' AND p_evidence->>'pi_status'='canceled'
       OR p_evidence->>'status'='completed_sale' AND p_evidence->>'pi_status'='succeeded'
         AND p_evidence->>'purchase_status'='completed' AND p_evidence->>'payment_captured'='true'
       OR p_evidence->>'status'='refunded' AND p_evidence->>'pi_status'='succeeded'
         AND p_evidence->>'charge_payment_intent'=p_pi AND p_evidence->>'charge_refunded'='true'
         AND (p_evidence->>'amount')::BIGINT>0
         AND (p_evidence->>'amount_refunded')::BIGINT=(p_evidence->>'amount')::BIGINT),false) THEN
    RETURN jsonb_build_object('ok',false,'code','HISTORICAL_SETTLEMENT_UNVERIFIED');
  END IF;
  SELECT * INTO b FROM reservation_payment_bindings WHERE purchase_id=p_purchase FOR UPDATE;
  IF FOUND THEN
    IF b.payment_intent_id IS DISTINCT FROM p_pi
       OR (p_evidence->>'status'='completed_sale' AND b.capture_state<>'finalized')
       OR EXISTS(SELECT 1 FROM payment_actions
        WHERE purchase_id=p_purchase AND status IN('pending','in_flight','unknown')) THEN
      RETURN jsonb_build_object('ok',false,'code','HISTORICAL_BINDING_REQUIRES_RECOVERY');
    END IF;
    -- A historical completed sale cannot promote an unfinished capture to
    -- finalized or bypass its payout/notification outbox. Existing finalization
    -- must already be proven in the canonical binding when one exists.
    IF p_evidence->>'status'<>'completed_sale' THEN
      UPDATE reservation_payment_bindings SET capture_state=p_evidence->>'status',updated_at=now() WHERE purchase_id=p_purchase;
    END IF;
  END IF;
  INSERT INTO reservation_operations(operation_id,subject_type,subject_id,operation_type,requested_state,
    expected_version,request_hash,status,recovery_evidence,committed_at)
  VALUES('m1-history:'||p_purchase,'user',p_user,'anonymize','settlement_verified',0,p_pi,'committed',p_evidence,now())
  ON CONFLICT(operation_id) DO UPDATE SET recovery_evidence=EXCLUDED.recovery_evidence
    WHERE reservation_operations.request_hash=EXCLUDED.request_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','HISTORICAL_IDENTITY_CONFLICT'); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

-- Explicit role boundary; schema 004 creates these roles. No public exposure.
REVOKE ALL ON FUNCTION authority_v1.m1_begin_checkout(TEXT,INTEGER,TEXT,TEXT,TIMESTAMPTZ,TEXT),
  authority_v1.m1_release_reservation(TEXT,INTEGER,TEXT,TEXT,TEXT),
  authority_v1.m1_operation_context(TEXT),authority_v1.m1_ack_projection(TEXT,INTEGER),
  authority_v1.m1_settle_checkout_admission(TEXT,JSONB),
  authority_v1.m1_attach_checkout_intent(TEXT,TEXT),authority_v1.m1_bind_checkout(TEXT,TEXT,TEXT),
  authority_v1.m1_release_context(TEXT),authority_v1.m1_prepare_release(TEXT,TEXT,TEXT,JSONB,TEXT,BOOLEAN),
  authority_v1.m1_dispatch_release(TEXT,TEXT,BIGINT,TEXT),authority_v1.m1_release_failure(TEXT,TEXT,BIGINT,TEXT),
  authority_v1.m1_commit_release(TEXT,TEXT,BIGINT,JSONB),authority_v1.m1_ack_release_projection(TEXT,INTEGER),
  authority_v1.m1_record_historical_settlement(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authority_v1.m1_begin_checkout(TEXT,INTEGER,TEXT,TEXT,TIMESTAMPTZ,TEXT),
  authority_v1.m1_release_reservation(TEXT,INTEGER,TEXT,TEXT,TEXT),
  authority_v1.m1_operation_context(TEXT),
  authority_v1.m1_attach_checkout_intent(TEXT,TEXT),authority_v1.m1_bind_checkout(TEXT,TEXT,TEXT),
  authority_v1.m1_release_context(TEXT),authority_v1.m1_prepare_release(TEXT,TEXT,TEXT,JSONB,TEXT,BOOLEAN),
  authority_v1.m1_dispatch_release(TEXT,TEXT,BIGINT,TEXT),authority_v1.m1_release_failure(TEXT,TEXT,BIGINT,TEXT)
  TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.m1_commit_release(TEXT,TEXT,BIGINT,JSONB),
  authority_v1.m1_settle_checkout_admission(TEXT,JSONB),
  authority_v1.m1_record_historical_settlement(TEXT,TEXT,TEXT,JSONB) TO authority_stripe_recorder;
GRANT EXECUTE ON FUNCTION authority_v1.m1_ack_release_projection(TEXT,INTEGER) TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.m1_ack_projection(TEXT,INTEGER) TO authority_worker;

-- Same migration owner as 004; never leave these functions owned by a
-- runtime executor or expose recorder/worker privileges to request callers.
DO $$ DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.proname,pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='authority_v1' AND p.proname LIKE 'm1\_%' ESCAPE '\'
  LOOP
    EXECUTE format('ALTER FUNCTION authority_v1.%I(%s) OWNER TO neondb_owner',f.proname,f.args);
  END LOOP;
END $$;
