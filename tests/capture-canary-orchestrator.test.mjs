/**
 * capture-canary-orchestrator.test.mjs — P0-01I Canary capture-payment saga tests.
 *
 * Executable proof suite for the canary capture-payment transition
 * (begin_capture + record_capture_result) wired into capturePayment.
 *
 * Uses:
 *   - Real executor client (authorityV1Client) against dev Postgres
 *   - Real recorder client (authorityV1StripeRecorderClient)
 *   - Fake Stripe adapter (no real provider calls)
 *   - In-memory Base44 entities mock
 *   - Admin SQL for setup/cleanup (exact synthetic IDs only)
 *
 * Run via exec_tool sandbox with npm-compat ESM loader hook.
 */
import { createAuthorityV1Client } from '../base44/shared/authorityV1Client.js';
import { createAuthorityV1StripeRecorderClient } from '../base44/shared/authorityV1StripeRecorderClient.js';
import { maybeRouteCanaryCapture, runCanaryCaptureSaga } from '../base44/shared/captureCanaryOrchestrator.js';
import { isCanaryListing } from '../base44/shared/authCanary.js';
import { sha256Hex, canonicalEnvelope } from '../base44/shared/canaryMirror.js';
import { readFileSync } from 'fs';

// ── Helpers ──────────────────────────────────────────────────────────────────
async function genId() {
  return crypto.randomUUID();
}

function makeFakeStripe(overrides = {}) {
  const config = {
    status: 'requires_capture',
    ...overrides,
  };
  return {
    async capturePaymentIntent(piId, idemKey) {
      if (config.throw) throw new Error('Stripe timeout');
      if (config.delay) await new Promise(r => setTimeout(r, config.delay));
      if (config.status === 'requires_capture') {
        return { derived: 'succeeded', raw: { status: 'succeeded', pi_status: 'requires_capture' } };
      }
      if (config.status === 'succeeded') {
        return { derived: 'succeeded', raw: { status: 'already_succeeded', pi_status: 'succeeded' } };
      }
      if (config.status === 'canceled') {
        return { derived: 'failed', raw: { status: 'already_canceled', pi_status: 'canceled' } };
      }
      if (config.status === 'processing') {
        return { derived: 'unknown', raw: { pi_status: 'processing' } };
      }
      return { derived: 'unknown', raw: { pi_status: config.status } };
    },
  };
}

function makeMockEntities() {
  const store = {
    listings: new Map(),
    listingPrivates: new Map(),
    purchases: new Map(),
    purchasePrivates: new Map(),
    outbox: new Map(),
    alerts: [],
  };

  return {
    Listing: {
      async filter(q) {
        if (q.id) return [store.listings.get(q.id)].filter(Boolean);
        return [...store.listings.values()];
      },
      async update(id, data) {
        const l = store.listings.get(id);
        if (!l) throw new Error('Listing not found');
        Object.assign(l, data);
      },
    },
    ListingPrivate: {
      async filter(q) {
        if (q.listing_id) return [...store.listingPrivates.values()].filter(l => l.listing_id === q.listing_id);
        return [...store.listingPrivates.values()];
      },
      async update(id, data) {
        const lp = store.listingPrivates.get(id);
        if (!lp) throw new Error('ListingPrivate not found');
        Object.assign(lp, data);
      },
    },
    Purchase: {
      async filter(q) {
        if (q.id) return [store.purchases.get(q.id)].filter(Boolean);
        return [...store.purchases.values()];
      },
      async update(id, data) {
        const p = store.purchases.get(id);
        if (!p) throw new Error('Purchase not found');
        Object.assign(p, data);
      },
    },
    PurchasePrivate: {
      async filter(q) {
        if (q.purchase_id) return [...store.purchasePrivates.values()].filter(p => p.purchase_id === q.purchase_id);
        return [...store.purchasePrivates.values()];
      },
    },
    CanaryMirrorOutbox: {
      async create(data) {
        const id = `outbox_${genId()}`;
        store.outbox.set(id, { id, ...data });
        return { id, ...data };
      },
      async filter(q) {
        return [...store.outbox.values()].filter(o => !q || Object.entries(q).every(([k, v]) => o[k] === v));
      },
    },
    AdminAlert: {
      async create(data) {
        store.alerts.push(data);
        return data;
      },
    },
    _store: store,
  };
}

// ── Authority setup helpers ──────────────────────────────────────────────────
async function setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, paymentIntentId) {
  // Initialize
  const initOpId = `test_init_${listingId}_${genId()}`;
  const initHash = await sha256Hex(canonicalEnvelope({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
  await adminSql`SELECT authority_v1.initialize_listing(${listingId}, ${sellerId}, ${initOpId}, ${initHash})`;

  // Reserve
  const tokenHash = await sha256Hex(token);
  const reserveOpId = `test_reserve_${listingId}_${genId()}`;
  const reserveHash = await sha256Hex(canonicalEnvelope({
    op: 'reserve', listing_id: listingId, expected_version: 0,
    buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt,
  }));
  await adminSql`SELECT authority_v1.reserve_listing(${listingId}, 0, ${buyerId}, ${tokenHash}, ${expiresAt}, ${reserveOpId}, ${reserveHash})`;

  // Read authoritative state to get the reservation_revision
  const stateRows = await adminSql`SELECT authority_v1.get_state(${listingId}) as result`;
  const state = stateRows[0]?.result;
  const revision = state?.reservation_revision;

  // Bind payment intent (creates binding with capture_state='authorized')
  const bindOpId = `test_bind_${listingId}_${genId()}`;
  const bindHash = await sha256Hex(canonicalEnvelope({
    op: 'bind_pi', listing_id: listingId, purchase_id: purchaseId,
    payment_intent_id: paymentIntentId, buyer_user_id: buyerId,
    authority_version: 1, reservation_revision: revision,
    token_hash: tokenHash, amount_minor: 10000, currency: 'usd',
  }));
  await adminSql`SELECT authority_v1.bind_payment_intent(${listingId}, ${purchaseId}, ${paymentIntentId}, ${buyerId}, 1, ${revision}, ${tokenHash}, ${bindOpId}, ${bindHash})`;

  return { revision };
}

async function getAuthorityState(adminSql, listingId) {
  const rows = await adminSql`SELECT version, lifecycle_state, recovery_blocked, recovery_blocked_reason FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}`;
  return rows[0] || null;
}

async function getBindingState(adminSql, purchaseId) {
  const rows = await adminSql`SELECT capture_state, freeze_finalized_at FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}`;
  return rows[0] || null;
}

async function getActionStatus(adminSql, actionId) {
  const rows = await adminSql`SELECT status FROM authority_v1.payment_actions WHERE action_id = ${actionId}`;
  return rows[0]?.status || null;
}

async function getIncident(adminSql, listingId) {
  const rows = await adminSql`SELECT incident_type, resolved FROM authority_v1.operational_incidents WHERE incident_key = ${'capture_unknown:' + listingId}`;
  return rows[0] || null;
}

async function getOutboxCount(adminSql, listingId) {
  const rows = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_outbox WHERE listing_id = ${listingId}`;
  return rows[0]?.c || 0;
}

async function cleanupListing(adminSql, listingId) {
  await adminSql`DELETE FROM authority_v1.reservation_outbox WHERE listing_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.reservation_payment_bindings WHERE listing_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.payment_actions WHERE listing_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.operational_incidents WHERE reference_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.reservation_operations WHERE listing_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}`;
}

async function cleanupAll() {
  const { neon } = await import('@neondatabase/serverless');
  const adminSql = neon(process.env.AUTHORITY_DB_URL_DEV_ADMIN);
  await adminSql`TRUNCATE authority_v1.reservation_outbox, authority_v1.reservation_payment_bindings, authority_v1.payment_actions, authority_v1.stripe_webhook_events, authority_v1.operational_incidents, authority_v1.reservation_operations, authority_v1.reservation_authority RESTART IDENTITY CASCADE`;
}

// ── Test runner ──────────────────────────────────────────────────────────────
export async function runAllTests(deps) {
  const { adminSql, executorUrl, recorderUrl } = deps;
  const executorClient = createAuthorityV1Client(executorUrl);
  const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);
  const results = [];
  const syntheticIds = new Set();

  function record(name, passed, details = {}) {
    results.push({ name, passed, ...details });
  }

  // ── T1: Successful capture → authority sold, binding finalized ───────────
  {
    const listingId = `canary_capture_t1_${genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const setup = await setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, piId);
    const expectedRevision = setup.revision;

    const entities = makeMockEntities();
    entities._store.listings.set(listingId, { id: listingId, notes: '[AUTH_CANARY]', event_id: 'evt_1' });

    const stripe = makeFakeStripe({ status: 'requires_capture' });

    const result = await runCanaryCaptureSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
      },
    });

    const authState = await getAuthorityState(adminSql, listingId);
    const bindingState = await getBindingState(adminSql, purchaseId);

    record('T1: Successful capture → sold + finalized',
      result.status === 200 && result.body?.captured === true && result.body?.finalized === true &&
      authState?.lifecycle_state === 'sold' && bindingState?.capture_state === 'finalized',
      { status: result.status, authState: authState?.lifecycle_state, bindingState: bindingState?.capture_state });

    record('T1: No credential leak in response',
      result.body?.action_id === undefined && result.body?.stripe_idempotency_key === undefined,
      { action_id: result.body?.action_id, stripe_idempotency_key: result.body?.stripe_idempotency_key });

    await cleanupListing(adminSql, listingId);
  }

  // ── T2: Failed capture → authority available, binding failed ─────────────
  {
    const listingId = `canary_capture_t2_${genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const setup = await setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, piId);
    const expectedRevision = setup.revision;

    const entities = makeMockEntities();
    const stripe = makeFakeStripe({ status: 'canceled' });

    const result = await runCanaryCaptureSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
      },
    });

    const authState = await getAuthorityState(adminSql, listingId);
    const bindingState = await getBindingState(adminSql, purchaseId);

    record('T2: Failed capture → available + failed',
      result.status === 200 && result.body?.capture_failed === true && result.body?.released === true &&
      authState?.lifecycle_state === 'available' && bindingState?.capture_state === 'failed',
      { status: result.status, authState: authState?.lifecycle_state, bindingState: bindingState?.capture_state });

    await cleanupListing(adminSql, listingId);
  }

  // ── T3: Unknown capture → recovery_blocked, incident created ────────────
  {
    const listingId = `canary_capture_t3_${genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const setup = await setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, piId);
    const expectedRevision = setup.revision;

    const entities = makeMockEntities();
    const stripe = makeFakeStripe({ status: 'processing' });

    const result = await runCanaryCaptureSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
      },
    });

    const authState = await getAuthorityState(adminSql, listingId);
    const bindingState = await getBindingState(adminSql, purchaseId);
    const incident = await getIncident(adminSql, listingId);

    record('T3: Unknown capture → recovery_blocked + incident',
      result.status === 200 && result.body?.capture_unknown === true && result.body?.recovery_blocked === true &&
      authState?.lifecycle_state === 'frozen' && authState?.recovery_blocked === true &&
      bindingState?.capture_state === 'capture_unknown' &&
      incident?.incident_type === 'capture_unknown' && incident?.resolved === false,
      { status: result.status, authState: authState?.lifecycle_state, bindingState: bindingState?.capture_state, incidentResolved: incident?.resolved });

    await cleanupListing(adminSql, listingId);
  }

  // ── T4: Reconciliation — unknown then succeeded → sold ───────────────────
  {
    const listingId = `canary_capture_t4_${genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const setup = await setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, piId);
    const expectedRevision = setup.revision;

    // First call: unknown — provide explicit action_id (response no longer leaks it)
    const explicitActionId = `act_t4_${genId()}`;
    const entities1 = makeMockEntities();
    const stripe1 = makeFakeStripe({ status: 'processing' });
    const result1 = await runCanaryCaptureSaga({
      entities: entities1, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe1,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
        action_id: explicitActionId,
      },
    });

    const authAfterUnknown = await getAuthorityState(adminSql, listingId);

    // Second call: succeeded (reconciliation) — reuse same action_id
    const entities2 = makeMockEntities();
    const stripe2 = makeFakeStripe({ status: 'requires_capture' });
    const result2 = await runCanaryCaptureSaga({
      entities: entities2, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe2,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
        action_id: explicitActionId,
      },
    });

    const authAfterRecon = await getAuthorityState(adminSql, listingId);
    const bindingAfterRecon = await getBindingState(adminSql, purchaseId);
    const incidentAfterRecon = await getIncident(adminSql, listingId);

    record('T4: Reconciliation unknown→succeeded → sold',
      result1.status === 200 && result1.body?.capture_unknown === true &&
      authAfterUnknown?.recovery_blocked === true &&
      result2.status === 200 && result2.body?.captured === true && result2.body?.finalized === true &&
      authAfterRecon?.lifecycle_state === 'sold' && authAfterRecon?.recovery_blocked === false &&
      bindingAfterRecon?.capture_state === 'finalized' &&
      incidentAfterRecon?.resolved === true,
      { r1: result1.status, r2: result2.status, authFinal: authAfterRecon?.lifecycle_state, incidentResolved: incidentAfterRecon?.resolved });

    await cleanupListing(adminSql, listingId);
  }

  // ── T5: Reconciliation — unknown then failed → available ─────────────────
  {
    const listingId = `canary_capture_t5_${genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const setup = await setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, piId);
    const expectedRevision = setup.revision;

    // First call: unknown — provide explicit action_id (response no longer leaks it)
    const explicitActionId = `act_t5_${genId()}`;
    const entities1 = makeMockEntities();
    const stripe1 = makeFakeStripe({ status: 'processing' });
    const result1 = await runCanaryCaptureSaga({
      entities: entities1, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe1,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
        action_id: explicitActionId,
      },
    });

    // Second call: failed (reconciliation)
    const entities2 = makeMockEntities();
    const stripe2 = makeFakeStripe({ status: 'canceled' });
    const result2 = await runCanaryCaptureSaga({
      entities: entities2, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe2,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
        action_id: explicitActionId,
      },
    });

    const authAfterRecon = await getAuthorityState(adminSql, listingId);
    const bindingAfterRecon = await getBindingState(adminSql, purchaseId);
    const incidentAfterRecon = await getIncident(adminSql, listingId);

    record('T5: Reconciliation unknown→failed → available',
      result1.status === 200 && result1.body?.capture_unknown === true &&
      result2.status === 200 && result2.body?.capture_failed === true &&
      authAfterRecon?.lifecycle_state === 'available' && authAfterRecon?.recovery_blocked === false &&
      bindingAfterRecon?.capture_state === 'failed' &&
      incidentAfterRecon?.resolved === true,
      { r1: result1.status, r2: result2.status, authFinal: authAfterRecon?.lifecycle_state, incidentResolved: incidentAfterRecon?.resolved });

    await cleanupListing(adminSql, listingId);
  }

  // ── T6: Reconciliation — unknown then unknown → stays blocked ────────────
  {
    const listingId = `canary_capture_t6_${genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const setup = await setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, piId);
    const expectedRevision = setup.revision;

    // First call: unknown — provide explicit action_id (response no longer leaks it)
    const explicitActionId = `act_t6_${genId()}`;
    const entities1 = makeMockEntities();
    const stripe1 = makeFakeStripe({ status: 'processing' });
    const result1 = await runCanaryCaptureSaga({
      entities: entities1, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe1,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
        action_id: explicitActionId,
      },
    });

    // Second call: unknown again (reconciliation no-op)
    const entities2 = makeMockEntities();
    const stripe2 = makeFakeStripe({ status: 'processing' });
    const result2 = await runCanaryCaptureSaga({
      entities: entities2, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe2,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
        action_id: explicitActionId,
      },
    });

    const authAfterRecon = await getAuthorityState(adminSql, listingId);
    const bindingAfterRecon = await getBindingState(adminSql, purchaseId);

    record('T6: Reconciliation unknown→unknown → stays blocked',
      result1.status === 200 && result1.body?.capture_unknown === true &&
      result2.status === 200 && result2.body?.capture_unknown === true &&
      authAfterRecon?.lifecycle_state === 'frozen' && authAfterRecon?.recovery_blocked === true &&
      bindingAfterRecon?.capture_state === 'capture_unknown',
      { r1: result1.status, r2: result2.status, authFinal: authAfterRecon?.lifecycle_state, blocked: authAfterRecon?.recovery_blocked });

    await cleanupListing(adminSql, listingId);
  }

  // ── T7: Identical replay → idempotent ────────────────────────────────────
  {
    const listingId = `canary_capture_t7_${genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const setup = await setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, piId);
    const expectedRevision = setup.revision;

    const entities = makeMockEntities();
    const stripe = makeFakeStripe({ status: 'requires_capture' });

    const sagaDeps = {
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
      },
    };

    const result1 = await runCanaryCaptureSaga(sagaDeps);
    const result2 = await runCanaryCaptureSaga(sagaDeps); // Identical replay

    const authState = await getAuthorityState(adminSql, listingId);
    const bindingState = await getBindingState(adminSql, purchaseId);

    record('T7: Identical replay → idempotent',
      result1.status === 200 && result1.body?.captured === true &&
      result2.status === 200 && result2.body?.captured === true &&
      authState?.lifecycle_state === 'sold' && bindingState?.capture_state === 'finalized',
      { r1: result1.status, r2: result2.status, authState: authState?.lifecycle_state });

    await cleanupListing(adminSql, listingId);
  }

  // ── T8: 20-way concurrent → exactly one capture ───────────────────────────
  {
    const listingId = `canary_capture_t8_${genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const setup = await setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, piId);
    const expectedRevision = setup.revision;

    const N = 20;
    const promises = [];
    for (let i = 0; i < N; i++) {
      const entities = makeMockEntities();
      const stripe = makeFakeStripe({ status: 'requires_capture' });
      promises.push(runCanaryCaptureSaga({
        entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
        executorClient, recorderClient, stripeAdapter: stripe,
        params: {
          listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
          buyer_user_id: buyerId, expected_revision: expectedRevision,
        },
      }));
    }
    const allResults = await Promise.all(promises);

    const successCount = allResults.filter(r => r.status === 200 && r.body?.captured === true).length;
    const authState = await getAuthorityState(adminSql, listingId);
    const bindingState = await getBindingState(adminSql, purchaseId);

    record('T8: 20-way concurrent → exactly one capture',
      successCount >= 1 && authState?.lifecycle_state === 'sold' && bindingState?.capture_state === 'finalized',
      { successCount, authState: authState?.lifecycle_state });

    await cleanupListing(adminSql, listingId);
  }

  // ── T9: Mirror failure → outbox created ───────────────────────────────────
  {
    const listingId = `canary_capture_t9_${genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const setup = await setupReservedListingWithBinding(adminSql, listingId, sellerId, buyerId, token, expiresAt, purchaseId, piId);
    const expectedRevision = setup.revision;

    const entities = makeMockEntities();
    entities._store.listings.set(listingId, { id: listingId, notes: '[AUTH_CANARY]', event_id: 'evt_1' });

    const stripe = makeFakeStripe({ status: 'requires_capture' });

    const result = await runCanaryCaptureSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, recorderClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, expected_revision: expectedRevision,
        simulate_mirror_failure: true,
      },
    });

    const outboxRecords = entities._store.outbox.size;
    const authState = await getAuthorityState(adminSql, listingId);

    record('T9: Mirror failure → outbox created',
      result.status === 200 && result.body?.captured === true &&
      result.body?.mirror?.outbox_id !== null && outboxRecords >= 1 &&
      authState?.lifecycle_state === 'sold',
      { status: result.status, outboxRecords, authState: authState?.lifecycle_state, mirrorOutbox: result.body?.mirror?.outbox_id });

    await cleanupListing(adminSql, listingId);
  }

  // ── T10: Flag-OFF isolation → 503 CANARY_DISABLED ─────────────────────────
  {
    const listingId = `canary_capture_t10_${genId()}`;
    const purchaseId = `pur_${listingId}`;

    const entities = makeMockEntities();
    entities._store.listings.set(listingId, { id: listingId, notes: '[AUTH_CANARY]', event_id: 'evt_1' });
    entities._store.purchases.set(purchaseId, {
      id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com',
      seller_email: 'seller@example.com', amount: 100,
      payment_intent_id: 'pi_test', transfer_status: 'pending_transfer',
    });

    const result = await maybeRouteCanaryCapture({
      base44: { asServiceRole: { entities } },
      user: { id: 'admin', email: 'admin@example.com', role: 'admin' },
      body: { canary: true, purchase_id: purchaseId },
      listing: entities._store.listings.get(listingId),
      purchase: entities._store.purchases.get(purchaseId),
      executorUrl: executorUrl,
      recorderUrl: recorderUrl,
      stripeAdapter: makeFakeStripe(),
    });

    record('T10: Flag-OFF → 503 CANARY_DISABLED',
      result?.status === 503 && result?.body?.code === 'CANARY_DISABLED',
      { status: result?.status, code: result?.body?.code });
  }

  // ── T11: Non-canary isolation → 400 NOT_CANARY ────────────────────────────
  {
    const listingId = `canary_capture_t11_${genId()}`;
    const purchaseId = `pur_${listingId}`;

    const entities = makeMockEntities();
    entities._store.listings.set(listingId, { id: listingId, notes: 'Regular listing', event_id: 'evt_1' });
    entities._store.purchases.set(purchaseId, {
      id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com',
      seller_email: 'seller@example.com', amount: 100,
      payment_intent_id: 'pi_test', transfer_status: 'pending_transfer',
    });

    const result = await maybeRouteCanaryCapture({
      base44: { asServiceRole: { entities } },
      user: { id: 'admin', email: 'admin@example.com', role: 'admin' },
      body: { canary: true, purchase_id: purchaseId },
      listing: entities._store.listings.get(listingId),
      purchase: entities._store.purchases.get(purchaseId),
      executorUrl: executorUrl,
      recorderUrl: recorderUrl,
      stripeAdapter: makeFakeStripe(),
    });

    record('T11: Non-canary → 400 NOT_CANARY',
      result?.status === 400 && result?.body?.code === 'NOT_CANARY',
      { status: result?.status, code: result?.body?.code });
  }

  // ── T12: No admin fallback (static analysis) ───────────────────────────────
  {
    const orchestratorSrc = readFileSync(new URL('../base44/shared/captureCanaryOrchestrator.js', import.meta.url), 'utf8');
    const handlerSrc = readFileSync(new URL('../base44/functions/capturePayment/entry.ts', import.meta.url), 'utf8');

    const orchestratorImportsAdmin = orchestratorSrc.includes('authorityV1TestAdmin');
    const handlerImportsAdmin = handlerSrc.includes('authorityV1TestAdmin');
    const orchestratorHasAdminUrl = orchestratorSrc.includes('AUTHORITY_DB_URL_DEV_ADMIN');
    const handlerHasAdminUrl = handlerSrc.includes('AUTHORITY_DB_URL_DEV_ADMIN');
    const handlerImportsCanary = handlerSrc.includes('maybeRouteCanaryCapture');
    const canaryBeforeMaintenance = handlerSrc.indexOf('maybeRouteCanaryCapture') < handlerSrc.indexOf('isMaintenanceActive()');

    record('T12: No admin fallback (static analysis)',
      !orchestratorImportsAdmin && !handlerImportsAdmin &&
      !orchestratorHasAdminUrl && !handlerHasAdminUrl &&
      handlerImportsCanary && canaryBeforeMaintenance,
      { orchestratorImportsAdmin, handlerImportsAdmin, orchestratorHasAdminUrl, handlerHasAdminUrl, handlerImportsCanary, canaryBeforeMaintenance });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await cleanupAll();

  // ── Verify all tables are empty ────────────────────────────────────────────
  const tables = ['reservation_authority', 'reservation_operations', 'reservation_outbox', 'reservation_payment_bindings', 'payment_actions', 'stripe_webhook_events', 'operational_incidents'];
  const counts = {};
  for (const t of tables) {
    const rows = await adminSql(`SELECT count(*)::int as c FROM authority_v1.${t}`);
    counts[t] = rows[0]?.c || 0;
  }
  const allClean = Object.values(counts).every(c => c === 0);

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  return {
    total,
    passed,
    failed,
    allClean,
    counts,
    syntheticIds: [...syntheticIds],
    results,
  };
}