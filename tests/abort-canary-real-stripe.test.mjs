/**
 * abort-canary-real-stripe.test.mjs — P0-01P Real Stripe TEST-MODE certification.
 *
 * Certifies the DEPLOYED abortCheckout canary path against the REAL Stripe API
 * in TEST MODE only. Exercises the SAME routing seam the handler uses:
 *   maybeRouteCanaryAbort (base44/shared/abortCanaryOrchestrator.js) — the
 *   exact function abortCheckout/entry.ts calls. No duplicated provider
 *   logic: the shared production adapter (base44/shared/stripeCancelProvider.js)
 *   is imported and executed by both the handler and this harness. The harness
 *   wraps the adapter in a thin observability proxy (counts + optional
 *   lost-response throw) but never reimplements retrieve/cancel behavior.
 *
 * SEAM: maybeRouteCanaryAbort performs the full guard (isCanaryListing,
 *   body.canary, admin, canaryEnabled, executor/recorder URL) then invokes
 *   runCanaryAbortSaga with the shared adapter. The harness injects the same
 *   executor/recorder clients and purchasePrivate the handler assembles.
 *
 * SAFETY:
 *   - NEVER uses a live-mode key. The caller (exec_tool sandbox) verifies the
 *     key starts with sk_test_ before invoking runAllTests. This module never
 *     reads process.env for the key and never logs/returns it.
 *   - Synthetic IDs only. No real users, listings, purchases, cards, or money.
 *   - All Stripe test PaymentIntents are manual-capture, tagged with
 *     metadata { pg_cert: 'P0-01P', purpose: 'canary_abort_cert' }.
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
 * deps = { adminSql, executorSql, executorUrl, recorderUrl, testKey }
 *   adminSql      — neon(adminUrl) for exact synthetic setup/cleanup only
 *   executorSql   — neon(executorUrl) for initialize_listing (setup)
 *   executorUrl   — AUTHORITY_V1_DB_URL_DEV_EXECUTOR (runtime executor)
 *   recorderUrl   — AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER (runtime recorder)
 *   testKey       — verified sk_test_ Stripe key (never logged)
 */
import Stripe from 'npm:stripe@14.21.0';
import { createAuthorityV1Client } from '../base44/shared/authorityV1Client.js';
import { createAuthorityV1StripeRecorderClient } from '../base44/shared/authorityV1StripeRecorderClient.js';
import { maybeRouteCanaryAbort } from '../base44/shared/abortCanaryOrchestrator.js';
import { createStripeCancelProvider } from '../base44/shared/stripeCancelProvider.js';
import { sha256Hex, canonicalEnvelope } from '../base44/shared/canaryMirror.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function genId() {
  return crypto.randomUUID();
}

const CERT_METADATA = { pg_cert: 'P0-01P', purpose: 'canary_abort_cert' };
const TEST_AMOUNT_MINOR = 100; // $1.00 USD — test mode, no real money
const TEST_CURRENCY = 'usd';
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
    description: 'PG P0-01P canary abort certification (test mode)',
  });
  if (!pi?.id) throw new Error('PI_CREATE_FAILED: no id returned');
  if (pi.status !== 'requires_capture') throw new Error(`PI_UNEXPECTED_STATUS: ${pi.status}`);
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
    description: 'PG P0-01P canary abort certification (captured, test mode)',
  });
  if (pi.status !== 'requires_capture') throw new Error(`PI_UNEXPECTED_STATUS: ${pi.status}`);
  const captured = await stripe.paymentIntents.capture(pi.id);
  if (captured.status !== 'succeeded') throw new Error(`CAPTURE_FAILED: ${captured.status}`);
  return captured;
}

// ── Observability proxy (NOT a provider reimplementation) ─────────────────────
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
  const initOpId = `cert_init_${listingId}_${genId()}`;
  const initHash = await sha256Hex(canonicalEnvelope({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
  await executorSql`SELECT authority_v1.initialize_listing(${listingId}, ${sellerId}, ${initOpId}, ${initHash})`;

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

  await adminSql`INSERT INTO authority_v1.reservation_payment_bindings
    (purchase_id, payment_intent_id, listing_id, buyer_user_id,
     authority_version, reservation_revision, reservation_token_hash, capture_state)
    VALUES (${purchaseId}, ${paymentIntentId}, ${listingId}, ${buyerId},
            1, ${revision}, ${tokenHash}, 'authorized')`;

  return { revision };
}

// Setup for sold/finalized state (T8 — captured PI)
async function setupSoldListingWithBinding(executorSql, adminSql, listingId, sellerId, buyerId, purchaseId, paymentIntentId) {
  const token = `tok_sold_${listingId}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await setupReservedListingWithBinding(executorSql, adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, paymentIntentId);
  await adminSql`UPDATE authority_v1.reservation_authority SET lifecycle_state = 'sold', buyer_user_id = null, reservation_token_hash = null, reservation_expires_at = null, reservation_revision = null, updated_at = now() WHERE listing_id = ${listingId}`;
  await adminSql`UPDATE authority_v1.reservation_payment_bindings SET capture_state = 'finalized', updated_at = now() WHERE purchase_id = ${purchaseId}`;
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
async function cleanupListing(adminSql) {
  await truncateAll(adminSql);
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

// ── Seam invocation — the exact routing function abortCheckout/entry.ts calls ──
async function runSeam(opts) {
  const { executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter, body, role } = opts;
  const entities = makeMockEntities();
  entities._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
  entities._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
  entities._store.purchasePrivates.set(`pp_${pid}`, { id: `pp_${pid}`, purchase_id: pid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_revision: revision });
  const base44 = makeMockBase44(entities);
  const result = await maybeRouteCanaryAbort({
    base44,
    user: { id: buyerId, email: buyerId, role: role || 'admin' },
    body: { canary: true, ...(body || {}) },
    listing: { id: lid, notes: '[AUTH_CANARY]' },
    purchase: { id: pid, listing_id: lid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_token: revision },
    purchasePrivate: { purchase_id: pid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_revision: revision },
    executorUrl, recorderUrl,
    stripeAdapter: adapter,
    executorClient, recorderClient,
    canaryEnabled: true,
  });
  return { result, entities };
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

  await truncateAll(adminSql);

  // ── T0: Flag-OFF guard — normal production config cannot enter the canary path ──
  {
    const guardAdapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const guardResult = await maybeRouteCanaryAbort({
      base44: makeMockBase44(makeMockEntities()),
      user: { id: 'guard', email: 'guard@example.com', role: 'admin' },
      body: { canary: true, purchase_id: 'guard_p' },
      listing: { id: 'guard_l', notes: '[AUTH_CANARY]' },
      purchase: { id: 'guard_p', listing_id: 'guard_l', payment_intent_id: 'pi_guard', buyer_email: 'guard@example.com', reservation_token: 'r_guard' },
      purchasePrivate: { purchase_id: 'guard_p', payment_intent_id: 'pi_guard', buyer_email: 'guard@example.com', reservation_revision: 'r_guard' },
      executorUrl, recorderUrl,
      stripeAdapter: guardAdapter,
      executorClient, recorderClient,
      canaryEnabled: false,
    });
    const counts = guardAdapter._counts();
    assert(guardResult?.status === 503, `T0: flag-OFF guard returns 503 (got ${guardResult?.status})`);
    assert(guardResult?.body?.code === 'CANARY_DISABLED', `T0: CANARY_DISABLED (got ${guardResult?.body?.code})`);
    assert(counts.cancelCount === 0, `T0: zero cancel requests (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 0, `T0: zero retrieve requests (got ${counts.retrieveCount})`);
    providerRequestLog.push({ scenario: 'T0', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });
  }

  // ── T1: Successful abort → exactly one real Stripe cancel, authority released ──
  {
    const lid = `cert_real_t1_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T1', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result, entities } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter });

    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const counts = adapter._counts();

    assert(result.status === 200, `T1: status 200 (got ${result.status})`);
    assert(result.body?.canceled === true, 'T1: canceled');
    assert(result.body?.released === true, 'T1: released');
    assert(result.body?.provider_called === true, 'T1: provider_called');
    assert(result.body?.provider_result === 'succeeded', 'T1: provider_result succeeded');
    assert(counts.cancelCount === 1, `T1: exactly 1 Stripe cancel (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 1, `T1: exactly 1 Stripe retrieve (got ${counts.retrieveCount})`);
    assert(auth?.lifecycle_state === 'available', `T1: authority available (got ${auth?.lifecycle_state})`);
    assert(auth?.recovery_blocked === false, 'T1: authority NOT recovery_blocked (released)');
    assert(binding?.capture_state === 'canceled', `T1: binding canceled (got ${binding?.capture_state})`);
    assert(entities._store.listings.get(lid)?.status === 'active', 'T1: mirror listing active (released)');
    assert(entities._store.listings.get(lid)?.reservation_token === null, 'T1: mirror reservation cleared');
    assert(counts.lastLivemode === false, `T1: Stripe livemode=false (got ${counts.lastLivemode})`);
    assert(pi.livemode === false, 'T1: created PI livemode=false');
    providerRequestLog.push({ scenario: 'T1', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql);
  }

  // ── T2: Identical replay → no second Stripe request, no new ops/incidents/outbox ──
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

    const { result: r1, entities } = await runSeam(seamOpts);
    const opsAfterFirst = await getOpCount(adminSql, lid);
    const incidentsAfterFirst = await countIncidents(adminSql, lid);
    const outboxAfterFirst = entities._store.outbox.size;

    const { result: r2 } = await runSeam(seamOpts);
    const opsAfterSecond = await getOpCount(adminSql, lid);
    const incidentsAfterSecond = await countIncidents(adminSql, lid);
    const outboxAfterSecond = entities._store.outbox.size;
    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const counts = adapter._counts();

    assert(r1.status === 200 && r1.body?.canceled === true, 'T2: first call canceled');
    assert(r2.status === 409, `T2: replay 409 NOT_CANCELLABLE (got ${r2.status})`);
    assert(r2.body?.code === 'NOT_CANCELLABLE', `T2: replay code NOT_CANCELLABLE (got ${r2.body?.code})`);
    assert(counts.cancelCount === 1, `T2: still 1 Stripe cancel (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 1, `T2: still 1 Stripe retrieve (got ${counts.retrieveCount})`);
    assert(opsAfterSecond === opsAfterFirst, `T2: no new operation rows (${opsAfterFirst}→${opsAfterSecond})`);
    assert(incidentsAfterSecond === incidentsAfterFirst, `T2: no new incidents (${incidentsAfterFirst}→${incidentsAfterSecond})`);
    assert(outboxAfterSecond === outboxAfterFirst, `T2: no new outbox events (${outboxAfterFirst}→${outboxAfterSecond})`);
    assert(auth?.lifecycle_state === 'available', 'T2: authority still available');
    assert(binding?.capture_state === 'canceled', 'T2: binding still canceled');
    providerRequestLog.push({ scenario: 'T2', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql);
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
    assert(r1.body?.recovery_blocked === true, 'T3: first call recovery_blocked');
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
    assert(r2.body?.released === true, 'T3: recon released');
    assert(counts2.cancelCount === 0, `T3: recon did NOT recancel (got ${counts2.cancelCount})`);
    assert(counts2.retrieveCount === 1, `T3: recon retrieved PI state (got ${counts2.retrieveCount})`);
    assert(counts2.lastPiStatus === 'canceled', `T3: Stripe PI is canceled (got ${counts2.lastPiStatus})`);
    assert(authAfterRecon?.lifecycle_state === 'available', `T3: authority available (got ${authAfterRecon?.lifecycle_state})`);
    assert(authAfterRecon?.recovery_blocked === false, 'T3: recon recovery_blocked cleared');
    assert(bindingAfterRecon?.capture_state === 'canceled', `T3: recon binding canceled (got ${bindingAfterRecon?.capture_state})`);
    assert(incidentAfterRecon?.resolved === true, 'T3: incident resolved');
    assert(entities._store.listings.get(lid)?.status === 'active', 'T3: mirror active (released)');
    providerRequestLog.push({ scenario: 'T3-first', cancelCount: counts1.cancelCount, retrieveCount: counts1.retrieveCount });
    providerRequestLog.push({ scenario: 'T3-recon', cancelCount: counts2.cancelCount, retrieveCount: counts2.retrieveCount });

    await cleanupListing(adminSql);
  }

  // ── T4: Concurrent identical aborts → one committed provider effect ──
  {
    const lid = `cert_real_t4_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T4', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const seamOpts = { executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter };
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(runSeam(seamOpts).then(r => ({ ok: r.result?.body?.canceled === true })).catch(() => ({ ok: false })));
    }
    const outcomes = await Promise.all(promises);
    const succ = outcomes.filter(r => r.ok).length;
    const paCount = await countPaymentActionsByPurchase(adminSql, pid);
    const counts = adapter._counts();

    assert(paCount === 1, `T4: 1 payment_action (got ${paCount})`);
    assert(succ === 1, `T4: 1 success (got ${succ})`);
    assert(counts.cancelCount === 1, `T4: exactly 1 Stripe cancel (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 1, `T4: exactly 1 Stripe retrieve (got ${counts.retrieveCount})`);
    providerRequestLog.push({ scenario: 'T4', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql);
  }

  // ── T5: Provider failure (captured PI) → fail-closed, NOT released ──
  {
    const lid = `cert_real_t5_${genId()}`;
    const pid = `pur_${lid}`;
    // Create a captured (succeeded) PI — the provider will return 'failed' (already_succeeded)
    const pi = await createCapturedPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T5', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    // Set up authority as 'reserved' (inconsistent with captured PI — tests fail-closed behavior)
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter });
    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const counts = adapter._counts();

    assert(result.status === 200, `T5: status 200 (got ${result.status})`);
    assert(result.body?.cancel_failed === true, 'T5: cancel_failed');
    assert(result.body?.recovery_blocked === true, 'T5: recovery_blocked');
    assert(result.body?.canceled !== true, 'T5: NOT canceled');
    assert(result.body?.released !== true, 'T5: NOT released');
    assert(counts.cancelCount === 0, `T5: 0 cancel API calls (PI succeeded, not cancellable) (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 1, `T5: 1 retrieve (got ${counts.retrieveCount})`);
    assert(auth?.lifecycle_state !== 'available', 'T5: authority NOT available (not released)');
    assert(auth?.recovery_blocked === true, 'T5: authority recovery_blocked');
    assert(binding?.capture_state === 'cancel_failed', `T5: binding cancel_failed (got ${binding?.capture_state})`);
    assert(counts.lastPiStatus === 'succeeded', `T5: PI is succeeded (got ${counts.lastPiStatus})`);
    providerRequestLog.push({ scenario: 'T5', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql);
  }

  // ── T6: Mirror failure cannot roll back PostgreSQL authority ──
  {
    const lid = `cert_real_t6_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T6', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result, entities } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter, body: { simulate_mirror_failure: true } });
    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const counts = adapter._counts();

    assert(result.status === 200 && result.body?.canceled === true, 'T6: canceled');
    assert(result.body?.released === true, 'T6: released');
    assert(counts.cancelCount === 1, `T6: 1 real cancel (got ${counts.cancelCount})`);
    assert(auth?.lifecycle_state === 'available', `T6: authority available despite mirror failure (got ${auth?.lifecycle_state})`);
    assert(binding?.capture_state === 'canceled', `T6: binding canceled despite mirror failure (got ${binding?.capture_state})`);
    assert(entities._store.outbox.size >= 1, `T6: outbox created (got ${entities._store.outbox.size})`);
    assert(result.body?.mirror?.outbox_id !== null, 'T6: mirror outbox_id set');
    providerRequestLog.push({ scenario: 'T6', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql);
  }

  // ── T7: Wrong buyer (non-admin) + conflicting replay → rejected before Stripe ──
  {
    // T7a: Non-admin user → 403 CANARY_ADMIN_REQUIRED, zero Stripe calls
    const lid = `cert_real_t7a_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T7a', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const entities = makeMockEntities();
    entities._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
    entities._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
    entities._store.purchasePrivates.set(`pp_${pid}`, { id: `pp_${pid}`, purchase_id: pid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_revision: revision });
    const unauthResult = await maybeRouteCanaryAbort({
      base44: makeMockBase44(entities),
      user: { id: 'other_user', email: 'notbuyer@test.com', role: 'user' },
      body: { canary: true, purchase_id: pid },
      listing: { id: lid, notes: '[AUTH_CANARY]' },
      purchase: { id: pid, listing_id: lid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_token: revision },
      purchasePrivate: { purchase_id: pid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_revision: revision },
      executorUrl, recorderUrl,
      stripeAdapter: adapter,
      executorClient, recorderClient,
      canaryEnabled: true,
    });
    const counts = adapter._counts();
    assert(unauthResult?.status === 403, `T7a: non-admin rejected 403 (got ${unauthResult?.status})`);
    assert(unauthResult?.body?.code === 'CANARY_ADMIN_REQUIRED', `T7a: CANARY_ADMIN_REQUIRED (got ${unauthResult?.body?.code})`);
    assert(counts.cancelCount === 0, `T7a: zero cancel requests (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 0, `T7a: zero retrieve requests (got ${counts.retrieveCount})`);
    providerRequestLog.push({ scenario: 'T7a', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql);

    // T7b: Conflicting replay (different action_id after first success) → 409, zero additional Stripe
    const lid2 = `cert_real_t7b_${genId()}`;
    const pid2 = `pur_${lid2}`;
    const pi2 = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi2.id, scenario: 'T7b', status: pi2.status, livemode: pi2.livemode });
    const buyerId2 = `buyer_${lid2}`, sellerId2 = `seller_${lid2}`, token2 = `tok_${lid2}`;
    const expiresAt2 = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision: revision2 } = await setupReservedListingWithBinding(executorSql, adminSql, lid2, sellerId2, buyerId2, token2, expiresAt2, pid2, pi2.id);

    const adapter2 = wrapWithCounts(createStripeCancelProvider(testKey));
    const seamOpts2 = { executorUrl, recorderUrl, executorClient, recorderClient, lid: lid2, pid: pid2, pi: pi2, buyerId: buyerId2, revision: revision2, adapter: adapter2 };
    const { result: r1 } = await runSeam(seamOpts2);
    assert(r1.body?.canceled === true, 'T7b: first succeeds');
    const { result: r2 } = await runSeam(seamOpts2);
    const counts2 = adapter2._counts();
    assert(r2.status === 409, `T7b: conflicting replay 409 (got ${r2.status})`);
    assert(r2.body?.code === 'NOT_CANCELLABLE', `T7b: NOT_CANCELLABLE (got ${r2.body?.code})`);
    assert(counts2.cancelCount === 1, `T7b: still 1 Stripe cancel (got ${counts2.cancelCount})`);
    assert(counts2.retrieveCount === 1, `T7b: still 1 Stripe retrieve (got ${counts2.retrieveCount})`);
    providerRequestLog.push({ scenario: 'T7b', cancelCount: counts2.cancelCount, retrieveCount: counts2.retrieveCount });

    await cleanupListing(adminSql);
  }

  // ── T8: Captured (sold) → 409 NOT_CANCELLABLE, zero Stripe calls ──
  {
    const lid = `cert_real_t8_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createCapturedPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T8', status: pi.status, livemode: pi.livemode });
    const sellerId = `seller_${lid}`;
    const buyerId = `buyer_${lid}`;
    await setupSoldListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision: 'rev_sold', adapter });
    const counts = adapter._counts();

    assert(result.status === 409, `T8: status 409 (got ${result.status})`);
    assert(result.body?.code === 'NOT_CANCELLABLE', `T8: NOT_CANCELLABLE (got ${result.body?.code})`);
    assert(counts.cancelCount === 0, `T8: zero cancel requests (got ${counts.cancelCount})`);
    assert(counts.retrieveCount === 0, `T8: zero retrieve requests (got ${counts.retrieveCount})`);
    assert(pi.livemode === false, 'T8: captured PI livemode=false');
    assert(pi.status === 'succeeded', `T8: PI is succeeded (got ${pi.status})`);
    providerRequestLog.push({ scenario: 'T8', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql);
  }

  // ── T9: PI identity, amount, currency, metadata, and test-mode binding ──
  {
    const lid = `cert_real_t9_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T9', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(executorSql, adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCancelProvider(testKey));
    const { result, entities } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter });
    const auth = await getAuthority(adminSql, lid);
    const action = await getAction(adminSql, result.body?.action_id);
    const counts = adapter._counts();

    assert(pi.livemode === false, 'T9: created PI livemode=false');
    assert(counts.lastLivemode === false, `T9: canceled PI livemode=false (got ${counts.lastLivemode})`);
    assert(pi.amount === TEST_AMOUNT_MINOR, `T9: amount bound (got ${pi.amount})`);
    assert(pi.currency === TEST_CURRENCY, `T9: currency bound (got ${pi.currency})`);
    assert(counts.lastPiId === pi.id, 'T9: PI identity bound across calls');
    assert(auth?.version >= 2, `T9: authority version progressed (got ${auth?.version})`);
    assert(action?.stripe_idempotency_key === result.body?.stripe_idempotency_key, 'T9: idem key bound in action');
    assert(result.body?.stripe_idempotency_key === `idem_abort_${result.body?.action_id}`, 'T9: idem key = idem_abort_<actionId>');
    assert(entities._store.listings.get(lid)?.status === 'active', 'T9: mirror active (released)');
    providerRequestLog.push({ scenario: 'T9', cancelCount: counts.cancelCount, retrieveCount: counts.retrieveCount });

    await cleanupListing(adminSql);
  }

  // ── T10: Exact synthetic cleanup → all seven authority tables empty ──
  {
    await truncateAll(adminSql);
    const counts = await countAll(adminSql);
    const allClean = Object.values(counts).every(c => c === 0);
    assert(allClean, `T10: all 7 tables empty (got ${JSON.stringify(counts)})`);

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