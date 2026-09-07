-- PG-CREDITS-01. Install separately, schema-first, using a migration owner.
-- No financial authority/outbox tables, existing roles, or passwords are changed.
-- Runtime has EXECUTE only. These NOLOGIN capability roles need separately
-- provisioned workload identities; the worker never runs migrations.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='notification_worker') THEN
    CREATE ROLE notification_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='notification_reconciler') THEN
    CREATE ROLE notification_reconciler NOLOGIN;
  END IF;
END $$;
CREATE SCHEMA notification_worker;
REVOKE ALL ON SCHEMA notification_worker FROM PUBLIC;

CREATE TABLE notification_worker.control (
  scope TEXT PRIMARY KEY,
  maintenance BOOLEAN NOT NULL DEFAULT true,
  cutover_reference TEXT,
  owner_token UUID,
  scan_offset BIGINT NOT NULL DEFAULT 0 CHECK(scan_offset>=0),
  pending_write UUID,
  last_code TEXT NOT NULL DEFAULT 'MAINTENANCE',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE notification_worker.writes (
  write_id UUID PRIMARY KEY,
  scope TEXT NOT NULL REFERENCES notification_worker.control(scope),
  entity TEXT NOT NULL CHECK(entity IN ('Notification','Purchase','PurchasePrivate','AdminAlert')),
  target_id TEXT,
  patch JSONB NOT NULL,
  dedupe_key TEXT,
  phase TEXT NOT NULL CHECK(phase IN ('started','returned','applied','not_sent')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  returned_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  operator_evidence JSONB
);
CREATE INDEX notification_write_receipts ON notification_worker.writes(scope,dedupe_key) WHERE phase='applied';
ALTER TABLE notification_worker.control ADD FOREIGN KEY(pending_write) REFERENCES notification_worker.writes(write_id);

CREATE FUNCTION notification_worker.configure(p_scope TEXT,p_maintenance BOOLEAN,p_cutover_reference TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=notification_worker,pg_temp AS $$
BEGIN
  IF p_scope IS NULL OR length(p_scope) NOT BETWEEN 1 AND 160 OR p_maintenance IS NULL
    OR (NOT p_maintenance AND length(coalesce(p_cutover_reference,''))<8) THEN
    RAISE EXCEPTION 'INVALID_CONFIGURATION';
  END IF;
  INSERT INTO control(scope,maintenance,cutover_reference) VALUES(p_scope,p_maintenance,p_cutover_reference)
    ON CONFLICT(scope) DO UPDATE SET maintenance=EXCLUDED.maintenance,
      cutover_reference=EXCLUDED.cutover_reference,updated_at=clock_timestamp();
END $$;

-- No timer/lease takeover. Recovery fences old SQL ownership only BETWEEN
-- external writes, or after a durable terminal response receipt. A started
-- write blocks takeover forever until separate operator reconciliation.
CREATE FUNCTION notification_worker.claim(p_scope TEXT,p_owner UUID,p_recover BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=notification_worker,pg_temp AS $$
DECLARE c control%ROWTYPE; w writes%ROWTYPE;
BEGIN
  SELECT * INTO c FROM control WHERE scope=p_scope FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_CONFIGURED'); END IF;
  IF p_owner IS NULL OR p_recover IS NULL THEN RAISE EXCEPTION 'INVALID_OWNER'; END IF;
  IF c.pending_write IS NOT NULL THEN
    SELECT * INTO w FROM writes WHERE write_id=c.pending_write;
    IF NOT p_recover OR w.phase<>'returned' THEN
      RETURN jsonb_build_object('ok',false,'code','WRITE_BLOCKED','write_id',w.write_id);
    END IF;
  ELSE
    IF c.owner_token IS NOT NULL AND NOT p_recover THEN
      RETURN jsonb_build_object('ok',false,'code','BUSY');
    END IF;
    IF NOT p_recover AND c.maintenance THEN RETURN jsonb_build_object('ok',false,'code','MAINTENANCE'); END IF;
    IF NOT p_recover AND length(coalesce(c.cutover_reference,''))<8 THEN
      RETURN jsonb_build_object('ok',false,'code','CUTOVER_UNVERIFIED');
    END IF;
  END IF;
  UPDATE control SET owner_token=p_owner,updated_at=clock_timestamp() WHERE scope=p_scope;
  RETURN jsonb_build_object('ok',true,'offset',c.scan_offset,'pending',
    CASE WHEN c.pending_write IS NULL THEN NULL ELSE to_jsonb(w) END);
END $$;

CREATE FUNCTION notification_worker.begin_write(p_scope TEXT,p_owner UUID,p_write UUID,
  p_entity TEXT,p_target TEXT,p_patch JSONB,p_dedupe TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=notification_worker,pg_temp AS $$
DECLARE c control%ROWTYPE; prior writes%ROWTYPE;
BEGIN
  SELECT * INTO c FROM control WHERE scope=p_scope FOR UPDATE;
  IF NOT FOUND OR p_owner IS NULL OR c.owner_token IS DISTINCT FROM p_owner THEN RAISE EXCEPTION 'OWNER_FENCED'; END IF;
  IF c.maintenance OR length(coalesce(c.cutover_reference,''))<8 THEN RAISE EXCEPTION 'MAINTENANCE_OR_CUTOVER'; END IF;
  IF c.pending_write IS NOT NULL THEN RAISE EXCEPTION 'WRITE_BLOCKED'; END IF;
  IF p_write IS NULL OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_WRITE'; END IF;
  -- Only the shared dispatcher's existing notification/status writes are allowed.
  IF p_entity='Notification' THEN
    IF p_target IS NULL OR p_patch NOT IN ('{"dispatch_status":"dispatched"}'::JSONB,'{"dispatch_status":"superseded"}'::JSONB)
      THEN RAISE EXCEPTION 'WRITE_NOT_ALLOWED'; END IF;
  ELSIF p_entity IN ('Purchase','PurchasePrivate') THEN
    IF p_target IS NULL OR p_patch<>'{"seller_push_status":"skipped","seller_email_status":"skipped"}'::JSONB
      THEN RAISE EXCEPTION 'WRITE_NOT_ALLOWED'; END IF;
  ELSIF p_entity='AdminAlert' THEN
    IF p_target IS NOT NULL OR length(coalesce(p_dedupe,''))<>64
      OR p_patch->>'alert_type' IS DISTINCT FROM 'admin_action_required'
      OR p_patch->>'priority' IS DISTINCT FROM 'critical'
      OR p_patch->>'reference_type' IS DISTINCT FROM 'purchase'
      OR p_patch->>'reference_id' IS NULL OR p_patch->>'title' IS NULL OR p_patch->>'description' IS NULL
      OR p_patch - ARRAY['alert_type','priority','reference_type','reference_id','title','description'] <> '{}'::JSONB
      OR octet_length(p_patch::TEXT)>8192 THEN RAISE EXCEPTION 'WRITE_NOT_ALLOWED'; END IF;
    SELECT * INTO prior FROM writes WHERE scope=p_scope AND dedupe_key=p_dedupe AND phase='applied' LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('ok',true,'already_applied',true,'target_id',prior.target_id); END IF;
  ELSE RAISE EXCEPTION 'WRITE_NOT_ALLOWED'; END IF;
  INSERT INTO writes(write_id,scope,entity,target_id,patch,dedupe_key,phase)
    VALUES(p_write,p_scope,p_entity,p_target,p_patch,p_dedupe,'started');
  UPDATE control SET pending_write=p_write,last_code='WRITE_STARTED',updated_at=clock_timestamp() WHERE scope=p_scope;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION notification_worker.record_return(p_scope TEXT,p_owner UUID,p_write UUID,p_target TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=notification_worker,pg_temp AS $$
DECLARE c control%ROWTYPE; w writes%ROWTYPE;
BEGIN
  SELECT * INTO c FROM control WHERE scope=p_scope FOR UPDATE;
  IF NOT FOUND OR p_owner IS NULL OR c.owner_token IS DISTINCT FROM p_owner OR c.pending_write IS DISTINCT FROM p_write
    THEN RAISE EXCEPTION 'OWNER_FENCED'; END IF;
  SELECT * INTO w FROM writes WHERE write_id=p_write;
  IF w.phase<>'started' OR p_target IS NULL OR (w.target_id IS NOT NULL AND w.target_id<>p_target)
    THEN RAISE EXCEPTION 'INVALID_RECEIPT'; END IF;
  UPDATE writes SET phase='returned',target_id=p_target,returned_at=clock_timestamp() WHERE write_id=p_write;
  UPDATE control SET last_code='WRITE_NEEDS_VERIFICATION',updated_at=clock_timestamp() WHERE scope=p_scope;
END $$;

CREATE FUNCTION notification_worker.finish_write(p_scope TEXT,p_owner UUID,p_write UUID,p_applied BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=notification_worker,pg_temp AS $$
DECLARE c control%ROWTYPE; w writes%ROWTYPE;
BEGIN
  SELECT * INTO c FROM control WHERE scope=p_scope FOR UPDATE;
  IF NOT FOUND OR p_owner IS NULL OR c.owner_token IS DISTINCT FROM p_owner OR c.pending_write IS DISTINCT FROM p_write
    THEN RAISE EXCEPTION 'OWNER_FENCED'; END IF;
  SELECT * INTO w FROM writes WHERE write_id=p_write;
  IF p_applied IS NULL OR (p_applied AND w.phase<>'returned') OR (NOT p_applied AND w.phase<>'started')
    THEN RAISE EXCEPTION 'INVALID_WRITE_COMPLETION'; END IF;
  -- false is reserved for a positively known NOT SENT transport outcome.
  -- A timeout, HTTP error or failed re-read is NOT sufficient evidence.
  UPDATE writes SET phase=CASE WHEN p_applied THEN 'applied' ELSE 'not_sent' END,
    completed_at=clock_timestamp() WHERE write_id=p_write;
  UPDATE control SET pending_write=NULL,last_code=CASE WHEN p_applied THEN 'WRITE_VERIFIED' ELSE 'WRITE_NOT_SENT' END,
    updated_at=clock_timestamp() WHERE scope=p_scope;
END $$;

CREATE FUNCTION notification_worker.finish_run(p_scope TEXT,p_owner UUID,p_offset BIGINT,p_code TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=notification_worker,pg_temp AS $$
BEGIN
  IF p_offset IS NULL OR p_offset<0 OR p_code NOT IN ('OK','RETRY_REQUIRED','STOPPED','RECOVERED') THEN RAISE EXCEPTION 'INVALID_COMPLETION'; END IF;
  UPDATE control SET owner_token=NULL,scan_offset=p_offset,last_code=p_code,updated_at=clock_timestamp()
    WHERE scope=p_scope AND owner_token=p_owner AND pending_write IS NULL;
  RETURN FOUND;
END $$;

CREATE FUNCTION notification_worker.status(p_scope TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=notification_worker,pg_temp AS $$
  SELECT jsonb_build_object('configured',true,'maintenance',c.maintenance,'owner_token',c.owner_token,
    'offset',c.scan_offset,'last_code',c.last_code,'updated_at',c.updated_at,'pending',to_jsonb(w))
    FROM control c LEFT JOIN writes w ON w.write_id=c.pending_write WHERE c.scope=p_scope
$$;

-- Operator-only evidence intake; these attestations are NOT platform fencing.
-- Obtain independent proof that the old executor cannot resume AND every
-- issued provider request is terminal. No timer/current-value check suffices.
-- A separate operator must supply the evidence reference under maintenance.
CREATE FUNCTION notification_worker.reconcile_unknown(p_scope TEXT,p_expected_owner UUID,p_write UUID,
  p_outcome TEXT,p_target TEXT,p_evidence JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=notification_worker,pg_temp AS $$
DECLARE c control%ROWTYPE; w writes%ROWTYPE;
BEGIN
  SELECT * INTO c FROM control WHERE scope=p_scope FOR UPDATE;
  IF NOT FOUND OR NOT c.maintenance OR c.owner_token IS DISTINCT FROM p_expected_owner
    OR c.pending_write IS DISTINCT FROM p_write THEN RAISE EXCEPTION 'RECONCILIATION_CONFLICT'; END IF;
  IF p_evidence->>'executor_stopped' IS DISTINCT FROM 'true' OR p_evidence->>'provider_terminal' IS DISTINCT FROM 'true'
    OR length(coalesce(p_evidence->>'reference',''))<8 OR p_outcome NOT IN ('applied','not_applied')
    OR p_outcome IS NULL THEN RAISE EXCEPTION 'INDEPENDENT_EVIDENCE_REQUIRED'; END IF;
  SELECT * INTO w FROM writes WHERE write_id=p_write;
  IF w.phase NOT IN ('started','returned') OR (p_outcome='applied' AND (p_target IS NULL OR
    (w.target_id IS NOT NULL AND w.target_id<>p_target))) THEN RAISE EXCEPTION 'INVALID_RECONCILIATION'; END IF;
  UPDATE writes SET phase=CASE WHEN p_outcome='applied' THEN 'returned' ELSE 'not_sent' END,
    target_id=CASE WHEN p_outcome='applied' THEN p_target ELSE target_id END,
    operator_evidence=p_evidence||jsonb_build_object('database_operator',session_user,'recorded_at',clock_timestamp()),
    returned_at=CASE WHEN p_outcome='applied' THEN clock_timestamp() ELSE returned_at END
    WHERE write_id=p_write;
  UPDATE control SET owner_token=NULL,pending_write=CASE WHEN p_outcome='applied' THEN p_write ELSE NULL END,
    last_code='OPERATOR_RECONCILED',updated_at=clock_timestamp() WHERE scope=p_scope;
  -- Applied still requires a fresh entity read by --recover before completion.
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA notification_worker FROM PUBLIC,notification_worker,notification_reconciler;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA notification_worker FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification_worker REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA notification_worker TO notification_worker,notification_reconciler;
GRANT EXECUTE ON FUNCTION notification_worker.claim(TEXT,UUID,BOOLEAN),
  notification_worker.begin_write(TEXT,UUID,UUID,TEXT,TEXT,JSONB,TEXT),
  notification_worker.record_return(TEXT,UUID,UUID,TEXT),
  notification_worker.finish_write(TEXT,UUID,UUID,BOOLEAN),
  notification_worker.finish_run(TEXT,UUID,BIGINT,TEXT),notification_worker.status(TEXT) TO notification_worker;
GRANT EXECUTE ON FUNCTION notification_worker.configure(TEXT,BOOLEAN,TEXT),
  notification_worker.reconcile_unknown(TEXT,UUID,UUID,TEXT,TEXT,JSONB),
  notification_worker.status(TEXT) TO notification_reconciler;
COMMIT;
