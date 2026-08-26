/**
 * capture-finalize-atomicity.test.mjs — P0-01G+ Atomic Capture Finalization Tests
 *
 * Importable module: exports runAllTests(deps) for exec_tool invocation.
 * No npm: imports — pure ESM with node:crypto only.
 *
 * deps = { adminSql, executorUrl, recorderUrl }
 *
 * Proves that record_capture_result(succeeded) atomically records the provider
 * result AND completes every authoritative sale-finalization mutation in ONE
 * database transaction — with no required second finalize_sale call.
 *
 * Test scenarios (fake Stripe/provider evidence only — no real provider calls):
 *   1.  Successful capture atomically reaches fully finalized state
 *   2.  Injected failure leaves both capture and sale uncommitted
 *   3.  Identical replay is idempotent
 *   4.  Changed-payload replay is rejected
 *   5.  Concurrent successful results finalize exactly once
 *   6.  Recorder direct finalize_sale call is permission denied
 *   7.  Executor direct finalize_sale call is permission denied
 *   8.  Recorder retains only result-recording functions and zero table grants
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

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

export async function runAllTests(deps) {
  const { adminSql, executorUrl, recorderUrl } = deps;

  let passed = 0, failed = 0;
  const failures = [];
  const results = {};

  function assert(cond, msg) {
    if (cond) { passed++; }
    else { failed++; failures.push(msg); }
  }

  // ── Create real executor client (for fingerprint) ────────────────────────
  const { createAuthorityV1Client } = await import('/app/base44/shared/authorityV1Client.js');
  const executorClient = createAuthorityV1Client(executorUrl);

  // ── Create real recorder client ──────────────────────────────────────────
  const { createAuthorityV1StripeRecorderClient } = await import('/app/base44/shared/authorityV1StripeRecorderClient.js');
  const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

  // ── Neon connections for direct calls ─────────────────────────────────────
  const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
  const execSql = neon(executorUrl);
  const recSql = neon(recorderUrl);

  // ── Direct begin_capture via executor connection (executor-granted) ──────
  async function beginCaptureDirect(ctx, actionId, idemKey) {
    const opId = `op_begin_${genId()}`;
    const requestHash = sha256Hex(canonicalEnvelope({
      op: 'begin_capture', listing_id: ctx.listingId, expected_version: 1,
      purchase_id: ctx.purchaseId, payment_intent_id: ctx.paymentIntentId,
      buyer_user_id: ctx.buyerId, expected_revision: ctx.revision,
      action_id: actionId, idem_key: idemKey,
    }));
    const rows = await execSql(
      `SELECT authority_v1.begin_capture($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as result`,
      [ctx.listingId, 1, ctx.purchaseId, ctx.paymentIntentId, ctx.buyerId,
       ctx.revision, actionId, idemKey, opId, requestHash]
    );
    return rows[0]?.result;
  }

  // ── Setup helpers ─────────────────────────────────────────────────────────
  async function setupFrozenWithCaptureAction(prefix) {
    const listingId = `capfin_${prefix}_${genId()}`;
    const sellerId = `seller_${prefix}`;
    const buyerId = `buyer_${prefix}`;
    const tokenHash = sha256Hex(`token_${prefix}_${genId()}`);
    const revision = genId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const purchaseId = `pur_${prefix}_${genId()}`;
    const paymentIntentId = `pi_${prefix}_${genId()}`;
    const actionId = `act_cap_${prefix}_${genId()}`;
    const idemKey = `idem_cap_${actionId}`;

    // Insert authority in 'reserved' state
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

    // Insert binding in 'authorized' state
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

    // Call begin_capture to freeze authority and create capture action
    const beginResult = await beginCaptureDirect(
      { listingId, buyerId, purchaseId, paymentIntentId, revision },
      actionId, idemKey,
    );

    if (!beginResult?.ok) {
      throw new Error(`begin_capture failed: ${JSON.stringify(beginResult)}`);
    }

    return {
      listingId, sellerId, buyerId, tokenHash, revision, expiresAt,
      purchaseId, paymentIntentId, actionId, idemKey,
      frozenVersion: beginResult.version,
      frozenRevision: beginResult.revision,
    };
  }

  async function recordCapture(actionId, resultDerived, stripeResponse, opId, requestHash) {
    return recorderClient.recordCaptureResult(
      actionId, resultDerived, stripeResponse, null, opId, requestHash,
    );
  }

  // ── State helpers ──────────────────────────────────────────────────────────
  async function getAuthority(lid) {
    const rows = await adminSql`SELECT version, lifecycle_state, recovery_blocked FROM authority_v1.reservation_authority WHERE listing_id = ${lid}`;
    return rows[0] || null;
  }
  async function getBinding(pid) {
    const rows = await adminSql`SELECT capture_state, freeze_finalized_at FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${pid}`;
    return rows[0] || null;
  }
  async function getAction(aid) {
    const rows = await adminSql`SELECT action_id, status FROM authority_v1.payment_actions WHERE action_id = ${aid}`;
    return rows[0] || null;
  }
  async function getOutboxCount(lid) {
    const rows = await adminSql`SELECT count(*)::int c FROM authority_v1.reservation_outbox WHERE listing_id = ${lid}`;
    return Number(rows[0]?.c || 0);
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

  // T1: Successful capture atomically reaches fully finalized state
  {
    const ctx = await setupFrozenWithCaptureAction('success');
    const opId = `op_rec_${genId()}`;
    const requestHash = sha256Hex(canonicalEnvelope({
      op: 'record_capture', action_id: ctx.actionId, result: 'succeeded',
    }));
    const result = await recordCapture(ctx.actionId, 'succeeded', { status: 'succeeded' }, opId, requestHash);

    assert(result?.ok === true, `T1: ok (got ${JSON.stringify(result)})`);
    assert(result?.captured === true, 'T1: captured');
    assert(result?.finalized === true, 'T1: finalized');
    assert(result?.version !== undefined, 'T1: version returned');

    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'sold', `T1: authority sold (got ${auth?.lifecycle_state})`);

    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'finalized', `T1: binding finalized (got ${b?.capture_state})`);
    assert(b?.freeze_finalized_at !== null, 'T1: freeze_finalized_at set');

    const action = await getAction(ctx.actionId);
    assert(action?.status === 'succeeded', `T1: action succeeded (got ${action?.status})`);

    // Outbox events: 1 from begin_capture (frozen mirror) + 3 from record_capture_result
    // (mirror_project + notification_dispatch + point_award) = 4 total
    const outboxCount = await getOutboxCount(ctx.listingId);
    assert(outboxCount === 4, `T1: 4 outbox events (got ${outboxCount})`);

    results.T1 = { assertions: 8, ok: true };
  }

  // T2: Injected failure leaves both capture and sale uncommitted
  {
    const ctx = await setupFrozenWithCaptureAction('fail');
    // Corrupt the binding state so the binding UPDATE in record_capture_result
    // affects 0 rows → RAISE EXCEPTION → entire transaction rolls back
    await adminSql`UPDATE authority_v1.reservation_payment_bindings
      SET capture_state = 'failed', updated_at = now()
      WHERE purchase_id = ${ctx.purchaseId}`;

    const opId = `op_recfail_${genId()}`;
    const requestHash = sha256Hex(canonicalEnvelope({
      op: 'record_capture', action_id: ctx.actionId, result: 'succeeded',
    }));

    // P0-01I: record_capture_result may return a structured BINDING_STATE_MISMATCH
    // result (no exception) OR raise an exception (injected failure). Either is
    // acceptable as long as no state mutated.
    let threw = false;
    let structuredResult = null;
    try {
      structuredResult = await recordCapture(ctx.actionId, 'succeeded', { status: 'succeeded' }, opId, requestHash);
    } catch (e) {
      threw = true;
    }
    assert(threw === true || (structuredResult?.ok === false && structuredResult?.code === 'BINDING_STATE_MISMATCH'),
      `T2: exception or BINDING_STATE_MISMATCH (got threw=${threw}, result=${JSON.stringify(structuredResult)})`);

    // Action status should be unchanged: 'pending' (not 'succeeded')
    const action = await getAction(ctx.actionId);
    assert(action?.status === 'pending', `T2: action unchanged/pending (got ${action?.status})`);

    // Authority should still be 'frozen' (not 'sold')
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'frozen', `T2: authority still frozen (got ${auth?.lifecycle_state})`);

    // Binding should still be 'failed' (not 'finalized')
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'failed', `T2: binding still failed (got ${b?.capture_state})`);

    // Only 1 outbox event from begin_capture (frozen mirror); record_capture rolled back
    const outboxCount = await getOutboxCount(ctx.listingId);
    assert(outboxCount === 1, `T2: 1 outbox event from begin_capture (got ${outboxCount})`);

    results.T2 = { assertions: 5, ok: true };
  }

  // T3: Identical replay is idempotent
  {
    const ctx = await setupFrozenWithCaptureAction('idem');
    const opId = `op_idem_${genId()}`;
    const requestHash = sha256Hex(canonicalEnvelope({
      op: 'record_capture', action_id: ctx.actionId, result: 'succeeded',
    }));

    const r1 = await recordCapture(ctx.actionId, 'succeeded', { status: 'succeeded' }, opId, requestHash);
    assert(r1?.ok === true, 'T3: first call ok');
    assert(r1?.finalized === true, 'T3: first call finalized');

    // Identical replay (same opId + same requestHash)
    const r2 = await recordCapture(ctx.actionId, 'succeeded', { status: 'succeeded' }, opId, requestHash);
    assert(r2?.ok === true, 'T3: replay ok');
    assert(r2?.finalized === true, 'T3: replay finalized');

    // Authority still sold (not double-finalized)
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'sold', 'T3: authority still sold');

    // 4 outbox events: 1 from begin_capture + 3 from first call (replay adds 0)
    const outboxCount = await getOutboxCount(ctx.listingId);
    assert(outboxCount === 4, `T3: 4 outbox events (got ${outboxCount})`);

    results.T3 = { assertions: 5, ok: true };
  }

  // T4: Changed-payload replay is rejected
  {
    const ctx = await setupFrozenWithCaptureAction('conflict');
    const opId = `op_conflict_${genId()}`;
    const hash1 = sha256Hex(canonicalEnvelope({
      op: 'record_capture', action_id: ctx.actionId, result: 'succeeded', n: 1,
    }));

    const r1 = await recordCapture(ctx.actionId, 'succeeded', { status: 'succeeded' }, opId, hash1);
    assert(r1?.ok === true, 'T4: first call ok');

    // Changed-payload replay (same opId, different requestHash)
    const hash2 = sha256Hex(canonicalEnvelope({
      op: 'record_capture', action_id: ctx.actionId, result: 'succeeded', n: 2,
    }));
    const r2 = await recordCapture(ctx.actionId, 'succeeded', { status: 'succeeded' }, opId, hash2);
    assert(r2?.ok === false, 'T4: changed-payload rejected');
    assert(r2?.code === 'OPERATION_ID_CONFLICT', `T4: OPERATION_ID_CONFLICT (got ${r2?.code})`);

    results.T4 = { assertions: 3, ok: true };
  }

  // T5: Concurrent successful results finalize exactly once
  {
    const ctx = await setupFrozenWithCaptureAction('conc');
    const promises = [];
    for (let i = 0; i < 20; i++) {
      const opId = `op_conc_${i}_${genId()}`;
      const requestHash = sha256Hex(canonicalEnvelope({
        op: 'record_capture', action_id: ctx.actionId, result: 'succeeded', n: i,
      }));
      promises.push(
        recordCapture(ctx.actionId, 'succeeded', { status: 'succeeded' }, opId, requestHash)
          .then(r => ({ ok: r?.ok === true, finalized: r?.finalized === true }))
          .catch(() => ({ ok: false, finalized: false }))
      );
    }
    const outcomes = await Promise.all(promises);
    const successCount = outcomes.filter(r => r.ok && r.finalized).length;
    assert(successCount === 1, `T5: exactly 1 success (got ${successCount})`);

    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'sold', 'T5: authority sold');

    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'finalized', 'T5: binding finalized');

    const outboxCount = await getOutboxCount(ctx.listingId);
    assert(outboxCount === 4, `T5: 4 outbox events (got ${outboxCount})`);

    results.T5 = { assertions: 4, ok: true };
  }

  // T6: Recorder direct finalize_sale call is permission denied
  {
    let permDenied = false;
    let errorMsg = '';
    try {
      await recSql`SELECT authority_v1.finalize_sale(
        'test_listing', 1, 'test_purchase', 'test_pi', 'test_buyer',
        'test_revision', 'test_op', 'test_hash'
      ) as result`;
    } catch (e) {
      permDenied = (e.message || '').includes('permission') || (e.message || '').includes('Permission');
      errorMsg = (e.message || '').slice(0, 100);
    }
    assert(permDenied === true, `T6: recorder finalize_sale permission denied (got: ${errorMsg})`);
    results.T6 = { assertions: 1, ok: true };
  }

  // T7: Executor direct finalize_sale call is permission denied
  {
    let permDenied = false;
    let errorMsg = '';
    try {
      await execSql`SELECT authority_v1.finalize_sale(
        'test_listing', 1, 'test_purchase', 'test_pi', 'test_buyer',
        'test_revision', 'test_op', 'test_hash'
      ) as result`;
    } catch (e) {
      permDenied = (e.message || '').includes('permission') || (e.message || '').includes('Permission');
      errorMsg = (e.message || '').slice(0, 100);
    }
    assert(permDenied === true, `T7: executor finalize_sale permission denied (got: ${errorMsg})`);
    results.T7 = { assertions: 1, ok: true };
  }

  // T8: Recorder retains only result-recording functions and zero table grants
  {
    // Check function grants
    const funcGrants = await adminSql`
      SELECT routine_name
      FROM information_schema.role_routine_grants
      WHERE grantee = 'authority_stripe_recorder'
        AND routine_schema = 'authority_v1'
      ORDER BY routine_name
    `;
    const grantedFunctions = funcGrants.map(r => r.routine_name);
    assert(grantedFunctions.length === 3, `T8: 3 function grants (got ${grantedFunctions.length}: ${JSON.stringify(grantedFunctions)})`);
    assert(grantedFunctions.includes('record_capture_result'), 'T8: record_capture_result granted');
    assert(grantedFunctions.includes('record_cancel_result'), 'T8: record_cancel_result granted');
    assert(grantedFunctions.includes('record_refund_result'), 'T8: record_refund_result granted');
    assert(!grantedFunctions.includes('finalize_sale'), 'T8: finalize_sale NOT granted');
    assert(!grantedFunctions.includes('acquire_operation'), 'T8: acquire_operation NOT granted');

    // Check table grants
    const tableGrants = await adminSql`
      SELECT count(*)::int c
      FROM information_schema.role_table_grants
      WHERE grantee = 'authority_stripe_recorder'
        AND table_schema = 'authority_v1'
    `;
    assert(Number(tableGrants[0]?.c || 0) === 0, `T8: 0 table grants (got ${tableGrants[0]?.c})`);

    // Verify recorder client does NOT expose finalizeSale method
    assert(typeof recorderClient.finalizeSale === 'undefined', 'T8: recorder client has no finalizeSale method');
    assert(typeof recorderClient.recordCaptureResult === 'function', 'T8: recorder client has recordCaptureResult');
    assert(typeof recorderClient.recordCancelResult === 'function', 'T8: recorder client has recordCancelResult');
    assert(typeof recorderClient.recordRefundResult === 'function', 'T8: recorder client has recordRefundResult');

    results.T8 = { assertions: 9, ok: true };
  }

  // ── Cleanup and final ──────────────────────────────────────────────────────
  await cleanupAll();
  const fc = await countAll();
  assert(Object.values(fc).every(v => v === 0), `T_final: all 0 after cleanup (got ${JSON.stringify(fc)})`);

  return { passed, failed, failures: failures.slice(0, 10), finalCounts: fc, results };
}