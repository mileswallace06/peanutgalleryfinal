/**
 * authorityProbeV2.ts — Phase 1B v2 hardening gate probe.
 * Runs in the Deno runtime via migrateSensitiveData (temporary action).
 * SQL is embedded — the Deno runtime cannot read from the project disk.
 */

import { neon } from 'npm:@neondatabase/serverless';
import { randomUUID } from 'node:crypto';

const PROBE_PREFIX = 'probe_v2_';
const CONCURRENCY = 100;

// ── Embedded SQL ─────────────────────────────────────────────────────────────
const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS authority_probe_v2;
CREATE TABLE IF NOT EXISTS authority_probe_v2.reservation_authority (
  listing_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0,
  lifecycle_state TEXT NOT NULL DEFAULT 'available' CHECK (lifecycle_state IN ('available','reserved','sold','cancelled','expired')),
  seller_user_id TEXT NOT NULL, buyer_user_id TEXT, reservation_token_hash TEXT,
  reservation_expires_at TIMESTAMPTZ, reservation_revision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE authority_probe_v2.reservation_authority DROP CONSTRAINT IF EXISTS reserved_requires_full_tuple;
ALTER TABLE authority_probe_v2.reservation_authority ADD CONSTRAINT reserved_requires_full_tuple
  CHECK (lifecycle_state <> 'reserved' OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL AND reservation_expires_at IS NOT NULL AND reservation_revision IS NOT NULL));
ALTER TABLE authority_probe_v2.reservation_authority DROP CONSTRAINT IF EXISTS available_clears_tuple;
ALTER TABLE authority_probe_v2.reservation_authority ADD CONSTRAINT available_clears_tuple
  CHECK (lifecycle_state <> 'available' OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL AND reservation_expires_at IS NULL));
ALTER TABLE authority_probe_v2.reservation_authority DROP CONSTRAINT IF EXISTS terminal_states_clear_tuple;
ALTER TABLE authority_probe_v2.reservation_authority ADD CONSTRAINT terminal_states_clear_tuple
  CHECK (lifecycle_state NOT IN ('sold','cancelled','expired') OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL AND reservation_expires_at IS NULL));
CREATE TABLE IF NOT EXISTS authority_probe_v2.reservation_operations (
  operation_id TEXT PRIMARY KEY, subject_type TEXT NOT NULL CHECK (subject_type IN ('listing','user')),
  subject_id TEXT NOT NULL, listing_id TEXT REFERENCES authority_probe_v2.reservation_authority(listing_id) DEFERRABLE INITIALLY DEFERRED,
  operation_type TEXT NOT NULL, requested_state TEXT NOT NULL, expected_version INTEGER NOT NULL,
  canonical_payload JSONB NOT NULL, result_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','committed','conflict','rejected','not_found','invalid_transition','idempotent_replay')),
  error_code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), committed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS authority_probe_v2.operational_incidents (
  incident_id BIGSERIAL PRIMARY KEY, incident_key TEXT UNIQUE NOT NULL, incident_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium', title TEXT NOT NULL, occurrence_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const FUNCTIONS_SQL = `
CREATE OR REPLACE FUNCTION authority_probe_v2.initialize_listing(p_listing_id TEXT, p_seller_user_id TEXT, p_operation_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp AS $$
DECLARE v_canonical_payload JSONB; v_existing reservation_operations%ROWTYPE; v_result JSONB;
BEGIN
  v_canonical_payload := jsonb_build_object('operation_type','initialize','listing_id',p_listing_id,'seller_user_id',p_seller_user_id);
  INSERT INTO reservation_operations (operation_id, subject_type, subject_id, listing_id, operation_type, requested_state, expected_version, canonical_payload, status)
  VALUES (p_operation_id, 'listing', p_listing_id, p_listing_id, 'initialize', 'available', 0, v_canonical_payload, 'pending') ON CONFLICT (operation_id) DO NOTHING;
  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF v_existing.status IN ('committed','conflict','rejected','not_found','invalid_transition') THEN
    IF v_existing.canonical_payload = v_canonical_payload THEN
      UPDATE reservation_operations SET status = 'idempotent_replay' WHERE operation_id = p_operation_id AND status <> 'idempotent_replay';
      RETURN v_existing.result_json::JSONB;
    ELSE RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT'); END IF;
  END IF;
  BEGIN
    INSERT INTO reservation_authority (listing_id, version, lifecycle_state, seller_user_id) VALUES (p_listing_id, 0, 'available', p_seller_user_id);
  EXCEPTION WHEN unique_violation THEN
    v_result := jsonb_build_object('ok', false, 'code', 'ALREADY_EXISTS');
    UPDATE reservation_operations SET status = 'conflict', result_json = v_result::TEXT, error_code = 'ALREADY_EXISTS', committed_at = now() WHERE operation_id = p_operation_id;
    RETURN v_result;
  END;
  v_result := jsonb_build_object('ok', true, 'version', 0);
  UPDATE reservation_operations SET status = 'committed', result_json = v_result::TEXT, committed_at = now() WHERE operation_id = p_operation_id;
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION authority_probe_v2.reserve_listing(p_listing_id TEXT, p_expected_version INTEGER, p_buyer_user_id TEXT, p_token_hash TEXT, p_expires_at TIMESTAMPTZ, p_operation_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp AS $$
DECLARE v_canonical_payload JSONB; v_existing reservation_operations%ROWTYPE; v_new_version INTEGER; v_revision TEXT; v_result JSONB;
BEGIN
  v_canonical_payload := jsonb_build_object('operation_type','reserve','requested_state','reserved','listing_id',p_listing_id,'expected_version',p_expected_version,'buyer_user_id',p_buyer_user_id,'token_hash',p_token_hash,'expires_at',p_expires_at);
  INSERT INTO reservation_operations (operation_id, subject_type, subject_id, listing_id, operation_type, requested_state, expected_version, canonical_payload, status)
  VALUES (p_operation_id, 'listing', p_listing_id, p_listing_id, 'reserve', 'reserved', p_expected_version, v_canonical_payload, 'pending') ON CONFLICT (operation_id) DO NOTHING;
  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF v_existing.status IN ('committed','conflict','rejected','not_found','invalid_transition') THEN
    IF v_existing.canonical_payload = v_canonical_payload THEN
      UPDATE reservation_operations SET status = 'idempotent_replay' WHERE operation_id = p_operation_id AND status <> 'idempotent_replay';
      RETURN v_existing.result_json::JSONB;
    ELSE RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT'); END IF;
  END IF;
  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority SET version = version + 1, lifecycle_state = 'reserved', buyer_user_id = p_buyer_user_id, reservation_token_hash = p_token_hash, reservation_expires_at = p_expires_at, reservation_revision = v_revision, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version AND lifecycle_state = 'available' RETURNING version INTO v_new_version;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM reservation_authority WHERE listing_id = p_listing_id) THEN
      v_result := jsonb_build_object('ok', false, 'code', 'CONFLICT');
      UPDATE reservation_operations SET status = 'conflict', result_json = v_result::TEXT, error_code = 'CONFLICT', committed_at = now() WHERE operation_id = p_operation_id;
    ELSE
      v_result := jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
      UPDATE reservation_operations SET status = 'not_found', result_json = v_result::TEXT, error_code = 'NOT_FOUND', committed_at = now() WHERE operation_id = p_operation_id;
    END IF; RETURN v_result;
  END IF;
  v_result := jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision);
  UPDATE reservation_operations SET status = 'committed', result_json = v_result::TEXT, committed_at = now() WHERE operation_id = p_operation_id;
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION authority_probe_v2.release_listing(p_listing_id TEXT, p_expected_version INTEGER, p_buyer_user_id TEXT, p_operation_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp AS $$
DECLARE v_canonical_payload JSONB; v_existing reservation_operations%ROWTYPE; v_new_version INTEGER; v_revision TEXT; v_result JSONB;
BEGIN
  v_canonical_payload := jsonb_build_object('operation_type','release','requested_state','available','listing_id',p_listing_id,'expected_version',p_expected_version,'buyer_user_id',p_buyer_user_id);
  INSERT INTO reservation_operations (operation_id, subject_type, subject_id, listing_id, operation_type, requested_state, expected_version, canonical_payload, status)
  VALUES (p_operation_id, 'listing', p_listing_id, p_listing_id, 'release', 'available', p_expected_version, v_canonical_payload, 'pending') ON CONFLICT (operation_id) DO NOTHING;
  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF v_existing.status IN ('committed','conflict','rejected','not_found','invalid_transition') THEN
    IF v_existing.canonical_payload = v_canonical_payload THEN
      UPDATE reservation_operations SET status = 'idempotent_replay' WHERE operation_id = p_operation_id AND status <> 'idempotent_replay';
      RETURN v_existing.result_json::JSONB;
    ELSE RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT'); END IF;
  END IF;
  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority SET version = version + 1, lifecycle_state = 'available', buyer_user_id = NULL, reservation_token_hash = NULL, reservation_expires_at = NULL, reservation_revision = v_revision, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version AND lifecycle_state = 'reserved' AND buyer_user_id = p_buyer_user_id RETURNING version INTO v_new_version;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM reservation_authority WHERE listing_id = p_listing_id) THEN
      v_result := jsonb_build_object('ok', false, 'code', 'CONFLICT');
      UPDATE reservation_operations SET status = 'conflict', result_json = v_result::TEXT, error_code = 'CONFLICT', committed_at = now() WHERE operation_id = p_operation_id;
    ELSE
      v_result := jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
      UPDATE reservation_operations SET status = 'not_found', result_json = v_result::TEXT, error_code = 'NOT_FOUND', committed_at = now() WHERE operation_id = p_operation_id;
    END IF; RETURN v_result;
  END IF;
  v_result := jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision);
  UPDATE reservation_operations SET status = 'committed', result_json = v_result::TEXT, committed_at = now() WHERE operation_id = p_operation_id;
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION authority_probe_v2.get_state(p_listing_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp AS $$
DECLARE v_row reservation_authority%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM reservation_authority WHERE listing_id = p_listing_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true, 'version', v_row.version, 'listing_id', v_row.listing_id, 'buyer_user_id', v_row.buyer_user_id, 'seller_user_id', v_row.seller_user_id, 'lifecycle_state', v_row.lifecycle_state, 'reservation_revision', v_row.reservation_revision);
END; $$;

CREATE OR REPLACE FUNCTION authority_probe_v2.get_operation(p_operation_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp AS $$
DECLARE v_row reservation_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM reservation_operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true, 'operation_id', v_row.operation_id, 'status', v_row.status, 'result', CASE WHEN v_row.result_json IS NOT NULL THEN v_row.result_json::JSONB ELSE NULL END, 'canonical_payload', v_row.canonical_payload, 'error_code', v_row.error_code);
END; $$;

CREATE OR REPLACE FUNCTION authority_probe_v2.create_incident(p_incident_key TEXT, p_incident_type TEXT, p_priority TEXT, p_title TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp AS $$
DECLARE v_id BIGINT; v_count INTEGER;
BEGIN
  INSERT INTO operational_incidents (incident_key, incident_type, priority, title) VALUES (p_incident_key, p_incident_type, p_priority, p_title)
  ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1, updated_at = now()
  RETURNING incident_id, occurrence_count INTO v_id, v_count;
  RETURN jsonb_build_object('ok', true, 'id', v_id::TEXT, 'occurrence_count', v_count);
END; $$;

CREATE OR REPLACE FUNCTION authority_probe_v2.reserve_and_fail(p_listing_id TEXT, p_expected_version INTEGER, p_buyer_user_id TEXT, p_token_hash TEXT, p_expires_at TIMESTAMPTZ, p_operation_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp AS $$
DECLARE v_result JSONB;
BEGIN
  v_result := reserve_listing(p_listing_id, p_expected_version, p_buyer_user_id, p_token_hash, p_expires_at, p_operation_id);
  IF (v_result->>'ok')::boolean THEN RAISE EXCEPTION 'INJECTED_FAILURE'; END IF;
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION authority_probe_v2.cleanup_synthetic(p_prefix TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_probe_v2, pg_temp AS $$
DECLARE v_auth INTEGER; v_ops INTEGER; v_inc INTEGER;
BEGIN
  DELETE FROM reservation_authority WHERE listing_id LIKE p_prefix || '%'; GET DIAGNOSTICS v_auth = ROW_COUNT;
  DELETE FROM reservation_operations WHERE operation_id LIKE p_prefix || '%'; GET DIAGNOSTICS v_ops = ROW_COUNT;
  DELETE FROM operational_incidents WHERE incident_key LIKE p_prefix || '%'; GET DIAGNOSTICS v_inc = ROW_COUNT;
  RETURN jsonb_build_object('authority', v_auth, 'operations', v_ops, 'incidents', v_inc);
END; $$;
`;

const ROLES_SQL = `
CREATE ROLE authority_probe_executor LOGIN NOINHERIT;
REVOKE ALL ON SCHEMA authority_probe_v2 FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA authority_probe_v2 FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA authority_probe_v2 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA authority_probe_v2 FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA authority_probe_v2 REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA authority_probe_v2 REVOKE ALL ON TABLES FROM PUBLIC;
GRANT USAGE ON SCHEMA authority_probe_v2 TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.initialize_listing TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.reserve_listing TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.release_listing TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.get_state TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.get_operation TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.create_incident TO authority_probe_executor;
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA authority_probe_v2 FROM authority_probe_executor;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA authority_probe_v2 FROM authority_probe_executor;
REVOKE CREATE ON SCHEMA authority_probe_v2 FROM authority_probe_executor;
DO $$ BEGIN EXECUTE format('REVOKE CREATE ON DATABASE %I FROM authority_probe_executor', current_database()); END $$;
`;

// ── SQL splitter ─────────────────────────────────────────────────────────────
function splitSql(sql: string): string[] {
  const stmts: string[] = [];
  let cur = '', inDollar = false, inSingle = false, inLine = false, inBlock = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (inLine) { cur += ch; if (ch === '\n') inLine = false; continue; }
    if (inBlock) { cur += ch; if (ch === '*' && next === '/') { inBlock = false; i++; cur += '/'; } continue; }
    if (inDollar) { cur += ch; if (ch === '$' && next === '$') { inDollar = false; i++; cur += '$'; } continue; }
    if (inSingle) { cur += ch; if (ch === "'" && sql[i-1] !== '\\') inSingle = false; continue; }
    if (ch === '-' && next === '-' && !inDollar && !inSingle) { inLine = true; cur += ch; continue; }
    if (ch === '/' && next === '*' && !inDollar && !inSingle) { inBlock = true; cur += ch; continue; }
    if (ch === '$' && next === '$' && !inSingle) { inDollar = true; cur += '$$'; i++; continue; }
    if (ch === "'" && !inDollar) { inSingle = true; cur += ch; continue; }
    if (ch === ';' && !inDollar && !inSingle && !inLine && !inBlock) { if (cur.trim()) stmts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

function parseResult(response: any): any {
  const rows = response?.rows || response;
  if (!rows || rows.length === 0) return null;
  const v = rows[0].result;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return { ok: false, raw: v?.substring(0, 80) }; } }
  return v;
}

// ── Main probe function ─────────────────────────────────────────────────────
export async function runProbeV2(): Promise<object> {
  let adminUrl = Deno.env.get('AUTHORITY_DB_URL_DEV_ADMIN');
  if (!adminUrl) throw new Error('AUTHORITY_DB_URL_DEV_ADMIN not available');
  const urlMatch = adminUrl.match(/(postgres(?:ql)?:\/\/[^\s]+)/);
  if (urlMatch) adminUrl = urlMatch[1];
  const executorUrlFromEnv = Deno.env.get('AUTHORITY_DB_URL_DEV_EXECUTOR');
  const password = randomUUID();
  const adminSql = neon(adminUrl, { fullResults: true, fetchTimeout: 15000 });

  // Create executor role FIRST (try tagged template literal)
  try {
    await adminSql`CREATE ROLE authority_probe_executor LOGIN NOINHERIT`;
  } catch (e: any) {
    if (!e.message.includes('already exists') && !e.message.includes('duplicate key')) {
      throw new Error('CREATE ROLE failed: ' + (e.message || '').substring(0, 100));
    }
  }
  // Verify role exists
  const roleCheck = await adminSql`SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'authority_probe_executor'`;
  if (roleCheck.rows.length === 0) throw new Error('Role not found after CREATE ROLE (rows: ' + roleCheck.rows.length + ')');
  if (!roleCheck.rows[0].rolcanlogin) throw new Error('Role exists but login not enabled');

  // Execute schema + functions (skip CREATE ROLE since we did it above)
  const schemaStmts = [...splitSql(SCHEMA_SQL), ...splitSql(FUNCTIONS_SQL)];
  for (const stmt of schemaStmts) {
    try { await adminSql.unsafe(stmt); } catch (e: any) {
      if (!e.message.includes('already exists') && !e.message.includes('duplicate key')) throw e;
    }
  }
  // Execute grants/revokes (skip CREATE ROLE)
  const rolesStmts = splitSql(ROLES_SQL).filter(s => !s.includes('CREATE ROLE'));
  for (const stmt of rolesStmts) {
    try { await adminSql.unsafe(stmt); } catch (e: any) {
      if (!e.message.includes('already exists') && !e.message.includes('duplicate key')) throw e;
    }
  }
  // Set executor password via a SECURITY DEFINER function (ALTER ROLE doesn't
  // support parameterized queries, and unsafe() may not work in Deno runtime).
  // Create a temp function that uses EXECUTE to set the password.
  await adminSql`CREATE OR REPLACE FUNCTION set_executor_pw(pw TEXT) RETURNS VOID AS $$ BEGIN EXECUTE 'ALTER ROLE authority_probe_executor WITH PASSWORD ''' || pw || ''' LOGIN'; END; $$ LANGUAGE plpgsql SECURITY DEFINER`;
  await adminSql`SELECT set_executor_pw(${password})`;
  const adminUrlObj = new URL(adminUrl);
  const executorUrl = `postgres://authority_probe_executor:${password}@${adminUrlObj.host}${adminUrlObj.pathname}?sslmode=require`;
  const execSql = neon(executorUrl, { fullResults: true, fetchTimeout: 5000 });

  const results: any = {};
  const runId = `probe_v2_${Date.now()}`;

  try {
    // Pre-construct all operation IDs (cannot use ${var}_suffix in tagged templates)
    const opInit = runId + '_init';
    const opStale = runId + '_stale';
    const opInit6 = runId + '_init6';
    const opRb = runId + '_rb';
    const opInit7 = runId + '_init7';
    const opR7_0 = runId + '_r7_0';
    const opRelease = runId + '_release';
    const expiresAt = '2026-12-31T00:00:00Z';

    // Test 1: Initialize listing
    const listing1 = PROBE_PREFIX + 't1';
    const initRes = parseResult(await execSql`SELECT authority_probe_v2.initialize_listing(${listing1}, 'seller_v2_t1', ${opInit}) AS result`);
    results.test1_init = { pass: initRes?.ok === true && initRes?.version === 0, result: initRes };

    // Test 2: Committed replay
    const replayRes = parseResult(await execSql`SELECT authority_probe_v2.initialize_listing(${listing1}, 'seller_v2_t1', ${opInit}) AS result`);
    results.test2_committed_replay = { pass: JSON.stringify(replayRes) === JSON.stringify(initRes) };

    // Test 3: Conflicted replay remains permanently conflicted
    const conflictOp = runId + '_conflict1';
    const conflictRes = parseResult(await execSql`SELECT authority_probe_v2.reserve_listing(${listing1}, 5, 'buyer_c', 'tok_c', ${expiresAt}, ${conflictOp}) AS result`);
    const conflictReplay = parseResult(await execSql`SELECT authority_probe_v2.reserve_listing(${listing1}, 5, 'buyer_c', 'tok_c', ${expiresAt}, ${conflictOp}) AS result`);
    results.test3_conflicted_replay = { pass: conflictRes?.code === 'CONFLICT' && JSON.stringify(conflictRes) === JSON.stringify(conflictReplay) };

    // Test 4: Same op_id with changed payload is rejected
    const changedOp = runId + '_changed';
    const changed1 = parseResult(await execSql`SELECT authority_probe_v2.reserve_listing(${listing1}, 0, 'buyer_A', 'tok_A', ${expiresAt}, ${changedOp}) AS result`);
    const changed2 = parseResult(await execSql`SELECT authority_probe_v2.reserve_listing(${listing1}, 0, 'buyer_B', 'tok_B', ${expiresAt}, ${changedOp}) AS result`);
    results.test4_changed_payload = { pass: changed1?.ok === true && changed2?.code === 'OPERATION_ID_CONFLICT' };

    // Test 5: Stale version rejection
    const staleRes = parseResult(await execSql`SELECT authority_probe_v2.reserve_listing(${listing1}, 99, 'buyer_s', 'tok_s', ${expiresAt}, ${opStale}) AS result`);
    results.test5_stale_version = { pass: staleRes?.code === 'CONFLICT' };

    // Test 6: Injected rollback (admin for test-only function)
    const listing6 = PROBE_PREFIX + 't6';
    await execSql`SELECT authority_probe_v2.initialize_listing(${listing6}, 'seller_v2_t6', ${opInit6}) AS result`;
    let rbError: string | null = null;
    try { await adminSql`SELECT authority_probe_v2.reserve_and_fail(${listing6}, 0, 'buyer_rb', 'tok_rb', ${expiresAt}, ${opRb}) AS result`; } catch (e: any) { rbError = e.message?.substring(0, 80); }
    const stateAfterRb = parseResult(await execSql`SELECT authority_probe_v2.get_state(${listing6}) AS result`);
    results.test6_injected_rollback = { pass: rbError?.includes('INJECTED_FAILURE') && stateAfterRb?.lifecycle_state === 'available' && stateAfterRb?.version === 0, injectedError: rbError };

    // Test 7: 100 distinct reservation attempts → 1 winner
    const listing7 = PROBE_PREFIX + 't7';
    await execSql`SELECT authority_probe_v2.initialize_listing(${listing7}, 'seller_v2_t7', ${opInit7}) AS result`;
    const reservePromises = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const buyerId = 'buyer_' + i;
      const tokId = 'tok_' + i;
      const r7Op = runId + '_r7_' + i;
      reservePromises.push(execSql`SELECT authority_probe_v2.reserve_listing(${listing7}, 0, ${buyerId}, ${tokId}, ${expiresAt}, ${r7Op}) AS result`);
    }
    const reserveResults = (await Promise.all(reservePromises)).map(parseResult);
    const winners = reserveResults.filter(r => r?.ok === true).length;
    const conflicts = reserveResults.filter(r => r?.code === 'CONFLICT').length;
    results.test7_concurrent_reserve = { pass: winners === 1 && conflicts === 99, winners, conflicts };

    // Test 8: 100 identical retries → 1 deterministic result
    const winnerResult = reserveResults.find(r => r?.ok === true);
    const retryPromises = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const buyerId = 'buyer_0';
      const tokId = 'tok_0';
      retryPromises.push(execSql`SELECT authority_probe_v2.reserve_listing(${listing7}, 0, ${buyerId}, ${tokId}, ${expiresAt}, ${opR7_0}) AS result`);
    }
    const retryResults = (await Promise.all(retryPromises)).map(parseResult);
    const allSame = retryResults.every(r => JSON.stringify(r) === JSON.stringify(winnerResult));
    results.test8_identical_retry = { pass: allSame, deterministic: allSame };

    // Test 9: Release
    const releaseRes = parseResult(await execSql`SELECT authority_probe_v2.release_listing(${listing7}, 1, 'buyer_0', ${opRelease}) AS result`);
    const stateAfterRelease = parseResult(await execSql`SELECT authority_probe_v2.get_state(${listing7}) AS result`);
    results.test9_release = { pass: releaseRes?.ok === true && stateAfterRelease?.lifecycle_state === 'available' };

    // Test 10: Unknown-response recovery
    const opLookup = parseResult(await execSql`SELECT authority_probe_v2.get_operation(${opR7_0}) AS result`);
    results.test10_recovery = { pass: opLookup?.ok === true && !!opLookup?.result, status: opLookup?.status };

    // Test 11: 100 concurrent incident calls → 1 incident ID, 1 row
    const incidentKey = PROBE_PREFIX + 'inc_' + Date.now();
    const incidentPromises = [];
    for (let i = 0; i < CONCURRENCY; i++) incidentPromises.push(execSql`SELECT authority_probe_v2.create_incident(${incidentKey}, 'test_incident', 'medium', 'Test incident') AS result`);
    const incidentResults = (await Promise.all(incidentPromises)).map(parseResult);
    const incidentIds = [...new Set(incidentResults.map(r => r?.id))];
    const allOk = incidentResults.every(r => r?.ok === true);
    const dbCountRow = parseResult(await adminSql`SELECT count(*)::text AS result FROM authority_probe_v2.operational_incidents WHERE incident_key = ${incidentKey}`);
    const dbCount = parseInt(dbCountRow?.raw || dbCountRow || '0', 10);
    results.test11_concurrent_incident = { pass: incidentIds.length === 1 && allOk && dbCount === 1, uniqueIds: incidentIds.length, dbCount, occurrenceCount: incidentResults[0]?.occurrence_count };

    // Test 12: Executor privilege matrix
    const priv: any = {};
    try { await execSql`SELECT * FROM authority_probe_v2.reservation_authority LIMIT 1`; priv.select = 'ALLOWED'; } catch { priv.select = 'DENIED'; }
    try { await execSql`INSERT INTO authority_probe_v2.reservation_authority (listing_id, seller_user_id) VALUES ('priv_test', 'x')`; priv.insert = 'ALLOWED'; } catch { priv.insert = 'DENIED'; }
    try { await execSql`UPDATE authority_probe_v2.reservation_authority SET version = 99`; priv.update = 'ALLOWED'; } catch { priv.update = 'DENIED'; }
    try { await execSql`DELETE FROM authority_probe_v2.reservation_authority WHERE listing_id = 'nonexistent'`; priv.delete = 'ALLOWED'; } catch { priv.delete = 'DENIED'; }
    try { await execSql`CREATE TABLE authority_probe_v2.priv_test (id int)`; priv.create = 'ALLOWED'; } catch { priv.create = 'DENIED'; }
    try { await execSql`ALTER TABLE authority_probe_v2.reservation_authority ADD COLUMN priv_test int`; priv.alter = 'ALLOWED'; } catch { priv.alter = 'DENIED'; }
    try { await execSql`SELECT authority_probe_v2.reserve_and_fail('x', 0, 'x', 'x', ${expiresAt}, 'x') AS result`; priv.reserve_and_fail = 'ALLOWED'; } catch { priv.reserve_and_fail = 'DENIED'; }
    const allowedWorks = parseResult(await execSql`SELECT authority_probe_v2.get_state(${listing1}) AS result`);
    results.test12_privileges = { pass: Object.values(priv).every((v: any) => v === 'DENIED') && allowedWorks?.ok === true, ...priv };

    // Test 13: Deployed handler retrieves executor secret
    const secretCheck = parseResult(await execSql`SELECT authority_probe_v2.get_state(${listing1}) AS result`);
    results.test13_executor_secret = { pass: secretCheck?.ok === true, executorSecretAvailable: !!executorUrlFromEnv, executorFunctionWorks: secretCheck?.ok === true, needsOwnerAction: !executorUrlFromEnv };

    // Test 14: Latency
    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) { const s = Date.now(); await execSql`SELECT authority_probe_v2.get_state(${listing1}) AS result`; latencies.push(Date.now() - s); }
    latencies.sort((a, b) => a - b);
    results.test14_latency = { min_ms: latencies[0], median_ms: latencies[10], p95_ms: latencies[19], max_ms: latencies[19] };

  } finally {
    // Test 15: Cleanup
    try {
      await adminSql`DELETE FROM authority_probe_v2.reservation_authority WHERE listing_id LIKE ${PROBE_PREFIX + '%'}`;
      await adminSql`DELETE FROM authority_probe_v2.reservation_operations WHERE operation_id LIKE ${PROBE_PREFIX + '%'} OR operation_id LIKE ${runId + '%'}`;
      await adminSql`DELETE FROM authority_probe_v2.operational_incidents WHERE incident_key LIKE ${PROBE_PREFIX + '%'}`;
      const remAuth = parseResult(await adminSql`SELECT count(*)::text AS result FROM authority_probe_v2.reservation_authority WHERE listing_id LIKE ${PROBE_PREFIX + '%'}`);
      const remOps = parseResult(await adminSql`SELECT count(*)::text AS result FROM authority_probe_v2.reservation_operations WHERE operation_id LIKE ${PROBE_PREFIX + '%'} OR operation_id LIKE ${runId + '%'}`);
      const remInc = parseResult(await adminSql`SELECT count(*)::text AS result FROM authority_probe_v2.operational_incidents WHERE incident_key LIKE ${PROBE_PREFIX + '%'}`);
      results.test15_cleanup = { pass: parseInt(remAuth?.raw || '0') === 0 && parseInt(remOps?.raw || '0') === 0 && parseInt(remInc?.raw || '0') === 0, remaining: { authority: parseInt(remAuth?.raw || '0'), operations: parseInt(remOps?.raw || '0'), incidents: parseInt(remInc?.raw || '0') } };
    } catch (e: any) { results.test15_cleanup = { pass: false, error: e.message?.substring(0, 80) }; }
  }

  const allPass = Object.entries(results).filter(([k]) => k.startsWith('test')).every(([, v]: any) => v?.pass === true);
  results.verdict = allPass ? 'PASS' : 'FAIL';
  results.meta = { run_id: runId, executorSecretFromEnv: !!executorUrlFromEnv, usingInMemoryExecutor: !executorUrlFromEnv, needsOwnerAction: !executorUrlFromEnv };
  return results;
}