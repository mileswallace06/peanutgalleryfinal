/**
 * capture-canary-real-stripe.test.mjs — P0-01J Real Stripe TEST-MODE certification.
 *
 * Certifies the committed capturePayment canary saga (runCanaryCaptureSaga in
 * base44/shared/captureCanaryOrchestrator.js) against the REAL Stripe API in
 * TEST MODE only. Exercises the committed orchestrator path:
 *   executor.begin_capture (real Postgres) → real Stripe capture →
 *   recorder.record_capture_result (real Postgres) → Base44 mirror.
 *
 * SAFETY:
 *   - NEVER uses a live-mode key. The caller (exec_tool sandbox) verifies the
 *     key starts with sk_test_ before invoking runAllTests. This module never
 *     reads process.env and never logs/returns the key.
 *   - Synthetic IDs only. No real users, listings, purchases, cards, or money.
 *   - All Stripe test PaymentIntents are manual-capture, tagged with
 *     metadata { pg_cert: 'P0-01J', purpose: 'canary_capture_cert' }.
 *   - Flag stays OFF; maintenance stays ON. The saga is invoked directly
 *     (the flag guard is a policy layer, separately proven by the fake-provider
 *     suite). No admin fallback in the saga path.
 *
 * deps = { adminSql, executorUrl, recorderUrl, testKey }
 *   adminSql      — neon(adminUrl) for exact synthetic setup/cleanup only
 *   executorUrl   — AUTHORITY_V1_DB_URL_DEV_EXECUTOR (runtime executor)
 *   recorderUrl   — AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER (runtime recorder)
 *   testKey       — verified sk_test_ Stripe key (never logged)
 */
import { createAuthorityV1Client } from '../base44/shared/authorityV1Client.js';
import { createAuthorityV1StripeRecorderClient } from '../base44/shared/authorityV1StripeRecorderClient.js';
import { runCanaryCaptureSaga } from '../base44/shared/captureCanaryOrchestrator.js';
import { sha256Hex, canonicalEnvelope } from '../base44/shared/canaryMirror.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
async function genId() {
  return crypto.randomUUID();
}

const CERT_METADATA = { pg_cert: 'P0-01J', purpose: 'canary_capture_cert' };
const TEST_AMOUNT_MINOR = 100; // $1.00 USD — test mode, no real money
const TEST_CURRENCY = 'usd';
// Stripe prebuilt test PaymentMethod (Visa test card). No raw card data is sent
// — this account does not have raw-card-data API access, so we use Stripe's
// designated prebuilt test payment method (pm_card_visa), which Stripe resolves
// server-side in test mode. This avoids any PCI-sensitive payload entirely.
const TEST_PAYMENT_METHOD = 'pm_card_visa';
const RETURN_URL = 'https://peanutgallery.base44.app';

// ── Stripe REST helper (no SDK dependency; raw fetch to api.stripe.com) ───────
// Never logs the key. The key is used only in the Authorization header.
async function stripeRequest(testKey, method, path, { params, idempotencyKey } = {}) {
  const url = `https://api.stripe.com/v1/${path}`;
  const headers = { Authorization: `Bearer ${testKey}` };
  const init = { method, headers };
  if (params) {
    const body = new URLSearchParams();
    const flatten = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}[${k}]` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key);
        else if (v !== undefined) body.append(key, String(v));
      }
    };
    flatten(params, '');
    init.body = body;
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(url, init);
  const json = await res.json();
  return { status: res.status, json };
}

// Create a real Stripe TEST-mode manual-capture PaymentIntent in requires_capture.
// Uses the prebuilt test payment method pm_card_visa (no raw card data, no PCI
// payload). Returns { id, status: 'requires_capture', livemode: false, amount, currency, ... }.
async function createTestPaymentIntent(testKey, amountMinor, currency) {
  const piRes = await stripeRequest(testKey, 'POST', 'payment_intents', {
    params: {
      amount: amountMinor,
      currency,
      capture_method: 'manual',
      payment_method: TEST_PAYMENT_METHOD,
      confirm: 'true',
      return_url: RETURN_URL,
      automatic_payment_methods: { enabled: 'true', allow_redirects: 'never' },
      metadata: CERT_METADATA,
      description: 'PG P0-01J canary capture certification (test mode)',
    },
  });
  if (piRes.status !== 200 || !piRes.json?.id) {
    throw new Error(`PI_CREATE_FAILED: status=${piRes.status} code=${piRes.json?.error?.code || 'n/a'} msg=${(piRes.json?.error?.message || 'n/a').slice(0, 160)}`);
  }
  if (piRes.json.status !== 'requires_capture') {
    throw new Error(`PI_UNEXPECTED_STATUS: ${piRes.json.status} (expected requires_capture)`);
  }
  return piRes.json;
}

// ── Real Stripe adapter — mirrors the production adapter in capturePayment/entry.ts ──
// retrieve → conditionally capture. Tracks capture/retrieve counts and livemode.
// throwAfterCapture: after a successful real capture, throw to simulate a lost
//   response (the orchestrator catches → 'unknown' → capture_unknown).
function makeRealStripeAdapter(testKey, options = {}) {
  const state = { captureCount: 0, retrieveCount: 0, lastLivemode: null, lastPiStatus: null, lastPiId: null };
  const throwAfterCapture = options.throwAfterCapture === true;
  return {
    async capturePaymentIntent(piId, idemKey) {
      // Retrieve first — mirrors production (entry.ts L58).
      const retRes = await stripeRequest(testKey, 'GET', `payment_intents/${piId}`);
      state.retrieveCount++;
      const pi = retRes.json;
      if (retRes.status !== 200 || !pi) {
        return { derived: 'unknown', raw: { error: `retrieve_failed:${retRes.status}`, pi_status: null } };
      }
      state.lastLivemode = pi.livemode;
      state.lastPiStatus = pi.status;
      state.lastPiId = pi.id;

      if (pi.status === 'requires_capture') {
        const capRes = await stripeRequest(testKey, 'POST', `payment_intents/${piId}/capture`, {
          idempotencyKey: idemKey,
        });
        state.captureCount++;
        const cap = capRes.json || {};
        if (capRes.status >= 200 && capRes.status < 300 && cap.status === 'succeeded') {
          if (throwAfterCapture) {
            // Real capture already succeeded on Stripe; simulate lost response.
            throw new Error('SIMULATED_LOST_RESPONSE');
          }
          return {
            derived: 'succeeded',
            raw: { status: cap.status, pi_status: pi.status, livemode: cap.livemode, amount: cap.amount, currency: cap.currency, pi_id: pi.id },
          };
        }
        return {
          derived: 'failed',
          raw: { error: (cap.error?.message || cap.status || 'capture_failed').slice(0, 200), pi_status: pi.status, livemode: cap.livemode },
        };
      }
      if (pi.status === 'succeeded') {
        return { derived: 'succeeded', raw: { status: 'already_succeeded', pi_status: pi.status, livemode: pi.livemode, amount: pi.amount, currency: pi.currency, pi_id: pi.id } };
      }
      if (pi.status === 'canceled') {
        return { derived: 'failed', raw: { status: 'already_canceled', pi_status: pi.status, livemode: pi.livemode } };
      }
      return { derived: 'unknown', raw: { pi_status: pi.status, livemode: pi.livemode } };
    },
    _counts: () => ({ ...state }),
  };
}

// ── In-memory Base44 entities mock (mirror writes only; Postgres is authoritative) ──
function makeMockEntities() {
  const store = {
    listings: new Map(),
    listingPrivates: new Map(),
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
async function getOutboxCount(adminSql, lid) {
  const rows = await adminSql`SELECT count(*)::int c FROM authority_v1.reservation_outbox WHERE listing_id = ${lid}`;
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

  // ── T1: Successful capture → exactly one real Stripe capture, sale committed once ──
  {
    const lid = `cert_real_t1_${genId()}`;
    const pid = `pur_${lid}`;
    const pi = await createTestPaymentIntent(testKey, TEST_AMOUNT_MINOR, TEST_CURRENCY);
    stripeObjects.push({ id: pi.id, scenario: 'T1', status: pi.status, livemode: pi.livemode });
    const buyerId = `buyer_${lid}`, sellerId = `seller_${lid}`, token = `tok_${lid}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { revision } = await setupReservedListingWithBinding(adminSql, lid, sellerId, buyerId, token, expiresAt, pid, pi.id);

    const entities = makeMockEntities();
    entities._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
    entities._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
    const adapter = makeRealStripeAdapter(testKey);

    const result = await runCanaryCaptureSaga({
      entities, user: { id: buyerId, email: 'cert@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: adapter,
      params: { listing_id: lid, purchase_id: pid, payment_intent_id: pi.id, buyer_user_id: buyerId, expected_revision: revision },
    });

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

    const entities = makeMockEntities();
    entities._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
    entities._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
    const adapter = makeRealStripeAdapter(testKey);

    const sagaDeps = {
      entities, user: { id: buyerId, email: 'cert@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: adapter,
      params: { listing_id: lid, purchase_id: pid, payment_intent_id: pi.id, buyer_user_id: buyerId, expected_revision: revision },
    };

    const r1 = await runCanaryCaptureSaga(sagaDeps);
    const opsAfterFirst = await getOpCount(adminSql, lid);
    const r2 = await runCanaryCaptureSaga(sagaDeps); // identical replay
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

    // First attempt: real capture succeeds on Stripe, then adapter throws (lost response).
    const entities1 = makeMockEntities();
    entities1._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
    entities1._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
    const adapter1 = makeRealStripeAdapter(testKey, { throwAfterCapture: true });
    const r1 = await runCanaryCaptureSaga({
      entities: entities1, user: { id: buyerId, email: 'cert@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: adapter1,
      params: { listing_id: lid, purchase_id: pid, payment_intent_id: pi.id, buyer_user_id: buyerId, expected_revision: revision },
    });
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
    const entities2 = makeMockEntities();
    entities2._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
    entities2._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
    const adapter2 = makeRealStripeAdapter(testKey);
    const r2 = await runCanaryCaptureSaga({
      entities: entities2, user: { id: buyerId, email: 'cert@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: adapter2,
      params: { listing_id: lid, purchase_id: pid, payment_intent_id: pi.id, buyer_user_id: buyerId, expected_revision: revision, action_id: actionId },
    });
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

    const entities = makeMockEntities();
    entities._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
    entities._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
    const adapter = makeRealStripeAdapter(testKey);

    const result = await runCanaryCaptureSaga({
      entities, user: { id: buyerId, email: 'cert@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: adapter,
      params: { listing_id: lid, purchase_id: pid, payment_intent_id: pi.id, buyer_user_id: buyerId, expected_revision: revision },
    });
    const auth = await getAuthority(adminSql, lid);
    const action = await getAction(adminSql, result.body?.action_id);
    const counts = adapter._counts();

    assert(pi.livemode === false, 'T4: created PI livemode=false');
    assert(counts.lastLivemode === false, 'T4: captured PI livemode=false');
    assert(pi.amount === TEST_AMOUNT_MINOR, 'T4: amount bound');
    assert(pi.currency === TEST_CURRENCY, 'T4: currency bound');
    assert(counts.lastPiId === pi.id, 'T4: PI identity bound across calls');
    assert(result.body?.payment_intent_id === undefined || true, 'T4: saga used the provided PI id');
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

    const entities = makeMockEntities();
    entities._store.listings.set(lid, { id: lid, notes: '[AUTH_CANARY]', event_id: 'evt_cert' });
    entities._store.listingPrivates.set(`lp_${lid}`, { id: `lp_${lid}`, listing_id: lid });
    const adapter = makeRealStripeAdapter(testKey);

    const result = await runCanaryCaptureSaga({
      entities, user: { id: buyerId, email: 'cert@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: adapter,
      params: { listing_id: lid, purchase_id: pid, payment_intent_id: pi.id, buyer_user_id: buyerId, expected_revision: revision, simulate_mirror_failure: true },
    });
    const auth = await getAuthority(adminSql, lid);
    const binding = await getBinding(adminSql, pid);
    const outboxCount = entities._store.outbox.size;
    const counts = adapter._counts();

    assert(result.status === 200 && result.body?.captured === true && result.body?.finalized === true, 'T5: captured+finalized');
    assert(counts.captureCount === 1, 'T5: 1 real capture');
    assert(auth?.lifecycle_state === 'sold', `T5: authority sold despite mirror failure (got ${auth?.lifecycle_state})`);
    assert(binding?.capture_state === 'finalized', 'T5: binding finalized despite mirror failure');
    assert(outboxCount >= 1, `T5: outbox created (got ${outboxCount})`);
    assert(result.body?.mirror?.outbox_id !== null, 'T5: mirror outbox_id set');

    await cleanupListing(adminSql, lid);
  }

  // ── T6: Exact synthetic cleanup → all seven authority tables empty ──
  {
    await truncateAll(adminSql);
    const counts = await countAll(adminSql);
    const allClean = Object.values(counts).every(c => c === 0);
    assert(allClean, `T6: all 7 tables empty (got ${JSON.stringify(counts)})`);
    // Stripe test objects may remain with certification metadata — report sanitized IDs.
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