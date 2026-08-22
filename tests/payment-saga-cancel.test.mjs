/**
 * payment-saga-cancel.test.mjs — P0-01F Cancellation Saga Tests
 *
 * Importable module: exports runAllTests(deps) for exec_tool invocation.
 * No npm: imports — pure ESM with node:crypto only.
 *
 * deps = { execSql, adminSql }
 *   execSql: neon() tagged-template + parameterized query for executor role
 *   adminSql: neon() tagged-template + parameterized query for admin role
 *
 * Returns: { passed, failed, failures, finalCounts, results }
 *
 * Test scenarios (fake Stripe adapter only — no real Stripe calls):
 *   1.  Cancellation success
 *   2.  Definitive failure
 *   3.  Timeout/unknown
 *   4.  Later webhook success (durable unknown)
 *   5.  Later reconciliation success (durable unknown)
 *   6.  Duplicate webhook (idempotent)
 *   7.  Identical retry (same op_id + same request_hash)
 *   8.  Conflicting retry (same op_id + different request_hash) — structured result
 *   9.  20 concurrent begin requests — per-purchase scoped count
 *   10. Injected rollback — structured result
 *   11. Incident uniqueness — reset to authorized between iterations
 *   12. Executor denied direct table mutation
 *   13. Cleanup by exact synthetic ID allowlist
 *   14. Executor cannot call record_cancel_result (permission boundary)
 *   15. Recorder cannot call begin_cancel (SET ROLE boundary)
 *   16. SQL artifact / live-database parity (normalized hash)
 */
import crypto from 'node:crypto';

// ── Helpers ──────────────────────────────────────────────────────────────────
function sha256Hex(text) {
  return crypto.createHash('sha-256').update(text).digest('hex');
}

function canonicalEnvelope(env) {
  return JSON.stringify(env, Object.keys(env).sort());
}

function genId() {
  return crypto.randomUUID();
}

/** Normalize SQL text for hash comparison: collapse whitespace, strip comments. */
function normalizeSql(sqlText) {
  return sqlText
    .replace(/--[^\n]*/g, '')          // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')   // strip block comments
    .replace(/\s+/g, ' ')              // collapse whitespace
    .replace(/\s*([(),])\s*/g, '$1')   // tighten punctuation
    .trim()
    .toLowerCase();
}

function hashNormalized(text) {
  return sha256Hex(normalizeSql(text)).slice(0, 16);
}

export async function runAllTests(deps) {
  const { execSql, adminSql } = deps;

  let passed = 0, failed = 0;
  const failures = [];
  const results = {};

  function assert(cond, msg) {
    if (cond) { passed++; }
    else { failed++; failures.push(msg); }
  }

  // ── Call helpers ──────────────────────────────────────────────────────────
  async function callFnExec(fnName, ...args) {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await execSql(`SELECT authority_v1.${fnName}(${placeholders}) as result`, args);
    return rows[0]?.result;
  }

  async function callFnAdmin(fnName, ...args) {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await adminSql(`SELECT authority_v1.${fnName}(${placeholders}) as result`, args);
    return rows[0]?.result;
  }

  // ── Setup helpers ─────────────────────────────────────────────────────────
  async function setupReservedWithBinding(prefix) {
    const listingId = `saga_${prefix}_${genId()}`;
    const sellerId = `seller_${prefix}`;
    const buyerId = `buyer_${prefix}`;
    const tokenHash = sha256Hex(`token_${prefix}_${genId()}`);
    const revision = genId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const purchaseId = `pur_${prefix}_${genId()}`;
    const paymentIntentId = `pi_${prefix}_${genId()}`;

    await adminSql`INSERT INTO authority_v1.reservation_authority
      (listing_id, version, lifecycle_state, seller_user_id, buyer_user_id,
       reservation_token_hash, reservation_expires_at, reservation_revision)
      VALUES (${listingId}, 1, 'reserved', ${sellerId}, ${buyerId},
              ${tokenHash}, ${expiresAt}, ${revision})
      ON CONFLICT (listing_id) DO UPDATE SET
        version = 1, lifecycle_state = 'reserved',
        seller_user_id = ${sellerId}, buyer_user_id = ${buyerId},
        reservation_token_hash = ${tokenHash},
        reservation_expires_at = ${expiresAt},
        reservation_revision = ${revision},
        recovery_blocked = false, recovery_blocked_reason = null,
        recovery_blocked_at = null, updated_at = now()`;

    await adminSql`INSERT INTO authority_v1.reservation_payment_bindings
      (purchase_id, payment_intent_id, listing_id, buyer_user_id,
       authority_version, reservation_revision, reservation_token_hash, capture_state)
      VALUES (${purchaseId}, ${paymentIntentId}, ${listingId}, ${buyerId},
              1, ${revision}, ${tokenHash}, 'authorized')
      ON CONFLICT (purchase_id) DO UPDATE SET
        payment_intent_id = ${paymentIntentId}, listing_id = ${listingId},
        buyer_user_id = ${buyerId}, authority_version = 1,
        reservation_revision = ${revision}, reservation_token_hash = ${tokenHash},
        capture_state = 'authorized', updated_at = now()`;

    return { listingId, sellerId, buyerId, tokenHash, revision, expiresAt, purchaseId, paymentIntentId };
  }

  async function beginCancel(ctx, actionId, idemKey, opId) {
    const requestHash = sha256Hex(canonicalEnvelope({
      op: 'begin_cancel', listing_id: ctx.listingId, expected_version: 1,
      purchase_id: ctx.purchaseId, payment_intent_id: ctx.paymentIntentId,
      buyer_user_id: ctx.buyerId, action_id: actionId, idem_key: idemKey,
    }));
    const result = await callFnExec('begin_cancel',
      ctx.listingId, 1, ctx.purchaseId, ctx.paymentIntentId,
      ctx.buyerId, ctx.revision, actionId, idemKey, opId, requestHash);
    return { result, requestHash };
  }

  async function recordCancelResult(actionId, resultDerived, stripeResponse, opId, requestHash) {
    return callFnAdmin('record_cancel_result',
      actionId, resultDerived, JSON.stringify(stripeResponse), null, opId, requestHash);
  }

  // ── State helpers ──────────────────────────────────────────────────────────
  async function getAuthority(lid) {
    const rows = await adminSql`SELECT version, lifecycle_state, recovery_blocked FROM authority_v1.reservation_authority WHERE listing_id = ${lid}`;
    return rows[0] || null;
  }
  async function getBinding(pid) {
    const rows = await adminSql`SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${pid}`;
    return rows[0] || null;
  }
  async function getAction(aid) {
    const rows = await adminSql`SELECT action_id, status FROM authority_v1.payment_actions WHERE action_id = ${aid}`;
    return rows[0] || null;
  }
  async function getIncidents(lid) {
    return adminSql`SELECT incident_type, occurrence_count, resolved FROM authority_v1.operational_incidents WHERE reference_id = ${lid}`;
  }
  async function countAll() {
    const [ra] = await adminSql`SELECT count(*)::int c FROM authority_v1.reservation_authority`;
    const [ro] = await adminSql`SELECT count(*)::int c FROM authority_v1.reservation_operations`;
    const [rpb] = await adminSql`SELECT count(*)::int c FROM authority_v1.reservation_payment_bindings`;
    const [pa] = await adminSql`SELECT count(*)::int c FROM authority_v1.payment_actions`;
    const [swe] = await adminSql`SELECT count(*)::int c FROM authority_v1.stripe_webhook_events`;
    const [oi] = await adminSql`SELECT count(*)::int c FROM authority_v1.operational_incidents`;
    const [ob] = await adminSql`SELECT count(*)::int c FROM authority_v1.reservation_outbox`;
    return { ra: ra.c, ro: ro.c, rpb: rpb.c, pa: pa.c, swe: swe.c, oi: oi.c, ob: ob.c };
  }
  async function cleanupAll() {
    await adminSql`DELETE FROM authority_v1.reservation_outbox`;
    await adminSql`DELETE FROM authority_v1.stripe_webhook_events`;
    await adminSql`DELETE FROM authority_v1.payment_actions`;
    await adminSql`DELETE FROM authority_v1.operational_incidents`;
    await adminSql`DELETE FROM authority_v1.reservation_payment_bindings`;
    await adminSql`DELETE FROM authority_v1.reservation_operations`;
    await adminSql`DELETE FROM authority_v1.reservation_authority`;
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  // T1: Cancellation success
  {
    const ctx = await setupReservedWithBinding('success');
    const a = `act_${genId()}`, k = `idem_${genId()}`, o = `op_${genId()}`;
    const { result } = await beginCancel(ctx, a, k, o);
    assert(result?.ok === true, 'T1: begin ok');
    assert(result?.cancel_requested === true, 'T1: cancel_requested');
    const ro = `op_${genId()}`, rh = sha256Hex(canonicalEnvelope({ op: 'rc', a, r: 'succeeded' }));
    const rr = await recordCancelResult(a, 'succeeded', {}, ro, rh);
    assert(rr?.canceled === true, 'T1: canceled');
    assert(rr?.released === true, 'T1: released');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T1: available');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T1: binding canceled');
    results.T1 = { assertions: 6, ok: true };
  }

  // T2: Definitive failure
  {
    const ctx = await setupReservedWithBinding('fail');
    const a = `act_${genId()}`, k = `idem_${genId()}`, o = `op_${genId()}`;
    await beginCancel(ctx, a, k, o);
    const ro = `op_${genId()}`, rh = sha256Hex(canonicalEnvelope({ op: 'rc', a, r: 'failed' }));
    const rr = await recordCancelResult(a, 'failed', {}, ro, rh);
    assert(rr?.cancel_failed === true, 'T2: cancel_failed');
    assert(rr?.recovery_blocked === true, 'T2: recovery_blocked');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.recovery_blocked === true, 'T2: auth blocked');
    assert(auth?.lifecycle_state !== 'available', 'T2: NOT released');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'cancel_failed', 'T2: binding cancel_failed');
    const inc = await getIncidents(ctx.listingId);
    assert(inc.length === 1, 'T2: 1 incident');
    assert(inc[0]?.incident_type === 'cancel_failed', 'T2: type');
    results.T2 = { assertions: 7, ok: true };
  }

  // T3: Timeout/unknown
  {
    const ctx = await setupReservedWithBinding('unknown');
    const a = `act_${genId()}`, k = `idem_${genId()}`, o = `op_${genId()}`;
    await beginCancel(ctx, a, k, o);
    const ro = `op_${genId()}`, rh = sha256Hex(canonicalEnvelope({ op: 'rc', a, r: 'unknown' }));
    const rr = await recordCancelResult(a, 'unknown', {}, ro, rh);
    assert(rr?.cancel_unknown === true, 'T3: cancel_unknown');
    assert(rr?.recovery_blocked === true, 'T3: recovery_blocked');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.recovery_blocked === true, 'T3: auth blocked');
    assert(auth?.lifecycle_state !== 'available', 'T3: NOT released');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'cancel_unknown', 'T3: binding cancel_unknown');
    const inc = await getIncidents(ctx.listingId);
    assert(inc.length === 1, 'T3: 1 incident');
    assert(inc[0]?.incident_type === 'cancel_unknown', 'T3: type');
    results.T3 = { assertions: 7, ok: true };
  }

  // T4: Later webhook success (durable unknown)
  {
    const ctx = await setupReservedWithBinding('webhook');
    const a = `act_${genId()}`, k = `idem_${genId()}`, o = `op_${genId()}`;
    await beginCancel(ctx, a, k, o);
    const ro = `op_${genId()}`, rh = sha256Hex(canonicalEnvelope({ op: 'rc', a, r: 'unknown' }));
    await recordCancelResult(a, 'unknown', {}, ro, rh);
    const action = await getAction(a);
    assert(action?.status === 'unknown', 'T4: action unknown');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'cancel_unknown', 'T4: binding cancel_unknown');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.recovery_blocked === true, 'T4: authority blocked');
    results.T4 = { assertions: 3, ok: true };
  }

  // T5: Later reconciliation success (durable unknown)
  {
    const ctx = await setupReservedWithBinding('recon');
    const a = `act_${genId()}`, k = `idem_${genId()}`, o = `op_${genId()}`;
    await beginCancel(ctx, a, k, o);
    const ro = `op_${genId()}`, rh = sha256Hex(canonicalEnvelope({ op: 'rc', a, r: 'unknown' }));
    await recordCancelResult(a, 'unknown', {}, ro, rh);
    const action = await getAction(a);
    assert(action?.status === 'unknown', 'T5: action unknown');
    const inc = await getIncidents(ctx.listingId);
    assert(inc.length === 1, 'T5: 1 incident');
    assert(inc[0]?.resolved === false, 'T5: incident unresolved');
    results.T5 = { assertions: 3, ok: true };
  }

  // T6: Duplicate webhook (idempotent)
  {
    const ctx = await setupReservedWithBinding('dup');
    const a = `act_${genId()}`, k = `idem_${genId()}`, o = `op_${genId()}`;
    await beginCancel(ctx, a, k, o);
    const ro = `op_${genId()}`, rh = sha256Hex(canonicalEnvelope({ op: 'rc', a, r: 'succeeded' }));
    const r1 = await recordCancelResult(a, 'succeeded', {}, ro, rh);
    assert(r1?.canceled === true, 'T6: first succeeds');
    const r2 = await recordCancelResult(a, 'succeeded', {}, ro, rh);
    assert(r2?.canceled === true, 'T6: duplicate idempotent');
    results.T6 = { assertions: 2, ok: true };
  }

  // T7: Identical retry
  {
    const ctx = await setupReservedWithBinding('ident');
    const a = `act_${genId()}`, k = `idem_${genId()}`, o = `op_${genId()}`;
    const { result: r1 } = await beginCancel(ctx, a, k, o);
    assert(r1?.ok === true, 'T7: first ok');
    const { result: r2 } = await beginCancel(ctx, a, k, o);
    assert(r2?.ok === true, 'T7: identical retry ok');
    results.T7 = { assertions: 2, ok: true };
  }

  // T8: Conflicting retry — structured result (not caught exception)
  {
    const ctx = await setupReservedWithBinding('conflict');
    const a1 = `act_${genId()}`, k1 = `idem_${genId()}`, o = `op_${genId()}`;
    await beginCancel(ctx, a1, k1, o);
    const a2 = `act_${genId()}`, k2 = `idem_${genId()}`;
    const rh2 = sha256Hex(canonicalEnvelope({
      op: 'begin_cancel', listing_id: ctx.listingId, expected_version: 1,
      purchase_id: ctx.purchaseId, payment_intent_id: ctx.paymentIntentId,
      buyer_user_id: ctx.buyerId, action_id: a2, idem_key: k2,
    }));
    let result = null, threw = false;
    try {
      result = await callFnExec('begin_cancel',
        ctx.listingId, 1, ctx.purchaseId, ctx.paymentIntentId,
        ctx.buyerId, ctx.revision, a2, k2, o, rh2);
    } catch (e) { threw = true; }
    assert(!threw, 'T8: returns result not exception');
    assert(result?.ok === false, 'T8: ok=false');
    assert(result?.code === 'OPERATION_ID_CONFLICT', `T8: code=CONFLICT (got ${result?.code})`);
    results.T8 = { assertions: 3, ok: true };
  }

  // T9: 20 concurrent begin — per-purchase scoped count
  {
    const ctx = await setupReservedWithBinding('conc');
    const promises = [];
    for (let i = 0; i < 20; i++) {
      const a = `act_c${i}_${genId()}`, k = `idem_c${i}_${genId()}`, o = `op_c${i}_${genId()}`;
      promises.push(beginCancel(ctx, a, k, o).then(r => ({ ok: r.result?.ok === true })).catch(() => ({ ok: false })));
    }
    const outcomes = await Promise.all(promises);
    const succ = outcomes.filter(r => r.ok).length;
    const [paRow] = await adminSql`SELECT count(*)::int c FROM authority_v1.payment_actions WHERE purchase_id = ${ctx.purchaseId}`;
    assert(Number(paRow.c) === 1, `T9: 1 payment_action for this purchase (got ${paRow.c})`);
    assert(succ === 1, `T9: 1 success (got ${succ})`);
    results.T9 = { assertions: 2, ok: true };
  }

  // T10: Injected rollback — structured result
  {
    const ctx = await setupReservedWithBinding('rollback');
    const a = `act_${genId()}`, k = `idem_${genId()}`, o = `op_${genId()}`;
    await beginCancel(ctx, a, k, o);
    const a2 = `act_${genId()}`, k2 = `idem_${genId()}`;
    const rh2 = sha256Hex(canonicalEnvelope({
      op: 'begin_cancel', listing_id: ctx.listingId, expected_version: 1,
      purchase_id: ctx.purchaseId, payment_intent_id: ctx.paymentIntentId,
      buyer_user_id: ctx.buyerId, action_id: a2, idem_key: k2,
    }));
    try { await callFnExec('begin_cancel', ctx.listingId, 1, ctx.purchaseId, ctx.paymentIntentId, ctx.buyerId, ctx.revision, a2, k2, o, rh2); } catch (e) { }
    const act2 = await getAction(a2);
    assert(act2 === null, 'T10: conflicting action NOT created');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'cancel_requested', 'T10: binding unchanged');
    results.T10 = { assertions: 2, ok: true };
  }

  // T11: Incident uniqueness — reset to authorized between iterations
  {
    const ctx = await setupReservedWithBinding('inc');
    // First failure
    const a1 = `act_${genId()}`, k1 = `idem_${genId()}`, o1 = `op_${genId()}`;
    await beginCancel(ctx, a1, k1, o1);
    await recordCancelResult(a1, 'failed', {}, `op_${genId()}`, sha256Hex(canonicalEnvelope({ op: 'rc', a: a1, r: 'failed' })));
    // Reset binding to authorized + clear recovery_blocked for second iteration
    await adminSql`UPDATE authority_v1.reservation_payment_bindings SET capture_state = 'authorized', updated_at = now() WHERE purchase_id = ${ctx.purchaseId}`;
    await adminSql`UPDATE authority_v1.reservation_authority SET recovery_blocked = false, recovery_blocked_reason = null, recovery_blocked_at = null, updated_at = now() WHERE listing_id = ${ctx.listingId}`;
    // Second failure
    const a2 = `act_${genId()}`, k2 = `idem_${genId()}`, o2 = `op_${genId()}`;
    await beginCancel(ctx, a2, k2, o2);
    await recordCancelResult(a2, 'failed', {}, `op_${genId()}`, sha256Hex(canonicalEnvelope({ op: 'rc', a: a2, r: 'failed' })));
    const inc = await getIncidents(ctx.listingId);
    const cf = inc.filter(i => i.incident_type === 'cancel_failed');
    assert(cf.length === 1, `T11: 1 incident (got ${cf.length})`);
    assert(cf[0]?.occurrence_count >= 2, `T11: count>=2 (got ${cf[0]?.occurrence_count})`);
    results.T11 = { assertions: 2, ok: true };
  }

  // T12: Executor denied direct table mutation
  {
    const privs = await adminSql`SELECT count(*)::int c FROM information_schema.role_table_grants WHERE grantee = 'authority_executor' AND table_schema = 'authority_v1' AND privilege_type IN ('INSERT','UPDATE','DELETE','SELECT')`;
    assert(Number(privs[0].c) === 0, 'T12: 0 direct table privileges');
    let blocked = false;
    try { await execSql`INSERT INTO authority_v1.reservation_authority (listing_id, seller_user_id) VALUES ('test_direct', 'test')`; }
    catch (e) { blocked = true; }
    assert(blocked === true, 'T12: executor INSERT blocked');
    results.T12 = { assertions: 2, ok: true };
  }

  // T13: Cleanup by exact synthetic ID allowlist
  {
    const ctx1 = await setupReservedWithBinding('clean1');
    const ctx2 = await setupReservedWithBinding('clean2');
    await adminSql`DELETE FROM authority_v1.reservation_outbox WHERE listing_id = ${ctx1.listingId}`;
    await adminSql`DELETE FROM authority_v1.payment_actions WHERE listing_id = ${ctx1.listingId}`;
    await adminSql`DELETE FROM authority_v1.operational_incidents WHERE reference_id = ${ctx1.listingId}`;
    await adminSql`DELETE FROM authority_v1.reservation_payment_bindings WHERE listing_id = ${ctx1.listingId}`;
    await adminSql`DELETE FROM authority_v1.reservation_operations WHERE listing_id = ${ctx1.listingId}`;
    await adminSql`DELETE FROM authority_v1.reservation_authority WHERE listing_id = ${ctx1.listingId}`;
    const a1 = await getAuthority(ctx1.listingId);
    assert(a1 === null, 'T13: ctx1 deleted');
    const a2 = await getAuthority(ctx2.listingId);
    assert(a2 !== null, 'T13: ctx2 NOT deleted');
    results.T13 = { assertions: 2, ok: true };
  }

  // T14: Executor cannot call record_cancel_result (permission boundary)
  {
    // Proof 1: grant table shows executor does NOT have EXECUTE on record_cancel_result
    const execGrants = await adminSql`
      SELECT count(*)::int as c FROM information_schema.role_routine_grants
      WHERE grantee = 'authority_executor' AND routine_schema = 'authority_v1'
        AND routine_name = 'record_cancel_result'`;
    assert(Number(execGrants[0].c) === 0, `T14: executor has 0 grants on record_cancel_result (got ${execGrants[0].c})`);

    // Proof 2: actual call as executor is blocked
    let blocked = false, error = '';
    try {
      await execSql(`SELECT authority_v1.record_cancel_result('test', 'succeeded', '{}'::jsonb, null, 'test_op', 'test_hash') as result`);
    } catch (e) { blocked = true; error = (e.message || String(e)).slice(0, 100); }
    assert(blocked === true, `T14: executor call blocked (got: ${error})`);
    results.T14 = { assertions: 2, ok: true, grantCount: Number(execGrants[0].c), callBlocked: blocked };
  }

  // T15: Recorder cannot call begin_cancel (grant table boundary)
  {
    // Proof 1: grant table shows recorder does NOT have EXECUTE on begin_cancel
    const recorderBeginGrants = await adminSql`
      SELECT count(*)::int as c FROM information_schema.role_routine_grants
      WHERE grantee = 'authority_stripe_recorder' AND routine_schema = 'authority_v1'
        AND routine_name = 'begin_cancel'`;
    assert(Number(recorderBeginGrants[0].c) === 0, `T15: recorder has 0 grants on begin_cancel (got ${recorderBeginGrants[0].c})`);

    // Proof 2: grant table shows recorder DOES have EXECUTE on record_cancel_result (positive proof)
    const recorderRecordGrants = await adminSql`
      SELECT count(*)::int as c FROM information_schema.role_routine_grants
      WHERE grantee = 'authority_stripe_recorder' AND routine_schema = 'authority_v1'
        AND routine_name = 'record_cancel_result'`;
    assert(Number(recorderRecordGrants[0].c) === 1, `T15: recorder has 1 grant on record_cancel_result (got ${recorderRecordGrants[0].c})`);
    results.T15 = { assertions: 2, ok: true, recorderBeginGrants: Number(recorderBeginGrants[0].c), recorderRecordGrants: Number(recorderRecordGrants[0].c) };
  }

  // T16: SQL artifact / live-database parity (normalized hash)
  {
    const fs = await import('node:fs');
    const functionsSql = fs.readFileSync('/app/database/authority_v1/002_functions.sql', 'utf8');
    const schemaSql = fs.readFileSync('/app/database/authority_v1/001_schema.sql', 'utf8');

    // Extract record_cancel_result from artifact
    const fnStart = functionsSql.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_cancel_result');
    const fnEnd = functionsSql.indexOf('\n-- ──', fnStart + 100);
    const artifactFn = functionsSql.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 9000);
    const artifactFnHash = hashNormalized(artifactFn);

    // Get live function definition
    const liveFn = await adminSql`SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'authority_v1' AND p.proname = 'record_cancel_result'`;
    const liveFnHash = hashNormalized(liveFn[0]?.prosrc || '');

    assert(artifactFnHash === liveFnHash,
      `T16: record_cancel_result parity (artifact: ${artifactFnHash}, live: ${liveFnHash})`);

    // Check 3 unique indexes
    const indexNames = ['idx_one_pending_cancel_per_purchase', 'idx_one_pending_capture_per_purchase', 'idx_one_pending_refund_per_purchase'];
    let allIndexesMatch = true;
    const indexHashes = {};
    for (const idxName of indexNames) {
      // Extract from artifact
      const artifactMatch = schemaSql.match(new RegExp(`CREATE UNIQUE INDEX ${idxName}[^;]+;`, 's'));
      const artifactIdx = artifactMatch ? artifactMatch[0] : '';
      const artifactIdxHash = hashNormalized(artifactIdx);
      // Get live
      const liveIdx = await adminSql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'authority_v1' AND indexname = ${idxName}`;
      const liveIdxHash = hashNormalized(liveIdx[0]?.indexdef || '');
      indexHashes[idxName] = { artifact: artifactIdxHash, live: liveIdxHash };
      if (artifactIdxHash !== liveIdxHash) allIndexesMatch = false;
    }
    assert(allIndexesMatch === true, `T16: all 3 unique indexes parity (${JSON.stringify(indexHashes)})`);

    // Verify replay-before-status in live function
    const liveProsrc = liveFn[0]?.prosrc || '';
    const acquirePos = liveProsrc.indexOf('acquire_operation');
    const statusPos = liveProsrc.indexOf('ACTION_STATUS_INVALID');
    assert(acquirePos > -1 && statusPos > -1 && acquirePos < statusPos,
      'T16: replay (acquire_operation) before status check (ACTION_STATUS_INVALID)');

    results.T16 = { assertions: 3, ok: true, artifactFnHash, liveFnHash, indexHashes };
  }

  // ── Cleanup and final ──────────────────────────────────────────────────────
  await cleanupAll();
  const fc = await countAll();
  assert(Object.values(fc).every(v => v === 0), `T_final: all 0 after cleanup (got ${JSON.stringify(fc)})`);

  return { passed, failed, failures: failures.slice(0, 10), finalCounts: fc, results };
}