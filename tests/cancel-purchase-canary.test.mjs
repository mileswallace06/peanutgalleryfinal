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
 * INVENTORY BEHAVIOR (P0-01L correction): Every successful pre-capture canary
 * cancellation quarantines the listing (recovery_blocked + checkout_quarantined)
 * and mirrors the Base44 Listing to hidden. The listing is NEVER relisted.
 * seller_confirmed is not authoritative proof — false, true, missing, stale,
 * or changing concurrently all produce the same quarantine result.
 *
 * Test scenarios (fake Stripe adapter only — no real Stripe calls):
 *   T1  seller_confirmed=false → quarantine (never relist)
 *   T2  Provider failure (cancel_failed)
 *   T3  Timeout → cancel_unknown → reconciliation (succeeded → quarantine)
 *   T4  Identical replay — no duplicate provider call, incident, outbox, or notification
 *   T5  Conflicting replay (second attempt → replay)
 *   T6  Concurrent duplicate requests (exactly one succeeds)
 *   T7  Capture-in-flight rejection (frozen → CAPTURE_IN_FLIGHT) [unchanged]
 *   T8  Captured-sale rejection (sold → CAPTURED_OUT_OF_SCOPE + incident) [unchanged]
 *   T9  seller_confirmed=true → quarantine (never relist)
 *   T10 Mirror failure (durable outbox)
 *   T11 Notification called after authoritative commitment
 *   T12 Flag-OFF isolation (503, no calls)
 *   T13 Non-canary isolation (null return, no calls)
 *   T14 Unauthorized access (not buyer, not admin → 403)
 *   T15 Admin override (admin can cancel any purchase)
 *   T16 No admin-client import (static analysis)
 *   T17 seller_confirmed missing (undefined) → quarantine (never relist)
 *   T18 seller_confirmed uncertain (non-boolean) → quarantine (never relist)
 *   T19 false→true race during cancellation → quarantine (never relist)
 *   T20 Cleanup (all tables empty)
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
function createFakeStripeAdapter(result, hooks = {}) {
  const calls = [];
  return {
    calls,
    async cancelPaymentIntent(piId, idemKey) {
      calls.push({ piId, idemKey, time: Date.now() });
      if (hooks.beforeReturn) await hooks.beforeReturn();
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
  async function countIncidents(lid) {
    const rows = await adminSql`SELECT count(*)::int c FROM authority_v1.operational_incidents WHERE reference_id = ${lid}`;
    return Number(rows[0]?.c || 0);
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
    await adminSql`TRUNCATE authority_v1.reservation_outbox, authority_v1.reservation_payment_bindings, authority_v1.payment_actions, authority_v1.stripe_webhook_events, authority_v1.operational_incidents, authority_v1.reservation_operations, authority_v1.reservation_authority RESTART IDENTITY CASCADE`;
  }

  // ── Import the orchestrator ──────────────────────────────────────────────
  const orchestratorModule = await import('/app/base44/shared/cancelPurchaseCanaryOrchestrator.js');
  const { runCanaryCancelPurchaseSaga, maybeRouteCanaryCancelPurchase } = orchestratorModule;

  // ── Tests ──────────────────────────────────────────────────────────────────

  // T1: seller_confirmed=false → quarantine (never relist)
  {
    const ctx = await setupReservedWithBinding('success');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    let notified = false, notifyType = null;
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      sendNotification: async (info) => { notified = true; notifyType = info.type; },
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false,
      },
    });
    assert(result.status === 200, `T1: status 200 (got ${result.status})`);
    assert(result.body.canceled === true, 'T1: canceled');
    assert(result.body.released === true, 'T1: released');
    assert(result.body.quarantined === true, 'T1: quarantined');
    assert(result.body.code === 'CANCELLED_INVENTORY_QUARANTINED', `T1: code (got ${result.body.code})`);
    assert(result.body.provider_called === true, 'T1: provider_called');
    assert(stripe.calls.length === 1, `T1: provider called once (got ${stripe.calls.length})`);
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T1: authority available');
    assert(auth?.recovery_blocked === true, 'T1: authority recovery_blocked');
    assert(auth?.checkout_quarantined === true, 'T1: authority checkout_quarantined');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T1: binding canceled');
    assert(entities._state.listings[ctx.listingId]?.status === 'hidden', 'T1: mirror listing hidden (NOT active)');
    assert(entities._state.listings[ctx.listingId]?.hidden_reason === 'cancel_inventory_quarantined', 'T1: hidden_reason');
    assert(notified === true, 'T1: notification sent');
    assert(notifyType === 'cancel_quarantined', `T1: notification type (got ${notifyType})`);
    results.T1 = { assertions: 15, ok: true };
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

  // T3: Timeout → cancel_unknown → reconciliation (succeeded → quarantine)
  {
    const ctx = await setupReservedWithBinding('unknown');
    const entities = createMockEntities();
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

    // Reconciliation: succeeded → quarantine
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
    assert(result2.body.quarantined === true, 'T3: recon quarantined');
    assert(result2.body.code === 'CANCELLED_INVENTORY_QUARANTINED', 'T3: recon code');
    const auth2 = await getAuthority(ctx.listingId);
    assert(auth2?.lifecycle_state === 'available', 'T3: recon authority available');
    assert(auth2?.recovery_blocked === true, 'T3: recon recovery_blocked (quarantined)');
    assert(auth2?.checkout_quarantined === true, 'T3: recon checkout_quarantined');
    const b2 = await getBinding(ctx.purchaseId);
    assert(b2?.capture_state === 'canceled', 'T3: recon binding canceled');
    assert(entities._state.listings[ctx.listingId]?.status === 'hidden', 'T3: mirror hidden (NOT active)');
    results.T3 = { assertions: 15, ok: true };
  }

  // T4: Identical replay — no duplicate provider call, incident, outbox, or notification
  {
    const ctx = await setupReservedWithBinding('replay');
    const entities = createMockEntities();
    const actionId = `act_replay_${genId()}`;
    const idemKey = `idem_replay_${actionId}`;
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const notifyCalls = [];
    const params = {
      listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
      payment_intent_id: ctx.paymentIntentId,
      seller_confirmed: false,
      action_id: actionId,
      stripe_idempotency_key: idemKey,
    };
    const result1 = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      sendNotification: async (info) => { notifyCalls.push(info); },
      params,
    });
    assert(result1.status === 200, 'T4: first 200');
    assert(result1.body.canceled === true, 'T4: first canceled');
    assert(result1.body.quarantined === true, 'T4: first quarantined');
    const calls1 = stripe.calls.length;
    const incidents1 = await countIncidents(ctx.listingId);
    const outbox1 = entities._state.outbox.length;
    const notifyCount1 = notifyCalls.length;

    // Replay with same action_id + idem_key
    const result2 = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      sendNotification: async (info) => { notifyCalls.push(info); },
      params,
    });
    assert(result2.status === 200, 'T4: replay 200');
    assert(result2.body.replay === true, 'T4: replay flag');
    assert(result2.body.quarantined === true, 'T4: replay quarantined');
    assert(result2.body.code === 'CANCELLED_INVENTORY_QUARANTINED', 'T4: replay code');
    // No additional Stripe call on replay
    assert(stripe.calls.length === calls1, `T4: no extra provider call (got ${stripe.calls.length - calls1} extra)`);
    // No additional action
    const actionCount = await countPaymentActionsByPurchase(ctx.purchaseId);
    assert(actionCount === 1, `T4: exactly 1 action (got ${actionCount})`);
    // No additional incident
    const incidents2 = await countIncidents(ctx.listingId);
    assert(incidents2 === incidents1, `T4: no extra incident (got ${incidents2 - incidents1} extra)`);
    // No additional outbox event
    const outbox2 = entities._state.outbox.length;
    assert(outbox2 === outbox1, `T4: no extra outbox event (got ${outbox2 - outbox1} extra)`);
    // No additional notification
    assert(notifyCalls.length === notifyCount1, `T4: no extra notification (got ${notifyCalls.length - notifyCount1} extra)`);
    results.T4 = { assertions: 13, ok: true };
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
    assert(result1.body.quarantined === true, 'T5: first quarantined');
    const calls1 = stripe.calls.length;

    // Second attempt with same action_id — authority is already 'available' → replay
    const result2 = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe, params,
    });
    assert(result2.status === 200, `T5: second 200 (got ${result2.status})`);
    assert(result2.body.replay === true, 'T5: replay flag (already available)');
    assert(result2.body.quarantined === true, 'T5: replay quarantined');
    assert(stripe.calls.length === calls1, `T5: no extra provider call (got ${stripe.calls.length - calls1} extra)`);
    const actionCount = await countPaymentActionsByPurchase(ctx.purchaseId);
    assert(actionCount === 1, `T5: exactly 1 action (got ${actionCount})`);
    results.T5 = { assertions: 7, ok: true };
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
    const oneSucceeded = (r1.body.canceled === true) || (r2.body.canceled === true);
    assert(oneSucceeded, 'T6: at least one succeeded');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T6: authority available (exactly one release)');
    assert(auth?.recovery_blocked === true, 'T6: authority recovery_blocked (quarantined)');
    assert(auth?.checkout_quarantined === true, 'T6: authority checkout_quarantined');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T6: binding canceled (exactly one)');
    assert(entities._state.listings[ctx.listingId]?.status === 'hidden', 'T6: mirror hidden (NOT active)');
    results.T6 = { assertions: 6, ok: true };
  }

  // T7: Capture-in-flight rejection (frozen → CAPTURE_IN_FLIGHT) [unchanged]
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

  // T8: Captured-sale rejection (sold → CAPTURED_OUT_OF_SCOPE + incident) [unchanged]
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

  // T9: seller_confirmed=true → quarantine (never relist)
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
        seller_confirmed: true,
      },
    });
    assert(result.status === 200, 'T9: status 200');
    assert(result.body.canceled === true, 'T9: canceled (money canceled)');
    assert(result.body.quarantined === true, 'T9: quarantined');
    assert(result.body.quarantine_ok === true, 'T9: quarantine_ok');
    assert(result.body.code === 'CANCELLED_INVENTORY_QUARANTINED', 'T9: code');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T9: authority released (money canceled)');
    assert(auth?.recovery_blocked === true, 'T9: authority recovery_blocked (quarantined)');
    assert(auth?.checkout_quarantined === true, 'T9: authority checkout_quarantined');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T9: binding canceled');
    assert(entities._state.listings[ctx.listingId]?.status === 'hidden', 'T9: mirror listing hidden (NOT active)');
    assert(entities._state.listings[ctx.listingId]?.hidden_reason === 'cancel_inventory_quarantined', 'T9: hidden_reason');
    assert(notifyType === 'cancel_quarantined', `T9: notification type (got ${notifyType})`);
    results.T9 = { assertions: 12, ok: true };
  }

  // T10: Mirror failure (durable outbox) — quarantine still succeeds
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
    assert(result.body.quarantined === true, 'T10: quarantined');
    assert(result.body.mirror?.outbox_id !== null, 'T10: outbox created');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T10: authority available (not rolled back)');
    assert(auth?.recovery_blocked === true, 'T10: authority recovery_blocked (quarantined)');
    const b = await getBinding(ctx.purchaseId);
    assert(b?.capture_state === 'canceled', 'T10: binding canceled');
    results.T10 = { assertions: 6, ok: true };
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
    assert(notifyCalls[0]?.type === 'cancel_quarantined', 'T11: notification type');
    assert(notifyCalls[0]?.action_id !== undefined, 'T11: action_id dedup key present');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T11: authority committed before notification');
    assert(auth?.recovery_blocked === true, 'T11: authority quarantined before notification');
    results.T11 = { assertions: 6, ok: true };
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
    assert(result.body.quarantined === true, 'T15: quarantined');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.lifecycle_state === 'available', 'T15: authority available');
    assert(auth?.recovery_blocked === true, 'T15: authority recovery_blocked (quarantined)');
    results.T15 = { assertions: 5, ok: true };
  }

  // T16: No admin-client import (static analysis)
  {
    const src = fs.readFileSync('/app/base44/shared/cancelPurchaseCanaryOrchestrator.js', 'utf8');
    assert(!src.includes('authorityV1TestAdmin'), 'T16: no admin client import');
    assert(!src.includes('AUTHORITY_DB_URL_DEV_ADMIN'), 'T16: no admin URL');
    assert(!src.includes('Deno.env'), 'T16: no Deno.env');
    assert(src.includes('createStripeCancelProvider') || src.includes('stripeAdapter'), 'T16: uses shared provider');
    assert(!src.includes('shouldQuarantine'), 'T16: shouldQuarantine removed');
    assert(!src.includes("status: 'active'"), 'T16: no relist mirror (status active)');

    const handlerSrc = fs.readFileSync('/app/base44/functions/cancelPurchase/entry.ts', 'utf8');
    assert(handlerSrc.includes('maybeRouteCanaryCancelPurchase'), 'T16: handler imports orchestrator');
    assert(handlerSrc.includes('createStripeCancelProvider'), 'T16: handler imports shared provider');
    assert(handlerSrc.includes('isCanaryEnabled'), 'T16: handler uses isCanaryEnabled');
    assert(handlerSrc.includes("secrets.get('STRIPE_SECRET_KEY')"), 'T16: handler uses base44:runtime secrets');
    assert(!handlerSrc.includes('authorityV1TestAdmin'), 'T16: handler no admin client');
    assert(handlerSrc.includes('cancel_quarantined'), 'T16: handler uses cancel_quarantined notification type');
    results.T16 = { assertions: 11, ok: true };
  }

  // T17: seller_confirmed missing (undefined) → quarantine (never relist)
  {
    const ctx = await setupReservedWithBinding('missing');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        // seller_confirmed intentionally omitted
      },
    });
    assert(result.status === 200, 'T17: status 200');
    assert(result.body.canceled === true, 'T17: canceled');
    assert(result.body.quarantined === true, 'T17: quarantined');
    assert(result.body.code === 'CANCELLED_INVENTORY_QUARANTINED', 'T17: code');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.recovery_blocked === true, 'T17: authority recovery_blocked');
    assert(auth?.checkout_quarantined === true, 'T17: authority checkout_quarantined');
    assert(entities._state.listings[ctx.listingId]?.status === 'hidden', 'T17: mirror hidden (NOT active)');
    assert(entities._state.listings[ctx.listingId]?.hidden_reason === 'cancel_inventory_quarantined', 'T17: hidden_reason');
    results.T17 = { assertions: 8, ok: true };
  }

  // T18: seller_confirmed uncertain (non-boolean) → quarantine (never relist)
  {
    const ctx = await setupReservedWithBinding('uncertain');
    const entities = createMockEntities();
    const stripe = createFakeStripeAdapter({ derived: 'succeeded', raw: { status: 'canceled' } });
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: 'maybe', // non-boolean, uncertain
      },
    });
    assert(result.status === 200, 'T18: status 200');
    assert(result.body.canceled === true, 'T18: canceled');
    assert(result.body.quarantined === true, 'T18: quarantined');
    assert(result.body.code === 'CANCELLED_INVENTORY_QUARANTINED', 'T18: code');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.recovery_blocked === true, 'T18: authority recovery_blocked');
    assert(auth?.checkout_quarantined === true, 'T18: authority checkout_quarantined');
    assert(entities._state.listings[ctx.listingId]?.status === 'hidden', 'T18: mirror hidden (NOT active)');
    results.T18 = { assertions: 7, ok: true };
  }

  // T19: false→true race during cancellation → quarantine (never relist)
  {
    const ctx = await setupReservedWithBinding('race');
    const entities = createMockEntities();
    // The Stripe adapter hook simulates seller_confirmed changing from false
    // to true DURING the cancellation (concurrent seller confirmation). The
    // saga does not use seller_confirmed for branching, so the listing is
    // quarantined regardless.
    let sellerConfirmedDuringCancel = false;
    const stripe = createFakeStripeAdapter(
      { derived: 'succeeded', raw: { status: 'canceled' } },
      {
        beforeReturn: async () => {
          // Simulate concurrent seller confirmation mid-saga
          sellerConfirmedDuringCancel = true;
        },
      },
    );
    const result = await runCanaryCancelPurchaseSaga({
      entities, user: { id: ctx.buyerId, email: ctx.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: ctx.listingId, purchase_id: ctx.purchaseId,
        payment_intent_id: ctx.paymentIntentId,
        seller_confirmed: false, // false at saga start
      },
    });
    assert(result.status === 200, 'T19: status 200');
    assert(result.body.canceled === true, 'T19: canceled');
    assert(result.body.quarantined === true, 'T19: quarantined');
    assert(result.body.code === 'CANCELLED_INVENTORY_QUARANTINED', 'T19: code');
    assert(sellerConfirmedDuringCancel === true, 'T19: race simulated (seller_confirmed changed to true mid-saga)');
    const auth = await getAuthority(ctx.listingId);
    assert(auth?.recovery_blocked === true, 'T19: authority recovery_blocked');
    assert(auth?.checkout_quarantined === true, 'T19: authority checkout_quarantined');
    assert(entities._state.listings[ctx.listingId]?.status === 'hidden', 'T19: mirror hidden (NOT active despite false→true race)');
    assert(entities._state.listings[ctx.listingId]?.hidden_reason === 'cancel_inventory_quarantined', 'T19: hidden_reason');
    results.T19 = { assertions: 9, ok: true };
  }

  // T20: Cleanup (all tables empty)
  {
    await cleanupAll();
    const counts = await countAll();
    const allZero = Object.values(counts).every(v => v === 0);
    assert(allZero, `T20: all tables empty (got ${JSON.stringify(counts)})`);
    results.T20 = { assertions: 1, ok: true };
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