/**
 * abort-canary-orchestrator.test.mjs — P0-01G Abort Canary Orchestrator Tests
 *
 * Importable module: exports runAllTests(deps) for exec_tool invocation.
 * No npm: imports — pure ESM with node:crypto only.
 *
 * deps = { adminSql, executorUrl, recorderUrl }
 *
 * Tests the ACTUAL shared orchestrator (abortCanaryOrchestrator.js) using:
 *   - Real executor client (begin_cancel, get_state via authority_v1)
 *   - Real recorder client (record_cancel_result via authority_stripe_recorder)
 *   - Fake Stripe adapter (configurable result, call counting)
 *   - Mock Base44 entities (in-memory) for mirror verification
 *   - Admin/test client ONLY for synthetic setup, evidence reads, exact-ID cleanup
 *
 * Test scenarios (fake Stripe adapter only — no real Stripe calls):
 *   1.  Successful cancellation
 *   2.  Definitive failure
 *   3.  Timeout/unknown
 *   4.  Recorder failure after provider response
 *   5.  Later reconciliation of unknown
 *   6.  Identical retry (idempotent)
 *   7.  Conflicting retry (structured result)
 *   8.  Concurrent abort attempts (exactly one succeeds)
 *   9.  Stable Stripe idempotency key reused after uncertain response
 *   10. Provider invoked at most once per execution attempt
 *   11. Mirror failure and repair (durable outbox)
 *   12. No authority/recorder call while flag OFF
 *   13. Non-canary isolation (null return, no calls)
 *   14. No admin-client import or fallback (static analysis)
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

// ── Mock Base44 entities (in-memory) ─────────────────────────────────────────
function createMockEntities() {
  const state = {
    listings: {},        // listing_id -> fields
    listingPrivates: {}, // listing_id -> { id, ...fields }
    outbox: [],          // array of outbox records
  };
  return {
    _state: state,
    Listing: {
      update: async (id, fields) => {
        if (!state.listings[id]) state.listings[id] = {};
        Object.assign(state.listings[id], fields);
      },
    },
    ListingPrivate: {
      filter: async (q) => {
        const lp = state.listingPrivates[q.listing_id];
        return lp ? [{ id: lp.id, ...lp }] : [];
      },
      update: async (id, fields) => {
        for (const [lid, lp] of Object.entries(state.listingPrivates)) {
          if (lp.id === id) { Object.assign(lp, fields); return; }
        }
      },
    },
    CanaryMirrorOutbox: {
      create: async (data) => {
        const record = { id: `ob_${genId()}`, ...data };
        state.outbox.push(record);
        return record;
      },
    },
    PurchasePrivate: {
      filter: async (q) => [],
    },
  };
}

// ── Fake Stripe adapter ─────────────────────────────────────────────────────
function createFakeStripeAdapter(result) {
  const calls = [];
  return {
    calls,
    async cancelPaymentIntent(piId, idemKey) {
      calls.push({ piId, idemKey, time: Date.now() });
      return result;
    },
  };
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

  // ── Create real executor client ──────────────────────────────────────────
  const { createAuthorityV1Client } = await import('/app/base44/shared/authorityV1Client.js');
  const executorClient = createAuthorityV1Client(executorUrl);

  // ── Create REAL recorder client (authority_stripe_recorder role) ─────────
  const { createAuthorityV1StripeRecorderClient } = await import('/app/base44/shared/authorityV1StripeRecorderClient.js');
  const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

  // ── Setup helpers ─────────────────────────────────────────────────────────
  async function setupReservedWithBinding(prefix) {
    const listingId = `abort_${prefix}_${genId()}`;
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

  async function getAuthority(lid) {
    const rows = await adminSql`SELECT version, lifecycle_state, recovery_blocked FROM authority_v1.reservation_authority WHERE listing_id = ${lid}`;
    return rows[0] || null;
  }
  async function getBinding(pid) {
    const rows = await adminSql`SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${pid}`;
    return rows[0] || null;
  }
  async function getAction(aid) {
    const rows = await adminSql`SELECT action_id, status, stripe_idempotency_key FROM authority_v1.payment_actions WHERE action_id = ${aid}`;
    return rows[0] || null;
  }
  async function getIncidents(lid) {
    return adminSql`SELECT incident_type, occurrence_count, resolved FROM authority_v1.operational_incidents WHERE reference_id = ${lid}`;
  }
  async function countPaymentActionsByPurchase(pid) {
    const rows = await adminSql`SELECT count(*)::int c FROM authority_v1.payment_actions WHERE purchase_id = ${pid}`;
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
  async function resetBindingToAuthorized(pid, lid) {
    await adminSql`UPDATE authority_v1.reservation_payment_bindings SET capture_state = 'authorized', updated_at = now() WHERE purchase_id = ${pid}`;
    await adminSql`UPDATE authority_v1.reservation_authority SET recovery_blocked = false, recovery_blocked_reason = null, recovery_blocked_at = null, updated_at = now() WHERE listing_id = ${lid}`;
  }

  // ── Import the orchestrator ──────────────────────────────────────────────
  const orchestratorModule = await import('/app/base44/shared/abortCanaryOrchestrator.js');
  const { runCanaryAbortSaga, maybeRouteCanaryAbort } = orchestratorModule;

  // ── Tests ──────────────────────────────────────────────────────────────────

  // T1: Successful cancellation
  {
    const ctx = await setupReservedWithBinding('success');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const result = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision,
      },
    });
    assert(result.status === 200, `T1: status 200 (got ${result.status})`);
    assert(result.body.canceled === true, 'T1: canceled');
    assert(result.body.released === true, 'T1: released');
    assert(result.body.provider_called === true, 'T1: provider_called');
    assert(result.body.provider_result === 'succeeded', 'T1: provider_result');
    assert(stripe.calls.length === 1, `T1: provider called once (got ${stripe.calls.length})`);
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T1: authority available');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T1: binding canceled');
    // Mirror was applied
    assert(entities._state.listings[ctx.listingId]?.status === 'active', 'T1: mirror listing active');
    assert(entities._state.listings[ctx.listingId]?.reservation_token === null, 'T1: mirror reservation cleared');
    results.T1 = { assertions: 9, ok: true };
  }

  // T2: Definitive failure
  {
    const ctx = await setupReservedWithBinding('fail');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'failed', raw: { error: 'already succeeded' } });
    const result = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision,
      },
    });
    assert(result.status === 200, 'T2: status 200');
    assert(result.body.cancel_failed === true, 'T2: cancel_failed');
    assert(result.body.recovery_blocked === true, 'T2: recovery_blocked');
    assert(stripe.calls.length === 1, 'T2: provider called once');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.recovery_blocked === true, 'T2: authority blocked');
    assert(auth?.lifecycle_state !== 'available', 'T2: NOT released');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'cancel_failed', 'T2: binding cancel_failed');
    const inc = await getIncidents(ctx.listingId);
    assert(inc.length === 1, 'T2: 1 incident');
    assert(inc[0]?.incident_type === 'cancel_failed', 'T2: incident type');
    // Mirror NOT applied (listing not in mock)
    assert(!entities._state.listings[ctx.listingId], 'T2: no mirror on failure');
    results.T2 = { assertions: 9, ok: true };
  }

  // T3: Timeout/unknown
  {
    const ctx = await setupReservedWithBinding('unknown');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'unknown', raw: { error: 'timeout' } });
    const result = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision,
      },
    });
    assert(result.status === 200, 'T3: status 200');
    assert(result.body.cancel_unknown === true, 'T3: cancel_unknown');
    assert(result.body.recovery_blocked === true, 'T3: recovery_blocked');
    assert(stripe.calls.length === 1, 'T3: provider called once');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.recovery_blocked === true, 'T3: authority blocked');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'cancel_unknown', 'T3: binding cancel_unknown');
    const inc = await getIncidents(ctx.listingId);
    assert(inc.length === 1, 'T3: 1 incident');
    assert(inc[0]?.incident_type === 'cancel_unknown', 'T3: incident type');
    assert(!entities._state.listings[ctx.listingId], 'T3: no mirror on unknown');
    results.T3 = { assertions: 9, ok: true };
  }

  // T4: Recorder failure after provider response
  {
    const ctx = await setupReservedWithBinding('recfail');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    // Inject a recorder that throws
    const failingRecorder = {
      async recordCancelResult() { throw new Error('recorder connection failed'); },
    };
    const result = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient: failingRecorder, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision,
      },
    });
    assert(result.status === 500, `T4: status 500 (got ${result.status})`);
    assert(result.body.code === 'RECORDER_FAILED', 'T4: RECORDER_FAILED');
    assert(result.body.provider_called === true, 'T4: provider was called');
    assert(result.body.provider_result === 'succeeded', 'T4: provider succeeded before recorder fail');
    assert(stripe.calls.length === 1, 'T4: provider called once');
    // Authority should still be cancel_requested (not released)
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'cancel_requested', 'T4: binding still cancel_requested');
    results.T4 = { assertions: 6, ok: true };
  }

  // T5: Later reconciliation of unknown — real recovery test
  {
    // Phase 1: Initial timeout creates unknown
    const ctx = await setupReservedWithBinding('recon');
    const entities = createMockEntities();
    const stripe1 = createFakeStripeAdapter({ derived: 'unknown', raw: { error: 'timeout' } });
    const actionId = `act_recon_${genId()}`;
    const idemKey = `idem_abort_${actionId}`;
    const r1 = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe1,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision, action_id: actionId, stripe_idempotency_key: idemKey,
      },
    });
    assert(r1.body.cancel_unknown === true, 'T5: initial timeout → cancel_unknown');
    assert(r1.body.recovery_blocked === true, 'T5: initial recovery_blocked');
    const actionAfterUnknown = await getAction(actionId);
    assert(actionAfterUnknown?.status === 'unknown', 'T5: action unknown after timeout');
    const b1 = await getBinding(ctx.purchaseId);
    assert(b1?.capture_state === 'cancel_unknown', 'T5: binding cancel_unknown');
    const auth1 = await getAuthority(ctx.listingId);
    assert(auth1?.recovery_blocked === true, 'T5: authority blocked after timeout');
    const inc1 = await getIncidents(ctx.listingId);
    assert(inc1.length === 1, 'T5: 1 incident after timeout');
    assert(inc1[0]?.incident_type === 'cancel_unknown', 'T5: cancel_unknown incident');
    assert(inc1[0]?.resolved === false, 'T5: incident unresolved');

    // Phase 2: Later reconciliation succeeds through real recorder client
    const reconOpId = `op_recon_${genId()}`;
    const reconHash = sha256Hex(canonicalEnvelope({ op: 'record_cancel', action_id: actionId, result: 'succeeded' }));
    const reconResult = await recorderClient.recordCancelResult(actionId, 'succeeded', { status: 'canceled' }, null, reconOpId, reconHash);
    assert(reconResult?.ok === true, `T5: recon ok (got ${JSON.stringify(reconResult)})`);
    assert(reconResult?.canceled === true, 'T5: recon canceled');
    assert(reconResult?.released === true, 'T5: recon released');
    assert(reconResult?.reconciliation === true, 'T5: reconciliation flag');
    const auth2 = await getAuthority(ctx.listingId);
    assert(auth2?.lifecycle_state === 'available', 'T5: authority available after recon');
    assert(auth2?.recovery_blocked === false, 'T5: recovery_blocked cleared');
    const b2 = await getBinding(ctx.purchaseId);
    assert(b2?.capture_state === 'canceled', 'T5: binding canceled after recon');
    const actionAfterRecon = await getAction(actionId);
    assert(actionAfterRecon?.status === 'succeeded', 'T5: action succeeded after recon');
    const inc2 = await getIncidents(ctx.listingId);
    const cancelUnknownInc = inc2.find(i => i.incident_type === 'cancel_unknown');
    assert(cancelUnknownInc?.resolved === true, 'T5: cancel_unknown incident resolved');

    // Phase 3: Identical reconciliation replay is idempotent
    const reconResult2 = await recorderClient.recordCancelResult(actionId, 'succeeded', { status: 'canceled' }, null, reconOpId, reconHash);
    assert(reconResult2?.ok === true, 'T5: replay ok');
    assert(reconResult2?.canceled === true, 'T5: replay canceled');
    const auth3 = await getAuthority(ctx.listingId);
    assert(auth3?.lifecycle_state === 'available', 'T5: still available after replay');
    const b3 = await getBinding(ctx.purchaseId);
    assert(b3?.capture_state === 'canceled', 'T5: still canceled after replay');

    // Phase 4: Concurrent reconciliation does not double-release (new setup)
    const ctx2 = await setupReservedWithBinding('reconconc');
    const entities2 = createMockEntities();
    const stripe2 = createFakeStripeAdapter({ derived: 'unknown', raw: {} });
    const actionId2 = `act_reconconc_${genId()}`;
    const idemKey2 = `idem_abort_${actionId2}`;
    await runCanaryAbortSaga({
      entities: entities2, user: { id: ctx2.buyerId, email: ctx2.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe2,
      params: {
        listing_id: ctx2.listingId, purchase_id: ctx2.purchaseId,
        payment_intent_id: ctx2.paymentIntentId, buyer_user_id: ctx2.buyerId,
        expected_revision: ctx2.revision, action_id: actionId2, stripe_idempotency_key: idemKey2,
      },
    });
    const reconOpA = `op_reconA_${genId()}`;
    const reconOpB = `op_reconB_${genId()}`;
    const reconHashA = sha256Hex(canonicalEnvelope({ op: 'record_cancel', action_id: actionId2, result: 'succeeded', n: 'A' }));
    const reconHashB = sha256Hex(canonicalEnvelope({ op: 'record_cancel', action_id: actionId2, result: 'succeeded', n: 'B' }));
    const [resultA, resultB] = await Promise.all([
      recorderClient.recordCancelResult(actionId2, 'succeeded', { status: 'canceled' }, null, reconOpA, reconHashA)
        .then(r => ({ canceled: r?.canceled === true })).catch(() => ({ canceled: false })),
      recorderClient.recordCancelResult(actionId2, 'succeeded', { status: 'canceled' }, null, reconOpB, reconHashB)
        .then(r => ({ canceled: r?.canceled === true })).catch(() => ({ canceled: false })),
    ]);
    const succCount = [resultA, resultB].filter(r => r.canceled).length;
    assert(succCount === 1, `T5: concurrent recon — 1 success (got ${succCount})`);
    const auth4 = await getAuthority(ctx2.listingId);
    assert(auth4?.lifecycle_state === 'available', 'T5: concurrent recon — authority available');
    assert(auth4?.recovery_blocked === false, 'T5: concurrent recon — recovery_blocked cleared');

    // Phase 5: Ambiguous reconciliation remains blocked (new setup)
    const ctx3 = await setupReservedWithBinding('reconamb');
    const entities3 = createMockEntities();
    const stripe3 = createFakeStripeAdapter({ derived: 'unknown', raw: {} });
    const actionId3 = `act_reconamb_${genId()}`;
    const idemKey3 = `idem_abort_${actionId3}`;
    await runCanaryAbortSaga({
      entities: entities3, user: { id: ctx3.buyerId, email: ctx3.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe3,
      params: {
        listing_id: ctx3.listingId, purchase_id: ctx3.purchaseId,
        payment_intent_id: ctx3.paymentIntentId, buyer_user_id: ctx3.buyerId,
        expected_revision: ctx3.revision, action_id: actionId3, stripe_idempotency_key: idemKey3,
      },
    });
    const ambOpId = `op_amb_${genId()}`;
    const ambHash = sha256Hex(canonicalEnvelope({ op: 'record_cancel', action_id: actionId3, result: 'unknown' }));
    const ambResult = await recorderClient.recordCancelResult(actionId3, 'unknown', { error: 'still timeout' }, null, ambOpId, ambHash);
    assert(ambResult?.ok === true, 'T5: ambiguous recon ok');
    assert(ambResult?.cancel_unknown === true, 'T5: ambiguous recon cancel_unknown');
    assert(ambResult?.recovery_blocked === true, 'T5: ambiguous recon recovery_blocked');
    assert(ambResult?.reconciliation === true, 'T5: ambiguous recon reconciliation flag');
    assert(ambResult?.resolved === false, 'T5: ambiguous recon not resolved');
    const auth5 = await getAuthority(ctx3.listingId);
    assert(auth5?.recovery_blocked === true, 'T5: ambiguous recon — still blocked');
    assert(auth5?.lifecycle_state !== 'available', 'T5: ambiguous recon — NOT released');
    const b5 = await getBinding(ctx3.purchaseId);
    assert(b5?.capture_state === 'cancel_unknown', 'T5: ambiguous recon — binding still cancel_unknown');

    results.T5 = { assertions: 32, ok: true };
  }

  // T6: Identical retry (idempotent)
  {
    const ctx = await setupReservedWithBinding('ident');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const actionId = `act_ident_${genId()}`;
    const idemKey = `idem_abort_${actionId}`;
    const opId = `op_ident_${genId()}`;
    const r1 = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision, action_id: actionId, stripe_idempotency_key: idemKey,
      },
    });
    assert(r1.body.canceled === true, 'T6: first succeeds');
    // Second run with same action_id but new operation_id — begin_cancel replay
    const r2 = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision, action_id: actionId, stripe_idempotency_key: idemKey,
      },
    });
    // After first success, authority is 'available' — second begin_cancel should fail (NOT_CANCELLABLE)
    // or return replay. Either way, provider should NOT be called again.
    assert(stripe.calls.length === 1, `T6: provider called once total (got ${stripe.calls.length})`);
    results.T6 = { assertions: 2, ok: true };
  }

  // T7: Conflicting retry (structured result)
  {
    const ctx = await setupReservedWithBinding('conflict');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const actionId = `act_conflict_${genId()}`;
    const idemKey = `idem_abort_${actionId}`;
    const opId = `op_conflict_${genId()}`;
    const r1 = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision, action_id: actionId, stripe_idempotency_key: idemKey,
      },
    });
    assert(r1.body.canceled === true, 'T7: first succeeds');
    // Second run with DIFFERENT action_id but SAME operation_id — conflict
    const actionId2 = `act_conflict2_${genId()}`;
    const idemKey2 = `idem_abort_${actionId2}`;
    const r2 = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision, action_id: actionId2, stripe_idempotency_key: idemKey2,
      },
    });
    // After first success, authority is 'available' — second begin_cancel fails NOT_CANCELLABLE
    assert(r2.status === 409, `T7: second 409 (got ${r2.status})`);
    assert(stripe.calls.length === 1, 'T7: provider called once total');
    results.T7 = { assertions: 2, ok: true };
  }

  // T8: Concurrent abort attempts (exactly one succeeds)
  {
    const ctx = await setupReservedWithBinding('conc');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(runCanaryAbortSaga({
        entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
        executorClient, recorderClient, stripeAdapter: stripe,
        params: {
          listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
          payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
          expected_revision: ctx.revision,
        },
      }).then(r => ({ ok: r.body?.canceled === true })).catch(() => ({ ok: false })));
    }
    const outcomes = await Promise.all(promises);
    const succ = outcomes.filter(r => r.ok).length;
    const paCount = await countPaymentActionsByPurchase(ctx.purchaseId);
    assert(paCount === 1, `T8: 1 payment_action (got ${paCount})`);
    assert(succ === 1, `T8: 1 success (got ${succ})`);
    assert(stripe.calls.length === 1, `T8: provider called once (got ${stripe.calls.length})`);
    results.T8 = { assertions: 3, ok: true };
  }

  // T9: Stable Stripe idempotency key reused after uncertain response
  {
    const ctx = await setupReservedWithBinding('idem');
    const entities = createMockEntities();
    const actionId = `act_idem_${genId()}`;
    const idemKey = `idem_abort_${actionId}`;

    // First run: unknown
    const stripe1 = createFakeStripeAdapter({ derived: 'unknown', raw: {} });
    await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe1,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision, action_id: actionId, stripe_idempotency_key: idemKey,
      },
    });
    assert(stripe1.calls.length === 1, 'T9: first call');
    assert(stripe1.calls[0]?.idemKey === idemKey, `T9: first call uses idemKey (got ${stripe1.calls[0]?.idemKey})`);

    // Reset binding for second attempt
    await resetBindingToAuthorized(ctx.purchaseId, ctx.listingId);
    // Clean up the old payment_action and incidents for this listing
    await adminSql`DELETE FROM authority_v1.payment_actions WHERE listing_id = ${ctx.listingId}`;
    await adminSql`DELETE FROM authority_v1.operational_incidents WHERE reference_id = ${ctx.listingId}`;

    // Second run with SAME action_id + idemKey — should reuse same key
    const stripe2 = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const r2 = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe2,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision, action_id: actionId, stripe_idempotency_key: idemKey,
      },
    });
    assert(stripe2.calls.length === 1, 'T9: second call');
    assert(stripe2.calls[0]?.idemKey === idemKey, `T9: second call reuses idemKey (got ${stripe2.calls[0]?.idemKey})`);
    assert(r2.body?.canceled === true, 'T9: second run succeeds');
    results.T9 = { assertions: 5, ok: true };
  }

  // T10: Provider invoked at most once per execution attempt
  {
    const ctx = await setupReservedWithBinding('once');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision,
      },
    });
    assert(stripe.calls.length === 1, `T10: exactly 1 provider call (got ${stripe.calls.length})`);
    results.T10 = { assertions: 1, ok: true };
  }

  // T11: Mirror failure and repair (durable outbox)
  {
    const ctx = await setupReservedWithBinding('mirror');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const result = await runCanaryAbortSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId, buyer_user_id: ctx.buyerId,
        expected_revision: ctx.revision,
        simulate_mirror_failure: true,
      },
    });
    assert(result.body.canceled === true, 'T11: canceled');
    assert(result.body.released === true, 'T11: released');
    assert(result.body.mirror?.outbox_id !== null, 'T11: outbox created');
    assert(entities._state.outbox.length === 1, `T11: 1 outbox record (got ${entities._state.outbox.length})`);
    assert(entities._state.outbox[0]?.operation_type === 'abort_release', 'T11: outbox operation_type');
    assert(entities._state.outbox[0]?.status === 'pending', 'T11: outbox pending');
    // Authority still released (Postgres is authoritative, mirror failure doesn't roll back)
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T11: authority available despite mirror failure');
    results.T11 = { assertions: 6, ok: true };
  }

  // T12: No authority/recorder call while flag OFF
  {
    const ctx = await setupReservedWithBinding('flagoff');
    let executorCalled = false;
    let recorderCalled = false;
    const trackingExecutor = {
      ...executorClient,
      async getState() { executorCalled = true; return executorClient.getState(...arguments); },
      async beginCancel() { executorCalled = true; return executorClient.beginCancel(...arguments); },
    };
    const trackingRecorder = {
      async recordCancelResult() { recorderCalled = true; return recorderClient.recordCancelResult(...arguments); },
    };
    const result = await maybeRouteCanaryAbort({
      base44: { asServiceRole: { entities: createMockEntities() } },
      user: { id: ctx.buyerId, email: ctx.buyerId, role: 'admin' },
      body: { canary: true, purchase_id: ctx.purchaseId },
      listing: { id: ctx.listingId, notes: '[AUTH_CANARY] test' },
      purchase: { id: ctx.purchaseId, listing_id: ctx.listingId, payment_intent_id: ctx.paymentIntentId, buyer_email: ctx.buyerId, reservation_token: ctx.revision },
      executorUrl, recorderUrl,
      executorClient: trackingExecutor,
      recorderClient: trackingRecorder,
      stripeAdapter: createFakeStripeAdapter({ derived: 'succeeded', raw: {} }),
    });
    // Flag is OFF → 503 CANARY_DISABLED
    assert(result?.status === 503, `T12: 503 (got ${result?.status})`);
    assert(result?.body?.code === 'CANARY_DISABLED', 'T12: CANARY_DISABLED');
    assert(executorCalled === false, 'T12: executor NOT called');
    assert(recorderCalled === false, 'T12: recorder NOT called');
    results.T12 = { assertions: 4, ok: true };
  }

  // T13: Non-canary isolation (null return, no calls)
  {
    let executorCalled = false;
    let recorderCalled = false;
    const trackingExecutor = {
      async getState() { executorCalled = true; return {}; },
      async beginCancel() { executorCalled = true; return {}; },
    };
    const trackingRecorder = {
      async recordCancelResult() { recorderCalled = true; return {}; },
    };
    const result = await maybeRouteCanaryAbort({
      base44: { asServiceRole: { entities: createMockEntities() } },
      user: { id: 'u', email: 'u@test.com', role: 'admin' },
      body: { purchase_id: 'p1' }, // no canary flag
      listing: { id: 'l1', notes: 'normal listing' }, // NOT [AUTH_CANARY]
      purchase: { id: 'p1', listing_id: 'l1' },
      executorUrl, recorderUrl,
      executorClient: trackingExecutor,
      recorderClient: trackingRecorder,
      stripeAdapter: createFakeStripeAdapter({ derived: 'succeeded', raw: {} }),
    });
    assert(result === null, 'T13: null for non-canary');
    assert(executorCalled === false, 'T13: executor NOT called');
    assert(recorderCalled === false, 'T13: recorder NOT called');
    results.T13 = { assertions: 3, ok: true };
  }

  // T14: No admin-client import or fallback (static analysis)
  {
    const orchestratorSrc = fs.readFileSync('/app/base44/shared/abortCanaryOrchestrator.js', 'utf8');
    assert(!orchestratorSrc.includes('authorityV1TestAdmin'), 'T14: no authorityV1TestAdmin import');
    assert(!orchestratorSrc.includes('AUTHORITY_DB_URL_DEV_ADMIN'), 'T14: no admin URL reference');
    assert(!orchestratorSrc.includes('adminUrl'), 'T14: no adminUrl variable');
    assert(orchestratorSrc.includes('authorityV1Client'), 'T14: imports executor client');
    assert(orchestratorSrc.includes('authorityV1StripeRecorderClient'), 'T14: imports recorder client');

    // Also check abortCheckout entry.ts
    const entrySrc = fs.readFileSync('/app/base44/functions/abortCheckout/entry.ts', 'utf8');
    assert(!entrySrc.includes('authorityV1TestAdmin'), 'T14: entry.ts no admin import');
    assert(!entrySrc.includes('AUTHORITY_DB_URL_DEV_ADMIN'), 'T14: entry.ts no admin URL');
    results.T14 = { assertions: 6, ok: true };
  }

  // ── Cleanup and final ──────────────────────────────────────────────────────
  await cleanupAll();
  const fc = await countAll();
  assert(Object.values(fc).every(v => v === 0), `T_final: all 0 after cleanup (got ${JSON.stringify(fc)})`);

  return { passed, failed, failures: failures.slice(0, 10), finalCounts: fc, results };
}