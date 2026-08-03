/**
 * Checkout & Cleanup Concurrency Tests (7C.5)
 *
 * Run: npm test
 *
 * Tests invoke the ACTUAL production orchestrator modules directly:
 *   - runCreateCheckout (from checkoutOrchestrator.js)
 *   - runCleanupAbandonedCheckouts (from cleanupOrchestrator.js)
 *
 * Tests do NOT simulate the workflow separately — they use the real modules
 * with mock deps and fault-injection hooks.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  verifyReservation,
  deriveIdempotencyKey,
  classifyRetryOutcome,
  classifyCleanupOutcome,
  isStripeIdempotencyError,
  isQuarantined,
  isRetryablePIStatus,
  verifyCleanupOwnership,
  canRecoverQuarantine,
} from '../base44/shared/checkoutLogic.js';
import { runCreateCheckout } from '../base44/shared/checkoutOrchestrator.js';
import { runCleanupAbandonedCheckouts } from '../base44/shared/cleanupOrchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Polyfill crypto.randomUUID for older Node.js
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = {
    randomUUID: () => `uuid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  };
}

// ── Mock Stripe with real idempotency behavior ────────────────────────────
function createMockStripe(config = {}) {
  const pisByKey = new Map();
  const pisById = new Map();
  let piCounter = 0;

  const stripe = {
    pisByKey, pisById,
    paymentIntents: {
      create: async (params, opts) => {
        await new Promise(r => setTimeout(r, 1));
        if (config.createThrows) throw config.createThrows;
        const key = opts?.idempotencyKey;
        if (key) {
          const cached = pisByKey.get(key);
          if (cached) {
            if (cached.params.amount !== params.amount ||
                JSON.stringify(cached.params.metadata) !== JSON.stringify(params.metadata)) {
              const err = new Error('Keys for idempotent requests can only be used with the same parameters.');
              err.type = 'StripeIdempotencyError';
              throw err;
            }
            return cached.pi;
          }
        }
        const piId = `pi_test_${++piCounter}`;
        const pi = {
          id: piId, client_secret: `secret_${piId}`,
          status: 'requires_payment_method', amount: params.amount,
          metadata: { ...params.metadata },
        };
        if (key) pisByKey.set(key, { pi, params: { amount: params.amount, metadata: { ...params.metadata } } });
        pisById.set(piId, pi);
        return pi;
      },
      retrieve: async (id) => {
        if (!pisById.has(id)) throw new Error('PI not found');
        return pisById.get(id);
      },
      cancel: async (id) => {
        if (!pisById.has(id)) throw new Error('PI not found');
        const pi = pisById.get(id);
        pi.status = 'canceled';
        return pi;
      },
      update: async (id, params) => {
        if (!pisById.has(id)) throw new Error('PI not found');
        const pi = pisById.get(id);
        if (params.metadata) pi.metadata = { ...pi.metadata, ...params.metadata };
        return pi;
      },
    },
    accounts: { retrieve: async () => ({ charges_enabled: true }) },
  };
  return stripe;
}

// ── Mock entity helpers ───────────────────────────────────────────────────
function applyFilter(records, query) {
  if (!query || Object.keys(query).length === 0) return records;
  return records.filter(record => {
    for (const [key, value] of Object.entries(query)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && value.$in) {
        if (!value.$in.includes(record[key])) return false;
      } else {
        if (record[key] !== value) return false;
      }
    }
    return true;
  });
}

function applySort(records, sort) {
  if (!sort) return records;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...records].sort((a, b) => {
    const av = a[field] || '';
    const bv = b[field] || '';
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

let idCounter = 0;
function genId(name) {
  return `${name.toLowerCase()}_${++idCounter}`;
}

// ── Create mock deps with seeded data and hooks ───────────────────────────
function createMockDeps(config = {}) {
  const stores = {
    Listing: new Map(),
    ListingPrivate: new Map(),
    Purchase: new Map(),
    PurchasePrivate: new Map(),
    User: new Map(),
    UserSecurityProfile: new Map(),
    AdminAlert: new Map(),
    SeatInventory: new Map(),
  };

  const hooks = config.hooks || {};
  const writeLog = [];

  function createMockEntity(name) {
    const store = stores[name];
    return {
      filter: async (query, sort, limit, skip) => {
        if (hooks[`before_${name}_filter`]) hooks[`before_${name}_filter`]();
        let results = [...store.values()];
        results = applyFilter(results, query);
        if (sort) results = applySort(results, sort);
        if (skip) results = results.slice(skip);
        if (limit) results = results.slice(0, limit);
        return results;
      },
      create: async (data) => {
        if (hooks[`before_${name}_create`]) {
          const r = await hooks[`before_${name}_create`]();
          if (r?.throw) throw r.throw;
        }
        const id = data.id || genId(name);
        const record = { id, created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...data };
        store.set(id, record);
        writeLog.push({ entity: name, op: 'create', id, data });
        return record;
      },
      update: async (id, data) => {
        if (hooks[`before_${name}_update`]) {
          const r = await hooks[`before_${name}_update`](id, data);
          if (r?.throw) throw r.throw;
        }
        const record = store.get(id);
        if (!record) throw new Error(`${name} ${id} not found`);
        const updated = { ...record, ...data, updated_date: new Date().toISOString() };
        store.set(id, updated);
        writeLog.push({ entity: name, op: 'update', id, data });
        if (hooks[`after_${name}_update`]) hooks[`after_${name}_update`](updated);
        return updated;
      },
      delete: async (id) => {
        if (hooks[`before_${name}_delete`]) await hooks[`before_${name}_delete`](id);
        store.delete(id);
        writeLog.push({ entity: name, op: 'delete', id });
      },
    };
  }

  // Seed data
  if (config.seed) {
    for (const [entityName, records] of Object.entries(config.seed)) {
      for (const record of records) {
        const id = record.id || genId(entityName);
        stores[entityName].set(id, {
          id, created_date: record.created_date || '2026-08-01T10:00:00.000Z',
          updated_date: record.updated_date || '2026-08-01T10:00:00.000Z', ...record,
        });
      }
    }
  }

  const deps = {
    entities: {
      Listing: createMockEntity('Listing'),
      ListingPrivate: createMockEntity('ListingPrivate'),
      Purchase: createMockEntity('Purchase'),
      PurchasePrivate: createMockEntity('PurchasePrivate'),
      User: createMockEntity('User'),
      UserSecurityProfile: createMockEntity('UserSecurityProfile'),
      AdminAlert: createMockEntity('AdminAlert'),
      SeatInventory: createMockEntity('SeatInventory'),
    },
    stripe: config.stripe || createMockStripe(),
    user: config.user || { id: 'user_buyer', email: 'buyer@test', role: 'user', full_name: 'Test Buyer' },
    now: config.now || (() => Date.now()),
    isMaintenanceActive: config.isMaintenanceActive || (() => false),
    isLiveMode: config.isLiveMode ?? false,
    _state: { stores, hooks, writeLog },
    _hooks: hooks,
  };

  return deps;
}

// ── Default seed: active listing + seller + buyer ─────────────────────────
function createDefaultSeed(overrides = {}) {
  const listingId = overrides.listingId || 'listing_1';
  const sellerEmail = 'seller@test';
  const buyerEmail = overrides.buyerEmail || 'buyer@test';
  const now = Date.now();
  const pastDate = new Date(now - 30 * 60 * 1000).toISOString(); // 30 min ago (abandoned)

  const seed = {
    Listing: [{
      id: listingId, status: 'active', asking_price: 100, quantity: 1,
      section: 'A', row: '1', event_id: 'event_1',
      updated_date: '2026-08-01T10:00:00.000Z',
      reservation_token: null, reserved_by_email: null,
      reservation_expires_at: null, hidden_reason: null,
      ...overrides.listing,
    }],
    ListingPrivate: [{
      listing_id: listingId, id: 'lp_1', seller_email: sellerEmail,
      reservation_token: null, reserved_by_email: null,
      reservation_expires_at: null, proof_status: 'approved',
      is_demo_listing: false, notes: null,
      seat_inventory_id: null, checkout_quarantined: false,
      ...overrides.lp,
    }],
    User: [
      { id: 'user_buyer', email: buyerEmail, role: 'user', full_name: 'Test Buyer', ...overrides.buyer },
      { id: 'user_seller', email: sellerEmail, role: 'admin', full_name: 'Test Seller', ...overrides.seller },
    ],
    UserSecurityProfile: [{
      id: 'usp_1', user_id: 'user_seller', user_email: sellerEmail,
      stripe_account_id: 'acct_test_123', stripe_onboarding_complete: true,
      ...overrides.sellerSec,
    }],
  };

  if (overrides.purchases) seed.Purchase = overrides.purchases;
  if (overrides.purchasePrivates) seed.PurchasePrivate = overrides.purchasePrivates;

  return { seed, listingId, sellerEmail, buyerEmail };
}

// Helper: create a pending purchase with reservation
function setupPendingPurchase(deps, opts = {}) {
  const listingId = opts.listingId || 'listing_1';
  const buyerEmail = opts.buyerEmail || 'buyer@test';
  const token = opts.token || 'res_token_123';
  const expiry = opts.expiry || new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const createdDate = opts.createdDate || new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Update listing to pending_transfer
  const listing = deps._state.stores.Listing.get(listingId);
  if (listing) {
    listing.status = 'pending_transfer';
    listing.reservation_token = token;
    listing.reserved_by_email = buyerEmail;
    listing.reservation_expires_at = expiry;
  }

  // Update LP
  const lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  if (lp) {
    lp.reservation_token = token;
    lp.reserved_by_email = buyerEmail;
    lp.reservation_expires_at = expiry;
  }

  // Create Purchase
  const purchaseId = opts.purchaseId || genId('Purchase');
  deps._state.stores.Purchase.set(purchaseId, {
    id: purchaseId, listing_id: listingId, event_id: 'event_1',
    buyer_email: buyerEmail, seller_email: 'seller@test',
    payment_intent_id: opts.piId || 'pi_existing',
    reservation_token: token, transfer_status: 'pending_transfer',
    payment_captured: false, is_demo: false, amount: 105,
    created_date: createdDate, updated_date: createdDate,
  });

  // Create PurchasePrivate
  deps._state.stores.PurchasePrivate.set(`pp_${purchaseId}`, {
    id: `pp_${purchaseId}`, purchase_id: purchaseId, listing_id: listingId,
    event_id: 'event_1', buyer_email: buyerEmail, seller_email: 'seller@test',
    payment_intent_id: opts.piId || 'pi_existing', reservation_token: token,
    payment_captured: false, is_demo: false,
  });

  // Create PI in mock stripe
  if (!deps.stripe.pisById.has(opts.piId || 'pi_existing')) {
    const piId = opts.piId || 'pi_existing';
    deps.stripe.pisById.set(piId, {
      id: piId, client_secret: `secret_${piId}`,
      status: opts.piStatus || 'requires_payment_method',
      metadata: {
        listing_id: listingId, buyer_email: buyerEmail,
        reservation_token: token, purchase_id: purchaseId,
      },
    });
  }

  return { purchaseId, token, listingId };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── A. Pure function tests ─────────────────────────────────────────────────

function testSixConditionVerification() {
  const expiry = new Date(Date.now() + 60000).toISOString();
  const listing = { status: 'pending_transfer', reservation_token: 'tokenA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const lp = { reservation_token: 'tokenB', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const mismatchCaught = !verifyReservation(listing, lp, 'tokenA', 'b@test') && !verifyReservation(listing, lp, 'tokenB', 'b@test');
  lp.reservation_token = 'tokenA';
  const allPass = verifyReservation(listing, lp, 'tokenA', 'b@test');
  const expiredExpiry = new Date(Date.now() - 60000).toISOString();
  listing.reservation_expires_at = expiredExpiry; lp.reservation_expires_at = expiredExpiry;
  const expiredCaught = !verifyReservation(listing, lp, 'tokenA', 'b@test');
  listing.reservation_expires_at = expiry; lp.reservation_expires_at = expiry;
  const wrongBuyer = !verifyReservation(listing, lp, 'tokenA', 'wrong@test');
  return { name: 'six_condition_verification', passed: mismatchCaught && allPass && expiredCaught && wrongBuyer, mismatched_tokens_detected: mismatchCaught, all_conditions_pass: allPass, expired_detected: expiredCaught, wrong_buyer_detected: wrongBuyer };
}

function testCleanupStateTable() {
  const scenarios = [
    [null, true, true, 'quarantine', 'PI retrieval failure'],
    ['unknown', true, true, 'quarantine', 'Unknown PI status'],
    ['requires_payment_method', true, true, 'release', 'Never authorized, owns it'],
    ['requires_payment_method', true, false, 'quarantine', 'Token mismatch'],
    ['requires_payment_method', false, true, 'quarantine', 'Buyer mismatch'],
    ['requires_action', true, true, 'release', 'Requires action, owns it'],
    ['requires_capture', true, true, 'keep_locked', 'Authorized'],
    ['succeeded', true, true, 'keep_locked', 'Succeeded'],
    ['processing', true, true, 'keep_locked', 'Processing'],
    ['canceled', true, true, 'release', 'Canceled, owns it'],
    ['canceled', true, false, 'quarantine', 'Canceled, token mismatch'],
    ['canceled', false, true, 'quarantine', 'Canceled, buyer mismatch'],
    ['canceled', false, false, 'quarantine', 'Canceled, no ownership'],
  ];
  const results = []; let allPassed = true;
  for (const [piStatus, ownsByBuyer, ownsByToken, expected, desc] of scenarios) {
    const actual = classifyCleanupOutcome(piStatus, ownsByBuyer, ownsByToken);
    const passed = actual === expected; if (!passed) allPassed = false;
    results.push({ piStatus, expected, actual, passed, desc });
  }
  return { name: 'cleanup_state_table', passed: allPassed, scenarios: results };
}

function testSchemaPermitsQuarantine() {
  const listingSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'Listing.jsonc'), 'utf8');
  const lpSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'ListingPrivate.jsonc'), 'utf8');
  const passed = listingSchema.includes('"checkout_quarantine"') && lpSchema.includes('"checkout_quarantined"') && lpSchema.includes('"checkout_quarantine_reason"') && lpSchema.includes('"checkout_quarantined_at"') && lpSchema.includes('"checkout_quarantine_pi_id"');
  return { name: 'schema_permits_quarantine', passed, listing_has_quarantine: listingSchema.includes('"checkout_quarantine"'), lp_has_quarantined: lpSchema.includes('"checkout_quarantined"') };
}

function testIsQuarantinedHelper() {
  const listing = { status: 'hidden', hidden_reason: 'checkout_quarantine' };
  const lp = { checkout_quarantined: true };
  const detected = isQuarantined(listing, lp);
  const notDetected = !isQuarantined({ status: 'active', hidden_reason: null }, { checkout_quarantined: false });
  return { name: 'is_quarantined_helper', passed: detected && notDetected, quarantined_detected: detected, clean_not_detected: notDetected };
}

function testVerifyCleanupOwnership() {
  const expiry = new Date(Date.now() + 60000).toISOString();
  const purchase = { id: 'p1', listing_id: 'l1' };
  const pp = { purchase_id: 'p1', listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' };
  const listing = { id: 'l1', status: 'pending_transfer', reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const lp = { reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const pi = { metadata: { purchase_id: 'p1', listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' } };
  const allMatch = verifyCleanupOwnership(purchase, pp, listing, lp, pi);
  const listingIdMismatch = !verifyCleanupOwnership(purchase, { ...pp, listing_id: 'l2' }, listing, lp, pi);
  const piMetadataMismatch = !verifyCleanupOwnership(purchase, pp, listing, lp, { metadata: { ...pi.metadata, buyer_email: 'wrong@test' } });
  const reservationMismatch = !verifyCleanupOwnership(purchase, pp, { ...listing, reservation_token: 'wrong' }, lp, pi);
  const passed = allMatch && listingIdMismatch && piMetadataMismatch && reservationMismatch;
  return { name: 'verify_cleanup_ownership', passed, all_match: allMatch, listing_id_mismatch: listingIdMismatch, pi_metadata_mismatch: piMetadataMismatch, reservation_mismatch: reservationMismatch };
}

// ── B. Checkout orchestrator tests ────────────────────────────────────────

async function testCheckoutSuccess() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const purchaseCreated = result.status === 200 && result.body.purchase_id;
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const listingReserved = listing.status === 'pending_transfer';
  const lpReserved = lp.reservation_token !== null;
  return { name: 'checkout_success', passed: purchaseCreated && listingReserved && lpReserved, status: result.status, listing_reserved: listingReserved, lp_reserved: lpReserved };
}

async function testTwoBuyerRace() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const [resultA, resultB] = await Promise.all([
    runCreateCheckout(deps, { listing_id: 'listing_1' }),
    runCreateCheckout(deps, { listing_id: 'listing_1' }),
  ]);
  const successCount = (resultA.status === 200 ? 1 : 0) + (resultB.status === 200 ? 1 : 0);
  const loserGot409 = resultA.status === 409 || resultB.status === 409;
  return { name: 'two_buyer_race', passed: successCount === 1 && loserGot409, success_count: successCount, loser_got_409: loserGot409, pi_count: deps.stripe.pisById.size };
}

async function testRetryBeforeActiveStatusRejection() {
  const { seed, buyerEmail } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'retry_before_active_rejection', passed: false, error: 'initial checkout failed', detail: r1 };
  timeOffset = 20000; // Advance past PI cooldown (15s)
  // Listing is now pending_transfer — retry should return existing
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const passed = r2.status === 200 && r2.body.purchase_id === r1.body.purchase_id;
  return { name: 'retry_before_active_rejection', passed, listing_is_pending: deps._state.stores.Listing.get('listing_1').status === 'pending_transfer', retry_reached: r2.status === 200, same_purchase: r2.body.purchase_id === r1.body.purchase_id };
}

async function testCanceledPIRetry() {
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'canceled_pi_retry', passed: false, error: 'initial checkout failed' };
  // Cancel the PI
  const pi = [...deps.stripe.pisById.values()][0];
  pi.status = 'canceled';
  timeOffset = 20000; // Advance past PI cooldown (15s)
  // Retry should be blocked
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const passed = r2.status === 409;
  return { name: 'canceled_pi_retry', passed, retry_status: r2.status };
}

async function testDifferentRevisions() {
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  // Reset listing to active with new revision
  const listing = deps._state.stores.Listing.get('listing_1');
  listing.status = 'active'; listing.reservation_token = null; listing.reserved_by_email = null;
  listing.reservation_expires_at = null; listing.updated_date = '2026-08-01T11:00:00.000Z';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reservation_token = null; lp.reserved_by_email = null; lp.reservation_expires_at = null;
  // Also expire the old purchase
  const oldPurchase = [...deps._state.stores.Purchase.values()][0];
  if (oldPurchase) oldPurchase.transfer_status = 'expired';
  const oldPP = [...deps._state.stores.PurchasePrivate.values()][0];
  if (oldPP) deps._state.stores.PurchasePrivate.delete(oldPP.id);
  timeOffset = 20000; // Advance past PI cooldown (15s)
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const passed = r1.status === 200 && r2.status === 200 && r1.body.purchase_id !== r2.body.purchase_id;
  return { name: 'different_revisions', passed, buyerA_success: r1.status === 200, buyerB_success: r2.status === 200, different_purchases: r1.body.purchase_id !== r2.body.purchase_id };
}

async function testQuarantinedRetry() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // Quarantine the listing
  const listing = deps._state.stores.Listing.get('listing_1');
  listing.status = 'hidden'; listing.hidden_reason = 'checkout_quarantine';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.checkout_quarantined = true;
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const passed = result.status === 409 && result.body.error?.includes('under review');
  return { name: 'quarantined_retry', passed, status: result.status, error: result.body.error };
}

async function testExpiredRetry() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // Complete checkout
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'expired_retry', passed: false, error: 'initial checkout failed' };
  // Expire the reservation
  const listing = deps._state.stores.Listing.get('listing_1');
  const pastExpiry = new Date(Date.now() - 60000).toISOString();
  listing.reservation_expires_at = pastExpiry;
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reservation_expires_at = pastExpiry;
  // Retry — should NOT return stale client_secret (verifyReservation fails on expired)
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  // Should either proceed to new checkout (200) or be blocked (409), but NOT return stale secret
  const noStaleSecret = !r2.body.clientSecret || r2.body.clientSecret !== r1.body.clientSecret;
  const passed = noStaleSecret;
  return { name: 'expired_retry', passed, r2_status: r2.status, no_stale_secret: noStaleSecret };
}

async function testPIMetadataMismatch() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'pi_metadata_mismatch', passed: false, error: 'initial checkout failed' };
  // Corrupt PI metadata
  const pi = [...deps.stripe.pisById.values()][0];
  pi.metadata.buyer_email = 'wrong@test';
  // Retry should not return existing (metadata mismatch)
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const noStaleSecret = r2.status !== 200 || r2.body.clientSecret !== r1.body.clientSecret;
  return { name: 'pi_metadata_mismatch', passed: noStaleSecret, r2_status: r2.status };
}

async function testMissingUserRecord() {
  const { seed } = createDefaultSeed();
  // Remove buyer from User entity
  seed.User = seed.User.filter(u => u.email !== 'buyer@test');
  const deps = createMockDeps({ seed });
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const passed = result.status === 401 && result.body.code === 'USER_NOT_FOUND';
  return { name: 'missing_user_record', passed, status: result.status, code: result.body.code };
}

async function testFailureAfterPICreation_PurchaseCreateFails() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    hooks: {
      'before_Purchase_create': async () => ({ throw: new Error('Simulated Purchase creation failure') }),
    },
  });
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCanceled = [...deps.stripe.pisById.values()].every(pi => pi.status === 'canceled');
  const listingQuarantined = deps._state.stores.Listing.get('listing_1').status === 'hidden';
  const alertCreated = deps._state.stores.AdminAlert.size > 0;
  const passed = result.status === 500 && piCanceled && listingQuarantined;
  return { name: 'failure_after_pi_purchase_create', passed, status: result.status, pi_canceled: piCanceled, listing_quarantined: listingQuarantined, alert_created: alertCreated };
}

async function testFailureAfterPICreation_LPWriteFails() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    hooks: {
      'before_ListingPrivate_update': async () => ({ throw: new Error('Simulated LP write failure') }),
    },
  });
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCanceled = [...deps.stripe.pisById.values()].every(pi => pi.status === 'canceled');
  const listingQuarantined = deps._state.stores.Listing.get('listing_1').status === 'hidden';
  const passed = result.status === 500 && piCanceled && listingQuarantined;
  return { name: 'failure_after_pi_lp_write', passed, status: result.status, pi_canceled: piCanceled, listing_quarantined: listingQuarantined };
}

async function testFailureAfterPICreation_RevisionMismatch() {
  const { seed } = createDefaultSeed();
  let piCreated = false;
  const deps = createMockDeps({
    seed,
    hooks: {
      'after_Listing_update': (updated) => {
        // Simulate revision change after listing update
        if (updated.status === 'pending_transfer') {
          updated.updated_date = '2026-08-01T12:00:00.000Z';
        }
      },
    },
  });
  // Actually, revision mismatch happens when listingFresh.updated_date !== listingRevision
  // We need to change the listing's updated_date between initial fetch and re-fetch
  // This is tricky with hooks. Let me use a different approach:
  // Set up a hook that changes updated_date after PI creation
  const originalCreate = deps.stripe.paymentIntents.create;
  deps.stripe.paymentIntents.create = async (params, opts) => {
    const pi = await originalCreate(params, opts);
    // After PI creation, change the listing revision
    const listing = deps._state.stores.Listing.get('listing_1');
    listing.updated_date = '2026-08-01T12:00:00.000Z';
    return pi;
  };
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCanceled = [...deps.stripe.pisById.values()].every(pi => pi.status === 'canceled');
  const listingQuarantined = deps._state.stores.Listing.get('listing_1').status === 'hidden';
  const passed = result.status === 409 && piCanceled && listingQuarantined;
  return { name: 'failure_after_pi_revision_mismatch', passed, status: result.status, pi_canceled: piCanceled, listing_quarantined: listingQuarantined };
}

// ── C. Cleanup orchestrator tests ──────────────────────────────────────────

async function testCleanupReleasesAbandoned() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // Complete a checkout to create a pending purchase
  const r = await runCreateCheckout(deps, { listing_id: listingId });
  if (r.status !== 200) return { name: 'cleanup_releases_abandoned', passed: false, error: 'checkout failed' };
  // Make the purchase old enough to be abandoned
  const purchase = [...deps._state.stores.Purchase.values()].find(p => p.transfer_status === 'pending_transfer');
  purchase.created_date = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  // Run cleanup
  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const released = listing.status === 'active' && listing.reservation_token === null;
  return { name: 'cleanup_releases_abandoned', passed: released && result.body.released > 0, status: result.status, released: result.body.released, listing_status: listing.status };
}

async function testCleanupQuarantinesOnPIMismatch() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // Set up a pending purchase with canceled PI
  const { token } = setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  // Diverge LP token
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reservation_token = 'different_token';
  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const quarantined = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine';
  return { name: 'cleanup_quarantines_pi_mismatch', passed: quarantined && result.body.quarantined > 0, quarantined, result_quarantined: result.body.quarantined };
}

async function testListingTokenChangesDuringRelease() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const { token } = setupPendingPurchase(deps, { listingId, piStatus: 'requires_payment_method' });
  // Hook: after PI cancel, change listing token (simulates race condition)
  const originalCancel = deps.stripe.paymentIntents.cancel;
  let cancelCalled = false;
  deps.stripe.paymentIntents.cancel = async (id) => {
    const result = await originalCancel(id);
    cancelCalled = true;
    // Change listing token after cancel
    const listing = deps._state.stores.Listing.get(listingId);
    listing.reservation_token = 'changed_by_race';
    return result;
  };
  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  // Should be quarantined, not released (token changed between check and release)
  const quarantined = listing.status === 'hidden';
  return { name: 'listing_token_changes_during_release', passed: quarantined, listing_status: listing.status, cancel_called: cancelCalled };
}

async function testLPTokenBuyerDivergence() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // Set up pending purchase with canceled PI
  setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  // Diverge LP buyer
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reserved_by_email = 'different@test';
  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const quarantined = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine';
  return { name: 'lp_token_buyer_divergence', passed: quarantined, listing_status: listing.status, listing_reason: listing.hidden_reason };
}

async function testQuarantineRecoverySuccess() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // Set up quarantined listing with canceled PI
  setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  const listing = deps._state.stores.Listing.get(listingId);
  listing.status = 'hidden'; listing.hidden_reason = 'checkout_quarantine';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.checkout_quarantined = true;
  lp.checkout_quarantine_pi_id = 'pi_existing';
  // Expire the purchase (so no pending purchases)
  const purchase = [...deps._state.stores.Purchase.values()][0];
  purchase.transfer_status = 'expired';
  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  const recovered = finalListing.status === 'active' && finalListing.reservation_token === null;
  return { name: 'quarantine_recovery_success', passed: recovered && result.body.quarantine_resolved > 0, listing_status: finalListing.status, quarantine_resolved: result.body.quarantine_resolved };
}

async function testSellerCancelDuringQuarantineRecovery() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // Set up quarantined listing
  setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  const listing = deps._state.stores.Listing.get(listingId);
  listing.status = 'hidden'; listing.hidden_reason = 'checkout_quarantine';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.checkout_quarantined = true;
  lp.checkout_quarantine_pi_id = 'pi_existing';
  const purchase = [...deps._state.stores.Purchase.values()][0];
  purchase.transfer_status = 'expired';
  // Hook: during LP update (between Listing write and verification), seller cancels
  deps._hooks.before_ListingPrivate_update = (id, data) => {
    if (data.checkout_quarantined === false) {
      // Seller cancels the listing during the LP update
      const l = deps._state.stores.Listing.get(listingId);
      l.status = 'cancelled';
    }
  };
  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  // Should NOT be reactivated (seller cancelled)
  const notReactivated = finalListing.status !== 'active';
  return { name: 'seller_cancel_during_quarantine_recovery', passed: notReactivated, listing_status: finalListing.status };
}

async function testListingUpdateSucceedsLPFails() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // Set up quarantined listing with canceled PI
  setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  const listing = deps._state.stores.Listing.get(listingId);
  listing.status = 'hidden'; listing.hidden_reason = 'checkout_quarantine';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.checkout_quarantined = true;
  lp.checkout_quarantine_pi_id = 'pi_existing';
  const purchase = [...deps._state.stores.Purchase.values()][0];
  purchase.transfer_status = 'expired';
  // Hook: LP update fails (Listing update succeeds)
  let listingUpdateAttempted = false;
  deps._hooks.before_ListingPrivate_update = async (id, data) => {
    if (data.checkout_quarantined === false) {
      listingUpdateAttempted = true;
      return { throw: new Error('Simulated LP update failure') };
    }
  };
  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  // Listing should be restored to hidden quarantine
  const restored = finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine';
  const alertCreated = deps._state.stores.AdminAlert.size > 0;
  return { name: 'listing_update_succeeds_lp_fails', passed: restored && alertCreated, listing_status: finalListing.status, listing_reason: finalListing.hidden_reason, alert_created: alertCreated };
}

async function testOldestFirstPagination() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // Create 3 abandoned purchases with different created_dates
  const dates = [
    new Date(Date.now() - 60 * 60 * 1000).toISOString(), // oldest
    new Date(Date.now() - 45 * 60 * 1000).toISOString(), // middle
    new Date(Date.now() - 30 * 60 * 1000).toISOString(), // newest
  ];
  const processingOrder = [];
  for (let i = 0; i < 3; i++) {
    setupPendingPurchase(deps, {
      listingId: `listing_${i + 1}`,
      purchaseId: `pur_${i}`,
      piId: `pi_${i}`,
      piStatus: 'canceled',
      createdDate: dates[i],
    });
  }
  // Track processing order
  deps._hooks.before_Purchase_update = (id, data) => {
    if (data.transfer_status === 'expired') processingOrder.push(id);
  };
  const result = await runCleanupAbandonedCheckouts(deps);
  // All 3 should be processed
  const allProcessed = result.body.processed >= 3;
  // Oldest should be processed first
  const oldestFirst = processingOrder[0] === 'pur_0';
  return { name: 'oldest_first_pagination', passed: allProcessed && oldestFirst, processed: result.body.processed, processing_order: processingOrder };
}

// ── D. Seller management interleaving (pure function) ─────────────────────

function testSellerManagementInterleaving() {
  const expiry = new Date(Date.now() + 600000).toISOString();
  // Seller pauses after checkout reservation
  const state1 = { status: 'pending_transfer', reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const lp1 = { reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const pauseDetected = !verifyReservation({ ...state1, status: 'hidden', hidden_reason: 'other' }, lp1, 'TA', 'b@test');
  // Seller cancels after checkout reservation
  const cancelDetected = !verifyReservation({ ...state1, status: 'cancelled' }, lp1, 'TA', 'b@test');
  return { name: 'seller_management_interleaving', passed: pauseDetected && cancelDetected, pause_detected: pauseDetected, cancel_detected: cancelDetected };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  const tests = [
    testSixConditionVerification(),
    testCleanupStateTable(),
    testSchemaPermitsQuarantine(),
    testIsQuarantinedHelper(),
    testVerifyCleanupOwnership(),
    testSellerManagementInterleaving(),
    await testCheckoutSuccess(),
    await testTwoBuyerRace(),
    await testRetryBeforeActiveStatusRejection(),
    await testCanceledPIRetry(),
    await testDifferentRevisions(),
    await testQuarantinedRetry(),
    await testExpiredRetry(),
    await testPIMetadataMismatch(),
    await testMissingUserRecord(),
    await testFailureAfterPICreation_PurchaseCreateFails(),
    await testFailureAfterPICreation_LPWriteFails(),
    await testFailureAfterPICreation_RevisionMismatch(),
    await testCleanupReleasesAbandoned(),
    await testCleanupQuarantinesOnPIMismatch(),
    await testListingTokenChangesDuringRelease(),
    await testLPTokenBuyerDivergence(),
    await testQuarantineRecoverySuccess(),
    await testSellerCancelDuringQuarantineRecovery(),
    await testListingUpdateSucceedsLPFails(),
    await testOldestFirstPagination(),
  ];

  console.log('=== Checkout & Cleanup Concurrency Tests (7C.5) ===\n');

  let allPassed = true;
  for (const t of tests) {
    const status = t.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${t.name}`);
    for (const [key, val] of Object.entries(t)) {
      if (key !== 'name' && key !== 'passed' && key !== 'scenarios' && key !== 'detail') {
        console.log(`  ${key}: ${JSON.stringify(val)}`);
      }
    }
    if (t.scenarios) {
      for (const s of t.scenarios) {
        const sStatus = s.passed ? 'PASS' : 'FAIL';
        console.log(`  [${sStatus}] ${s.desc}: ${s.piStatus} → ${s.actual} (expected ${s.expected})`);
      }
    }
    console.log();
    if (!t.passed) allPassed = false;
  }

  console.log(`=== Overall: ${allPassed ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${tests.length}, Passed: ${tests.filter(t => t.passed).length}, Failed: ${tests.filter(t => !t.passed).length}`);

  if (!allPassed) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});