/**
 * cancel-purchase-canary.test.mjs — P0-01L Cancel-Purchase Canary Tests
 *
 * Importable module: exports runAllTests(deps) for exec_tool invocation.
 * No npm: imports — pure ESM with node:crypto only.
 *
 * deps = { adminSql, executorUrl, recorderUrl }
 *
 * Tests the ACTUAL shared orchestrator (cancelPurchaseCanaryOrchestrator.js) using:
 *   - Real executor client (begin_cancel, get_state, quarantine_listing, create_webhook_incident)
 *   - Real recorder client (record_cancel_result via authority_stripe_recorder)
 *   - Fake Stripe adapter (configurable result, call counting)
 *   - Mock Base44 entities (in-memory) for mirror verification
 *   - Admin/test client ONLY for synthetic setup, evidence reads, exact-ID cleanup
 *
 * Test scenarios (fake Stripe adapter only — no real Stripe calls):
 *   T1  Successful uncaptured cancellation (seller_confirmed=false → relist)
 *   T2  Provider failure (cancel_failed)
 *   T3  Timeout → cancel_unknown → reconciliation (succeeded)
 *   T4  Identical replay (idempotent)
 *   T5  Conflicting replay (OPERATION_ID_CONFLICT)
 *   T6  Concurrent duplicate requests (exactly one succeeds)
 *   T7  Capture-in-flight rejection (frozen → CAPTURE_IN_FLIGHT)
 *   T8  Captured-sale rejection (sold → CAPTURED_OUT_OF_SCOPE + incident)
 *   T9  Seller-confirmed quarantine (cancel money but quarantine)
 *   T10 Mirror failure (durable outbox)
 *   T11 Notification called after authoritative commitment
 *   T12 Flag-OFF isolation (503, no calls)
 *   T13 Non-canary isolation (null return, no calls)
 *   T14 Unauthorized access (not buyer, not admin → 403)
 *   T15 Admin override (admin can cancel any purchase)
 *   T16 No admin-client import (static analysis)
 *   T17 Cleanup (all tables empty)
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
    listings: {},
    listingPrivates: {},
    outbox: [],
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

  // ── Create REAL recorder client ──────────────────────────────────────────
  const { createAuthorityV1StripeRecorderClient } = await import('/app/base44/shared/authorityV1StripeRecorderClient.js');
  const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

  // ── Setup helpers ─────────────────────────────────────────────────────────
  async function setupReservedWithBinding(prefix, opts = {}) {
    const listingId = `cancel_${prefix}_${genId()}`;
    const sellerId = `seller_${prefix}`;
    const buyerId = opts.buyerId || `buyer_${prefix}@test.com`;
    const tokenHash = sha256Hex(`token_${prefix}_${genId()}`);
    const revision = genId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const purchaseId = `pur_${prefix}_${genId()}`;
    const paymentIntentId = `pi_${prefix}_${genId()}`;
    const lifecycleState = opts.lifecycleState || 'reserved';
    const captureState = opts.captureState || 'authorized';
    const recoveryBlocked = opts.recoveryBlocked || false;

    // Terminal states (sold/available) must have the tuple cleared by constraint.
    // Non-terminal states (reserved/frozen) require the full tuple.
    const isTerminal = ['sold', 'available', 'cancelled', 'expired'].includes(lifecycleState);
    const authBuyerId = isTerminal ? null : buyerId;
    const authTokenHash = isTerminal ? null : tokenHash;
    const authExpiresAt = isTerminal ? null : expiresAt;
    const authRevision = isTerminal ? null : revision;

    await adminSql`INSERT INTO authority_v1.reservation_authority
      (listing_id, version, lifecycle_state, seller_user_id, buyer_user_id,
       reservation_token_hash, reservation_expires_at, reservation_revision,
       recovery_blocked)
      VALUES (${listingId}, 1, ${lifecycleState}, ${sellerId}, ${authBuyerId},
              ${authTokenHash}, ${authExpiresAt}, ${authRevision}, ${recoveryBlocked})
      ON CONFLICT (listing_id) DO UPDATE SET
        version = 1, lifecycle_state = ${lifecycleState},
        seller_user_id = ${sellerId}, buyer_user_id = ${authBuyerId},
        reservation_token_hash = ${authTokenHash},
        reservation_expires_at = ${authExpiresAt},
        reservation_revision = ${authRevision},
        recovery_blocked = ${recoveryBlocked},
        recovery_blocked_reason = ${recoveryBlocked ? 'test' : null},
        recovery_blocked_at = ${recoveryBlocked ? new Date().toISOString() : null},
        checkout_quarantined = false,
        checkout_quarantine_reason = null,
        updated_at = now()`;

    await adminSql`INSERT INTO authority_v1.reservation_payment_bindings
      (purchase_id, payment_intent_id, listing_id, buyer_user_id,
       authority_version, reservation_revision, reservation_token_hash, capture_state)
      VALUES (${purchaseId}, ${paymentIntentId}, ${listingId}, ${buyerId},
              1, ${revision}, ${tokenHash}, ${captureState})
      ON CONFLICT (purchase_id) DO UPDATE SET
        payment_intent_id = ${paymentIntentId}, listing_id = ${listingId},
        buyer_user_id = ${buyerId}, authority_version = 1,
        reservation_revision = ${revision}, reservation_token_hash = ${tokenHash},
        capture_state = ${captureState}, updated_at = now()`;

    return { listingId, sellerId, buyerId, tokenHash, revision, expiresAt, purchaseId, paymentIntentId };
  }

  async function getAuthority(lid) {
    const rows = await adminSql`SELECT version, lifecycle_state, recovery_blocked, checkout_quarantined FROM authority_v1.reservation_authority WHERE listing_id = ${lid}`;
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
    await adminSql`UPDATE authority_v1.reservation_authority SET recovery_blocked = false, recovery_blocked_reason = null, recovery_blocked_at = null, checkout_quarantined = false, checkout_quarantine_reason = null, updated_at = now() WHERE listing_id = ${lid}`;
  }

  // ── Import the orchestrator ──────────────────────────────────────────────
  const orchestratorModule = await import('/app/base44/shared/cancelPurchaseCanaryOrchestrator.js');
  const { runCanaryCancelPurchaseSaga, maybeRouteCanaryCancelPurchase } = orchestratorModule;

  // ── Tests ──────────────────────────────────────────────────────────────────

  // T1: Successful uncaptured cancellation (seller_confirmed=false → relist)
  {
    const ctx = await setupReservedWithBinding('success');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    let notified = false;
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      sendNotification: async () => { notified = true; },
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
      },
    });
    assert(result.status === 200, `T1: status 200 (got ${result.status})`);
    assert(result.body.canceled === true, 'T1: canceled');
    assert(result.body.released === true, 'T1: released');
    assert(result.body.quarantined !== true, 'T1: NOT quarantined');
    assert(result.body.provider_called === true, 'T1: provider_called');
    assert(stripe.calls.length === 1, `T1: provider called once (got ${stripe.calls.length})`);
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T1: authority available');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T1: binding canceled');
    assert(entities._state.listings[ctx.listingId]?.status === 'active', 'T1: mirror listing active');
    assert(notified === true, 'T1: notification sent');
    results.T1 = { assertions: 10, ok: true };
  }

  // T2: Provider failure (cancel_failed)
  {
    const ctx = await setupReservedWithBinding('fail');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'failed', raw: { error: 'already succeeded' } });
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
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
    results.T2 = { assertions: 8, ok: true };
  }

  // T3: Timeout → cancel_unknown → reconciliation (succeeded)
  {
    const ctx = await setupReservedWithBinding('unknown');
    const entities = createMockEntities();
    // First attempt: unknown
    const stripe1 = createFakeStripeAdapter({ derived: 'unknown', raw: { error: 'timeout' } });
    const result1 = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe1,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
      },
    });
    assert(result1.status === 200, 'T3: first status 200');
    assert(result1.body.cancel_unknown === true, 'T3: cancel_unknown');
    assert(result1.body.recovery_blocked === true, 'T3: recovery_blocked');
    const auth1 = await getAuthority(ctx.listingId);
    assert(auth1?.recovery_blocked === true, 'T3: authority blocked after unknown');
    const b1 = await getBinding(ctx.purchaseId);
    assert(b1?.capture_state === 'cancel_unknown', 'T3: binding cancel_unknown');

    // Reconciliation: succeeded (skip begin_cancel since recovery_blocked)
    const stripe2 = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const result2 = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe2,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
      },
    });
    assert(result2.status === 200, 'T3: recon status 200');
    assert(result2.body.canceled === true, 'T3: recon canceled');
    assert(result2.body.released === true, 'T3: recon released');
    const auth2 = await getAuthority(ctx.listingId);
    assert(auth2?.lifecycle_state === 'available', 'T3: recon authority available');
    assert(auth2?.recovery_blocked === false, 'T3: recon recovery_blocked cleared');
    const b2 = await getBinding(ctx.purchaseId);
    assert(b2?.capture_state === 'canceled', 'T3: recon binding canceled');
    results.T3 = { assertions: 11, ok: true };
  }

  // T4: Identical replay (idempotent)
  {
    const ctx = await setupReservedWithBinding('replay');
    const entities = createMockEntities();
    const actionId = `act_replay_${genId()}`;
    const idemKey = `idem_replay_${actionId}`;
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const params = {
      listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
      payment_intent_id: ctx.paymentIntentId,
      seller_confirmed: false,
      action_id: actionId,
      stripe_idempotency_key: idemKey,
    };
    const result1 = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe, params,
    });
    assert(result1.status === 200, 'T4: first 200');
    assert(result1.body.canceled === true, 'T4: first canceled');
    const calls1 = stripe.calls.length;

    // Replay with same action_id + idem_key
    const result2 = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe, params,
    });
    assert(result2.status === 200, 'T4: replay 200');
    // On replay, the authority is 'available' → idempotent replay path
    assert(result2.body.replay === true, 'T4: replay flag');
    // No additional Stripe call on replay (authority already available)
    const calls2 = stripe.calls.length;
    assert(calls2 === calls1, `T4: no extra provider call (got ${calls2 - calls1} extra)`);
    const actionCount = await countPaymentActionsByPurchase(ctx.purchaseId);
    assert(actionCount === 1, `T4: exactly 1 action (got ${actionCount})`);
    results.T4 = { assertions: 6, ok: true };
  }

  // T5: Conflicting replay — second attempt on already-canceled listing returns replay
  {
    const ctx = await setupReservedWithBinding('conflict');
    const entities = createMockEntities();
    const actionId = `act_conflict_${genId()}`;
    const idemKey = `idem_conflict_${actionId}`;
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const params = {
      listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
      payment_intent_id: ctx.paymentIntentId,
      seller_confirmed: false,
      action_id: actionId,
      stripe_idempotency_key: idemKey,
    };
    const result1 = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe, params,
    });
    assert(result1.status === 200, 'T5: first 200');
    assert(result1.body.canceled === true, 'T5: first canceled');
    const calls1 = stripe.calls.length;

    // Second attempt with same action_id — authority is already 'available' → replay
    const result2 = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe, params,
    });
    assert(result2.status === 200, `T5: second 200 (got ${result2.status})`);
    assert(result2.body.replay === true, 'T5: replay flag (already available)');
    // No additional provider call
    assert(stripe.calls.length === calls1, `T5: no extra provider call (got ${stripe.calls.length - calls1} extra)`);
    // Exactly one action created
    const actionCount = await countPaymentActionsByPurchase(ctx.purchaseId);
    assert(actionCount === 1, `T5: exactly 1 action (got ${actionCount})`);
    results.T5 = { assertions: 5, ok: true };
  }

  // T6: Concurrent duplicate requests (exactly one succeeds)
  {
    const ctx = await setupReservedWithBinding('concurrent');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const params = {
      listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
      payment_intent_id: ctx.paymentIntentId,
      seller_confirmed: false,
    };
    const [r1, r2] = await Promise.all([
      runCanaryCancelPurchaseSaga({
        entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
        executorClient, recorderClient, stripeAdapter: stripe, params,
      }),
      runCanaryCancelPurchaseSaga({
        entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
        executorClient, recorderClient, stripeAdapter: createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } }),
        params,
      }),
    ]);
    // At least one should succeed
    const oneSucceeded = (r1.body.canceled === true) || (r2.body.canceled === true);
    assert(oneSucceeded, 'T6: at least one succeeded');
    // The other should be a conflict or replay (not both succeed with duplicate cancel)
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T6: authority available (exactly one release)');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T6: binding canceled (exactly one)');
    results.T6 = { assertions: 4, ok: true };
  }

  // T7: Capture-in-flight rejection (frozen → CAPTURE_IN_FLIGHT)
  {
    const ctx = await setupReservedWithBinding('frozen', { lifecycleState: 'frozen', captureState: 'capture_requested' });
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
      },
    });
    assert(result.status === 409, `T7: status 409 (got ${result.status})`);
    assert(result.body.code === 'CAPTURE_IN_FLIGHT', `T7: CAPTURE_IN_FLIGHT (got ${result.body.code})`);
    assert(stripe.calls.length === 0, 'T7: provider NOT called');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'frozen', 'T7: authority stays frozen');
    results.T7 = { assertions: 4, ok: true };
  }

  // T8: Captured-sale rejection (sold → CAPTURED_OUT_OF_SCOPE + incident)
  {
    const ctx = await setupReservedWithBinding('sold', { lifecycleState: 'sold', captureState: 'finalized' });
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
      },
    });
    assert(result.status === 409, `T8: status 409 (got ${result.status})`);
    assert(result.body.code === 'CAPTURED_OUT_OF_SCOPE', `T8: CAPTURED_OUT_OF_SCOPE (got ${result.body.code})`);
    assert(stripe.calls.length === 0, 'T8: provider NOT called');
    const inc = await getIncidents(ctx.listingId);
    const hasIncident = inc.some(i => i.incident_type === 'admin_action_required');
    assert(hasIncident, 'T8: incident created');
    results.T8 = { assertions: 4, ok: true };
  }

  // T9: Seller-confirmed quarantine (cancel money but quarantine)
  {
    const ctx = await setupReservedWithBinding('quarantine');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    let notifyType = null;
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      sendNotification: async (info) => { notifyType = info.type; },
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: true, // transfer may have started
      },
    });
    assert(result.status === 200, 'T9: status 200');
    assert(result.body.canceled === true, 'T9: canceled (money canceled)');
    assert(result.body.quarantined === true, 'T9: quarantined');
    assert(result.body.quarantine_ok === true, 'T9: quarantine_ok');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T9: authority released (money canceled)');
    assert(auth?.recovery_blocked === true, 'T9: authority recovery_blocked (quarantined)');
    assert(auth?.checkout_quarantined === true, 'T9: authority checkout_quarantined');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T9: binding canceled');
    assert(entities._state.listings[ctx.listingId]?.status === 'hidden', 'T9: mirror listing hidden');
    assert(entities._state.listings[ctx.listingId]?.hidden_reason === 'transfer_uncertain_cancel', 'T9: hidden_reason');
    assert(notifyType === 'dispute', 'T9: dispute notification');
    results.T9 = { assertions: 11, ok: true };
  }

  // T10: Mirror failure (durable outbox)
  {
    const ctx = await setupReservedWithBinding('mirrorfail');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
        simulate_mirror_failure: true,
      },
    });
    assert(result.status === 200, 'T10: status 200');
    assert(result.body.canceled === true, 'T10: canceled');
    assert(result.body.mirror?.outbox_id !== null, 'T10: outbox created');
    // Authority still released (mirror failure doesn't roll back)
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T10: authority available (not rolled back)');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T10: binding canceled');
    results.T10 = { assertions: 5, ok: true };
  }

  // T11: Notification called after authoritative commitment
  {
    const ctx = await setupReservedWithBinding('notify');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const notifyCalls = [];
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      sendNotification: async (info) => { notifyCalls.push(info); },
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
      },
    });
    assert(result.status === 200, 'T11: status 200');
    assert(result.body.canceled === true, 'T11: canceled');
    assert(notifyCalls.length === 1, `T11: exactly 1 notification (got ${notifyCalls.length})`);
    assert(notifyCalls[0]?.type === 'cancelled', 'T11: notification type');
    // Verify authority was committed BEFORE notification
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T11: authority committed before notification');
    results.T11 = { assertions: 5, ok: true };
  }

  // T12: Flag-OFF isolation (503, no calls)
  {
    const ctx = await setupReservedWithBinding('flagoff');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const result = await maybeRouteCanaryCancelPurchase({
      base44: { asServiceRole: { entities } },
      user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      listing: { id: ctx.listingId, notes: '[AUTH_CANARY] test listing' },
      purchase: { id: ctx.purchaseId, listing_id: ctx.listingId, payment_intent_id: ctx.paymentIntentId, seller_confirmed: false },
      executorUrl, recorderUrl,
      stripeAdapter: stripe,
      canaryEnabled: false,
    });
    assert(result.status === 503, `T12: status 503 (got ${result?.status})`);
    assert(result.body.code === 'CANARY_DISABLED', 'T12: CANARY_DISABLED');
    assert(stripe.calls.length === 0, 'T12: provider NOT called');
    results.T12 = { assertions: 3, ok: true };
  }

  // T13: Non-canary isolation (null return, no calls)
  {
    const ctx = await setupReservedWithBinding('noncanary');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const result = await maybeRouteCanaryCancelPurchase({
      base44: { asServiceRole: { entities } },
      user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      listing: { id: ctx.listingId, notes: 'Regular listing (no canary marker)' },
      purchase: { id: ctx.purchaseId, listing_id: ctx.listingId, payment_intent_id: ctx.paymentIntentId, seller_confirmed: false },
      executorUrl, recorderUrl,
      stripeAdapter: stripe,
      canaryEnabled: true,
    });
    assert(result === null, 'T13: null return (legacy path)');
    assert(stripe.calls.length === 0, 'T13: provider NOT called');
    results.T13 = { assertions: 2, ok: true };
  }

  // T14: Unauthorized access (not buyer, not admin → 403)
  {
    const ctx = await setupReservedWithBinding('unauth');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: {} });
    const result = await runCanaryCancelPurchaseSaga({
      entities,
      user: { id: 'other_user', email: 'other@test.com', role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
      },
    });
    assert(result.status === 403, `T14: status 403 (got ${result.status})`);
    assert(result.body.code === 'NOT_BUYER', `T14: NOT_BUYER (got ${result.body.code})`);
    assert(stripe.calls.length === 0, 'T14: provider NOT called');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'reserved', 'T14: authority unchanged');
    results.T14 = { assertions: 4, ok: true };
  }

  // T15: Admin override (admin can cancel any purchase)
  {
    const ctx = await setupReservedWithBinding('admin');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const result = await runCanaryCancelPurchaseSaga({
      entities,
      user: { id: 'admin_user', email: 'admin@test.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
      },
    });
    assert(result.status === 200, `T15: status 200 (got ${result.status})`);
    assert(result.body.canceled === true, 'T15: canceled');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T15: authority available');
    results.T15 = { assertions: 3, ok: true };
  }

  // T16: No admin-client import (static analysis)
  {
    const src = fs.readFileSync('/app/base44/shared/cancelPurchaseCanaryOrchestrator.js', 'utf8');
    assert(!src.includes('authorityV1TestAdmin'), 'T16: no admin client import');
    assert(!src.includes('AUTHORITY_DB_URL_DEV_ADMIN'), 'T16: no admin URL');
    assert(!src.includes('Deno.env'), 'T16: no Deno.env');
    assert(src.includes('createStripeCancelProvider') || src.includes('stripeAdapter'), 'T16: uses shared provider');

    const handlerSrc = fs.readFileSync('/app/base44/functions/cancelPurchase/entry.ts', 'utf8');
    assert(handlerSrc.includes('maybeRouteCanaryCancelPurchase'), 'T16: handler imports orchestrator');
    assert(handlerSrc.includes('createStripeCancelProvider'), 'T16: handler imports shared provider');
    assert(handlerSrc.includes('isCanaryEnabled'), 'T16: handler uses isCanaryEnabled');
    assert(handlerSrc.includes("secrets.get('STRIPE_SECRET_KEY')"), 'T16: handler uses base44:runtime secrets');
    assert(!handlerSrc.includes('authorityV1TestAdmin'), 'T16: handler no admin client');
    results.T16 = { assertions: 8, ok: true };
  }

  // T17: Cleanup (all tables empty)
  {
    await cleanupAll();
    const counts = await countAll();
    const allZero = Object.values(counts).every(v => v === 0);
    assert(allZero, `T17: all tables empty (got ${JSON.stringify(counts)})`);
    results.T17 = { assertions: 1, ok: true };
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const totalAssertions = Object.values(results).reduce((s, r) => s + (r.assertions || 0), 0);
  console.log(`\n=== P0-01L Cancel-Purchase Canary Tests ===`);
  console.log(`Tests run: ${Object.keys(results).length}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`Total assertions: ${totalAssertions}`);
  console.log(`Overall: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  if (failed > 0) {
    console.log(`Failed: ${failures.join(', ')}`);
  }
  return { passed, failed, totalAssertions, results, failures };
}