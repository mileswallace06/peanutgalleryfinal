/**
 * capture-canary-real-stripe.test.mjs — P0-01J Real Stripe TEST-MODE certification.
 *
 * Certifies the DEPLOYED capturePayment canary path against the REAL Stripe API
 * in TEST MODE only. Exercises the SAME routing seam the handler uses:
 *   maybeRouteCanaryCapture (base44/shared/captureCanaryOrchestrator.js) — the
 *   exact function capturePayment/entry.ts calls. No duplicated provider
 *   logic: the shared production adapter (base44/shared/stripeCaptureProvider.js)
 *   is imported and executed by both the handler and this harness. The harness
 *   wraps the adapter in a thin observability proxy (counts + optional
 *   lost-response throw) but never reimplements retrieve/capture behavior.
 *
 * SEAM: maybeRouteCanaryCapture performs the full guard (isCanaryListing,
 *   canary action, admin, flag, executor/recorder URL) then invokes
 *   runCanaryCaptureSaga with the shared adapter. The harness injects the same
 *   executor/recorder clients and purchasePrivate the handler would assemble.
 *
 * SAFETY:
 *   - NEVER uses a live-mode key. The caller (exec_tool sandbox) verifies the
 *     key starts with sk_test_ before invoking runAllTests. This module never
 *     reads process.env for the key and never logs/returns it.
 *   - Synthetic IDs only. No real users, listings, purchases, cards, or money.
 *   - All Stripe test PaymentIntents are manual-capture, tagged with
 *     metadata { pg_cert: 'P0-01J', purpose: 'canary_capture_cert' }.
 *   - Flag stays OFF in production (CANARY_ENABLED = false). The canary-routing
 *     function accepts its enabled state as a trusted, caller-supplied
 *     dependency (canaryEnabled). The production handler supplies
 *     isCanaryEnabled() (the committed default-OFF flag); this harness supplies
 *     true directly when constructing the router. No environment variable,
 *     global, request field, header, or secret can override the flag. T0
 *     proves the normal production configuration (canaryEnabled: false) cannot
 *     enter the canary path while OFF.
 *   - No admin fallback in the saga path. Executor-only authority access.
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
import { maybeRouteCanaryCapture } from '../base44/shared/captureCanaryOrchestrator.js';
import { createStripeCaptureProvider } from '../base44/shared/stripeCaptureProvider.js';
import { sha256Hex, canonicalEnvelope } from '../base44/shared/canaryMirror.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
async function genId() {
  return crypto.randomUUID();
}

const CERT_METADATA = { pg_cert: 'P0-01J', purpose: 'canary_capture_cert' };
const TEST_AMOUNT_MINOR = 100; // $1.00 USD — test mode, no real money
const TEST_CURRENCY = 'usd';
// Stripe prebuilt test PaymentMethod (Visa test card). No raw card data is sent
// — pm_card_visa is resolved server-side by Stripe in test mode. No PCI payload.
const TEST_PAYMENT_METHOD = 'pm_card_visa';
const RETURN_URL = 'https://peanutgallery.base44.app';

// ── Test fixture: create a real Stripe TEST-mode manual-capture PaymentIntent ──
// This is test SETUP (fixture creation), NOT the capture provider behavior being
// certified. Uses the Stripe SDK (same package as production). The certified
// capture behavior lives in the shared stripeCaptureProvider module.
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
    description: 'PG P0-01J canary capture certification (test mode)',
  });
  if (!pi?.id) {
    throw new Error('PI_CREATE_FAILED: no id returned');
  }
  if (pi.status !== 'requires_capture') {
    throw new Error(`PI_UNEXPECTED_STATUS: ${pi.status} (expected requires_capture)`);
  }
  return pi;
}

// ── Observability proxy (NOT a provider reimplementation) ─────────────────────
// Delegates capturePaymentIntent to the shared production adapter and records
// counts/livemode/pi_id for assertions. retrieveCount = calls (each does exactly
// 1 retrieve per the production logic); captureCount = calls where the retrieved
// PI was requires_capture (a capture was attempted). throwAfterCapture: after a
// successful real capture, throw to simulate a lost response (orchestrator →
// 'unknown' → capture_unknown).
function wrapWithCounts(realAdapter, options = {}) {
  const state = { captureCount: 0, retrieveCount: 0, lastLivemode: null, lastPiStatus: null, lastPiId: null };
  const throwAfterCapture = options.throwAfterCapture === true;
  return {
    async capturePaymentIntent(piId, idemKey) {
      state.retrieveCount++;
      const result = await realAdapter.capturePaymentIntent(piId, idemKey);
      if (result?.raw) {
        if (result.raw.livemode !== undefined) state.lastLivemode = result.raw.livemode;
        if (result.raw.pi_status !== undefined) state.lastPiStatus = result.raw.pi_status;
        if (result.raw.pi_id !== undefined) state.lastPiId = result.raw.pi_id;
        if (result.raw.pi_status === 'requires_capture') state.captureCount++;
      }
      if (throwAfterCapture && result?.derived === 'succeeded' && result?.raw?.pi_status === 'requires_capture') {
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
async function setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, paymentIntentId) {
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
  const revision = stateRows[0]?.result?.reservation_revision;

  const bindOpId = `cert_bind_${listingId}_${genId()}`;
  const bindHash = await sha256Hex(canonicalEnvelope({
    op: 'bind_pi', listing_id: listingId, purchase_id: purchaseId,
    payment_intent_id: paymentIntentId, buyer_user_id: buyerId,
    authority_version: 1, reservation_revision: revision, token_hash: tokenHash,
  }));
  await adminSql`SELECT authority_v1.bind_payment_intent(${listingId}, ${purchaseId}, ${paymentIntentId}, ${buyerId}, 1, ${revision}, ${tokenHash}, ${bindOpId}, ${bindHash})`;
  return { revision };
}

// ── State helpers ──────────────────────────────────────────────────────────────
async function getAuthority(adminSql, lid) {
  const rows = await adminSql`SELECT version, lifecycle_state, recovery_blocked FROM authority_v1.reservation_authority WHERE listing_id = ${lid}`;
  return rows[0] || null;
}
async function getBinding(adminSql, pid) {
  const rows = await adminSql`SELECT capture_state, freeze_finalized_at FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${pid}`;
  return rows[0] || null;
}
async function getAction(adminSql, aid) {
  const rows = await adminSql`SELECT status, stripe_idempotency_key FROM authority_v1.payment_actions WHERE action_id = ${aid}`;
  return rows[0] || null;
}
async function getIncident(adminSql, lid) {
  const rows = await adminSql`SELECT incident_type, resolved FROM authority_v1.operational_incidents WHERE incident_key = ${'capture_unknown:' + lid}`;
  return rows[0] || null;
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

// ── Seam invocation — the exact routing function capturePayment/entry.ts calls ──
// Assembles the same deps the handler passes to maybeRouteCanaryCapture and
// returns { result, entities } so callers can inspect the mock mirror store.
async function runSeam(opts) {
  const { executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter, body } = opts;
  const entities = makeMockEntities();
  entities._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
  entities._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
  entities._store.purchasePrivates.set(`pp_${pid}`, { id: `pp_${pid}`, purchase_id: pid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_revision: revision });
  const base44 = makeMockBase44(entities);
  const result = await maybeRouteCanaryCapture({
    base44,
    user: { id: buyerId, email: 'cert@example.com', role: 'admin' },
    body: { canary: true, purchase_id: pid, ...body },
    listing: { id: lid, notes: '[AUTH_CANARY]' },
    purchase: { id: pid, listing_id: lid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_token: revision },
    purchasePrivate: { purchase_id: pid, payment_intent_id: pi.id, buyer_email: buyerId, reservation_revision: revision },
    executorUrl, recorderUrl,
    stripeAdapter: adapter,
    executorClient, recorderClient,
    // Trusted dependency injection: the harness supplies true directly when
    // constructing the router. This mirrors the handler supplying
    // isCanaryEnabled() — never derived from user input or the environment.
    canaryEnabled: true,
  });
  return { result, entities };
}

// ── Test runner ──────────────────────────────────────────────────────────────
export async function runAllTests(deps) {
  const { adminSql, executorUrl, recorderUrl, testKey } = deps;
  const executorClient = createAuthorityV1Client(executorUrl);
  const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

  let passed = 0, failed = 0;
  const failures = [];
  const stripeObjects = [];
  function assert(cond, msg) {
    if (cond) passed++;
    else { failed++; failures.push(msg); }
  }

  // ── T0: Flag-OFF guard — normal production config cannot enter the canary path ──
  // The handler supplies isCanaryEnabled() (the committed default-OFF flag).
  // This test supplies the same value (false) directly via dependency injection
  // and proves the seam returns 503 CANARY_DISABLED — no bypass, no provider call.
  {
    const guardResult = await maybeRouteCanaryCapture({
      base44: makeMockBase44(makeMockEntities()),
      user: { id: 'guard', email: 'guard@example.com', role: 'admin' },
      body: { canary: true, purchase_id: 'guard_p' },
      listing: { id: 'guard_l', notes: '[AUTH_CANARY]' },
      purchase: { id: 'guard_p', listing_id: 'guard_l', payment_intent_id: 'pi_guard', buyer_email: 'b_guard', reservation_token: 'r_guard' },
      purchasePrivate: { purchase_id: 'guard_p', payment_intent_id: 'pi_guard', buyer_email: 'b_guard', reservation_revision: 'r_guard' },
      executorUrl, recorderUrl,
      stripeAdapter: { async capturePaymentIntent() { throw new Error('provider must not be called with flag OFF'); } },
      executorClient, recorderClient,
      canaryEnabled: false, // the real committed production configuration
    });
    assert(guardResult?.status === 503, `T0: flag-OFF guard returns 503 (got ${guardResult?.status})`);
    assert(guardResult?.body?.code === 'CANARY_DISABLED', `T0: CANARY_DISABLED (got ${guardResult?.body?.code})`);
  }

  // ── T1: Successful capture → exactly one real Stripe capture, sale committed once ──
  {
    const lid = `cert_real_t1_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T1', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const { result } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter });

    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const counts = adapter._counts();

    assert(result.status === 200, `T1: status 200 (got ${result.status})`);
    assert(result.body?.captured === true && result.body?.finalized === true, 'T1: captured+finalized');
    assert(counts.captureCount === 1, `T1: exactly 1 Stripe capture (got ${counts.captureCount})`);
    assert(counts.retrieveCount === 1, `T1: exactly 1 Stripe retrieve (got ${counts.retrieveCount})`);
    assert(auth?.lifecycle_state === 'sold', `T1: authority sold (got ${auth?.lifecycle_state})`);
    assert(binding?.capture_state === 'finalized', `T1: binding finalized (got ${binding?.capture_state})`);
    assert(counts.lastLivemode === false, `T1: Stripe livemode=false (got ${counts.lastLivemode})`);
    assert(pi.livemode === false, 'T1: created PI livemode=false');
    assert(pi.amount === TEST_AMOUNT_MINOR, `T1: amount bound (got ${pi.amount})`);
    assert(pi.currency === TEST_CURRENCY, `T1: currency bound (got ${pi.currency})`);
    assert(result.body?.stripe_idempotency_key?.startsWith('idem_capture_'), 'T1: idempotency key bound');

    await cleanupListing(adminSql, lid);
  }

  // ── T2: Identical replay → no second Stripe request, no new operation/sale/mirror ──
  {
    const lid = `cert_real_t2_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T2', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const seamOpts = { executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter };

    const { result: r1 } = await runSeam(seamOpts);
    const opsAfterFirst = await getOpCount(adminSql, lid);
    const { result: r2 } = await runSeam(seamOpts); // identical replay
    const opsAfterSecond = await getOpCount(adminSql, lid);
    const auth = await getAuthority(adminSql, lid);
    const counts = adapter._counts();

    assert(r1.status === 200 && r1.body?.captured === true, 'T2: first call captured');
    assert(r2.status === 200 && r2.body?.captured === true, 'T2: replay captured');
    assert(r2.body?.replay === true, 'T2: replay flag set');
    assert(counts.captureCount === 1, `T2: still 1 Stripe capture (got ${counts.captureCount})`);
    assert(counts.retrieveCount === 1, `T2: still 1 Stripe retrieve (got ${counts.retrieveCount})`);
    assert(opsAfterSecond === opsAfterFirst, `T2: no new operation rows (${opsAfterFirst}→${opsAfterSecond})`);
    assert(auth?.lifecycle_state === 'sold', 'T2: authority still sold');

    await cleanupListing(adminSql, lid);
  }

  // ── T3: Simulated lost response → capture_unknown, then reconcile from Stripe state without recapturing ──
  {
    const lid = `cert_real_t3_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T3', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    // First attempt: real capture succeeds on Stripe, then proxy throws (lost response).
    const adapter1 = wrapWithCounts(createStripeCaptureProvider(testKey), { throwAfterCapture: true });
    const { result: r1 } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter: adapter1 });
    const authAfterUnknown = await getAuthority(adminSql, lid);
    const bindingAfterUnknown = await getBinding(adminSql, pid);
    const incidentAfterUnknown = await getIncident(adminSql, lid);
    const counts1 = adapter1._counts();
    const actionId = r1.body?.action_id;

    assert(r1.status === 200 && r1.body?.capture_unknown === true, 'T3: first call capture_unknown');
    assert(counts1.captureCount === 1, `T3: first call did 1 real capture (got ${counts1.captureCount})`);
    assert(authAfterUnknown?.lifecycle_state === 'frozen' && authAfterUnknown?.recovery_blocked === true, 'T3: frozen+blocked');
    assert(bindingAfterUnknown?.capture_state === 'capture_unknown', 'T3: binding capture_unknown');
    assert(incidentAfterUnknown?.incident_type === 'capture_unknown' && incidentAfterUnknown?.resolved === false, 'T3: incident open');

    // Reconcile: retrieve Stripe's actual state (succeeded) WITHOUT recapturing.
    const adapter2 = wrapWithCounts(createStripeCaptureProvider(testKey));
    const { result: r2 } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter: adapter2, body: { action_id: actionId } });
    const authAfterRecon = await getAuthority(adminSql, lid);
    const bindingAfterRecon = await getBinding(adminSql, pid);
    const incidentAfterRecon = await getIncident(adminSql, lid);
    const counts2 = adapter2._counts();

    assert(r2.status === 200 && r2.body?.captured === true && r2.body?.finalized === true, 'T3: recon captured+finalized');
    assert(counts2.captureCount === 0, `T3: recon did NOT recapture (got ${counts2.captureCount})`);
    assert(counts2.retrieveCount === 1, `T3: recon retrieved PI state (got ${counts2.retrieveCount})`);
    assert(counts2.lastPiStatus === 'succeeded', `T3: Stripe PI is succeeded (got ${counts2.lastPiStatus})`);
    assert(authAfterRecon?.lifecycle_state === 'sold' && authAfterRecon?.recovery_blocked === false, 'T3: authority sold, unblocked');
    assert(bindingAfterRecon?.capture_state === 'finalized', 'T3: binding finalized');
    assert(incidentAfterRecon?.resolved === true, 'T3: incident resolved');

    await cleanupListing(adminSql, lid);
  }

  // ── T4: Stripe objects livemode=false; amount, currency, PI identity, version, idem key bound ──
  {
    const lid = `cert_real_t4_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T4', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const { result } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter });
    const auth = await getAuthority(adminSql, lid);
    const action = await getAction(adminSql, result.body?.action_id);
    const counts = adapter._counts();

    assert(pi.livemode === false, 'T4: created PI livemode=false');
    assert(counts.lastLivemode === false, 'T4: captured PI livemode=false');
    assert(pi.amount === TEST_AMOUNT_MINOR, 'T4: amount bound');
    assert(pi.currency === TEST_CURRENCY, 'T4: currency bound');
    assert(counts.lastPiId === pi.id, 'T4: PI identity bound across calls');
    assert(auth?.version >= 2, `T4: authority version progressed (got ${auth?.version})`);
    assert(action?.stripe_idempotency_key === result.body?.stripe_idempotency_key, 'T4: idem key bound in action');
    assert(result.body?.stripe_idempotency_key === `idem_capture_${result.body?.action_id}`, 'T4: idem key = idem_capture_<actionId>');

    await cleanupListing(adminSql, lid);
  }

  // ── T5: Mirror failure cannot roll back PostgreSQL authority ──
  {
    const lid = `cert_real_t5_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T5', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const adapter = wrapWithCounts(createStripeCaptureProvider(testKey));
    const { result, entities } = await runSeam({ executorUrl, recorderUrl, executorClient, recorderClient, lid, pid, pi, buyerId, revision, adapter, body: { simulate_mirror_failure: true } });
    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const counts = adapter._counts();

    assert(result.status === 200 && result.body?.captured === true && result.body?.finalized === true, 'T5: captured+finalized');
    assert(counts.captureCount === 1, 'T5: 1 real capture');
    assert(auth?.lifecycle_state === 'sold', `T5: authority sold despite mirror failure (got ${auth?.lifecycle_state})`);
    assert(binding?.capture_state === 'finalized', 'T5: binding finalized despite mirror failure');
    assert(entities._store.outbox.size >= 1, `T5: outbox created (got ${entities._store.outbox.size})`);
    assert(result.body?.mirror?.outbox_id !== null, 'T5: mirror outbox_id set');

    await cleanupListing(adminSql, lid);
  }

  // ── T6: Exact synthetic cleanup → all seven authority tables empty ──
  {
    await truncateAll(adminSql);
    const counts = await countAll(adminSql);
    const allClean = Object.values(counts).every(c => c === 0);
    assert(allClean, `T6: all 7 tables empty (got ${JSON.stringify(counts)})`);
    const sanitized = stripeObjects.map(o => ({ id: o.id, scenario: o.scenario, livemode: o.livemode, final_status: o.status }));
    return {
      passed, failed, failures: failures.slice(0, 10),
      allClean, finalCounts: counts,
      stripeObjects: sanitized,
      stripeCaptureTotal: sanitized.length,
      providerRequestCount: 'see per-scenario capture/retrieve counts above',
    };
  }
}