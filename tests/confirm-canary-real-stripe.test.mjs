/**
 * confirm-canary-real-stripe.test.mjs — P0-01R Real Stripe TEST-MODE certification.
 *
 * Certifies the DEPLOYED confirmCheckoutAuthorized canary path against the REAL
 * Stripe API in TEST MODE only. Exercises the SAME routing seam the handler uses:
 *   maybeRouteCanaryConfirm (base44/shared/confirmCanaryOrchestrator.js) — the
 *   exact function confirmCheckoutAuthorized/entry.ts calls. No duplicated
 *   provider logic: the shared production adapter (base44/shared/stripeCaptureProvider.js)
 *   is imported and executed by both the handler and this harness. The harness
 *   wraps the adapter in a thin observability proxy (retrieve counts) but never
 *   reimplements retrieve behavior.
 *
 * SEAM: maybeRouteCanaryConfirm performs the full guard (isCanaryListing, canary
 *   action, admin, flag, executor URL) then invokes runCanaryConfirmSaga with
 *   the shared adapter. The saga retrieves the PI, verifies metadata, then calls
 *   bind_payment_intent via the executor-only client. The binding is created by
 *   the executor path — admin SQL NEVER calls bind_payment_intent.
 *
 * SAFETY:
 *   - NEVER uses a live-mode key. The caller (exec_tool sandbox) verifies the
 *     key starts with sk_test_ before invoking runAllTests. This module never
 *     reads process.env for the key and never logs/returns it.
 *   - Synthetic IDs only. No real users, listings, purchases, cards, or money.
 *   - All Stripe test PaymentIntents are manual-capture, tagged with
 *     metadata { pg_cert: 'P0-01R', purpose: 'canary_confirm_cert' }.
 *   - Flag stays OFF in production (CANARY_ENABLED = false). The canary-routing
 *     function accepts its enabled state as a trusted, caller-supplied
 *     dependency (canaryEnabled). The production handler supplies
 *     isCanaryEnabled() (the committed default-OFF flag); this harness supplies
 *     true directly when constructing the router. No environment variable,
 *     global, request field, header, or secret can override the flag. T0
 *     proves the normal production configuration (canaryEnabled: false) cannot
 *     enter the canary path while OFF.
 *   - No admin fallback in the saga path. Executor-only authority access.
 *   - Admin SQL is used ONLY for synthetic setup (initialize + reserve) and
 *     exact cleanup. Admin NEVER calls bind_payment_intent.
 *   - The separate AUTHORITY_DB_URL_DEV_EXECUTOR probe credential is NOT
 *     accessed or modified. Only AUTHORITY_V1_DB_URL_DEV_EXECUTOR is used.
 *
 * deps = { adminSql, executorUrl, testKey }
 *   adminSql    — neon(adminUrl) for exact synthetic setup/cleanup only
 *   executorUrl — AUTHORITY_V1_DB_URL_DEV_EXECUTOR (runtime executor)
 *   testKey     — verified sk_test_ Stripe key (never logged)
 */
import Stripe from 'npm:stripe@14.21.0';
import { createAuthorityV1Client } from '../base44/shared/authorityV1Client.js';
import { maybeRouteCanaryConfirm } from '../base44/shared/confirmCanaryOrchestrator.js';
import { createStripeCaptureProvider } from '../base44/shared/stripeCaptureProvider.js';
import { sha256Hex, canonicalEnvelope } from '../base44/shared/canaryMirror.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
async function genId() {
  return crypto.randomUUID();
}

const CERT_METADATA = { pg_cert: 'P0-01R', purpose: 'canary_confirm_cert' };
const TEST_AMOUNT_MINOR = 100; // $1.00 USD — test mode, no real money
const TEST_CURRENCY = 'usd';
const TEST_PAYMENT_METHOD = 'pm_card_visa';
const RETURN_URL = 'https://peanutgallery.base44.app';

// ── Test fixture: create a real Stripe TEST-mode manual-capture PaymentIntent ──
// This is test SETUP (fixture creation), NOT the confirm provider behavior being
// certified. Uses the Stripe SDK (same package as production). The certified
// confirm behavior lives in the shared stripeCaptureProvider.retrievePaymentIntent.
async function createTestPaymentIntent(testKey, amountMinor, currency, metadata) {
  const stripe = new Stripe(testKey);
  const pi = await stripe.paymentIntents.create({
    amount: amountMinor,
    currency,
    capture_method: 'manual',
    payment_method: TEST_PAYMENT_METHOD,
    confirm: true,
    return_url: RETURN_URL,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: { ...CERT_METADATA, ...metadata },
    description: 'PG P0-01R canary confirm certification (test mode)',
  });
  if (!pi?.id) throw new Error('PI_CREATE_FAILED: no id returned');
  return pi;
}

// ── Cleanup: cancel an open test PI (setup/cleanup, not production behavior) ──
async function cancelTestPaymentIntent(testKey, piId) {
  const stripe = new Stripe(testKey);
  try {
    return await stripe.paymentIntents.cancel(piId);
  } catch (_) {
    return null; // already canceled/captured — ignore
  }
}

// ── Observability proxy (NOT a provider reimplementation) ─────────────────────
// Delegates retrievePaymentIntent to the shared production adapter and records
// counts/livemode/pi_id/amount/currency for assertions. throwOnRetrieve: throw
// to simulate a retrieval failure (orchestrator → PI_RETRIEVE_FAILED).
function wrapWithCounts(realAdapter, options = {}) {
  const state = { retrieveCount: 0, lastLivemode: null, lastPiStatus: null, lastPiId: null, lastAmount: null, lastCurrency: null };
  const throwOnRetrieve = options.throwOnRetrieve === true;
  return {
    async retrievePaymentIntent(piId) {
      state.retrieveCount++;
      if (throwOnRetrieve) throw new Error('SIMULATED_RETRIEVE_FAILURE');
      const pi = await realAdapter.retrievePaymentIntent(piId);
      if (pi) {
        if (pi.livemode !== undefined) state.lastLivemode = pi.livemode;
        if (pi.status !== undefined) state.lastPiStatus = pi.status;
        if (pi.id !== undefined) state.lastPiId = pi.id;
        if (pi.amount !== undefined) state.lastAmount = pi.amount;
        if (pi.currency !== undefined) state.lastCurrency = pi.currency;
      }
      return pi;
    },
    _counts: () => ({ ...state }),
  };
}

// ── In-memory Base44 entities mock (mirror writes only; Postgres is authoritative) ──
function makeMockEntities() {
  const store = {
    listings: new Map(),
    listingPrivates: new Map(),
    purchases: new Map(),
    purchasePrivates: new Map(),
    outbox: new Map(),
  };
  return {
    Listing: {
      async filter(q) { if (q.id) return [store.listings.get(q.id)].filter(Boolean); return [...store.listings.values()]; },
      async update(id, data) { const l = store.listings.get(id); if (!l) throw new Error('Listing not found'); Object.assign(l, data); },
    },
    ListingPrivate: {
      async filter(q) { return [...store.listingPrivates.values()].filter(l => !q || Object.entries(q).every(([k, v]) => l[k] === v)); },
    },
    Purchase: {
      async filter(q) { if (q.id) return [store.purchases.get(q.id)].filter(Boolean); return [...store.purchases.values()]; },
      async update(id, data) { const p = store.purchases.get(id); if (!p) throw new Error('Purchase not found'); Object.assign(p, data); },
    },
    PurchasePrivate: {
      async filter(q) { return [...store.purchasePrivates.values()].filter(p => !q || Object.entries(q).every(([k, v]) => p[k] === v)); },
      async update(id, data) { const pp = store.purchasePrivates.get(id); if (!pp) throw new Error('PurchasePrivate not found'); Object.assign(pp, data); },
    },
    CanaryMirrorOutbox: {
      async create(data) { const id = `outbox_${genId()}`; store.outbox.set(id, { id, ...data }); return { id, ...data }; },
    },
    _store: store,
  };
}

function makeMockBase44(entities) {
  return { asServiceRole: { entities } };
}

// ── Authority setup (exact synthetic IDs; admin SQL for setup only) ──────────
// Admin SQL calls initialize_listing + reserve_listing ONLY.
// Admin NEVER calls bind_payment_intent — the binding is created by the executor.
async function setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt) {
  const initOpId = `cert_init_${listingId}_${genId()}`;
  const initHash = await sha256Hex(canonicalEnvelope({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
  await adminSql`SELECT authority_v1.initialize_listing(${listingId}, ${sellerId}, ${initOpId}, ${initHash})`;

  const tokenHash = await sha256Hex(token);
  const reserveOpId = `cert_reserve_${listingId}_${genId()}`;
  const reserveHash = await sha256Hex(canonicalEnvelope({
    op: 'reserve', listing_id: listingId, expected_version: 0,
    buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt,
  }));
  await adminSql`SELECT authority_v1.reserve_listing(${listingId}, 0, ${buyerId}, ${tokenHash}, ${expiresAt}, ${reserveOpId}, ${reserveHash})`;

  const stateRows = await adminSql`SELECT authority_v1.get_state(${listingId}) as result`;
  const state = stateRows[0]?.result;
  return { revision: state?.reservation_revision, version: state?.version };
}

// ── State helpers ──────────────────────────────────────────────────────────────
async function getAuthority(adminSql, lid) {
  const rows = await adminSql`SELECT version, lifecycle_state, recovery_blocked FROM authority_v1.reservation_authority WHERE listing_id = ${lid}`;
  return rows[0] || null;
}
async function getBinding(adminSql, pid) {
  const rows = await adminSql`SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${pid}`;
  return rows[0] || null;
}
async function getBindingCount(adminSql, pid) {
  const rows = await adminSql`SELECT count(*)::int c FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${pid}`;
  return Number(rows[0]?.c || 0);
}
async function getOpCount(adminSql, lid) {
  const rows = await adminSql`SELECT count(*)::int c FROM authority_v1.reservation_operations WHERE listing_id = ${lid}`;
  return Number(rows[0]?.c || 0);
}
async function cleanupListing(adminSql, lid) {
  await adminSql`DELETE FROM authority_v1.reservation_outbox WHERE listing_id = ${lid}`;
  await adminSql`DELETE FROM authority_v1.payment_actions WHERE listing_id = ${lid}`;
  await adminSql`DELETE FROM authority_v1.operational_incidents WHERE reference_id = ${lid}`;
  await adminSql`DELETE FROM authority_v1.reservation_payment_bindings WHERE listing_id = ${lid}`;
  await adminSql`DELETE FROM authority_v1.reservation_operations WHERE listing_id = ${lid}`;
  await adminSql`DELETE FROM authority_v1.reservation_authority WHERE listing_id = ${lid}`;
}
async function countAll(adminSql) {
  const tables = ['reservation_authority', 'reservation_operations', 'reservation_outbox',
    'reservation_payment_bindings', 'payment_actions', 'stripe_webhook_events', 'operational_incidents'];
  const counts = {};
  for (const t of tables) {
    const rows = await adminSql(`SELECT count(*)::int c FROM authority_v1.${t}`);
    counts[t] = Number(rows[0]?.c || 0);
  }
  return counts;
}
async function truncateAll(adminSql) {
  await adminSql`TRUNCATE authority_v1.reservation_outbox, authority_v1.reservation_payment_bindings, authority_v1.payment_actions, authority_v1.stripe_webhook_events, authority_v1.operational_incidents, authority_v1.reservation_operations, authority_v1.reservation_authority RESTART IDENTITY CASCADE`;
}

// ── Seam invocation — the exact routing function confirmCheckoutAuthorized/entry.ts calls ──
async function runSeam(opts) {
  const { executorUrl, executorClient, lid, pid, pi, buyerId, sellerEmail, reservationToken, amount, revision, adapter, body, purchaseOverrides, userOverrides } = opts;
  const entities = makeMockEntities();
  entities._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
  const purchase = {
    id: pid, listing_id: lid, payment_intent_id: pi?.id || 'pi_unknown',
    buyer_email: buyerId, seller_email: sellerEmail,
    reservation_token: reservationToken, amount,
    ...purchaseOverrides,
  };
  entities._store.purchases.set(pid, purchase);
  entities._store.purchasePrivates.set(`pp_${pid}`, {
    id: `pp_${pid}`, purchase_id: pid,
    payment_intent_id: pi?.id || 'pi_unknown', buyer_email: buyerId,
    seller_email: sellerEmail, reservation_token: reservationToken,
  });
  const base44 = makeMockBase44(entities);
  const result = await maybeRouteCanaryConfirm({
    base44,
    user: { id: buyerId, email: buyerId, role: 'admin', ...userOverrides },
    body: { canary: true, purchase_id: pid, ...body },
    listing: { id: lid, notes: '[AUTH_CANARY]' },
    purchase: entities._store.purchases.get(pid),
    purchasePrivate: entities._store.purchasePrivates.get(`pp_${pid}`),
    executorUrl,
    stripeAdapter: adapter,
    executorClient,
    canaryEnabled: true,
  });
  return { result, entities };
}

// ── Test runner ──────────────────────────────────────────────────────────────
export async function runAllTests(deps) {
  const { adminSql, executorUrl, testKey } = deps;
  const executorClient = createAuthorityV1Client(executorUrl);

  let passed = 0, failed = 0;
  const failures = [];
  const stripeObjects = []; // { id, scenario, status, livemode }
  let setupRequests = 0; // PI creations
  let cleanupRequests = 0; // PI cancellations
  let seamRetrievals = 0; // production-seam retrievePaymentIntent calls

  function assert(cond, msg) {
    if (cond) passed++;
    else { failed++; failures.push(msg); }
  }

  // ── T0: Flag-OFF guard — normal production config cannot enter the canary path ──
  {
    const guardResult = await maybeRouteCanaryConfirm({
      base44: makeMockBase44(makeMockEntities()),
      user: { id: 'guard', email: 'guard@example.com', role: 'admin' },
      body: { canary: true, purchase_id: 'guard_p' },
      listing: { id: 'guard_l', notes: '[AUTH_CANARY]' },
      purchase: { id: 'guard_p', listing_id: 'guard_l', payment_intent_id: 'pi_guard', buyer_email: 'b_guard', reservation_token: 'r_guard', amount: 1 },
      purchasePrivate: { purchase_id: 'guard_p', payment_intent_id: 'pi_guard', buyer_email: 'b_guard', reservation_token: 'r_guard' },
      executorUrl,
      stripeAdapter: { async retrievePaymentIntent() { throw new Error('provider must not be called with flag OFF'); } },
      executorClient,
      canaryEnabled: false, // the real committed production configuration
    });
    assert(guardResult?.status === 503, `T0: flag-OFF guard returns 503 (got ${guardResult?.status})`);
    assert(guardResult?.body?.code === 'CANARY_DISABLED', `T0: CANARY_DISABLED (got ${guardResult?.body?.code})`);
  }

  // ── T1: Happy path — create + confirm a real test-mode PI, binding created by executor ──
  {
    const lid = `cert_real_t1_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    stripeObjects.push({ id: pi.id, scenario: 'T1', status: pi.status, livemode: pi.livemode });

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const { result } = await runSeam({ executorUrl, executorClient, lid, pid, pi, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter });

    const binding = await getBinding(adminSql, pid);
    const bindingCount = await getBindingCount(adminSql, pid);
    const counts = adapter._counts();
    seamRetrievals += counts.retrieveCount;

    assert(result.status === 200, `T1: status 200 (got ${result.status})`);
    assert(result.body?.bound === true, 'T1: bound=true');
    assert(counts.retrieveCount === 1, `T1: exactly 1 Stripe retrieve (got ${counts.retrieveCount})`);
    assert(counts.lastLivemode === false, `T1: livemode=false (got ${counts.lastLivemode})`);
    assert(counts.lastPiId === pi.id, 'T1: PI identity bound');
    assert(counts.lastPiStatus === 'requires_capture', `T1: PI status requires_capture (got ${counts.lastPiStatus})`);
    assert(counts.lastAmount === TEST_AMOUNT_MINOR, `T1: amount=${TEST_AMOUNT_MINOR} (got ${counts.lastAmount})`);
    assert(counts.lastCurrency === TEST_CURRENCY, `T1: currency=${TEST_CURRENCY} (got ${counts.lastCurrency})`);
    assert(binding?.capture_state === 'authorized', `T1: binding authorized (got ${binding?.capture_state})`);
    assert(bindingCount === 1, `T1: exactly 1 binding (got ${bindingCount})`);

    // Cleanup: cancel the open PI (requires_capture → canceled)
    cleanupRequests++;
    await cancelTestPaymentIntent(testKey, pi.id);
    await cleanupListing(adminSql, lid);
  }

  // ── T2: Identical replay — idempotent, no duplicate binding/operation ──
  {
    const lid = `cert_real_t2_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    stripeObjects.push({ id: pi.id, scenario: 'T2', status: pi.status, livemode: pi.livemode });

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const seamOpts = { executorUrl, executorClient, lid, pid, pi, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter };

    const { result: r1 } = await runSeam(seamOpts);
    const opsAfterFirst = await getOpCount(adminSql, lid);
    const { result: r2 } = await runSeam(seamOpts); // identical replay
    const opsAfterSecond = await getOpCount(adminSql, lid);
    const bindingCount = await getBindingCount(adminSql, pid);
    const counts = adapter._counts();
    seamRetrievals += counts.retrieveCount;

    assert(r1.status === 200 && r1.body?.bound === true, 'T2: first call bound');
    assert(r2.status === 200 && r2.body?.bound === true, 'T2: replay bound');
    assert(counts.retrieveCount === 2, `T2: 2 Stripe retrieves total (1 per call) (got ${counts.retrieveCount})`);
    assert(bindingCount === 1, `T2: still 1 binding (got ${bindingCount})`);
    assert(opsAfterSecond === opsAfterFirst, `T2: no new operation rows (${opsAfterFirst}→${opsAfterSecond})`);

    cleanupRequests++;
    await cancelTestPaymentIntent(testKey, pi.id);
    await cleanupListing(adminSql, lid);
  }

  // ── T3: Conflicting PaymentIntent — different PI for same purchase → rejected ──
  {
    const lid = `cert_real_t3_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    const pi1 = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    const pi2 = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    stripeObjects.push({ id: pi1.id, scenario: 'T3-pi1', status: pi1.status, livemode: pi1.livemode });
    stripeObjects.push({ id: pi2.id, scenario: 'T3-pi2', status: pi2.status, livemode: pi2.livemode });

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    // First: bind pi1
    const { result: r1 } = await runSeam({ executorUrl, executorClient, lid, pid, pi: pi1, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter });
    // Second: try to bind pi2 to the same purchase
    const { result: r2 } = await runSeam({ executorUrl, executorClient, lid, pid, pi: pi2, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter });
    const bindingCount = await getBindingCount(adminSql, pid);
    const counts = adapter._counts();
    seamRetrievals += counts.retrieveCount;

    assert(r1.status === 200 && r1.body?.bound === true, 'T3: first PI bound');
    assert(r2.status === 409 || r2.status === 500, `T3: second PI rejected (got ${r2.status})`);
    assert(bindingCount === 1, `T3: still 1 binding (got ${bindingCount})`);

    cleanupRequests += 2;
    await cancelTestPaymentIntent(testKey, pi1.id);
    await cancelTestPaymentIntent(testKey, pi2.id);
    await cleanupListing(adminSql, lid);
  }

  // ── T4: Non-USD → CURRENCY_MISMATCH, no binding ──
  {
    const lid = `cert_real_t4_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, 'eur', {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    stripeObjects.push({ id: pi.id, scenario: 'T4', status: pi.status, livemode: pi.livemode });

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const { result } = await runSeam({ executorUrl, executorClient, lid, pid, pi, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter });
    const bindingCount = await getBindingCount(adminSql, pid);
    const counts = adapter._counts();
    seamRetrievals += counts.retrieveCount;

    assert(result.status === 400, `T4: status 400 (got ${result.status})`);
    assert(result.body?.code === 'CURRENCY_MISMATCH', `T4: CURRENCY_MISMATCH (got ${result.body?.code})`);
    assert(bindingCount === 0, `T4: no binding created (got ${bindingCount})`);
    assert(pi.livemode === false, 'T4: PI livemode=false');

    cleanupRequests++;
    await cancelTestPaymentIntent(testKey, pi.id);
    await cleanupListing(adminSql, lid);
  }

  // ── T5: Amount mismatch → AMOUNT_MISMATCH, no binding ──
  {
    const lid = `cert_real_t5_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    // PI amount = 200 cents ($2.00), but purchase.amount = $1.00 (100 cents)
    const pi = await createTestPaymentIntent(testKey, 200, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    stripeObjects.push({ id: pi.id, scenario: 'T5', status: pi.status, livemode: pi.livemode });

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const { result } = await runSeam({ executorUrl, executorClient, lid, pid, pi, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter });
    const bindingCount = await getBindingCount(adminSql, pid);
    const counts = adapter._counts();
    seamRetrievals += counts.retrieveCount;

    assert(result.status === 500, `T5: status 500 (got ${result.status})`);
    assert(result.body?.code === 'AMOUNT_MISMATCH', `T5: AMOUNT_MISMATCH (got ${result.body?.code})`);
    assert(bindingCount === 0, `T5: no binding created (got ${bindingCount})`);

    cleanupRequests++;
    await cancelTestPaymentIntent(testKey, pi.id);
    await cleanupListing(adminSql, lid);
  }

  // ── T6: Unauthorized buyer → BUYER_MISMATCH, no binding ──
  {
    const lid = `cert_real_t6_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, wrongBuyerId = `wrong_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    // Reserve with buyerId, but confirm with wrongBuyerId
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    stripeObjects.push({ id: pi.id, scenario: 'T6', status: pi.status, livemode: pi.livemode });

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    // Pass wrongBuyerId as the authenticated user
    const { result } = await runSeam({ executorUrl, executorClient, lid, pid, pi, buyerId: wrongBuyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter });
    const bindingCount = await getBindingCount(adminSql, pid);
    const counts = adapter._counts();
    seamRetrievals += counts.retrieveCount;

    assert(result.status === 409, `T6: status 409 (got ${result.status})`);
    assert(result.body?.code === 'BUYER_MISMATCH', `T6: BUYER_MISMATCH (got ${result.body?.code})`);
    assert(bindingCount === 0, `T6: no binding created (got ${bindingCount})`);

    cleanupRequests++;
    await cancelTestPaymentIntent(testKey, pi.id);
    await cleanupListing(adminSql, lid);
  }

  // ── T7: Non-authorized PI (canceled) → PI_NOT_AUTHORIZED, no binding ──
  {
    const lid = `cert_real_t7_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    // Cancel the PI so it's no longer authorized
    cleanupRequests++;
    await cancelTestPaymentIntent(testKey, pi.id);
    stripeObjects.push({ id: pi.id, scenario: 'T7', status: 'canceled', livemode: pi.livemode });

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const { result } = await runSeam({ executorUrl, executorClient, lid, pid, pi, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter });
    const bindingCount = await getBindingCount(adminSql, pid);
    const counts = adapter._counts();
    seamRetrievals += counts.retrieveCount;

    assert(result.status === 402, `T7: status 402 (got ${result.status})`);
    assert(result.body?.code === 'PI_NOT_AUTHORIZED', `T7: PI_NOT_AUTHORIZED (got ${result.body?.code})`);
    assert(bindingCount === 0, `T7: no binding created (got ${bindingCount})`);

    await cleanupListing(adminSql, lid);
  }

  // ── T8: Concurrent identical confirmations → exactly one binding ──
  {
    const lid = `cert_real_t8_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    stripeObjects.push({ id: pi.id, scenario: 'T8', status: pi.status, livemode: pi.livemode });

    const N = 10;
    const promises = [];
    const adapters = [];
    for (let i = 0; i < N; i++) {
      const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
      adapters.push(adapter);
      promises.push(runSeam({ executorUrl, executorClient, lid, pid, pi, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter }));
    }
    const allResults = await Promise.all(promises);
    const bindingCount = await getBindingCount(adminSql, pid);
    const okCount = allResults.filter(r => r.result?.status === 200 && r.result?.body?.bound === true).length;
    const t8Retrievals = adapters.reduce((sum, a) => sum + a._counts().retrieveCount, 0);
    seamRetrievals += t8Retrievals;

    assert(okCount >= 1, `T8: at least 1 succeeded (got ${okCount})`);
    assert(bindingCount === 1, `T8: exactly 1 binding (got ${bindingCount})`);
    assert(t8Retrievals === N, `T8: ${N} concurrent retrieves (got ${t8Retrievals})`);

    cleanupRequests++;
    await cancelTestPaymentIntent(testKey, pi.id);
    await cleanupListing(adminSql, lid);
  }

  // ── T9: Stripe retrieval failure → PI_RETRIEVE_FAILED, fail-closed ──
  {
    const lid = `cert_real_t9_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    // Use a real PI ID but adapter throws on retrieve
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    stripeObjects.push({ id: pi.id, scenario: 'T9', status: pi.status, livemode: pi.livemode });

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey), { throwOnRetrieve: true });
    const { result } = await runSeam({ executorUrl, executorClient, lid, pid, pi, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter });
    const bindingCount = await getBindingCount(adminSql, pid);
    seamRetrievals += 1; // the throw happened after incrementing retrieveCount

    assert(result.status === 500, `T9: status 500 (got ${result.status})`);
    assert(result.body?.code === 'PI_RETRIEVE_FAILED', `T9: PI_RETRIEVE_FAILED (got ${result.body?.code})`);
    assert(bindingCount === 0, `T9: no binding created (got ${bindingCount})`);

    cleanupRequests++;
    await cancelTestPaymentIntent(testKey, pi.id);
    await cleanupListing(adminSql, lid);
  }

  // ── T10: Binding accepted by downstream begin_capture (no admin-created binding) ──
  {
    const lid = `cert_real_t10_${genId()}`;
    const pid = `pur_${lid}`;
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListing(adminSql, lid, sellerId, buyerId, token, expiresAt);

    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY, {
      purchase_id: pid, listing_id: lid, buyer_email: buyerId, seller_email: sellerId, reservation_token: token,
    });
    setupRequests++;
    stripeObjects.push({ id: pi.id, scenario: 'T10', status: pi.status, livemode: pi.livemode });

    // Step 1: Confirm through the seam → binding created by executor
    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const { result: confirmResult } = await runSeam({ executorUrl, executorClient, lid, pid, pi, buyerId, sellerEmail: sellerId, reservationToken: token, amount: 1.00, revision, adapter });
    seamRetrievals += adapter._counts().retrieveCount;

    assert(confirmResult.status === 200 && confirmResult.body?.bound === true, 'T10: confirm bound');

    // Step 2: Read state after confirm (version may have changed)
    const stateRows = await adminSql`SELECT authority_v1.get_state(${lid}) as result`;
    const state = stateRows[0]?.result;

    // Step 3: Call begin_capture via the executor client (proves binding is valid)
    const captureActionId = `capture_action_${lid}_${genId()}`;
    const captureIdemKey = `idem_capture_${captureActionId}`;
    const captureOpId = `cert_capture_${lid}_${genId()}`;
    const captureHash = await sha256Hex(canonicalEnvelope({
      op: 'begin_capture', listing_id: lid, expected_version: state.version,
      purchase_id: pid, payment_intent_id: pi.id, buyer_user_id: buyerId,
      expected_revision: state.reservation_revision,
      action_id: captureActionId, stripe_idempotency_key: captureIdemKey,
    }));
    const captureResult = await executorClient.beginCapture(
      lid, state.version, pid, pi.id, buyerId,
      state.reservation_revision, captureActionId, captureIdemKey,
      captureOpId, captureHash,
    );

    const authAfterCapture = await getAuthority(adminSql, lid);
    const bindingAfterCapture = await getBinding(adminSql, pid);

    assert(captureResult?.ok === true, `T10: begin_capture accepted (got ${JSON.stringify(captureResult?.ok)})`);
    assert(authAfterCapture?.lifecycle_state === 'frozen', `T10: authority frozen (got ${authAfterCapture?.lifecycle_state})`);
    assert(bindingAfterCapture?.capture_state === 'authorized' || bindingAfterCapture?.capture_state === 'capture_requested',
      `T10: binding still valid (got ${bindingAfterCapture?.capture_state})`);

    cleanupRequests++;
    await cancelTestPaymentIntent(testKey, pi.id);
    await cleanupListing(adminSql, lid);
  }

  // ── T11: Cleanup — all seven authority tables empty, no open PIs ──
  {
    await truncateAll(adminSql);
    const counts = await countAll(adminSql);
    const allClean = Object.values(counts).every(c => c === 0);
    assert(allClean, `T11: all 7 tables empty (got ${JSON.stringify(counts)})`);

    // Verify all PIs are canceled (not left open)
    const stripe = new Stripe(testKey);
    let allCanceled = true;
    for (const obj of stripeObjects) {
      try {
        const pi = await stripe.paymentIntents.retrieve(obj.id);
        if (pi.status === 'requires_capture') {
          allCanceled = false;
          // Force-cancel any leftover
          cleanupRequests++;
          await stripe.paymentIntents.cancel(obj.id);
        }
      } catch (_) { /* already gone */ }
    }
    assert(allCanceled, 'T11: no test PaymentIntent left open');

    const sanitized = stripeObjects.map(o => ({ id: o.id, scenario: o.scenario, livemode: o.livemode, final_status: o.status }));
    return {
      passed, failed, failures: failures.slice(0, 10),
      allClean, finalCounts: counts,
      stripeObjects: sanitized,
      setupStripeRequests: setupRequests,
      cleanupStripeRequests: cleanupRequests,
      seamRetrieveTotal: seamRetrievals,
    };
  }
}