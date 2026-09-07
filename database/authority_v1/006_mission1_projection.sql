-- Mission 1 integration. Apply after 005. Uses the approved operation/outbox
-- tables; no Base44 claim, schema CAS or timeout is an exclusion authority.
-- Runtime worker grants are separate from executor and Stripe recorder.

CREATE OR REPLACE FUNCTION authority_v1.m1_claim_projection(op TEXT, owner_id TEXT, recover BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
DECLARE r reservation_outbox%ROWTYPE; a reservation_authority%ROWTYPE;
BEGIN
  SELECT * INTO r FROM reservation_outbox WHERE event_id=op AND effect_type='mirror_project';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','PROJECTION_NOT_FOUND'); END IF;
  SELECT * INTO a FROM reservation_authority WHERE listing_id=r.listing_id FOR UPDATE;
  SELECT * INTO r FROM reservation_outbox WHERE event_id=op FOR UPDATE;
  IF r.delivery_status='delivered' THEN RETURN jsonb_build_object('ok',true,'completed',true,'context',r.payload); END IF;
  -- Recovery may fence an old worker only between external writes. Its next
  -- write-start/ack requires the new owner. An unknown in-flight write never
  -- permits takeover, regardless of elapsed time.
  IF owner_id IS NULL OR r.lease_owner IS NOT NULL AND r.lease_owner IS DISTINCT FROM owner_id
    AND (recover IS NOT TRUE OR r.payload ? 'projection_pending') THEN
    RETURN jsonb_build_object('ok',false,'code','PROJECTION_OWNER_RETAINED');
  END IF;
  IF a.version<>r.committed_version OR EXISTS(SELECT 1 FROM reservation_outbox
    WHERE listing_id=r.listing_id AND effect_type='mirror_project' AND delivery_status<>'delivered'
      AND outbox_id<r.outbox_id) THEN
    RETURN jsonb_build_object('ok',false,'code','PROJECTION_ORDER_CONFLICT');
  END IF;
  UPDATE reservation_outbox SET lease_owner=owner_id,lease_expires_at='infinity',
    delivery_status='in_flight',claimed_at=now(),attempt_count=attempt_count+1 WHERE event_id=op;
  RETURN jsonb_build_object('ok',true,'context',r.payload);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_plan_projection(op TEXT, owner_id TEXT, plan JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
DECLARE r reservation_outbox%ROWTYPE;
BEGIN
  SELECT * INTO r FROM reservation_outbox WHERE event_id=op FOR UPDATE;
  IF NOT FOUND OR owner_id IS NULL OR r.lease_owner IS DISTINCT FROM owner_id OR r.delivery_status<>'in_flight'
    OR jsonb_typeof(plan) IS DISTINCT FROM 'array' OR jsonb_array_length(plan)>100 THEN
    RETURN jsonb_build_object('ok',false,'code','PROJECTION_PLAN_REJECTED');
  END IF;
  IF r.payload ? 'projection_plan' THEN RETURN jsonb_build_object('ok',true,'context',r.payload); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(plan) item WHERE item->>'entity' NOT IN
    ('Listing','ListingPrivate','Purchase','PurchasePrivate','SeatInventory') OR item->>'id' IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','PROJECTION_ENTITY_REJECTED');
  END IF;
  UPDATE reservation_outbox SET payload=payload||jsonb_build_object('projection_plan',plan,'projection_done',0)
    WHERE event_id=op RETURNING * INTO r;
  RETURN jsonb_build_object('ok',true,'context',r.payload);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_projection_step(op TEXT, owner_id TEXT, step_index INTEGER, verified BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
DECLARE r reservation_outbox%ROWTYPE;
BEGIN
  SELECT * INTO r FROM reservation_outbox WHERE event_id=op;
  PERFORM 1 FROM reservation_authority WHERE listing_id=r.listing_id AND version=r.committed_version FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','PROJECTION_VERSION_CONFLICT'); END IF;
  SELECT * INTO r FROM reservation_outbox WHERE event_id=op FOR UPDATE;
  IF owner_id IS NULL OR r.lease_owner IS DISTINCT FROM owner_id OR r.delivery_status<>'in_flight'
    OR step_index IS NULL OR step_index IS DISTINCT FROM (r.payload->>'projection_done')::INTEGER
    OR step_index>=jsonb_array_length(r.payload->'projection_plan') THEN
    RETURN jsonb_build_object('ok',false,'code','PROJECTION_STEP_FENCED');
  END IF;
  IF verified IS TRUE THEN
    IF (r.payload->>'projection_pending')::INTEGER IS DISTINCT FROM step_index THEN
      RETURN jsonb_build_object('ok',false,'code','PROJECTION_STEP_NOT_STARTED');
    END IF;
    UPDATE reservation_outbox SET payload=(payload-'projection_pending')||jsonb_build_object('projection_done',step_index+1) WHERE event_id=op;
  ELSE
    IF r.payload ? 'projection_pending' THEN RETURN jsonb_build_object('ok',false,'code','PROJECTION_WRITE_OUTCOME_UNKNOWN'); END IF;
    UPDATE reservation_outbox SET payload=payload||jsonb_build_object('projection_pending',step_index) WHERE event_id=op;
  END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_projection_failure(op TEXT, owner_id TEXT, error_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
DECLARE r reservation_outbox%ROWTYPE;
BEGIN
  SELECT * INTO r FROM reservation_outbox WHERE event_id=op FOR UPDATE;
  IF owner_id IS NULL OR r.lease_owner IS DISTINCT FROM owner_id THEN RETURN jsonb_build_object('ok',false,'code','STALE_PROJECTION_WORKER'); END IF;
  INSERT INTO operational_incidents(incident_key,incident_type,priority,title,description,reference_id,reference_type)
  VALUES('projection:'||op,'admin_action_required','critical','Inventory projection requires recovery',
    jsonb_build_object('operation_id',op,'listing_id',r.listing_id,'version',r.committed_version,'owner',owner_id,
      'step',r.payload->'projection_pending','error',error_code)::TEXT,r.listing_id,'listing')
  ON CONFLICT(incident_key) DO UPDATE SET description=EXCLUDED.description,resolved=false,resolved_at=NULL,last_occurred_at=now();
  -- Unknown write outcomes retain ownership forever. A timeout, re-read or
  -- manually resolved alert does not prove that an old request cannot resume.
  UPDATE reservation_outbox SET last_error=error_code,
    lease_owner=CASE WHEN payload ? 'projection_pending' THEN lease_owner ELSE NULL END,
    lease_expires_at=CASE WHEN payload ? 'projection_pending' THEN lease_expires_at ELSE NULL END,
    delivery_status=CASE WHEN payload ? 'projection_pending' THEN 'in_flight' ELSE 'pending' END WHERE event_id=op;
  RETURN jsonb_build_object('ok',true,'retained',r.payload ? 'projection_pending');
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_complete_projection(op TEXT, owner_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
DECLARE r reservation_outbox%ROWTYPE; result JSONB;
BEGIN
  SELECT * INTO r FROM reservation_outbox WHERE event_id=op;
  PERFORM 1 FROM reservation_authority WHERE listing_id=r.listing_id AND version=r.committed_version FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','PROJECTION_VERSION_CONFLICT'); END IF;
  SELECT * INTO r FROM reservation_outbox WHERE event_id=op FOR UPDATE;
  IF r.delivery_status='delivered' THEN RETURN jsonb_build_object('ok',true,'completed',true); END IF;
  IF owner_id IS NULL OR r.lease_owner IS DISTINCT FROM owner_id OR r.payload ? 'projection_pending'
     OR NOT r.payload ? 'projection_plan'
     OR (r.payload->>'projection_done')::INTEGER IS DISTINCT FROM jsonb_array_length(r.payload->'projection_plan') THEN
    RETURN jsonb_build_object('ok',false,'code','PROJECTION_INCOMPLETE');
  END IF;
  IF r.payload->>'phase'='committed' THEN
    result := m1_ack_projection(op,r.committed_version);
    IF result->>'ok'<>'true' THEN RETURN result; END IF;
  ELSE
    UPDATE reservation_outbox SET delivery_status='delivered',delivered_at=now(),lease_owner=NULL,lease_expires_at=NULL,claimed_at=NULL WHERE event_id=op;
  END IF;
  UPDATE operational_incidents SET resolved=true,resolved_at=now(),resolution_notes='All projection writes verified by owning worker'
    WHERE incident_key='projection:'||op;
  RETURN jsonb_build_object('ok',true,'completed',true);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_projection_receipt(op TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
  SELECT COALESCE((SELECT jsonb_build_object('ok',true,'verified',delivery_status='delivered',
    'operation_id',event_id,'version',committed_version) FROM reservation_outbox WHERE event_id=op),
    '{"ok":false,"code":"PROJECTION_NOT_FOUND"}'::JSONB)
$$;

CREATE OR REPLACE FUNCTION authority_v1.m1_pending_recovery()
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
  SELECT jsonb_build_object('ok',true,'operations',COALESCE(jsonb_agg(item),'[]'::JSONB),
    'incidents',COALESCE((SELECT jsonb_agg(incident) FROM (SELECT incident_key,title,description,resolved,reference_id,last_occurred_at
      FROM operational_incidents WHERE NOT resolved AND (incident_key LIKE 'm1-%' OR incident_key LIKE 'projection:m1-%')
      ORDER BY last_occurred_at LIMIT 50) incident),'[]'::JSONB)) FROM (
    SELECT recovery_evidence AS item FROM reservation_operations o WHERE recovery_evidence IS NOT NULL
      AND (recovery_evidence->>'phase' IN ('checkout_prepared','prepared','dispatched','blocked','committed')
        OR EXISTS(SELECT 1 FROM reservation_outbox b WHERE b.event_id=o.operation_id AND b.delivery_status<>'delivered'))
    ORDER BY created_at LIMIT 50
  ) jobs
$$;

-- Serializes inventory automation with M1 transitions. It enqueues only;
-- event payloads cannot supply status, ownership or provider evidence.
CREATE OR REPLACE FUNCTION authority_v1.m1_queue_inventory(p_listing TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
DECLARE a reservation_authority%ROWTYPE; op TEXT; e JSONB; active_purchase TEXT;
BEGIN
  SELECT * INTO a FROM reservation_authority WHERE listing_id=p_listing FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','AUTHORITY_NOT_FOUND'); END IF;
  -- A transition's own projection is the sole inventory writer. Do not queue
  -- another update from its Listing automation event, including delayed replays.
  IF EXISTS(SELECT 1 FROM reservation_outbox WHERE listing_id=p_listing AND effect_type='mirror_project'
    AND delivery_status<>'delivered') OR a.payment_release_operation_id IS NOT NULL OR a.checkout_operation_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'queued',false);
  END IF;
  SELECT purchase_id INTO active_purchase FROM reservation_payment_bindings
    WHERE listing_id=p_listing AND capture_state NOT IN ('canceled','refunded','aborted','failed')
    ORDER BY created_at DESC LIMIT 1;
  IF active_purchase IS NOT NULL AND a.lifecycle_state NOT IN ('reserved','frozen','sold') THEN
    RETURN jsonb_build_object('ok',false,'code','INVENTORY_PAYMENT_STATE_CONFLICT');
  END IF;
  op := 'm1-inventory:'||p_listing||':'||a.version;
  e := jsonb_build_object('operation_id',op,'listing_id',p_listing,'authority_version',a.version,'kind','inventory_sync','phase','projection_only','purchase_id',active_purchase);
  INSERT INTO reservation_operations(operation_id,subject_type,subject_id,listing_id,operation_type,requested_state,expected_version,request_hash,status,recovery_evidence)
    VALUES(op,'listing',p_listing,p_listing,'release',a.lifecycle_state,a.version,op,'committed',e) ON CONFLICT DO NOTHING;
  INSERT INTO reservation_outbox(event_id,operation_id,listing_id,committed_version,effect_type,payload)
    VALUES(op,op,p_listing,a.version,'mirror_project',e) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok',true,'queued',true,'context',e);
END $$;

CREATE OR REPLACE FUNCTION authority_v1.m1_reserve(p_listing TEXT,p_version INTEGER,p_buyer TEXT,p_hash TEXT,
  p_expiry TIMESTAMPTZ,op TEXT,details JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
DECLARE a reservation_authority%ROWTYPE; r JSONB; e JSONB;
BEGIN
  SELECT * INTO a FROM reservation_authority WHERE listing_id=p_listing FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','AUTHORITY_NOT_FOUND'); END IF;
  IF a.buyer_user_id=p_buyer AND a.lifecycle_state='reserved' AND a.reservation_expires_at>now()
    AND NOT a.recovery_blocked AND NOT a.checkout_quarantined
    AND NOT EXISTS(SELECT 1 FROM reservation_outbox WHERE listing_id=p_listing AND effect_type='mirror_project' AND delivery_status<>'delivered') THEN
    RETURN jsonb_build_object('ok',true,'already_reserved',true,'reservation_expires_at',a.reservation_expires_at);
  END IF;
  r:=reserve_listing(p_listing,p_version,p_buyer,p_hash,p_expiry,op,op);
  IF r->>'ok'<>'true' THEN RETURN r; END IF;
  e:=jsonb_build_object('operation_id',op,'listing_id',p_listing,'kind','reserve','phase','projection_only',
    'authority_version',(r->>'version')::INTEGER,'revision',r->>'revision','token_hash',p_hash,
    'previous_token_hash',a.reservation_token_hash,'previous_revision',a.reservation_revision,'details',details);
  UPDATE reservation_operations SET recovery_evidence=e WHERE operation_id=op;
  UPDATE reservation_outbox SET event_id=op,payload=e WHERE operation_id=op AND effect_type='mirror_project';
  RETURN jsonb_build_object('ok',true,'context',e);
END $$;

-- A retry cannot expose a client secret based only on a matching Base44 tuple.
CREATE OR REPLACE FUNCTION authority_v1.m1_checkout_ready(p_purchase TEXT,p_pi TEXT,p_buyer TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
  SELECT jsonb_build_object('ok',true,'ready',EXISTS(
    SELECT 1 FROM reservation_payment_bindings b JOIN reservation_authority a USING(listing_id)
    JOIN reservation_outbox o ON o.listing_id=a.listing_id AND o.committed_version=a.version
    WHERE b.purchase_id=p_purchase AND b.payment_intent_id=p_pi AND b.buyer_user_id=p_buyer
      AND b.capture_state='authorized' AND a.lifecycle_state='reserved'
      AND a.buyer_user_id=p_buyer AND a.reservation_token_hash=b.reservation_token_hash
      AND NOT a.recovery_blocked AND NOT a.checkout_quarantined AND a.payment_release_operation_id IS NULL
      AND o.payload->>'kind'='checkout' AND o.payload->>'purchase_id'=p_purchase
      AND o.delivery_status='delivered'))
$$;
REVOKE ALL ON FUNCTION authority_v1.m1_checkout_ready(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authority_v1.m1_checkout_ready(TEXT,TEXT,TEXT) TO authority_executor;

-- Enforce ordering for every existing PostgreSQL authority writer, including
-- transfer/capture/cancellation functions that are not Mission 1 callers.
-- A field read in JavaScript is not a substitute for this row-locked barrier.
CREATE OR REPLACE FUNCTION authority_v1.m1_guard_projection_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=authority_v1,pg_temp AS $$
BEGIN
  IF ROW(NEW.version,NEW.lifecycle_state,NEW.seller_user_id,NEW.buyer_user_id,
    NEW.reservation_token_hash,NEW.reservation_expires_at,NEW.reservation_revision,
    NEW.transfer_state,NEW.buyer_confirmed_at,NEW.seller_pause_requested_at,NEW.seller_cancel_requested_at)
    IS DISTINCT FROM ROW(OLD.version,OLD.lifecycle_state,OLD.seller_user_id,OLD.buyer_user_id,
    OLD.reservation_token_hash,OLD.reservation_expires_at,OLD.reservation_revision,
    OLD.transfer_state,OLD.buyer_confirmed_at,OLD.seller_pause_requested_at,OLD.seller_cancel_requested_at)
    AND EXISTS(SELECT 1 FROM reservation_outbox WHERE listing_id=OLD.listing_id
      AND event_id LIKE 'm1-%' AND effect_type='mirror_project' AND delivery_status<>'delivered') THEN
    RAISE EXCEPTION 'MISSION1_PROJECTION_PENDING';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION authority_v1.m1_guard_projection_order() FROM PUBLIC;
CREATE OR REPLACE TRIGGER mission1_projection_order BEFORE UPDATE ON authority_v1.reservation_authority
  FOR EACH ROW EXECUTE FUNCTION authority_v1.m1_guard_projection_order();

REVOKE EXECUTE ON FUNCTION authority_v1.m1_ack_projection(TEXT,INTEGER),authority_v1.m1_ack_release_projection(TEXT,INTEGER) FROM authority_worker;
REVOKE ALL ON FUNCTION authority_v1.m1_claim_projection(TEXT,TEXT,BOOLEAN),authority_v1.m1_plan_projection(TEXT,TEXT,JSONB),
  authority_v1.m1_projection_step(TEXT,TEXT,INTEGER,BOOLEAN),authority_v1.m1_projection_failure(TEXT,TEXT,TEXT),
  authority_v1.m1_complete_projection(TEXT,TEXT),authority_v1.m1_projection_receipt(TEXT),
  authority_v1.m1_pending_recovery(),authority_v1.m1_queue_inventory(TEXT),
  authority_v1.m1_reserve(TEXT,INTEGER,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authority_v1.m1_claim_projection(TEXT,TEXT,BOOLEAN),authority_v1.m1_plan_projection(TEXT,TEXT,JSONB),
  authority_v1.m1_projection_step(TEXT,TEXT,INTEGER,BOOLEAN),authority_v1.m1_projection_failure(TEXT,TEXT,TEXT),
  authority_v1.m1_complete_projection(TEXT,TEXT),authority_v1.m1_pending_recovery() TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.m1_projection_receipt(TEXT),authority_v1.m1_queue_inventory(TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.m1_reserve(TEXT,INTEGER,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB) TO authority_executor;
DO $$ DECLARE f RECORD; BEGIN
  FOR f IN SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='authority_v1' AND p.proname LIKE 'm1\_%' ESCAPE '\'
  LOOP EXECUTE format('ALTER FUNCTION authority_v1.%I(%s) OWNER TO neondb_owner',f.proname,f.args); END LOOP;
END $$;
