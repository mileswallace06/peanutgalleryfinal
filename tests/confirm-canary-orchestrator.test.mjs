/**
 * confirm-canary-orchestrator.test.mjs — P0-01H Canary confirm-checkout saga tests.
 *
 * Executable proof suite for the canary payment-binding transition
 * (bind_payment_intent) wired into confirmCheckoutAuthorized.
 *
 * Uses:
 *   - Real executor client (authorityV1Client) against dev Postgres
 *   - Fake Stripe adapter (no real provider calls)
 *   - In-memory Base44 entities mock
 *   - Admin SQL for setup/cleanup (exact synthetic IDs only)
 *
 * Run via exec_tool sandbox with npm-compat ESM loader hook.
 */
import { createAuthorityV1Client } from '../base44/shared/authorityV1Client.js';
import { maybeRouteCanaryConfirm, runCanaryConfirmSaga } from '../base44/shared/confirmCanaryOrchestrator.js';
import { isCanaryListing } from '../base44/shared/authCanary.js';
import { sha256Hex, canonicalEnvelope } from '../base44/shared/canaryMirror.js';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// ── Helpers ──────────────────────────────────────────────────────────────────
async function genId() {
  return crypto.randomUUID();
}

function makeFakeStripe(overrides = {}) {
  const defaults = {
    status: 'requires_capture',
    amount: 10000,
    metadata: {
      purchase_id: 'pur_test_001',
      listing_id: 'list_test_001',
      buyer_email: 'buyer@example.com',
      seller_email: 'seller@example.com',
      reservation_token: 'tok_test_001',
    },
  };
  const config = { ...defaults, ...overrides, metadata: { ...defaults.metadata, ...(overrides.metadata || {}) } };
  return {
    async retrievePaymentIntent(piId) {
      if (config.throw) throw new Error('Stripe timeout');
      if (config.delay) await new Promise(r => setTimeout(r, config.delay));
      return {
        id: piId || 'pi_test_001',
        status: config.status,
        amount: config.amount,
        currency: config.currency || 'usd',
        metadata: config.metadata,
      };
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
        if (q.reserved_by_email) return [...store.listingPrivates.values()].filter(l => l.reserved_by_email === q.reserved_by_email);
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
      async create(data) {
        const id = data.id || `pur_${await genId()}`;
        store.purchases.set(id, { id, ...data });
        return { id, ...data };
      },
    },
    PurchasePrivate: {
      async filter(q) {
        if (q.purchase_id) return [...store.purchasePrivates.values()].filter(p => p.purchase_id === q.purchase_id);
        return [...store.purchasePrivates.values()];
      },
      async update(id, data) {
        const pp = store.purchasePrivates.get(id);
        if (!pp) throw new Error('PurchasePrivate not found');
        Object.assign(pp, data);
      },
      async create(data) {
        const id = data.id || `pp_${await genId()}`;
        store.purchasePrivates.set(id, { id, ...data });
        return { id, ...data };
      },
    },
    CanaryMirrorOutbox: {
      async create(data) {
        const id = `outbox_${await genId()}`;
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
async function setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt) {
  // Initialize
  const initOpId = `test_init_${listingId}_${await genId()}`;
  const initHash = await sha256Hex(canonicalEnvelope({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
  await adminSql`SELECT authority_v1.initialize_listing(${listingId}, ${sellerId}, ${initOpId}, ${initHash})`;

  // Reserve
  const tokenHash = await sha256Hex(token);
  const reserveOpId = `test_reserve_${listingId}_${await genId()}`;
  const reserveHash = await sha256Hex(canonicalEnvelope({
    op: 'reserve', listing_id: listingId, expected_version: 0,
    buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt,
  }));
  const reserveResult = await adminSql`SELECT authority_v1.reserve_listing(${listingId}, 0, ${buyerId}, ${tokenHash}, ${expiresAt}, ${reserveOpId}, ${reserveHash})`;
  return reserveResult[0]?.result;
}

async function getBindingCount(adminSql, purchaseId) {
  const rows = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}`;
  return rows[0]?.c || 0;
}

async function getBindingState(adminSql, purchaseId) {
  const rows = await adminSql`SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}`;
  return rows[0]?.capture_state || null;
}

async function getOpCount(adminSql, listingId) {
  const rows = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_operations WHERE listing_id = ${listingId}`;
  return rows[0]?.c || 0;
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
  const { adminSql, executorUrl } = deps;
  const executorClient = createAuthorityV1Client(executorUrl);
  const results = [];
  const syntheticIds = new Set();

  function record(name, passed, details = {}) {
    results.push({ name, passed, ...details });
  }

  // ── T1: Authorized PI → binding created (authorized state) ─────────────────
  {
    const listingId = `canary_confirm_t1_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    const entities = makeMockEntities();
    entities._store.listings.set(listingId, { id: listingId, notes: '[AUTH_CANARY]', event_id: 'evt_1' });
    entities._store.purchases.set(purchaseId, {
      id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com',
      seller_email: 'seller@example.com', amount: 100, reservation_token: token,
      payment_intent_id: piId, transfer_status: 'pending_transfer',
    });
    entities._store.purchasePrivates.set(`pp_${purchaseId}`, {
      id: `pp_${purchaseId}`, purchase_id: purchaseId, listing_id: listingId,
      buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
      payment_intent_id: piId, reservation_token: token,
    });

    const stripe = makeFakeStripe({
      amount: 10000,
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });

    const result = await runCanaryConfirmSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);
    const bindingState = await getBindingState(adminSql, purchaseId);

    record('T1: Authorized PI → binding created', 
      result.status === 200 && result.body?.ok === true && result.body?.bound === true &&
      bindingCount === 1 && bindingState === 'authorized',
      { status: result.status, bindingCount, bindingState });

    await cleanupListing(adminSql, listingId);
  }

  // ── T2: Wrong PI status → 402, no binding ──────────────────────────────────
  {
    const listingId = `canary_confirm_t2_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    const entities = makeMockEntities();
    const stripe = makeFakeStripe({
      status: 'requires_payment_method',
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });

    const result = await runCanaryConfirmSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);

    record('T2: Wrong PI status → 402, no binding',
      result.status === 402 && result.body?.code === 'PI_NOT_AUTHORIZED' && bindingCount === 0,
      { status: result.status, bindingCount });

    await cleanupListing(adminSql, listingId);
  }

  // ── T3: Timeout/unknown → 500, no binding ──────────────────────────────────
  {
    const listingId = `canary_confirm_t3_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    const entities = makeMockEntities();
    const stripe = makeFakeStripe({ throw: true });

    const result = await runCanaryConfirmSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);

    record('T3: Timeout/unknown → 500, no binding',
      result.status === 500 && result.body?.code === 'PI_RETRIEVE_FAILED' && bindingCount === 0,
      { status: result.status, bindingCount });

    await cleanupListing(adminSql, listingId);
  }

  // ── T4: Mismatched amount → 500, no binding ─────────────────────────────────
  {
    const listingId = `canary_confirm_t4_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    const entities = makeMockEntities();
    const stripe = makeFakeStripe({
      amount: 99900, // Wrong amount (999.00 vs 100.00)
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });

    const result = await runCanaryConfirmSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);

    record('T4: Mismatched amount → 500, no binding',
      result.status === 500 && result.body?.code === 'AMOUNT_MISMATCH' && bindingCount === 0,
      { status: result.status, bindingCount });

    await cleanupListing(adminSql, listingId);
  }

  // ── T5: Mismatched purchase_id → 500, no binding ───────────────────────────
  {
    const listingId = `canary_confirm_t5_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    const entities = makeMockEntities();
    const stripe = makeFakeStripe({
      metadata: { purchase_id: 'wrong_purchase', listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });

    const result = await runCanaryConfirmSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);

    record('T5: Mismatched purchase_id → 500, no binding',
      result.status === 500 && result.body?.code === 'PI_METADATA_MISMATCH' && bindingCount === 0,
      { status: result.status, bindingCount });

    await cleanupListing(adminSql, listingId);
  }

  // ── T6: Mismatched buyer_email → 500, no binding ───────────────────────────
  {
    const listingId = `canary_confirm_t6_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    const entities = makeMockEntities();
    const stripe = makeFakeStripe({
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'wrong@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });

    const result = await runCanaryConfirmSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);

    record('T6: Mismatched buyer_email → 500, no binding',
      result.status === 500 && result.body?.code === 'PI_METADATA_MISMATCH' && bindingCount === 0,
      { status: result.status, bindingCount });

    await cleanupListing(adminSql, listingId);
  }

  // ── T7: Stale version / mismatched token → 409, no binding ─────────────────
  {
    const listingId = `canary_confirm_t7_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token1 = `tok1_${listingId}`;
    const token2 = `tok2_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Reserve with token1, then release, then re-reserve with token2
    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token1, expiresAt);
    const releaseOpId = `test_release_${listingId}_${await genId()}`;
    const releaseHash = await sha256Hex(canonicalEnvelope({ op: 'release', listing_id: listingId, expected_version: 1 }));
    await adminSql`SELECT authority_v1.release_listing(${listingId}, 1, ${releaseOpId}, ${releaseHash})`;

    const token2Hash = await sha256Hex(token2);
    const reserve2OpId = `test_reserve2_${listingId}_${await genId()}`;
    const reserve2Hash = await sha256Hex(canonicalEnvelope({
      op: 'reserve', listing_id: listingId, expected_version: 2,
      buyer_user_id: buyerId, token_hash: token2Hash, expires_at: expiresAt,
    }));
    await adminSql`SELECT authority_v1.reserve_listing(${listingId}, 2, ${buyerId}, ${token2Hash}, ${expiresAt}, ${reserve2OpId}, ${reserve2Hash})`;

    // Now try to confirm with the OLD token1
    const entities = makeMockEntities();
    const stripe = makeFakeStripe({
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token1 },
    });

    const result = await runCanaryConfirmSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token1, amount: 100, // Old token
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);

    record('T7: Stale version / mismatched token → 409, no binding',
      result.status === 409 && bindingCount === 0,
      { status: result.status, code: result.body?.code, bindingCount });

    await cleanupListing(adminSql, listingId);
  }

  // ── T8: Identical replay → idempotent ──────────────────────────────────────
  {
    const listingId = `canary_confirm_t8_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    const entities1 = makeMockEntities();
    const stripe = makeFakeStripe({
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });

    const sagaDeps = {
      entities: entities1, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
      },
    };

    const result1 = await runCanaryConfirmSaga(sagaDeps);
    // Capture baseline counts after the first call (includes setup ops + outbox)
    const bindingCountAfter1 = await getBindingCount(adminSql, purchaseId);
    const opCountAfter1 = await getOpCount(adminSql, listingId);
    const outboxCountAfter1 = await getOutboxCount(adminSql, listingId);

    const result2 = await runCanaryConfirmSaga(sagaDeps); // Identical replay

    const bindingCount = await getBindingCount(adminSql, purchaseId);
    const opCount = await getOpCount(adminSql, listingId);
    const outboxCount = await getOutboxCount(adminSql, listingId);

    // Strengthened T8: identical replay must not create a second binding, a
    // second operation, or any outbox record. The operation is replayed (same
    // operation_id + same request_hash → stored committed result returned),
    // not duplicated. Verify counts did NOT increase from the baseline after
    // the first call.
    record('T8: Identical replay → no second binding/operation/outbox',
      result1.status === 200 && result2.status === 200 &&
      result1.body?.bound === true && result2.body?.bound === true &&
      bindingCount === 1 &&
      opCount === opCountAfter1 && outboxCount === outboxCountAfter1,
      { r1: result1.status, r2: result2.status, bindingCount, opCount, outboxCount, opCountAfter1, outboxCountAfter1, r1_bound: result1.body?.bound, r2_bound: result2.body?.bound });

    await cleanupListing(adminSql, listingId);
  }

  // ── T9: Conflicting replay → OPERATION_ID_CONFLICT ─────────────────────────
  {
    const listingId = `canary_confirm_t9_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token1 = `tok1_${listingId}`;
    const token2 = `tok2_${listingId}`; // Different token → different token_hash → different request_hash
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token1, expiresAt);

    // First call with token1 (matches authority)
    const entities1 = makeMockEntities();
    const stripe1 = makeFakeStripe({
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token1 },
    });

    const result1 = await runCanaryConfirmSaga({
      entities: entities1, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe1,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token1, amount: 100,
      },
    });

    // Second call with token2 (different token_hash → different request_hash,
    // same deterministic operation_id → OPERATION_ID_CONFLICT)
    const entities2 = makeMockEntities();
    const stripe2 = makeFakeStripe({
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token2 },
    });

    const result2 = await runCanaryConfirmSaga({
      entities: entities2, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe2,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token2, amount: 100, // Same amount, but different token → different request_hash
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);

    record('T9: Conflicting replay → OPERATION_ID_CONFLICT',
      result1.status === 200 && result2.status === 409 &&
      (result2.body?.code === 'OPERATION_ID_CONFLICT' || result2.body?.authority?.code === 'OPERATION_ID_CONFLICT') &&
      bindingCount === 1,
      { r1: result1.status, r2: result2.status, r2_code: result2.body?.code || result2.body?.authority?.code, bindingCount });

    await cleanupListing(adminSql, listingId);
  }

  // ── T9b: Changed amount, same operation_id → OPERATION_ID_CONFLICT ─────────
  {
    const listingId = `canary_confirm_t9b_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    // First call with amount=100 (10000 cents) — succeeds
    const entities1 = makeMockEntities();
    const stripe1 = makeFakeStripe({
      amount: 10000,
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });
    const result1 = await runCanaryConfirmSaga({
      entities: entities1, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe1,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
      },
    });
    // Capture baseline after first call
    const opCountAfter1 = await getOpCount(adminSql, listingId);

    // Second call with amount=200 (20000 cents) — same deterministic operation_id
    // but different request_hash (amount_minor changed) → OPERATION_ID_CONFLICT
    const entities2 = makeMockEntities();
    const stripe2 = makeFakeStripe({
      amount: 20000,
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });
    const result2 = await runCanaryConfirmSaga({
      entities: entities2, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe2,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 200, // Different amount → different request_hash
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);
    const opCount = await getOpCount(adminSql, listingId);

    record('T9b: Changed amount, same op → OPERATION_ID_CONFLICT',
      result1.status === 200 && result2.status === 409 &&
      (result2.body?.code === 'OPERATION_ID_CONFLICT' || result2.body?.authority?.code === 'OPERATION_ID_CONFLICT') &&
      bindingCount === 1 && opCount === opCountAfter1, // No second binding, no second operation
      { r1: result1.status, r2: result2.status, r2_code: result2.body?.code || result2.body?.authority?.code, bindingCount, opCount, opCountAfter1 });

    await cleanupListing(adminSql, listingId);
  }

  // ── T9c: Non-USD PI → CURRENCY_MISMATCH, zero mutation ─────────────────────
  {
    const listingId = `canary_confirm_t9c_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    // Capture baseline counts after setup (setup creates ops + outbox)
    const opCountBaseline = await getOpCount(adminSql, listingId);
    const outboxCountBaseline = await getOutboxCount(adminSql, listingId);

    const entities = makeMockEntities();
    const stripe = makeFakeStripe({
      currency: 'eur', // Non-USD
      amount: 10000,
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });

    const result = await runCanaryConfirmSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
      },
    });

    const bindingCount = await getBindingCount(adminSql, purchaseId);
    const opCount = await getOpCount(adminSql, listingId);
    const outboxCount = await getOutboxCount(adminSql, listingId);

    // Non-USD must be rejected BEFORE any mutation: no new binding, no new
    // operation, no new outbox. Counts must not increase from the baseline
    // captured after setup.
    record('T9c: Non-USD → CURRENCY_MISMATCH, zero mutation',
      result.status === 400 && result.body?.code === 'CURRENCY_MISMATCH' &&
      bindingCount === 0 &&
      opCount === opCountBaseline && outboxCount === outboxCountBaseline,
      { status: result.status, code: result.body?.code, bindingCount, opCount, outboxCount, opCountBaseline, outboxCountBaseline });

    await cleanupListing(adminSql, listingId);
  }

  // ── T10: 20-way concurrent → exactly one binding ───────────────────────────
  {
    const listingId = `canary_confirm_t10_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    const N = 20;
    const promises = [];
    for (let i = 0; i < N; i++) {
      const entities = makeMockEntities();
      const stripe = makeFakeStripe({
        metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
      });
      promises.push(runCanaryConfirmSaga({
        entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
        executorClient, stripeAdapter: stripe,
        params: {
          listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
          buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
          reservation_token: token, amount: 100,
        },
      }));
    }
    const allResults = await Promise.all(promises);

    const okCount = allResults.filter(r => r.status === 200 && r.body?.ok === true).length;
    const bindingCount = await getBindingCount(adminSql, purchaseId);

    record('T10: 20-way concurrent → exactly one binding',
      bindingCount === 1 && okCount >= 1,
      { okCount, bindingCount });

    await cleanupListing(adminSql, listingId);
  }

  // ── T11: Mirror failure → outbox created ───────────────────────────────────
  {
    const listingId = `canary_confirm_t11_${await genId()}`;
    syntheticIds.add(listingId);
    const purchaseId = `pur_${listingId}`;
    const piId = `pi_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await setupReservedListing(adminSql, listingId, sellerId, buyerId, token, expiresAt);

    const entities = makeMockEntities();
    entities._store.listings.set(listingId, { id: listingId, notes: '[AUTH_CANARY]', event_id: 'evt_1' });
    entities._store.purchases.set(purchaseId, {
      id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com',
      seller_email: 'seller@example.com', amount: 100, reservation_token: token,
      payment_intent_id: piId, transfer_status: 'pending_transfer',
    });
    entities._store.purchasePrivates.set(`pp_${purchaseId}`, {
      id: `pp_${purchaseId}`, purchase_id: purchaseId, listing_id: listingId,
      buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
      payment_intent_id: piId, reservation_token: token,
    });

    const stripe = makeFakeStripe({
      metadata: { purchase_id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com', reservation_token: token },
    });

    const result = await runCanaryConfirmSaga({
      entities, user: { id: buyerId, email: 'buyer@example.com', role: 'admin' },
      executorClient, stripeAdapter: stripe,
      params: {
        listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId,
        buyer_user_id: buyerId, buyer_email: 'buyer@example.com', seller_email: 'seller@example.com',
        reservation_token: token, amount: 100,
        simulate_mirror_failure: true,
      },
    });

    const outboxRecords = entities._store.outbox.size;
    const bindingCount = await getBindingCount(adminSql, purchaseId);

    record('T11: Mirror failure → outbox created',
      result.status === 200 && result.body?.mirror?.outbox_id !== null &&
      outboxRecords >= 1 && bindingCount === 1, // Binding still created (Postgres authoritative)
      { status: result.status, outboxRecords, bindingCount, mirrorOutbox: result.body?.mirror?.outbox_id });

    await cleanupListing(adminSql, listingId);
  }

  // ── T12: Flag-OFF isolation → 503 CANARY_DISABLED ──────────────────────────
  {
    const listingId = `canary_confirm_t12_${await genId()}`;
    const purchaseId = `pur_${listingId}`;

    const entities = makeMockEntities();
    entities._store.listings.set(listingId, { id: listingId, notes: '[AUTH_CANARY]', event_id: 'evt_1' });
    entities._store.purchases.set(purchaseId, {
      id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com',
      seller_email: 'seller@example.com', amount: 100,
      payment_intent_id: 'pi_test', transfer_status: 'pending_transfer',
    });

    // maybeRouteCanaryConfirm receives canaryEnabled via trusted DI (flag OFF)
    const result = await maybeRouteCanaryConfirm({
      base44: { asServiceRole: { entities } },
      user: { id: 'admin', email: 'admin@example.com', role: 'admin' },
      body: { canary: true, purchase_id: purchaseId },
      listing: entities._store.listings.get(listingId),
      purchase: entities._store.purchases.get(purchaseId),
      executorUrl: executorUrl,
      stripeAdapter: makeFakeStripe(),
      canaryEnabled: false,
    });

    record('T12: Flag-OFF → 503 CANARY_DISABLED',
      result?.status === 503 && result?.body?.code === 'CANARY_DISABLED',
      { status: result?.status, code: result?.body?.code });
  }

  // ── T13: Non-canary isolation → 400 NOT_CANARY ────────────────────────────
  {
    const listingId = `canary_confirm_t13_${await genId()}`;
    const purchaseId = `pur_${listingId}`;

    const entities = makeMockEntities();
    // Non-canary listing (no [AUTH_CANARY] tag)
    entities._store.listings.set(listingId, { id: listingId, notes: 'Regular listing', event_id: 'evt_1' });
    entities._store.purchases.set(purchaseId, {
      id: purchaseId, listing_id: listingId, buyer_email: 'buyer@example.com',
      seller_email: 'seller@example.com', amount: 100,
      payment_intent_id: 'pi_test', transfer_status: 'pending_transfer',
    });

    const result = await maybeRouteCanaryConfirm({
      base44: { asServiceRole: { entities } },
      user: { id: 'admin', email: 'admin@example.com', role: 'admin' },
      body: { canary: true, purchase_id: purchaseId },
      listing: entities._store.listings.get(listingId),
      purchase: entities._store.purchases.get(purchaseId),
      executorUrl: executorUrl,
      stripeAdapter: makeFakeStripe(),
    });

    record('T13: Non-canary → 400 NOT_CANARY',
      result?.status === 400 && result?.body?.code === 'NOT_CANARY',
      { status: result?.status, code: result?.body?.code });
  }

  // ── T14: Handler wiring + no admin fallback (static analysis) ──────────────
  {
    const orchestratorSrc = readFileSync(new URL('../base44/shared/confirmCanaryOrchestrator.js', import.meta.url), 'utf8');
    const handlerSrc = readFileSync(new URL('../base44/functions/confirmCheckoutAuthorized/entry.ts', import.meta.url), 'utf8');

    // No admin fallback
    const orchestratorImportsAdmin = orchestratorSrc.includes('authorityV1TestAdmin');
    const handlerImportsAdmin = handlerSrc.includes('authorityV1TestAdmin');
    const orchestratorHasAdminUrl = orchestratorSrc.includes('AUTHORITY_DB_URL_DEV_ADMIN');
    const handlerHasAdminUrl = handlerSrc.includes('AUTHORITY_DB_URL_DEV_ADMIN');

    // Handler imports maybeRouteCanaryConfirm
    const handlerImportsCanary = handlerSrc.includes('maybeRouteCanaryConfirm');

    // Canary guard before maintenance
    const canaryBeforeMaintenance = handlerSrc.indexOf('maybeRouteCanaryConfirm') < handlerSrc.indexOf('isMaintenanceActive()');

    // P0-01Q: trusted flag injection — orchestrator accepts canaryEnabled DI,
    // does NOT call isCanaryEnabled() internally
    const orchCodeLines = orchestratorSrc.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    const orchCode = orchCodeLines.join('\n');
    const orchestratorAcceptsDI = orchCode.includes('deps.canaryEnabled');
    const orchestratorNoInternalFlag = !/isCanaryEnabled\s*\(\)/.test(orchCode);

    // Handler imports isCanaryEnabled + supplies canaryEnabled: isCanaryEnabled()
    const handlerImportsIsCanaryEnabled = handlerSrc.includes('isCanaryEnabled');
    const handlerSuppliesDI = handlerSrc.includes('canaryEnabled: isCanaryEnabled()');

    // Handler uses shared Stripe provider (not inline adapter)
    const handlerUsesSharedProvider = handlerSrc.includes('createStripeCaptureProvider');

    // Handler reads STRIPE_SECRET_KEY via base44:runtime (not Deno.env / STRIPELIVESECRETKEY)
    const handlerUsesRuntimeSecret = handlerSrc.includes("secrets.get('STRIPE_SECRET_KEY')");

    // Canary route (before "Legacy path") must not use Deno.env or STRIPELIVESECRETKEY
    const canarySection = handlerSrc.substring(0, handlerSrc.indexOf('Legacy path'));
    const canaryNoDenoEnv = !canarySection.includes('Deno.env');
    const canaryNoLiveKey = !canarySection.includes('STRIPELIVESECRETKEY');

    // Executor-only authority access (no recorder URL needed for confirm — bind only)
    const handlerUsesExecutorUrl = handlerSrc.includes("secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR')");

    record('T14: Handler wiring + no admin fallback (static analysis)',
      !orchestratorImportsAdmin && !handlerImportsAdmin &&
      !orchestratorHasAdminUrl && !handlerHasAdminUrl &&
      handlerImportsCanary && canaryBeforeMaintenance &&
      orchestratorAcceptsDI && orchestratorNoInternalFlag &&
      handlerImportsIsCanaryEnabled && handlerSuppliesDI &&
      handlerUsesSharedProvider && handlerUsesRuntimeSecret &&
      canaryNoDenoEnv && canaryNoLiveKey &&
      handlerUsesExecutorUrl,
      { orchestratorImportsAdmin, handlerImportsAdmin, orchestratorHasAdminUrl, handlerHasAdminUrl,
        handlerImportsCanary, canaryBeforeMaintenance,
        orchestratorAcceptsDI, orchestratorNoInternalFlag,
        handlerImportsIsCanaryEnabled, handlerSuppliesDI,
        handlerUsesSharedProvider, handlerUsesRuntimeSecret,
        canaryNoDenoEnv, canaryNoLiveKey, handlerUsesExecutorUrl });
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