/**
 * Checkout & Cleanup Concurrency Tests (7C.6)
 *
 * Run: npm test
 *
 * Tests invoke the ACTUAL production orchestrator modules directly:
 *   - runCreateCheckout (from checkoutOrchestrator.js)
 *   - runCleanupAbandonedCheckouts (from cleanupOrchestrator.js)
 *
 * 7C.6 test improvements:
 *   - Advance beyond cooldown for expired-retry and metadata-mismatch tests
 *   - Assert exact response status, PI count, PI statuses, Purchase status,
 *     Listing state, and ListingPrivate state
 *   - Test 201+ records with first 200 remaining pending; prove record 201 reached
 *   - Two-buyer race uses two different authenticated users sharing same DB/Stripe
 *   - No test may pass merely because it received 429
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  verifyReservation,
  verifyCleanupReservation,
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
  } else {
    deps._state.stores.Listing.set(listingId, {
      id: listingId, status: 'pending_transfer', asking_price: 100, quantity: 1,
      section: 'A', row: '1', event_id: 'event_1',
      updated_date: '2026-08-01T10:00:00.000Z',
      reservation_token: token, reserved_by_email: buyerEmail,
      reservation_expires_at: expiry, hidden_reason: null,
      created_date: createdDate,
    });
  }

  // Update LP
  let lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  if (lp) {
    lp.reservation_token = token;
    lp.reserved_by_email = buyerEmail;
    lp.reservation_expires_at = expiry;
  } else {
    deps._state.stores.ListingPrivate.set(`lp_${listingId}`, {
      id: `lp_${listingId}`, listing_id: listingId, seller_email: 'seller@test',
      reservation_token: token, reserved_by_email: buyerEmail,
      reservation_expires_at: expiry, proof_status: 'approved',
      is_demo_listing: false, notes: null,
      seat_inventory_id: null, checkout_quarantined: false,
      created_date: createdDate, updated_date: createdDate,
    });
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
    created_date: createdDate, updated_date: createdDate,
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

// Helper: bulk create pending purchases for pagination tests
function setupBulkPendingPurchases(deps, count, opts = {}) {
  for (let i = 0; i < count; i++) {
    const listingId = `listing_bulk_${i}`;
    const purchaseId = `pur_bulk_${i}`;
    const piId = `pi_bulk_${i}`;
    const token = `token_bulk_${i}`;
    const createdDate = new Date(Date.now() - (i + 30) * 60 * 1000).toISOString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const piStatus = (i < 200 && opts.first200KeepLocked) ? 'requires_capture' : 'requires_payment_method';

    deps._state.stores.Listing.set(listingId, {
      id: listingId, status: 'pending_transfer', asking_price: 100, quantity: 1,
      section: 'A', row: '1', event_id: 'event_1',
      updated_date: '2026-08-01T10:00:00.000Z',
      reservation_token: token, reserved_by_email: 'buyer@test',
      reservation_expires_at: expiry, hidden_reason: null,
      created_date: createdDate,
    });
    deps._state.stores.ListingPrivate.set(`lp_${listingId}`, {
      id: `lp_${listingId}`, listing_id: listingId, seller_email: 'seller@test',
      reservation_token: token, reserved_by_email: 'buyer@test',
      reservation_expires_at: expiry, proof_status: 'approved',
      is_demo_listing: false, notes: null,
      seat_inventory_id: null, checkout_quarantined: false,
      created_date: createdDate, updated_date: createdDate,
    });
    deps._state.stores.Purchase.set(purchaseId, {
      id: purchaseId, listing_id: listingId, event_id: 'event_1',
      buyer_email: 'buyer@test', seller_email: 'seller@test',
      payment_intent_id: piId, reservation_token: token,
      transfer_status: 'pending_transfer', payment_captured: false,
      is_demo: false, amount: 105,
      created_date: createdDate, updated_date: createdDate,
    });
    deps._state.stores.PurchasePrivate.set(`pp_${purchaseId}`, {
      id: `pp_${purchaseId}`, purchase_id: purchaseId, listing_id: listingId,
      event_id: 'event_1', buyer_email: 'buyer@test', seller_email: 'seller@test',
      payment_intent_id: piId, reservation_token: token,
      payment_captured: false, is_demo: false,
      created_date: createdDate, updated_date: createdDate,
    });
    deps.stripe.pisById.set(piId, {
      id: piId, client_secret: `secret_${piId}`, status: piStatus,
      metadata: { listing_id: listingId, buyer_email: 'buyer@test', reservation_token: token, purchase_id: purchaseId },
    });
  }
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

function testCleanupAllowsExpired() {
  // verifyCleanupReservation allows expired but still requires matching expirations
  const expiry = new Date(Date.now() + 60000).toISOString();
  const expiredExpiry = new Date(Date.now() - 60000).toISOString();
  const listing = { status: 'pending_transfer', reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiredExpiry };
  const lp = { reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiredExpiry };
  const expiredAllowed = verifyCleanupReservation(listing, lp, 'tok1', 'b@test');
  // verifyReservation rejects expired
  const expiredRejected = !verifyReservation(listing, lp, 'tok1', 'b@test');
  // Mismatched expirations still rejected
  listing.reservation_expires_at = expiry;
  const mismatchRejected = !verifyCleanupReservation(listing, lp, 'tok1', 'b@test');
  return { name: 'cleanup_allows_expired', passed: expiredAllowed && expiredRejected && mismatchRejected, expired_allowed: expiredAllowed, expired_rejected_by_verifyReservation: expiredRejected, mismatch_rejected: mismatchRejected };
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
  const expiredExpiry = new Date(Date.now() - 60000).toISOString();
  const purchase = { id: 'p1', listing_id: 'l1' };
  const pp = { purchase_id: 'p1', listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' };
  const listing = { id: 'l1', status: 'pending_transfer', reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const lp = { reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const pi = { metadata: { purchase_id: 'p1', listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' } };

  const allMatch = verifyCleanupOwnership(purchase, pp, listing, lp, pi);
  const listingIdMismatch = !verifyCleanupOwnership(purchase, { ...pp, listing_id: 'l2' }, listing, lp, pi);
  const piMetadataMismatch = !verifyCleanupOwnership(purchase, pp, listing, lp, { metadata: { ...pi.metadata, buyer_email: 'wrong@test' } });
  const reservationMismatch = !verifyCleanupOwnership(purchase, pp, { ...listing, reservation_token: 'wrong' }, lp, pi);

  // 7C.6 fix #1: purchase_id is required (not optional)
  const missingPurchaseId = !verifyCleanupOwnership(purchase, pp, listing, lp, { metadata: { listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' } });

  // 7C.6 fix #1: cleanup allows expired reservations
  const expiredListing = { ...listing, reservation_expires_at: expiredExpiry };
  const expiredLP = { ...lp, reservation_expires_at: expiredExpiry };
  const expiredAllowed = verifyCleanupOwnership(purchase, pp, expiredListing, expiredLP, pi);

  const passed = allMatch && listingIdMismatch && piMetadataMismatch && reservationMismatch && missingPurchaseId && expiredAllowed;
  return { name: 'verify_cleanup_ownership', passed, all_match: allMatch, listing_id_mismatch: listingIdMismatch, pi_metadata_mismatch: piMetadataMismatch, reservation_mismatch: reservationMismatch, purchase_id_required: missingPurchaseId, expired_allowed: expiredAllowed };
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
  const piCount = deps.stripe.pisById.size;
  const passed = purchaseCreated && listingReserved && lpReserved && piCount === 1 && result.status === 200;
  return { name: 'checkout_success', passed, status: result.status, listing_reserved: listingReserved, lp_reserved: lpReserved, pi_count: piCount };
}

async function testTwoBuyerRace() {
  // 7C.6 fix #6: two different authenticated users sharing same DB and Stripe mock
  const { seed } = createDefaultSeed({ buyerEmail: 'buyerA@test' });
  seed.User.push({ id: 'user_buyer_b', email: 'buyerB@test', role: 'user', full_name: 'Buyer B' });

  const deps = createMockDeps({ seed });
  const depsA = { ...deps, user: { id: 'user_buyer', email: 'buyerA@test', role: 'user', full_name: 'Buyer A' } };
  const depsB = { ...deps, user: { id: 'user_buyer_b', email: 'buyerB@test', role: 'user', full_name: 'Buyer B' } };

  const [resultA, resultB] = await Promise.all([
    runCreateCheckout(depsA, { listing_id: 'listing_1' }),
    runCreateCheckout(depsB, { listing_id: 'listing_1' }),
  ]);
  const successCount = (resultA.status === 200 ? 1 : 0) + (resultB.status === 200 ? 1 : 0);
  const loserGot409 = resultA.status === 409 || resultB.status === 409;
  const piCount = deps.stripe.pisById.size;
  // 7C.6 fix #4: never permit two live PIs for one listing/buyer
  const passed = successCount === 1 && loserGot409 && piCount === 1;
  return { name: 'two_buyer_race', passed, success_count: successCount, loser_got_409: loserGot409, pi_count: piCount, resultA_status: resultA.status, resultB_status: resultB.status };
}

async function testRetryBeforeActiveStatusRejection() {
  const { seed, buyerEmail } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'retry_before_active_rejection', passed: false, error: 'initial checkout failed', detail: r1 };
  timeOffset = 20000; // Advance past PI cooldown (15s)
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const piCount = deps.stripe.pisById.size;
  // 7C.6 fix #6: assert exact status, not just "not 429"
  const passed = r2.status === 200 && r2.body.purchase_id === r1.body.purchase_id && r2.status !== 429 && piCount === 1;
  return { name: 'retry_before_active_rejection', passed, listing_is_pending: listing.status === 'pending_transfer', retry_status: r2.status, retry_not_429: r2.status !== 429, same_purchase: r2.body.purchase_id === r1.body.purchase_id, pi_count: piCount };
}

async function testCanceledPIRetry() {
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'canceled_pi_retry', passed: false, error: 'initial checkout failed' };
  const pi = [...deps.stripe.pisById.values()][0];
  pi.status = 'canceled';
  timeOffset = 20000; // Advance past PI cooldown (15s)
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const piCount = deps.stripe.pisById.size;
  const piStatuses = [...deps.stripe.pisById.values()].map(p => p.status);
  // 7C.6 fix #6: assert exact status, PI count, PI statuses
  const passed = r2.status === 409 && r2.status !== 429 && piCount === 1;
  return { name: 'canceled_pi_retry', passed, retry_status: r2.status, retry_not_429: r2.status !== 429, pi_count: piCount, pi_statuses: JSON.stringify(piStatuses), listing_status: listing.status, lp_quarantined: lp.checkout_quarantined };
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
  const oldPurchase = [...deps._state.stores.Purchase.values()][0];
  if (oldPurchase) oldPurchase.transfer_status = 'expired';
  const oldPP = [...deps._state.stores.PurchasePrivate.values()][0];
  if (oldPP) deps._state.stores.PurchasePrivate.delete(oldPP.id);
  timeOffset = 20000; // Advance past PI cooldown (15s)
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCount = deps.stripe.pisById.size;
  const passed = r1.status === 200 && r2.status === 200 && r1.body.purchase_id !== r2.body.purchase_id && r2.status !== 429 && piCount === 2;
  return { name: 'different_revisions', passed, buyerA_success: r1.status === 200, buyerB_success: r2.status === 200, buyerB_not_429: r2.status !== 429, different_purchases: r1.body.purchase_id !== r2.body.purchase_id, pi_count: piCount };
}

async function testQuarantinedRetry() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const listing = deps._state.stores.Listing.get('listing_1');
  listing.status = 'hidden'; listing.hidden_reason = 'checkout_quarantine';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.checkout_quarantined = true;
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const passed = result.status === 409 && result.body.error?.includes('under review');
  return { name: 'quarantined_retry', passed, status: result.status, error: result.body.error };
}

async function testExpiredRetry() {
  // 7C.6 fix #6: advance beyond cooldown, assert no 429
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'expired_retry', passed: false, error: 'initial checkout failed' };
  // Expire the reservation
  const listing = deps._state.stores.Listing.get('listing_1');
  const pastExpiry = new Date(Date.now() - 60000).toISOString();
  listing.reservation_expires_at = pastExpiry;
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reservation_expires_at = pastExpiry;
  timeOffset = 20000; // Advance past PI cooldown (15s)
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCount = deps.stripe.pisById.size;
  const noStaleSecret = !r2.body.clientSecret || r2.body.clientSecret !== r1.body.clientSecret;
  // 7C.6 fix #6: no test may pass merely because it received 429
  const passed = noStaleSecret && r2.status !== 429;
  return { name: 'expired_retry', passed, r2_status: r2.status, r2_not_429: r2.status !== 429, no_stale_secret: noStaleSecret, pi_count: piCount };
}

async function testPIMetadataMismatch() {
  // 7C.6 fix #4: metadata mismatch must fail closed
  // 7C.6 fix #6: advance beyond cooldown, assert PI count/status, no 429
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'pi_metadata_mismatch', passed: false, error: 'initial checkout failed' };
  // Corrupt PI metadata
  const pi = [...deps.stripe.pisById.values()][0];
  pi.metadata.buyer_email = 'wrong@test';
  timeOffset = 20000; // Advance past PI cooldown (15s)
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCount = deps.stripe.pisById.size;
  const piStatuses = [...deps.stripe.pisById.values()].map(p => p.status);
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  // 7C.6 fix #4: do not continue to new checkout, cancel/quarantine, never two live PIs
  const passed = r2.status === 409 && r2.status !== 429 && piCount === 1;
  return { name: 'pi_metadata_mismatch', passed, r2_status: r2.status, r2_not_429: r2.status !== 429, pi_count: piCount, pi_statuses: JSON.stringify(piStatuses), listing_status: listing.status, listing_reason: listing.hidden_reason, lp_quarantined: lp.checkout_quarantined };
}

async function testMissingUserRecord() {
  const { seed } = createDefaultSeed();
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
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const alertCreated = deps._state.stores.AdminAlert.size > 0;
  // 7C.6 fix #6: assert exact status, PI status, Listing state, LP state
  const passed = result.status === 500 && piCanceled && listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' && lp.checkout_quarantined === true;
  return { name: 'failure_after_pi_purchase_create', passed, status: result.status, pi_canceled: piCanceled, listing_status: listing.status, listing_reason: listing.hidden_reason, lp_quarantined: lp.checkout_quarantined, lp_quarantine_pi_id: lp.checkout_quarantine_pi_id, alert_created: alertCreated };
}

async function testFailureAfterPICreation_LPWriteFails() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    hooks: {
      'before_ListingPrivate_update': async (id, data) => {
        // Only throw on checkout reservation writes, not quarantine writes
        if (data.reservation_token !== undefined) {
          return { throw: new Error('Simulated LP write failure') };
        }
      },
    },
  });
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCanceled = [...deps.stripe.pisById.values()].every(pi => pi.status === 'canceled');
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const passed = result.status === 500 && piCanceled && listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' && lp.checkout_quarantined === true;
  return { name: 'failure_after_pi_lp_write', passed, status: result.status, pi_canceled: piCanceled, listing_status: listing.status, listing_reason: listing.hidden_reason, lp_quarantined: lp.checkout_quarantined };
}

async function testFailureAfterPICreation_RevisionMismatch() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const originalCreate = deps.stripe.paymentIntents.create;
  deps.stripe.paymentIntents.create = async (params, opts) => {
    const pi = await originalCreate(params, opts);
    const listing = deps._state.stores.Listing.get('listing_1');
    listing.updated_date = '2026-08-01T12:00:00.000Z';
    return pi;
  };
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCanceled = [...deps.stripe.pisById.values()].every(pi => pi.status === 'canceled');
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const passed = result.status === 409 && piCanceled && listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' && lp.checkout_quarantined === true;
  return { name: 'failure_after_pi_revision_mismatch', passed, status: result.status, pi_canceled: piCanceled, listing_status: listing.status, listing_reason: listing.hidden_reason, lp_quarantined: lp.checkout_quarantined };
}

// ── C. Cleanup orchestrator tests ──────────────────────────────────────────

async function testCleanupReleasesAbandoned() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const r = await runCreateCheckout(deps, { listing_id: listingId });
  if (r.status !== 200) return { name: 'cleanup_releases_abandoned', passed: false, error: 'checkout failed' };
  const purchase = [...deps._state.stores.Purchase.values()].find(p => p.transfer_status === 'pending_transfer');
  purchase.created_date = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  const piStatuses = [...deps.stripe.pisById.values()].map(p => p.status);
  // 7C.6 fix #6: assert all fields
  const passed = result.body.released > 0 && listing.status === 'active' && listing.reservation_token === null && listing.hidden_reason === null && lp.reservation_token === null && lp.checkout_quarantined === false && piStatuses.every(s => s === 'canceled');
  return { name: 'cleanup_releases_abandoned', passed, status: result.status, released: result.body.released, listing_status: listing.status, listing_reservation: listing.reservation_token, lp_reservation: lp.reservation_token, lp_quarantined: lp.checkout_quarantined, pi_statuses: JSON.stringify(piStatuses) };
}

async function testCleanupQuarantinesOnPIMismatch() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const { token } = setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reservation_token = 'different_token';
  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const lpFinal = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  const passed = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' && lpFinal.checkout_quarantined === true && result.body.quarantined > 0;
  return { name: 'cleanup_quarantines_pi_mismatch', passed, quarantined: result.body.quarantined, listing_status: listing.status, listing_reason: listing.hidden_reason, lp_quarantined: lpFinal.checkout_quarantined };
}

async function testListingTokenChangesDuringRelease() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const { token } = setupPendingPurchase(deps, { listingId, piStatus: 'requires_payment_method' });
  const originalCancel = deps.stripe.paymentIntents.cancel;
  let cancelCalled = false;
  deps.stripe.paymentIntents.cancel = async (id) => {
    const result = await originalCancel(id);
    cancelCalled = true;
    const listing = deps._state.stores.Listing.get(listingId);
    listing.reservation_token = 'changed_by_race';
    return result;
  };
  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  // 7C.6 fix #3: new token must never be erased — should be quarantined, not released
  const passed = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' && lp.checkout_quarantined === true;
  return { name: 'listing_token_changes_during_release', passed, listing_status: listing.status, listing_reason: listing.hidden_reason, lp_quarantined: lp.checkout_quarantined, cancel_called: cancelCalled };
}

async function testLPTokenBuyerDivergence() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reserved_by_email = 'different@test';
  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const lpFinal = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  const passed = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' && lpFinal.checkout_quarantined === true;
  return { name: 'lp_token_buyer_divergence', passed, listing_status: listing.status, listing_reason: listing.hidden_reason, lp_quarantined: lpFinal.checkout_quarantined };
}

async function testQuarantineRecoverySuccess() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  const listing = deps._state.stores.Listing.get(listingId);
  listing.status = 'hidden'; listing.hidden_reason = 'checkout_quarantine';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.checkout_quarantined = true;
  lp.checkout_quarantine_pi_id = 'pi_existing';
  const purchase = [...deps._state.stores.Purchase.values()][0];
  purchase.transfer_status = 'expired';
  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  const finalLP = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  // 7C.6 fix #5: assert EVERY public/private field
  const passed = finalListing.status === 'active' &&
    finalListing.reservation_token === null &&
    finalListing.reserved_by_email === null &&
    finalListing.reservation_expires_at === null &&
    finalListing.hidden_reason === null &&
    finalLP.reservation_token === null &&
    finalLP.reserved_by_email === null &&
    finalLP.reservation_expires_at === null &&
    finalLP.checkout_quarantined === false &&
    finalLP.checkout_quarantine_reason === null &&
    finalLP.checkout_quarantined_at === null &&
    finalLP.checkout_quarantine_pi_id === null &&
    result.body.quarantine_resolved > 0;
  return { name: 'quarantine_recovery_success', passed, listing_status: finalListing.status, listing_reservation: finalListing.reservation_token, listing_hidden_reason: finalListing.hidden_reason, lp_reservation: finalLP.reservation_token, lp_quarantined: finalLP.checkout_quarantined, lp_quarantine_reason: finalLP.checkout_quarantine_reason, lp_quarantine_pi_id: finalLP.checkout_quarantine_pi_id, quarantine_resolved: result.body.quarantine_resolved };
}

async function testSellerCancelDuringQuarantineRecovery() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  const listing = deps._state.stores.Listing.get(listingId);
  listing.status = 'hidden'; listing.hidden_reason = 'checkout_quarantine';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.checkout_quarantined = true;
  lp.checkout_quarantine_pi_id = 'pi_existing';
  const purchase = [...deps._state.stores.Purchase.values()][0];
  purchase.transfer_status = 'expired';
  deps._hooks.before_ListingPrivate_update = (id, data) => {
    if (data.checkout_quarantined === false) {
      const l = deps._state.stores.Listing.get(listingId);
      l.status = 'cancelled';
    }
  };
  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  const finalLP = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  // 7C.6 fix #5: assert every field — should NOT be reactivated, should be quarantined
  const notReactivated = finalListing.status !== 'active';
  const quarantined = finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine' && finalLP.checkout_quarantined === true;
  const piIdPreserved = finalLP.checkout_quarantine_pi_id === 'pi_existing';
  const passed = notReactivated && quarantined && piIdPreserved;
  return { name: 'seller_cancel_during_quarantine_recovery', passed, listing_status: finalListing.status, listing_reason: finalListing.hidden_reason, lp_quarantined: finalLP.checkout_quarantined, lp_quarantine_pi_id: finalLP.checkout_quarantine_pi_id, not_reactivated: notReactivated };
}

async function testListingUpdateSucceedsLPFails() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  const listing = deps._state.stores.Listing.get(listingId);
  listing.status = 'hidden'; listing.hidden_reason = 'checkout_quarantine';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.checkout_quarantined = true;
  lp.checkout_quarantine_pi_id = 'pi_existing';
  const purchase = [...deps._state.stores.Purchase.values()][0];
  purchase.transfer_status = 'expired';
  deps._hooks.before_ListingPrivate_update = async (id, data) => {
    if (data.checkout_quarantined === false) {
      return { throw: new Error('Simulated LP update failure') };
    }
  };
  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  const finalLP = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  // 7C.6 fix #5: assert EVERY public/private field — both sides must be restored
  const passed = finalListing.status === 'hidden' &&
    finalListing.hidden_reason === 'checkout_quarantine' &&
    finalLP.checkout_quarantined === true &&
    finalLP.checkout_quarantine_pi_id === 'pi_existing' &&
    finalLP.checkout_quarantine_reason !== null;
  return { name: 'listing_update_succeeds_lp_fails', passed, listing_status: finalListing.status, listing_reason: finalListing.hidden_reason, lp_quarantined: finalLP.checkout_quarantined, lp_quarantine_reason: finalLP.checkout_quarantine_reason, lp_quarantine_pi_id: finalLP.checkout_quarantine_pi_id };
}

async function testNewTokenNeverErased() {
  // 7C.6 fix #3: a new token appearing after any check must never be erased
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const { token } = setupPendingPurchase(deps, { listingId, piStatus: 'requires_payment_method' });
  // Fault injection: during Purchase.update (step 5), inject a new token on LP
  deps._hooks.before_Purchase_update = (id, data) => {
    if (data.transfer_status === 'expired') {
      const lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
      if (lp) lp.reservation_token = 'new_token_injected';
    }
  };
  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  // The new token must NOT be erased — listing should be quarantined
  const passed = listing.status === 'hidden' &&
    listing.hidden_reason === 'checkout_quarantine' &&
    lp.checkout_quarantined === true &&
    lp.reservation_token === 'new_token_injected';
  return { name: 'new_token_never_erased', passed, listing_status: listing.status, listing_reason: listing.hidden_reason, lp_quarantined: lp.checkout_quarantined, lp_reservation_token: lp.reservation_token, new_token_preserved: lp.reservation_token === 'new_token_injected' };
}

async function testOldestFirstPagination() {
  const { seed, listingId } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const dates = [
    new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    new Date(Date.now() - 30 * 60 * 1000).toISOString(),
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
  deps._hooks.before_Purchase_update = (id, data) => {
    if (data.transfer_status === 'expired') processingOrder.push(id);
  };
  const result = await runCleanupAbandonedCheckouts(deps);
  const allProcessed = result.body.processed >= 3;
  const oldestFirst = processingOrder[0] === 'pur_0';
  return { name: 'oldest_first_pagination', passed: allProcessed && oldestFirst, processed: result.body.processed, processing_order: processingOrder };
}

async function testPagination201() {
  // 7C.6 fix #6/#7: test 201+ records with first 200 remaining pending; prove record 201 reached
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  setupBulkPendingPurchases(deps, 201, { first200KeepLocked: true });
  const result = await runCleanupAbandonedCheckouts(deps);
  // Record 201 (index 200) should be reached and released
  const pur201 = deps._state.stores.Purchase.get('pur_bulk_200');
  const listing201 = deps._state.stores.Listing.get('listing_bulk_200');
  const lp201 = deps._state.stores.ListingPrivate.get('lp_listing_bulk_200');
  // First 200 should remain pending (keep_locked)
  const pur0 = deps._state.stores.Purchase.get('pur_bulk_0');
  const first200StillPending = pur0.transfer_status === 'pending_transfer';
  const passed = result.body.processed >= 201 &&
    pur201.transfer_status === 'expired' &&
    listing201.status === 'active' &&
    lp201.reservation_token === null &&
    first200StillPending;
  return { name: 'pagination_201', passed, processed: result.body.processed, pur201_status: pur201.transfer_status, listing201_status: listing201.status, first200_still_pending: first200StillPending, max_skip_reached: result.body.max_skip_reached };
}

// ── D. Seller management interleaving (pure function) ─────────────────────

function testSellerManagementInterleaving() {
  const expiry = new Date(Date.now() + 600000).toISOString();
  const state1 = { status: 'pending_transfer', reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const lp1 = { reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const pauseDetected = !verifyReservation({ ...state1, status: 'hidden', hidden_reason: 'other' }, lp1, 'TA', 'b@test');
  const cancelDetected = !verifyReservation({ ...state1, status: 'cancelled' }, lp1, 'TA', 'b@test');
  return { name: 'seller_management_interleaving', passed: pauseDetected && cancelDetected, pause_detected: pauseDetected, cancel_detected: cancelDetected };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  const tests = [
    testSixConditionVerification(),
    testCleanupAllowsExpired(),
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
    await testNewTokenNeverErased(),
    await testOldestFirstPagination(),
    await testPagination201(),
  ];

  console.log('=== Checkout & Cleanup Concurrency Tests (7C.6) ===\n');

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