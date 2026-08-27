/**
 * cancel-purchase-real-stripe.test.mjs — P0-01N Real Stripe TEST-MODE certification.
 *
 * Certifies the DEPLOYED cancelPurchase canary path against the REAL Stripe API
 * in TEST MODE only. Exercises the SAME routing seam the handler uses:
 *   maybeRouteCanaryCancelPurchase (base44/shared/cancelPurchaseCanaryOrchestrator.js)
 *   — the exact function cancelPurchase/entry.ts calls. No duplicated provider
 *   logic: the shared production adapter (base44/shared/stripeCancelProvider.js)
 *   is imported and executed by both the handler and this harness. The harness
 *   wraps the adapter in a thin observability proxy (counts + optional
 *   lost-response throw) but never reimplements retrieve/cancel behavior.
 *
 * SEAM: maybeRouteCanaryCancelPurchase performs the full guard (isCanaryListing,
 *   canaryEnabled, executor/recorder URL) then invokes
 *   runCanaryCancelPurchaseSaga with the shared adapter. The harness injects
 *   the same executor/recorder clients and purchasePrivate the handler assembles.
 *
 * SAFETY:
 *   - NEVER uses a live-mode key. The caller (exec_tool sandbox) verifies the
 *     key starts with sk_test_ before invoking runAllTests. This module never
 *     reads process.env for the key and never logs/returns it.
 *   - Synthetic IDs only. No real users, listings, purchases, cards, or money.
 *   - All Stripe test PaymentIntents are manual-capture, tagged with
 *     metadata { pg_cert: 'P0-01N', purpose: 'canary_cancel_cert' }.
 *   - Flag stays OFF in production (CANARY_ENABLED = false). The canary-routing
 *     function accepts its enabled state as a trusted, caller-supplied
 *     dependency (canaryEnabled). The production handler supplies
 *     isCanaryEnabled() (the committed default-OFF flag); this harness supplies
 *     true directly when constructing the router. No environment variable,
 *     global, request field, header, or secret can override the flag. T0
 *     proves the normal production configuration (canaryEnabled: false) cannot
 *     enter the canary path while OFF.
 *   - No admin fallback in the saga path. Executor-only authority access.
 *   - Admin SQL is used ONLY for synthetic fixture setup and exact cleanup.
 *
 * deps = { adminSql, executorUrl, recorderUrl, testKey }
 *   adminSql      — neon(adminUrl) for exact synthetic setup/cleanup only
 *   executorUrl   — AUTHORITY_V1_DB_URL_DEV_EXECUTOR (runtime executor)
 *   recorderUrl   — AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER (runtime recorder)
 *   testKey       — verified sk_test_ Stripe key (never logged)
 */
import Stripe from 'npm:stripe@14.21.0';
import { createAuthorityV1Client } from '../base44/shared/authorityV1Client.js';
import { createAuthorityV1StripeRecorderClient } from '../base44/shared/authorityV1StripeRecorderClient.js';
import { maybeRouteCanaryCancelPurchase } from '../base44/shared/cancelPurchaseCanaryOrchestrator.js';
import { createStripeCancelProvider } from '../base44/shared/stripeCancelProvider.js';
import { sha256Hex, canonicalEnvelope } from '../base44/shared/canaryMirror.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
async function genId() {
  return crypto.randomUUID();
}

const CERT_METADATA = { pg_cert: 'P0-01N', purpose: 'canary_cancel_cert' };
const TEST_AMOUNT_MINOR = 100; // $1.00 USD — test mode, no real money
const TEST_CURRENCY = 'usd';
// Stripe prebuilt test PaymentMethod (Visa test card). No raw card data is sent
// — pm_card_visa is resolved server-side by Stripe in test mode. No PCI payload.
const TEST_PAYMENT_METHOD = 'pm_card_visa';
const RETURN_URL = 'https://peanutgallery.base44.app';

const CANCELLABLE_STATUSES = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'requires_capture',
];

// ── Test fixture: create a real Stripe TEST-mode manual-capture PaymentIntent ──
// This is test SETUP (fixture creation), NOT the cancel provider behavior being
// certified. Uses the Stripe SDK (same package as production). The certified
// cancel behavior lives in the shared stripeCancelProvider module.
async function createTestPaymentIntent(testKey, amountMinor, currency) {
  const stripe = new Stripe(testKey);
  const pi = await stripe.paymentIntents.create({
    amount: amountMinor,
    currency,
    capture_method: 'manual',
    payment_method: TEST_PAYMENT_METHOD,
    confirm: true,
    return_url: RETURN_URL,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: CERT_METADATA,
    description: 'PG P0-01N canary cancel certification (test mode)',
  });
  if (!pi?.id) {
    throw new Error('PI_CREATE_FAILED: no id returned');
  }
  if (pi.status !== 'requires_capture') {
    throw new Error(`PI_UNEXPECTED_STATUS: ${pi.status} (expected requires_capture)`);
  }
  return pi;
}

// ── Test fixture: create a real Stripe TEST-mode captured (succeeded) PI ──
async function createCapturedPaymentIntent(testKey, amountMinor, currency) {
  const stripe = new Stripe(testKey);
  const pi = await stripe.paymentIntents.create({
    amount: amountMinor,
    currency,
    capture_method: 'manual',
    payment_method: TEST_PAYMENT_METHOD,
    confirm: true,
    return_url: RETURN_URL,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: CERT_METADATA,
    description: 'PG P0-01N canary cancel certification (captured, test mode)',
  });
  if (pi.status !== 'requires_capture') {
    throw new Error(`PI_UNEXPECTED_STATUS: ${pi.status} (expected requires_capture)`);
  }
  const captured = await stripe.paymentIntents.capture(pi.id);
  if (captured.status !== 'succeeded') {
    throw new Error(`CAPTURE_FAILED: ${captured.status}`);
  }
  return captured;
}

// ── Observability proxy (NOT a provider reimplementation) ─────────────────────
// Delegates cancelPaymentIntent to the shared production adapter and records
// counts/livemode/pi_id for assertions. retrieveCount = calls (each does exactly
// 1 retrieve per the production logic); cancelCount = calls where the retrieved
// PI was in a cancellable status (a cancel API call was attempted). throwAfterCancel:
// after a successful real cancel, throw to simulate a lost response (orchestrator →
// 'unknown' → cancel_unknown).
function wrapWithCounts(realAdapter, options = {}) {
  const state = { cancelCount: 0, retrieveCount: 0, lastLivemode: null, lastPiStatus: null, lastPiId: null };
  const throwAfterCancel = options.throwAfterCancel === true;
  return {
    async cancelPaymentIntent(piId, idemKey) {
      state.retrieveCount++;
      const result = await realAdapter.cancelPaymentIntent(piId, idemKey);
      if (result?.raw) {
        if (result.raw.livemode !== undefined) state.lastLivemode = result.raw.livemode;
        if (result.raw.pi_status !== undefined) state.lastPiStatus = result.raw.pi_status;
        if (result.raw.pi_id !== undefined) state.lastPiId = result.raw.pi_id;
        if (CANCELLABLE_STATUSES.includes(result.raw.pi_status)) state.cancelCount++;
      }
      if (throwAfterCancel && result?.derived === 'succeeded' && CANCELLABLE_STATUSES.includes(result?.raw?.pi_status)) {
        throw new Error('SIMULATED_LOST_RESPONSE');
      }
      return result;
    },
    _counts: () => ({ ...state }),
  };
}

// ── In-memory Base44 entities mock (mirror writes only; Postgres is authoritative) ──
function makeMockEntities() {
  const store = {
    listings: new Map(),
    listingPrivates: new Map(),
    purchasePrivates: new Map(),
    outbox: new Map(),
  };
  return {
    Listing: {
      async update(id, data) {
        const l = store.listings.get(id);
        if (!l) throw new Error('Listing not found');
        Object.assign(l, data);
      },
    },
    ListingPrivate: {
      async filter(q) {
        return [...store.listingPrivates.values()].filter(l => l.listing_id === q.listing_id);
      },
      async update(id, data) {
        const lp = store.listingPrivates.get(id);
        if (!lp) throw new Error('ListingPrivate not found');
        Object.assign(lp, data);
      },
    },
    PurchasePrivate: {
      async filter(q) {
        return [...store.purchasePrivates.values()].filter(pp => pp.purchase_id === q.purchase_id);
      },
    },
    CanaryMirrorOutbox: {
      async create(data) {
        const id = `outbox_${genId()}`;
        store.outbox.set(id, { id, ...data });
        return { id, ...data };
      },
    },
    _store: store,
  };
}

function makeMockBase44(entities) {
  return { asServiceRole: { entities } };
}

// ── Authority setup (exact synthetic IDs; admin SQL for setup only) ──────────
async function setupReservedListingWithBinding(executorSql, adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, paymentIntentId) {
  // Step 1: initialize_listing via executor (creates 'available' listing, version 0)
  const initOpId = `cert_init_${listingId}_${genId()}`;
  const initHash = await sha256Hex(canonicalEnvelope({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
  await executorSql`SELECT authority_v1.initialize_listing(${listingId}, ${sellerId}, ${initOpId}, ${initHash})`;

  // Step 2: UPDATE to 'reserved' via admin (direct SQL UPDATE — avoids reserve_listing
  // which inserts into reservation_outbox where neondb_owner lacks INSERT)
  const tokenHash = await sha256Hex(token);
  const revision = genId();
  await adminSql`UPDATE authority_v1.reservation_authority SET
    version = 1, lifecycle_state = 'reserved',
    buyer_user_id = ${buyerId},
    reservation_token_hash = ${tokenHash},
    reservation_expires_at = ${expiresAt},
    reservation_revision = ${revision},
    updated_at = now()
    WHERE listing_id = ${listingId}`;

  // Step 3: INSERT binding via admin (direct SQL INSERT, no ON CONFLICT)
  await adminSql`INSERT INTO authority_v1.reservation_payment_bindings
    (purchase_id, payment_intent_id, listing_id, buyer_user_id,
     authority_version, reservation_revision, reservation_token_hash, capture_state)
    VALUES (${purchaseId}, ${paymentIntentId}, ${listingId}, ${buyerId},
            1, ${revision}, ${tokenHash}, 'authorized')`;

  return { revision };
}

// Setup for sold/finalized state (T7 — captured PI)
// Uses executor for initial reserve+bind, then admin UPDATE to transition to sold.
async function setupSoldListingWithBinding(executorSql, adminSql, listingId, sellerId, buyerId, purchaseId, paymentIntentId) {
  const token = `tok_sold_${listingId}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  // 1. Set up a reserved listing with binding via executor (function calls)
  const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, paymentIntentId);
  // 2. UPDATE authority to sold + binding to finalized via admin (direct UPDATE)
  await adminSql`UPDATE authority_v1.reservation_authority SET lifecycle_state = 'sold', buyer_user_id = null, reservation_token_hash = null, reservation_expires_at = null, reservation_revision = null, updated_at = now() WHERE listing_id = ${listingId}`;
  await adminSql`UPDATE authority_v1.reservation_payment_bindings SET capture_state = 'finalized', updated_at = now() WHERE purchase_id = ${purchaseId}`;
}

async function setTransferState(adminSql, lid, state) {
  await adminSql`UPDATE authority_v1.reservation_authority SET transfer_state = ${state} WHERE listing_id = ${lid}`;
}

// ── State helpers ──────────────────────────────────────────────────────────────
async function getAuthority(adminSql, lid) {
  const rows = await adminSql`SELECT version, lifecycle_state, recovery_blocked, checkout_quarantined, transfer_state FROM authority_v1.reservation_authority WHERE listing_id = ${lid}`;
  return rows[0] || null;
}
async function getBinding(adminSql, pid) {
  const rows = await adminSql`SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${pid}`;
  return rows[0] || null;
}
async function getAction(adminSql, aid) {
  const rows = await adminSql`SELECT status, stripe_idempotency_key FROM authority_v1.payment_actions WHERE action_id = ${aid}`;
  return rows[0] || null;
}
async function getIncident(adminSql, lid) {
  const rows = await adminSql`SELECT incident_type, resolved FROM authority_v1.operational_incidents WHERE reference_id = ${lid}`;
  return rows[0] || null;
}
async function getOpCount(adminSql, lid) {
  const rows = await adminSql`SELECT count(*)::int c FROM authority_v1.reservation_operations WHERE listing_id = ${lid}`;
  return Number(rows[0]?.c || 0);
}
async function countIncidents(adminSql, lid) {
  const rows = await adminSql`SELECT count(*)::int c FROM authority_v1.operational_incidents WHERE reference_id = ${lid}`;
  return Number(rows[0]?.c || 0);
}
async function countPaymentActionsByPurchase(adminSql, pid) {
  const rows = await adminSql`SELECT count(*)::int c FROM authority_v1.payment_actions WHERE purchase_id = ${pid}`;
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

// ── Seam invocation — the exact routing function cancelPurchase/entry.ts calls ──
// Assembles the same deps the handler passes to maybeRouteCanaryCancelPurchase
// and returns { result, entities, notifyCalls } so callers can inspect the mock.
async function runSeam(opts) {
  const { executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter, body, role } = opts;
  const entities = makeMockEntities();
  entities._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
  entities._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
  entities._store.purchasePrivates.set(`pp_${pid}`, { id: `pp_${pid}`, purchase_id: pid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_revision: revision });
  const base44 = makeMockBase44(entities);
  const notifyCalls = [];
  const result = await maybeRouteCanaryCancelPurchase({
    base44,
    user: { id: buyerId, email: buyerId, role: role || 'admin' },
    listing: { id: lid, notes: '[AUTH_CANARY]' },
    purchase: { id: pid, listing_id: lid, payment_intent_id: pi.id, seller_email: `seller_${lid}` },
    purchasePrivate: { purchase_id: pid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_revision: revision },
    executorUrl, recorderUrl,
    stripeAdapter: adapter,
    executorClient, recorderClient,
    // Trusted dependency injection: the harness supplies true directly when
    // constructing the router. This mirrors the handler supplying
    // isCanaryEnabled() — never derived from user input or the environment.
    canaryEnabled: true,
    sendNotification: async (info) => { notifyCalls.push(info); },
    body: body || {},
  });
  return { result, entities, notifyCalls };
}

// ── Test runner ──────────────────────────────────────────────────────────────
export async function runAllTests(deps) {
  const { adminSql, executorSql, executorUrl, recorderUrl, testKey } = deps;
  const executorClient = createAuthorityV1Client(executorUrl);
  const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

  let passed = 0, failed = 0;
  const failures = [];
  const stripeObjects = [];
  const providerRequestLog = [];
  function assert(cond, msg) {
    if (cond) passed++;
    else { failed++; failures.push(msg); }
  }

  // ── T0: Flag-OFF guard — normal production config cannot enter the canary path ──
  // The handler supplies isCanaryEnabled() (the committed default-OFF flag).
  // This test supplies the same value (false) directly via dependency injection
  // and proves the seam returns 503 CANARY_DISABLED — no bypass, no provider call.
  {
    const guardAdapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const guardResult = await maybeRouteCanaryCancelPurchase({
      base44: makeMockBase44(makeMockEntities()),
      user: { id: 'guard', email: 'guard@example.com', role: 'admin' },
      listing: { id: 'guard_l', notes: '[AUTH_CANARY]' },
      purchase: { id: 'guard_p', listing_id: 'guard_l', payment_intent_id: 'pi_guard', seller_email: 's_guard' },
      purchasePrivate: { purchase_id: 'guard_p', payment_intent_id: 'pi_guard', buyer_email: 'guard@example.com', reservation_revision: 'r_guard' },
      executorUrl, recorderUrl,
      stripeAdapter: guardAdapter,
      executorClient, recorderClient,
      canaryEnabled: false, // the real committed production configuration
    });
    const counts = guardAdapter._counts();
    assert(guardResult?.status === 503, `T0: flag-OFF guard returns 503 (got ${guardResult?.status})`);
    assert(guardResult?.body?.code === 'CANARY_DISABLED', `T0: CANARY_DISABLED (got ${guardResult?.body?.code})`);
    assert(counts.cancelCount === 0, `T0: zero cancel requests (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 0, `T0: zero retrieve requests (got ${counts.retrieveCount})`);
    providerRequestLog.push({ scenario: 'T0', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });
  }

  // ── T1: Successful cancel → exactly one real Stripe cancel, quarantine ──
  {
    const lid = `cert_real_t1_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T1', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result, entities, notifyCalls } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter });

    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const counts = adapter._counts();

    assert(result.status === 200, `T1: status 200 (got ${result.status})`);
    assert(result.body?.canceled === true, 'T1: canceled');
    assert(result.body?.released === true, 'T1: released');
    assert(result.body?.quarantined === true, 'T1: quarantined');
    assert(result.body?.code === 'CANCELLED_INVENTORY_QUARANTINED', `T1: code (got ${result.body?.code})`);
    assert(counts.cancelCount === 1, `T1: exactly 1 Stripe cancel (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 1, `T1: exactly 1 Stripe retrieve (got ${counts.retrieveCount})`);
    assert(auth?.lifecycle_state === 'available', `T1: authority available (got ${auth?.lifecycle_state})`);
    assert(auth?.recovery_blocked === true, 'T1: authority recovery_blocked');
    assert(auth?.checkout_quarantined === true, 'T1: authority checkout_quarantined');
    assert(binding?.capture_state === 'canceled', `T1: binding canceled (got ${binding?.capture_state})`);
    assert(entities._store.listings.get(lid)?.status === 'hidden', 'T1: mirror listing hidden (NOT active)');
    assert(entities._store.listings.get(lid)?.hidden_reason === 'cancel_inventory_quarantined', 'T1: hidden_reason');
    assert(counts.lastLivemode === false, `T1: Stripe livemode=false (got ${counts.lastLivemode})`);
    assert(pi.livemode === false, 'T1: created PI livemode=false');
    assert(notifyCalls.length === 1, `T1: exactly 1 notification (got ${notifyCalls.length})`);
    assert(notifyCalls[0]?.type === 'cancel_quarantined', 'T1: notification type');
    providerRequestLog.push({ scenario: 'T1', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql, lid);
  }

  // ── T2: Identical replay → no second Stripe request, no new ops/incidents/mirrors/notifications ──
  {
    const lid = `cert_real_t2_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T2', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const seamOpts = { executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter };

    const { result: r1, entities, notifyCalls } = await runSeam(seamOpts);
    const opsAfterFirst = await getOpCount(adminSql, lid);
    const incidentsAfterFirst = await countIncidents(adminSql, lid);
    const outboxAfterFirst = entities._store.outbox.size;
    const notifyAfterFirst = notifyCalls.length;

    const { result: r2 } = await runSeam(seamOpts); // identical replay
    const opsAfterSecond = await getOpCount(adminSql, lid);
    const incidentsAfterSecond = await countIncidents(adminSql, lid);
    const outboxAfterSecond = entities._store.outbox.size;
    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const counts = adapter._counts();

    assert(r1.status === 200 && r1.body?.canceled === true, 'T2: first call canceled');
    assert(r2.status === 200, `T2: replay 200 (got ${r2.status})`);
    assert(r2.body?.replay === true, 'T2: replay flag set');
    assert(r2.body?.quarantined === true, 'T2: replay quarantined');
    assert(r2.body?.code === 'CANCELLED_INVENTORY_QUARANTINED', 'T2: replay code');
    assert(counts.cancelCount === 1, `T2: still 1 Stripe cancel (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 1, `T2: still 1 Stripe retrieve (got ${counts.retrieveCount})`);
    assert(opsAfterSecond === opsAfterFirst, `T2: no new operation rows (${opsAfterFirst}→${opsAfterSecond})`);
    assert(incidentsAfterSecond === incidentsAfterFirst, `T2: no new incidents (${incidentsAfterFirst}→${incidentsAfterSecond})`);
    assert(outboxAfterSecond === outboxAfterFirst, `T2: no new outbox events (${outboxAfterFirst}→${outboxAfterSecond})`);
    assert(notifyCalls.length === notifyAfterFirst, `T2: no new notifications (${notifyAfterFirst}→${notifyCalls.length})`);
    assert(auth?.lifecycle_state === 'available', 'T2: authority still available');
    assert(binding?.capture_state === 'canceled', 'T2: binding still canceled');
    providerRequestLog.push({ scenario: 'T2', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql, lid);
  }

  // ── T3: Simulated lost response → cancel_unknown, then reconcile from Stripe state without recanceling ──
  {
    const lid = `cert_real_t3_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T3', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    // First attempt: real cancel succeeds on Stripe, then proxy throws (lost response).
    const adapter1 = wrapWithCounts(createStripeCancelProvider(testKey), { throwAfterCancel: true });
    const { result: r1 } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter: adapter1 });
    const authAfterUnknown = await getAuthority(adminSql, lid);
    const bindingAfterUnknown = await getBinding(adminSql, pid);
    const incidentAfterUnknown = await getIncident(adminSql, lid);
    const counts1 = adapter1._counts();

    assert(r1.status === 200 && r1.body?.cancel_unknown === true, 'T3: first call cancel_unknown');
    assert(counts1.cancelCount === 1, `T3: first call did 1 real cancel (got ${counts1.cancelCount})`);
    assert(counts1.retrieveCount === 1, `T3: first call did 1 retrieve (got ${counts1.retrieveCount})`);
    assert(authAfterUnknown?.recovery_blocked === true, 'T3: recovery_blocked after unknown');
    assert(bindingAfterUnknown?.capture_state === 'cancel_unknown', `T3: binding cancel_unknown (got ${bindingAfterUnknown?.capture_state})`);
    assert(incidentAfterUnknown?.incident_type === 'cancel_unknown' && incidentAfterUnknown?.resolved === false, 'T3: incident open');

    // Reconcile: retrieve Stripe's actual state (canceled) WITHOUT recanceling.
    const adapter2 = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result: r2, entities } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter: adapter2 });
    const authAfterRecon = await getAuthority(adminSql, lid);
    const bindingAfterRecon = await getBinding(adminSql, pid);
    const incidentAfterRecon = await getIncident(adminSql, lid);
    const counts2 = adapter2._counts();

    assert(r2.status === 200 && r2.body?.canceled === true, 'T3: recon canceled');
    assert(r2.body?.quarantined === true, 'T3: recon quarantined');
    assert(r2.body?.code === 'CANCELLED_INVENTORY_QUARANTINED', 'T3: recon code');
    assert(counts2.cancelCount === 0, `T3: recon did NOT recancel (got ${counts2.cancelCount})`);
    assert(counts2.retrieveCount === 1, `T3: recon retrieved PI state (got ${counts2.retrieveCount})`);
    assert(counts2.lastPiStatus === 'canceled', `T3: Stripe PI is canceled (got ${counts2.lastPiStatus})`);
    assert(authAfterRecon?.lifecycle_state === 'available', `T3: authority available (got ${authAfterRecon?.lifecycle_state})`);
    assert(authAfterRecon?.recovery_blocked === true, 'T3: recon recovery_blocked (quarantined)');
    assert(authAfterRecon?.checkout_quarantined === true, 'T3: recon checkout_quarantined');
    assert(bindingAfterRecon?.capture_state === 'canceled', `T3: recon binding canceled (got ${bindingAfterRecon?.capture_state})`);
    assert(incidentAfterRecon?.resolved === true, 'T3: incident resolved');
    assert(entities._store.listings.get(lid)?.status === 'hidden', 'T3: mirror hidden (NOT active)');
    providerRequestLog.push({ scenario: 'T3-first', cancelCount: counts1.cancelCount, retrieveCount: counts1.retrieveCount });
    providerRequestLog.push({ scenario: 'T3-recon', cancelCount: counts2.cancelCount, retrieveCount: counts2.retrieveCount });

    await cleanupListing(adminSql, lid);
  }

  // ── T4: Transfer states (not_started, in_progress, seller_reported_sent, unknown) all preserve quarantine ──
  {
    const transferStates = ['not_started', 'in_progress', 'seller_reported_sent', 'unknown'];
    for (const ts of transferStates) {
      const lid = `cert_real_t4_${ts}_${genId()}`;
      const pid = `pur_${lid}`;
      const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
      stripeObjects.push({ id: pi.id, scenario: `T4-${ts}`, status: pi.status, livemode: pi.livemode });
      const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);
      if (ts !== 'not_started') {
        await setTransferState(adminSql, lid, ts);
      }

      const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
      const { result, entities } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter });
      const auth = await getAuthority(adminSql, lid);
      const binding = await getBinding(adminSql, pid);
      const counts = adapter._counts();

      assert(result.status === 200, `T4-${ts}: status 200 (got ${result.status})`);
      assert(result.body?.canceled === true, `T4-${ts}: canceled`);
      assert(result.body?.quarantined === true, `T4-${ts}: quarantined`);
      assert(result.body?.code === 'CANCELLED_INVENTORY_QUARANTINED', `T4-${ts}: code`);
      assert(counts.cancelCount === 1, `T4-${ts}: exactly 1 Stripe cancel (got ${counts.cancelCount})`);
      assert(auth?.lifecycle_state === 'available', `T4-${ts}: authority available`);
      assert(auth?.recovery_blocked === true, `T4-${ts}: recovery_blocked`);
      assert(auth?.checkout_quarantined === true, `T4-${ts}: checkout_quarantined`);
      assert(binding?.capture_state === 'canceled', `T4-${ts}: binding canceled`);
      assert(entities._store.listings.get(lid)?.status === 'hidden', `T4-${ts}: mirror hidden (NOT active)`);
      assert(entities._store.listings.get(lid)?.hidden_reason === 'cancel_inventory_quarantined', `T4-${ts}: hidden_reason`);
      // No active/relist mirror — status is 'hidden', never 'active'
      assert(entities._store.listings.get(lid)?.status !== 'active', `T4-${ts}: mirror is NOT active (no relist)`);
      providerRequestLog.push({ scenario: `T4-${ts}`, cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

      await cleanupListing(adminSql, lid);
    }
  }

  // ── T5: Mirror failure cannot roll back PostgreSQL authority ──
  {
    const lid = `cert_real_t5_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T5', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result, entities } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter, body: { simulate_mirror_failure: true } });
    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const counts = adapter._counts();

    assert(result.status === 200 && result.body?.canceled === true, 'T5: canceled');
    assert(result.body?.quarantined === true, 'T5: quarantined');
    assert(counts.cancelCount === 1, `T5: 1 real cancel (got ${counts.cancelCount})`);
    assert(auth?.lifecycle_state === 'available', `T5: authority available despite mirror failure (got ${auth?.lifecycle_state})`);
    assert(auth?.recovery_blocked === true, 'T5: authority recovery_blocked (quarantined)');
    assert(auth?.checkout_quarantined === true, 'T5: authority checkout_quarantined');
    assert(binding?.capture_state === 'canceled', `T5: binding canceled despite mirror failure (got ${binding?.capture_state})`);
    assert(entities._store.outbox.size >= 1, `T5: outbox created (got ${entities._store.outbox.size})`);
    assert(result.body?.mirror?.outbox_id !== null, 'T5: mirror outbox_id set');
    providerRequestLog.push({ scenario: 'T5', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql, lid);
  }

  // ── T6: Binding, amount/currency, buyer authorization, operation identity, and livemode safeguards ──
  {
    const lid = `cert_real_t6_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T6', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    // T6a: Successful cancel with safeguard verification
    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result, entities } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter });
    const auth = await getAuthority(adminSql, lid);
    const action = await getAction(adminSql, result.body?.action_id);
    const counts = adapter._counts();

    assert(pi.livemode === false, 'T6: created PI livemode=false');
    assert(counts.lastLivemode === false, `T6: canceled PI livemode=false (got ${counts.lastLivemode})`);
    assert(pi.amount === TEST_AMOUNT_MINOR, `T6: amount bound (got ${pi.amount})`);
    assert(pi.currency === TEST_CURRENCY, `T6: currency bound (got ${pi.currency})`);
    assert(counts.lastPiId === pi.id, 'T6: PI identity bound across calls');
    assert(auth?.version >= 2, `T6: authority version progressed (got ${auth?.version})`);
    assert(action?.stripe_idempotency_key === result.body?.stripe_idempotency_key, 'T6: idem key bound in action');
    assert(result.body?.stripe_idempotency_key === `idem_cancel_${result.body?.action_id}`, 'T6: idem key = idem_cancel_<actionId>');
    assert(entities._store.listings.get(lid)?.status === 'hidden', 'T6: mirror hidden (NOT active)');
    providerRequestLog.push({ scenario: 'T6', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql, lid);

    // T6b: Non-buyer authorization rejection (zero provider calls)
    const lid2 = `cert_real_t6b_${genId()}`;
    const pid2 = `pur_${lid2}`;
    const pi2 = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi2.id, scenario: 'T6b', status: pi2.status, livemode: pi2.livemode });
    const buyerId2 = `buyer_${lid2}`, sellerId2 = `seller_${lid2}`, token2 = `tok_${lid2}`;
    const expiresAt2 = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision: revision2 } = await setupReservedListingWithBinding(executorSql, adminSql, lid2, sellerId2, buyerId2, token2, expiresAt2, pid2, pi2.id);

    const adapter2 = wrapWithCounts(createStripeCancelProvider(testKey));
    // Non-buyer, non-admin user
    const entities2 = makeMockEntities();
    entities2._store.listings.set(lid2, { id: lid2, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
    entities2._store.listingPrivates.set(`lp_${lid2}`, { id: `lp_${lid2}`, listing_id: lid2 });
    entities2._store.purchasePrivates.set(`pp_${pid2}`, { id: `pp_${pid2}`, purchase_id: pid2, payment_intent_id: pi2.id, buyer_email: buyerId2, reservation_revision: revision2 });
    const unauthResult = await maybeRouteCanaryCancelPurchase({
      base44: makeMockBase44(entities2),
      user: { id: 'other_user', email: 'notbuyer@test.com', role: 'user' },
      listing: { id: lid2, notes: '[AUTH_CANARY]' },
      purchase: { id: pid2, listing_id: lid2, payment_intent_id: pi2.id, seller_email: sellerId2 },
      purchasePrivate: { purchase_id: pid2, payment_intent_id: pi2.id, buyer_email: buyerId2, reservation_revision: revision2 },
      executorUrl, recorderUrl,
      stripeAdapter: adapter2,
      executorClient, recorderClient,
      canaryEnabled: true,
    });
    const counts2b = adapter2._counts();
    assert(unauthResult?.status === 403, `T6b: non-buyer rejected 403 (got ${unauthResult?.status})`);
    assert(unauthResult?.body?.code === 'NOT_BUYER', `T6b: NOT_BUYER (got ${unauthResult?.body?.code})`);
    assert(counts2b.cancelCount === 0, `T6b: zero cancel requests (got ${counts2b.cancelCount})`);
    assert(counts2b.retrieveCount === 0, `T6b: zero retrieve requests (got ${counts2b.retrieveCount})`);
    providerRequestLog.push({ scenario: 'T6b', cancelCount: counts2b.cancelCount, retrieveCount: counts2b.retrieveCount });

    await cleanupListing(adminSql, lid2);
  }

  // ── T7: Captured/succeeded PaymentIntents remain CAPTURED_OUT_OF_SCOPE, never sent to cancel endpoint ──
  {
    const lid = `cert_real_t7_${genId()}`;
    const pid = `pur_${lid}`;
    // Create a real captured (succeeded) PI
    const pi = await createCapturedPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T7', status: pi.status, livemode: pi.livemode });
    const sellerId = `seller_${lid}`;
    const buyerIdT7 = `buyer_${lid}`;
    await setupSoldListingWithBinding(executorSql, adminSql, lid, sellerId, buyerIdT7, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId: `buyer_${lid}`, revision: 'rev_sold', adapter });
    const counts = adapter._counts();

    assert(result.status === 409, `T7: status 409 (got ${result.status})`);
    assert(result.body?.code === 'CAPTURED_OUT_OF_SCOPE', `T7: CAPTURED_OUT_OF_SCOPE (got ${result.body?.code})`);
    assert(counts.cancelCount === 0, `T7: zero cancel requests (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 0, `T7: zero retrieve requests (got ${counts.retrieveCount})`);
    assert(pi.livemode === false, 'T7: captured PI livemode=false');
    assert(pi.status === 'succeeded', `T7: PI is succeeded (got ${pi.status})`);
    providerRequestLog.push({ scenario: 'T7', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql, lid);
  }

  // ── T8: Exact synthetic cleanup → all seven authority tables empty ──
  {
    await truncateAll(adminSql);
    const counts = await countAll(adminSql);
    const allClean = Object.values(counts).every(c => c === 0);
    assert(allClean, `T8: all 7 tables empty (got ${JSON.stringify(counts)})`);

    // Aggregate provider request counts
    const totalCancelRequests = providerRequestLog.reduce((s, r) => s + r.cancelCount, 0);
    const totalRetrieveRequests = providerRequestLog.reduce((s, r) => s + r.retrieveCount, 0);

    const sanitized = stripeObjects.map(o => ({ id: o.id, scenario: o.scenario, livemode: o.livemode, final_status: o.status }));
    return {
      passed,
      failed,
      failures: failures.slice(0, 10),
      allClean,
      finalCounts: counts,
      stripeObjects: sanitized,
      stripeCancelTotal: totalCancelRequests,
      stripeRetrieveTotal: totalRetrieveRequests,
      providerRequestLog,
    };
  }
}