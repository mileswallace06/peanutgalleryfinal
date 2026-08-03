/**
 * Checkout & Cleanup Concurrency Tests (7C.7)
 *
 * Tests invoke the ACTUAL production orchestrator modules directly:
 *   - runCreateCheckout (from checkoutOrchestrator.js)
 *   - runCleanupAbandonedCheckouts (from cleanupOrchestrator.js)
 *
 * 7C.7 tests:
 *   A. Expired retry where Stripe cancel throws
 *   B. Retry PI missing purchase_id
 *   C. New token after final pre-clear read
 *   D. New token detected in run one, survives run two
 *   E. Seller cancel before recovery Listing.update
 *   F. Seller cancel between activation and LP quarantine clearing
 *   G. Correct pagination (first 200 locked, row 201 released)
 *   H. No test passes because of 429
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
  verifyExactPIMetadata,
  hasSellerCancelIntent,
  hasSellerPauseIntent,
  matchesQuarantineSnapshot,
  drainPeriodPassed,
  QUARANTINE_DRAIN_MS,
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

  const listing = deps._state.stores.Listing.get(listingId);
  if (listing) {
    listing.status = 'pending_transfer';
    listing.reservation_token = token;
    listing.reserved_by_email = buyerEmail;
    listing.reservation_expires_at = expiry;
  }

  let lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  if (lp) {
    lp.reservation_token = token;
    lp.reserved_by_email = buyerEmail;
    lp.reservation_expires_at = expiry;
  }

  const purchaseId = opts.purchaseId || genId('Purchase');
  deps._state.stores.Purchase.set(purchaseId, {
    id: purchaseId, listing_id: listingId, event_id: 'event_1',
    buyer_email: buyerEmail, seller_email: 'seller@test',
    payment_intent_id: opts.piId || 'pi_existing',
    reservation_token: token, transfer_status: 'pending_transfer',
    payment_captured: false, is_demo: false, amount: 105,
    created_date: createdDate, updated_date: createdDate,
  });

  deps._state.stores.PurchasePrivate.set(`pp_${purchaseId}`, {
    id: `pp_${purchaseId}`, purchase_id: purchaseId, listing_id: listingId,
    event_id: 'event_1', buyer_email: buyerEmail, seller_email: 'seller@test',
    payment_intent_id: opts.piId || 'pi_existing', reservation_token: token,
    payment_captured: false, is_demo: false,
    created_date: createdDate, updated_date: createdDate,
  });

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

// Helper: set up a pre-quarantined listing with durable snapshot
function setupQuarantinedListing(deps, opts = {}) {
  const listingId = opts.listingId || 'listing_1';
  const buyerEmail = opts.buyerEmail || 'buyer@test';
  const token = opts.token || 'res_token_123';
  const expiry = opts.expiry || new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const piId = opts.piId || 'pi_existing';
  const purchaseId = opts.purchaseId || 'pur_1';
  const quarantineTime = opts.quarantineTime || new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recoveryNotBefore = opts.recoveryNotBefore || new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Remove any existing LP for this listing to avoid duplicates
  for (const [key, val] of deps._state.stores.ListingPrivate.entries()) {
    if (val.listing_id === listingId) deps._state.stores.ListingPrivate.delete(key);
  }

  deps._state.stores.Listing.set(listingId, {
    id: listingId, status: 'hidden', hidden_reason: 'checkout_quarantine',
    asking_price: 100, quantity: 1, section: 'A', row: '1', event_id: 'event_1',
    updated_date: quarantineTime,
    reservation_token: token, reserved_by_email: buyerEmail,
    reservation_expires_at: expiry,
    created_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });

  deps._state.stores.ListingPrivate.set(`lp_${listingId}`, {
    id: `lp_${listingId}`, listing_id: listingId, seller_email: 'seller@test',
    reservation_token: token, reserved_by_email: buyerEmail,
    reservation_expires_at: expiry, proof_status: 'approved',
    is_demo_listing: false, notes: null, seat_inventory_id: null,
    checkout_quarantined: true,
    checkout_quarantine_reason: opts.reason || 'Test quarantine',
    checkout_quarantined_at: quarantineTime,
    checkout_quarantine_pi_id: piId,
    quarantined_reservation_token: token,
    quarantined_buyer: buyerEmail,
    quarantined_expiration: expiry,
    quarantined_purchase_id: purchaseId,
    quarantine_generation: 1,
    recovery_not_before: recoveryNotBefore,
    created_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    updated_date: quarantineTime,
  });

  deps._state.stores.Purchase.set(purchaseId, {
    id: purchaseId, listing_id: listingId, event_id: 'event_1',
    buyer_email: buyerEmail, seller_email: 'seller@test',
    payment_intent_id: piId, reservation_token: token,
    transfer_status: 'expired', payment_captured: false,
    is_demo: false, amount: 105,
    created_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    updated_date: quarantineTime,
  });

  deps._state.stores.PurchasePrivate.set(`pp_${purchaseId}`, {
    id: `pp_${purchaseId}`, purchase_id: purchaseId, listing_id: listingId,
    event_id: 'event_1', buyer_email: buyerEmail, seller_email: 'seller@test',
    payment_intent_id: piId, reservation_token: token,
    payment_captured: false, is_demo: false,
    created_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    updated_date: quarantineTime,
  });

  deps.stripe.pisById.set(piId, {
    id: piId, client_secret: `secret_${piId}`, status: 'canceled',
    metadata: { listing_id: listingId, buyer_email: buyerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  return { listingId, token, piId, purchaseId };
}

// Helper: bulk create pending purchases for pagination tests
function setupBulkPendingPurchases(deps, count, opts = {}) {
  for (let i = 0; i < count; i++) {
    const listingId = `listing_bulk_${i}`;
    const purchaseId = `pur_bulk_${i}`;
    const piId = `pi_bulk_${i}`;
    const token = `token_bulk_${i}`;
    const createdDate = new Date(Date.now() - (count - i + 30) * 60 * 1000).toISOString();
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
      is_demo_listing: false, notes: null, seat_inventory_id: null,
      checkout_quarantined: false,
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
  return { name: 'six_condition_verification', passed: mismatchCaught && allPass && expiredCaught && wrongBuyer };
}

function testCleanupAllowsExpired() {
  const expiry = new Date(Date.now() + 60000).toISOString();
  const expiredExpiry = new Date(Date.now() - 60000).toISOString();
  const listing = { status: 'pending_transfer', reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiredExpiry };
  const lp = { reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiredExpiry };
  const expiredAllowed = verifyCleanupReservation(listing, lp, 'tok1', 'b@test');
  const expiredRejected = !verifyReservation(listing, lp, 'tok1', 'b@test');
  listing.reservation_expires_at = expiry;
  const mismatchRejected = !verifyCleanupReservation(listing, lp, 'tok1', 'b@test');
  return { name: 'cleanup_allows_expired', passed: expiredAllowed && expiredRejected && mismatchRejected };
}

function testCleanupStateTable() {
  const scenarios = [
    [null, true, true, 'quarantine'], ['unknown', true, true, 'quarantine'],
    ['requires_payment_method', true, true, 'release'],
    ['requires_payment_method', true, false, 'quarantine'],
    ['requires_payment_method', false, true, 'quarantine'],
    ['requires_action', true, true, 'release'],
    ['requires_capture', true, true, 'keep_locked'],
    ['succeeded', true, true, 'keep_locked'],
    ['processing', true, true, 'keep_locked'],
    ['canceled', true, true, 'release'],
    ['canceled', true, false, 'quarantine'],
    ['canceled', false, true, 'quarantine'],
    ['canceled', false, false, 'quarantine'],
  ];
  const results = []; let allPassed = true;
  for (const [piStatus, ownsByBuyer, ownsByToken, expected] of scenarios) {
    const actual = classifyCleanupOutcome(piStatus, ownsByBuyer, ownsByToken);
    const passed = actual === expected; if (!passed) allPassed = false;
    results.push({ piStatus, expected, actual, passed });
  }
  return { name: 'cleanup_state_table', passed: allPassed, scenarios: results };
}

function testSchemaPermitsQuarantine() {
  const listingSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'Listing.jsonc'), 'utf8');
  const lpSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'ListingPrivate.jsonc'), 'utf8');
  const passed = listingSchema.includes('"checkout_quarantine"') &&
    lpSchema.includes('"checkout_quarantined"') &&
    lpSchema.includes('"quarantined_reservation_token"') &&
    lpSchema.includes('"quarantined_buyer"') &&
    lpSchema.includes('"quarantined_expiration"') &&
    lpSchema.includes('"quarantined_purchase_id"') &&
    lpSchema.includes('"quarantine_generation"') &&
    lpSchema.includes('"recovery_not_before"') &&
    lpSchema.includes('"seller_cancel_requested_at"') &&
    lpSchema.includes('"seller_pause_requested_at"');
  return { name: 'schema_permits_quarantine', passed };
}

function testIsQuarantinedHelper() {
  const listing = { status: 'hidden', hidden_reason: 'checkout_quarantine' };
  const lp = { checkout_quarantined: true };
  const detected = isQuarantined(listing, lp);
  const notDetected = !isQuarantined({ status: 'active', hidden_reason: null }, { checkout_quarantined: false });
  return { name: 'is_quarantined_helper', passed: detected && notDetected };
}

function testVerifyCleanupOwnership() {
  const expiry = new Date(Date.now() + 60000).toISOString();
  const expiredExpiry = new Date(Date.now() - 60000).toISOString();
  const purchase = { id: 'p1', listing_id: 'l1', payment_intent_id: 'pi1' };
  const pp = { purchase_id: 'p1', listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1', payment_intent_id: 'pi1' };
  const listing = { id: 'l1', status: 'pending_transfer', reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const lp = { reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const pi = { id: 'pi1', metadata: { purchase_id: 'p1', listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' } };
  const allMatch = verifyCleanupOwnership(purchase, pp, listing, lp, pi);
  const missingPurchaseId = !verifyCleanupOwnership(purchase, pp, listing, lp, { id: 'pi1', metadata: { listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' } });
  const expiredListing = { ...listing, reservation_expires_at: expiredExpiry };
  const expiredLP = { ...lp, reservation_expires_at: expiredExpiry };
  const expiredAllowed = verifyCleanupOwnership(purchase, pp, expiredListing, expiredLP, pi);
  return { name: 'verify_cleanup_ownership', passed: allMatch && missingPurchaseId && expiredAllowed };
}

function testSellerManagementInterleaving() {
  const expiry = new Date(Date.now() + 600000).toISOString();
  const state1 = { status: 'pending_transfer', reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const lp1 = { reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  const pauseDetected = !verifyReservation({ ...state1, status: 'hidden', hidden_reason: 'other' }, lp1, 'TA', 'b@test');
  const cancelDetected = !verifyReservation({ ...state1, status: 'cancelled' }, lp1, 'TA', 'b@test');
  return { name: 'seller_management_interleaving', passed: pauseDetected && cancelDetected };
}

// ── 7C.7 New pure function tests ───────────────────────────────────────────

function testVerifyExactPIMetadata() {
  const purchase = { id: 'p1', listing_id: 'l1', payment_intent_id: 'pi1' };
  const pp = { purchase_id: 'p1', listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1', payment_intent_id: 'pi1' };
  const pi = { id: 'pi1', metadata: { purchase_id: 'p1', listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' } };
  const allMatch = verifyExactPIMetadata(purchase, pp, pi);
  const missingPurchaseId = !verifyExactPIMetadata(purchase, pp, { id: 'pi1', metadata: { listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' } });
  const wrongPurchaseId = !verifyExactPIMetadata(purchase, pp, { id: 'pi1', metadata: { purchase_id: 'p2', listing_id: 'l1', buyer_email: 'b@test', reservation_token: 'tok1' } });
  const piIdMismatch = !verifyExactPIMetadata(purchase, { ...pp, payment_intent_id: 'pi2' }, pi);
  const purchasePiIdMismatch = !verifyExactPIMetadata({ ...purchase, payment_intent_id: 'pi2' }, pp, pi);
  return { name: 'verify_exact_pi_metadata', passed: allMatch && missingPurchaseId && wrongPurchaseId && piIdMismatch && purchasePiIdMismatch };
}

function testMatchesQuarantineSnapshot() {
  const lp = { reservation_token: 'tok1', reserved_by_email: 'b@test', reservation_expires_at: 'exp1', quarantined_reservation_token: 'tok1', quarantined_buyer: 'b@test', quarantined_expiration: 'exp1' };
  const matches = matchesQuarantineSnapshot(lp);
  const tokenMismatch = !matchesQuarantineSnapshot({ ...lp, reservation_token: 'tok2' });
  const buyerMismatch = !matchesQuarantineSnapshot({ ...lp, reserved_by_email: 'c@test' });
  const expiryMismatch = !matchesQuarantineSnapshot({ ...lp, reservation_expires_at: 'exp2' });
  const nullSnapshot = matchesQuarantineSnapshot({ reservation_token: null, reserved_by_email: null, reservation_expires_at: null, quarantined_reservation_token: null, quarantined_buyer: null, quarantined_expiration: null });
  return { name: 'matches_quarantine_snapshot', passed: matches && tokenMismatch && buyerMismatch && expiryMismatch && nullSnapshot };
}

function testDrainPeriodPassed() {
  const past = new Date(Date.now() - 60000).toISOString();
  const future = new Date(Date.now() + 60000).toISOString();
  const now = Date.now();
  const passed = drainPeriodPassed({ recovery_not_before: past }, now);
  const notPassed = !drainPeriodPassed({ recovery_not_before: future }, now);
  const noField = drainPeriodPassed({}, now);
  return { name: 'drain_period_passed', passed: passed && notPassed && noField };
}

function testHasSellerIntent() {
  const cancelIntent = hasSellerCancelIntent({ seller_cancel_requested_at: '2026-01-01T00:00:00.000Z' });
  const noCancelIntent = !hasSellerCancelIntent({ seller_cancel_requested_at: null });
  const pauseIntent = hasSellerPauseIntent({ seller_pause_requested_at: '2026-01-01T00:00:00.000Z' });
  const noPauseIntent = !hasSellerPauseIntent({});
  return { name: 'has_seller_intent', passed: cancelIntent && noCancelIntent && pauseIntent && noPauseIntent };
}

// ── B. Checkout orchestrator tests ────────────────────────────────────────

async function testCheckoutSuccess() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const piCount = deps.stripe.pisById.size;
  const passed = result.status === 200 && result.body.purchase_id &&
    listing.status === 'pending_transfer' && lp.reservation_token !== null &&
    piCount === 1 && result.status !== 429;
  return { name: 'checkout_success', passed, status: result.status, listing_reserved: listing.status === 'pending_transfer', pi_count: piCount };
}

async function testTwoBuyerRace() {
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
  const passed = successCount === 1 && loserGot409 && piCount === 1;
  return { name: 'two_buyer_race', passed, success_count: successCount, loser_got_409: loserGot409, pi_count: piCount };
}

async function testRetryBeforeActiveStatusRejection() {
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'retry_before_active_rejection', passed: false, error: 'initial checkout failed' };
  timeOffset = 20000;
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCount = deps.stripe.pisById.size;
  const passed = r2.status === 200 && r2.body.purchase_id === r1.body.purchase_id && r2.status !== 429 && piCount === 1;
  return { name: 'retry_before_active_rejection', passed, retry_status: r2.status, same_purchase: r2.body.purchase_id === r1.body.purchase_id, pi_count: piCount };
}

async function testCanceledPIRetry() {
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'canceled_pi_retry', passed: false, error: 'initial checkout failed' };
  const pi = [...deps.stripe.pisById.values()][0];
  pi.status = 'canceled';
  timeOffset = 20000;
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCount = deps.stripe.pisById.size;
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const passed = r2.status === 409 && r2.status !== 429 && piCount === 1;
  return { name: 'canceled_pi_retry', passed, retry_status: r2.status, pi_count: piCount, listing_status: listing.status, lp_quarantined: lp.checkout_quarantined };
}

async function testDifferentRevisions() {
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const listing = deps._state.stores.Listing.get('listing_1');
  listing.status = 'active'; listing.reservation_token = null; listing.reserved_by_email = null;
  listing.reservation_expires_at = null; listing.updated_date = '2026-08-01T11:00:00.000Z';
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reservation_token = null; lp.reserved_by_email = null; lp.reservation_expires_at = null;
  const oldPurchase = [...deps._state.stores.Purchase.values()][0];
  if (oldPurchase) oldPurchase.transfer_status = 'expired';
  const oldPP = [...deps._state.stores.PurchasePrivate.values()][0];
  if (oldPP) deps._state.stores.PurchasePrivate.delete(oldPP.id);
  timeOffset = 20000;
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCount = deps.stripe.pisById.size;
  const passed = r1.status === 200 && r2.status === 200 && r1.body.purchase_id !== r2.body.purchase_id && r2.status !== 429 && piCount === 2;
  return { name: 'different_revisions', passed, different_purchases: r1.body.purchase_id !== r2.body.purchase_id, pi_count: piCount };
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
  return { name: 'quarantined_retry', passed, status: result.status };
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
  const deps = createMockDeps({ seed, hooks: { 'before_Purchase_create': async () => ({ throw: new Error('Simulated Purchase creation failure') }) } });
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCanceled = [...deps.stripe.pisById.values()].every(pi => pi.status === 'canceled');
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const passed = result.status === 500 && piCanceled && listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' && lp.checkout_quarantined === true;
  return { name: 'failure_after_pi_purchase_create', passed, status: result.status, pi_canceled: piCanceled, listing_status: listing.status, lp_quarantined: lp.checkout_quarantined };
}

async function testFailureAfterPICreation_LPWriteFails() {
  const { seed } = createDefaultSeed();
  const deps = createMockDeps({ seed, hooks: { 'before_ListingPrivate_update': async (id, data) => { if (data.reservation_token !== undefined) return { throw: new Error('Simulated LP write failure') }; } } });
  const result = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  const piCanceled = [...deps.stripe.pisById.values()].every(pi => pi.status === 'canceled');
  const listing = deps._state.stores.Listing.get('listing_1');
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  const passed = result.status === 500 && piCanceled && listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' && lp.checkout_quarantined === true;
  return { name: 'failure_after_pi_lp_write', passed, status: result.status, pi_canceled: piCanceled, listing_status: listing.status, lp_quarantined: lp.checkout_quarantined };
}

// ── Test A: Expired retry where Stripe cancel throws ──────────────────────
async function testExpiredRetryCancelThrows() {
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'expired_retry_cancel_throws', passed: false, error: 'initial checkout failed' };

  // Expire the reservation
  const pastExpiry = new Date(Date.now() - 60000).toISOString();
  const listing = deps._state.stores.Listing.get('listing_1');
  listing.reservation_expires_at = pastExpiry;
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reservation_expires_at = pastExpiry;

  // Make Stripe cancel throw
  const piId = [...deps.stripe.pisById.keys()][0];
  const pi = deps.stripe.pisById.get(piId);
  pi.status = 'requires_payment_method';
  const originalCancel = deps.stripe.paymentIntents.cancel;
  deps.stripe.paymentIntents.cancel = async () => { throw new Error('Stripe cancel error'); };

  timeOffset = 20000;
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  deps.stripe.paymentIntents.cancel = originalCancel;

  const piCount = deps.stripe.pisById.size;
  const purchaseCount = deps._state.stores.Purchase.size;
  const finalListing = deps._state.stores.Listing.get('listing_1');
  const finalLP = [...deps._state.stores.ListingPrivate.values()][0];
  const alertHasPIId = [...deps._state.stores.AdminAlert.values()].some(a => a.description && a.description.includes(piId));

  const passed = r2.status !== 200 && r2.status !== 429 &&
    piCount === 1 && purchaseCount === 1 &&
    finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine' &&
    finalLP.checkout_quarantined === true && alertHasPIId;
  return { name: 'expired_retry_cancel_throws', passed, r2_status: r2.status, pi_count: piCount, purchase_count: purchaseCount, listing_status: finalListing.status, lp_quarantined: finalLP.checkout_quarantined, alert_has_pi_id: alertHasPIId };
}

// ── Test B: Retry PI missing purchase_id ───────────────────────────────────
async function testRetryPIMissingPurchaseId() {
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r1 = await runCreateCheckout(deps, { listing_id: 'listing_1' });
  if (r1.status !== 200) return { name: 'retry_pi_missing_purchase_id', passed: false, error: 'initial checkout failed' };

  // Remove purchase_id from PI metadata
  const pi = [...deps.stripe.pisById.values()][0];
  delete pi.metadata.purchase_id;

  timeOffset = 20000;
  const r2 = await runCreateCheckout(deps, { listing_id: 'listing_1' });

  const piCount = deps.stripe.pisById.size;
  const finalListing = deps._state.stores.Listing.get('listing_1');
  const finalLP = [...deps._state.stores.ListingPrivate.values()][0];

  const passed = r2.status !== 200 && r2.status !== 429 &&
    !r2.body.clientSecret && piCount === 1 &&
    finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine' &&
    finalLP.checkout_quarantined === true;
  return { name: 'retry_pi_missing_purchase_id', passed, r2_status: r2.status, has_client_secret: !!r2.body.clientSecret, pi_count: piCount, listing_status: finalListing.status, lp_quarantined: finalLP.checkout_quarantined };
}

// ── C. Cleanup orchestrator tests ──────────────────────────────────────────

async function testCleanupQuarantinesAbandoned() {
  const { seed, listingId } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r = await runCreateCheckout(deps, { listing_id: listingId });
  if (r.status !== 200) return { name: 'cleanup_quarantines_abandoned', passed: false, error: 'checkout failed' };
  const purchase = [...deps._state.stores.Purchase.values()].find(p => p.transfer_status === 'pending_transfer');
  purchase.created_date = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  // Cancel PI so Phase 1 can quarantine it
  const pi = [...deps.stripe.pisById.values()][0];
  pi.status = 'canceled';

  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);

  // 7C.7: Phase 1 quarantines only — never clears tokens or reactivates
  const passed = result.body.quarantined > 0 &&
    listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' &&
    lp.checkout_quarantined === true &&
    lp.reservation_token !== null && // tokens preserved, not cleared
    listing.status !== 'active'; // never reactivated
  return { name: 'cleanup_quarantines_abandoned', passed, quarantined: result.body.quarantined, listing_status: listing.status, lp_quarantined: lp.checkout_quarantined, lp_reservation_preserved: lp.reservation_token !== null };
}

async function testCleanupRecoveryAfterDrain() {
  const { seed, listingId } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r = await runCreateCheckout(deps, { listing_id: listingId });
  if (r.status !== 200) return { name: 'cleanup_recovery_after_drain', passed: false, error: 'checkout failed' };
  const purchase = [...deps._state.stores.Purchase.values()].find(p => p.transfer_status === 'pending_transfer');
  purchase.created_date = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const pi = [...deps.stripe.pisById.values()][0];
  pi.status = 'canceled';

  // Phase 1: quarantine
  await runCleanupAbandonedCheckouts(deps);

  // Advance past drain period
  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  // Phase 2: recovery
  const result2 = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);

  const passed = listing.status === 'active' && listing.reservation_token === null &&
    lp.reservation_token === null && lp.checkout_quarantined === false &&
    result2.body.quarantine_resolved > 0;
  return { name: 'cleanup_recovery_after_drain', passed, listing_status: listing.status, lp_reservation: lp.reservation_token, lp_quarantined: lp.checkout_quarantined, quarantine_resolved: result2.body.quarantine_resolved };
}

// ── Test C: New token after final pre-clear read but before Listing.update ─
async function testNewTokenBeforeClearing() {
  const { seed, listingId } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r = await runCreateCheckout(deps, { listing_id: listingId });
  if (r.status !== 200) return { name: 'new_token_before_clearing', passed: false, error: 'checkout failed' };
  const purchase = [...deps._state.stores.Purchase.values()].find(p => p.transfer_status === 'pending_transfer');
  purchase.created_date = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const pi = [...deps.stripe.pisById.values()][0];
  pi.status = 'canceled';

  // Phase 1: quarantine
  await runCleanupAbandonedCheckouts(deps);
  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  // Hook: inject new token during Phase 2's Listing.update (clearing reservation fields)
  deps._hooks.before_Listing_update = (id, data) => {
    if (data.reservation_token === null && data.status === undefined && data.hidden_reason === undefined) {
      const lpRecord = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === id);
      if (lpRecord) lpRecord.reservation_token = 'new_token_injected';
    }
  };

  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  const finalLP = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);

  const passed = finalLP.reservation_token === 'new_token_injected' &&
    finalListing.status !== 'active';
  return { name: 'new_token_before_clearing', passed, lp_reservation_token: finalLP.reservation_token, listing_status: finalListing.status, listing_never_active: finalListing.status !== 'active' };
}

// ── Test D: Detect new token in run one, then run cleanup again ───────────
async function testNewTokenSurvivesTwoRuns() {
  const { seed, listingId } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  const r = await runCreateCheckout(deps, { listing_id: listingId });
  if (r.status !== 200) return { name: 'new_token_survives_two_runs', passed: false, error: 'checkout failed' };
  const purchase = [...deps._state.stores.Purchase.values()].find(p => p.transfer_status === 'pending_transfer');
  purchase.created_date = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const pi = [...deps.stripe.pisById.values()][0];
  pi.status = 'canceled';

  // Phase 1: quarantine
  await runCleanupAbandonedCheckouts(deps);

  // Inject new token after quarantine
  const lp = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);
  lp.reservation_token = 'new_token_injected';

  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  // Run 2: should NOT recover (snapshot mismatch)
  const result2 = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  const finalLP = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);

  const passed = finalLP.reservation_token === 'new_token_injected' &&
    finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine' &&
    finalLP.checkout_quarantined === true;
  return { name: 'new_token_survives_two_runs', passed, lp_reservation_token: finalLP.reservation_token, listing_status: finalListing.status, lp_quarantined: finalLP.checkout_quarantined };
}

// ── Test E: Seller cancel immediately before recovery Listing.update ───────
async function testSellerCancelBeforeRecoveryActivation() {
  const { seed, listingId } = createDefaultSeed();
  let timeOffset = QUARANTINE_DRAIN_MS + 60000; // start past drain period
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });

  // Set up a quarantined listing directly
  setupQuarantinedListing(deps, { listingId });

  // Hook: set seller_cancel_requested_at during Phase 2, before Listing activation
  deps._hooks.before_Listing_update = (id, data) => {
    if (data.status === 'active' && data.hidden_reason === null) {
      const lpRecord = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === id);
      if (lpRecord) lpRecord.seller_cancel_requested_at = new Date().toISOString();
    }
  };

  // Run 1: recovery attempt — seller cancel detected after activation, quarantine restored
  const result1 = await runCleanupAbandonedCheckouts(deps);

  // Run 2: seller intent still set → skip
  const result2 = await runCleanupAbandonedCheckouts(deps);

  const finalListing = deps._state.stores.Listing.get(listingId);
  const finalLP = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);

  const passed = finalListing.status !== 'active' &&
    finalLP.seller_cancel_requested_at !== null &&
    finalLP.checkout_quarantined === true;
  return { name: 'seller_cancel_before_recovery_activation', passed, listing_status: finalListing.status, seller_intent_present: finalLP.seller_cancel_requested_at !== null, lp_quarantined: finalLP.checkout_quarantined };
}

// ── Test F: Seller cancel between Listing activation and LP quarantine clearing ─
async function testSellerCancelBetweenActivationAndLPClearing() {
  const { seed, listingId } = createDefaultSeed();
  let timeOffset = QUARANTINE_DRAIN_MS + 60000;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });

  setupQuarantinedListing(deps, { listingId });

  // Hook: set seller_cancel_requested_at during LP quarantine clearing
  deps._hooks.before_ListingPrivate_update = (id, data) => {
    if (data.checkout_quarantined === false) {
      const lpRecord = deps._state.stores.ListingPrivate.get(id);
      if (lpRecord) lpRecord.seller_cancel_requested_at = new Date().toISOString();
    }
  };

  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  const finalLP = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);

  const passed = finalListing.status !== 'active' &&
    finalLP.seller_cancel_requested_at !== null &&
    finalLP.checkout_quarantined === true;
  return { name: 'seller_cancel_between_activation_and_lp_clearing', passed, listing_status: finalListing.status, seller_intent_present: finalLP.seller_cancel_requested_at !== null, lp_quarantined: finalLP.checkout_quarantined };
}

// ── Test G: Correct pagination ─────────────────────────────────────────────
async function testPagination201() {
  const { seed } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  setupBulkPendingPurchases(deps, 201, { first200KeepLocked: true });

  // Phase 1: quarantine all 201 (first 200 keep_locked, row 201 quarantined)
  const result1 = await runCleanupAbandonedCheckouts(deps);

  // Advance past drain
  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  // Phase 2: recover row 201 (first 200 stay locked — PI is authorized)
  const result2 = await runCleanupAbandonedCheckouts(deps);

  const pur0 = deps._state.stores.Purchase.get('pur_bulk_0');
  const pur201 = deps._state.stores.Purchase.get('pur_bulk_200');
  const listing201 = deps._state.stores.Listing.get('listing_bulk_200');
  const lp201 = deps._state.stores.ListingPrivate.get('lp_listing_bulk_200');

  const first200StillPending = pur0.transfer_status === 'pending_transfer';
  const passed = result1.body.max_skip_reached >= 200 &&
    pur201.transfer_status === 'expired' &&
    listing201.status === 'active' &&
    lp201.reservation_token === null &&
    first200StillPending;
  return { name: 'pagination_201', passed, max_skip_reached: result1.body.max_skip_reached, pur201_status: pur201.transfer_status, listing201_status: listing201.status, first200_still_pending: first200StillPending };
}

// ── D. Additional cleanup tests ────────────────────────────────────────────

async function testCleanupQuarantinesOnPIMismatch() {
  const { seed, listingId } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  setupPendingPurchase(deps, { listingId, piStatus: 'canceled' });
  const lp = [...deps._state.stores.ListingPrivate.values()][0];
  lp.reservation_token = 'different_token';

  const result = await runCleanupAbandonedCheckouts(deps);
  const listing = deps._state.stores.Listing.get(listingId);
  const lpFinal = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);

  const passed = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine' && lpFinal.checkout_quarantined === true && result.body.quarantined > 0;
  return { name: 'cleanup_quarantines_pi_mismatch', passed, quarantined: result.body.quarantined, listing_status: listing.status, lp_quarantined: lpFinal.checkout_quarantined };
}

async function testQuarantineRecoverySuccess() {
  const { seed, listingId } = createDefaultSeed();
  let timeOffset = QUARANTINE_DRAIN_MS + 60000;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  setupQuarantinedListing(deps, { listingId });

  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  const finalLP = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);

  const passed = finalListing.status === 'active' &&
    finalListing.reservation_token === null && finalListing.hidden_reason === null &&
    finalLP.reservation_token === null && finalLP.checkout_quarantined === false &&
    finalLP.quarantined_reservation_token === null && finalLP.recovery_not_before === null;
  return { name: 'quarantine_recovery_success', passed, listing_status: finalListing.status, lp_quarantined: finalLP.checkout_quarantined, quarantine_resolved: result.body.quarantine_resolved };
}

async function testListingUpdateSucceedsLPFails() {
  const { seed, listingId } = createDefaultSeed();
  let timeOffset = QUARANTINE_DRAIN_MS + 60000;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  setupQuarantinedListing(deps, { listingId });

  // Hook: LP quarantine clear fails
  deps._hooks.before_ListingPrivate_update = async (id, data) => {
    if (data.checkout_quarantined === false) return { throw: new Error('Simulated LP update failure') };
  };

  const result = await runCleanupAbandonedCheckouts(deps);
  const finalListing = deps._state.stores.Listing.get(listingId);
  const finalLP = [...deps._state.stores.ListingPrivate.values()].find(l => l.listing_id === listingId);

  const passed = finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine' &&
    finalLP.checkout_quarantined === true;
  return { name: 'listing_update_succeeds_lp_fails', passed, listing_status: finalListing.status, lp_quarantined: finalLP.checkout_quarantined };
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
    testVerifyExactPIMetadata(),
    testMatchesQuarantineSnapshot(),
    testDrainPeriodPassed(),
    testHasSellerIntent(),
    await testCheckoutSuccess(),
    await testTwoBuyerRace(),
    await testRetryBeforeActiveStatusRejection(),
    await testCanceledPIRetry(),
    await testDifferentRevisions(),
    await testQuarantinedRetry(),
    await testMissingUserRecord(),
    await testFailureAfterPICreation_PurchaseCreateFails(),
    await testFailureAfterPICreation_LPWriteFails(),
    await testExpiredRetryCancelThrows(),
    await testRetryPIMissingPurchaseId(),
    await testCleanupQuarantinesAbandoned(),
    await testCleanupRecoveryAfterDrain(),
    await testNewTokenBeforeClearing(),
    await testNewTokenSurvivesTwoRuns(),
    await testSellerCancelBeforeRecoveryActivation(),
    await testSellerCancelBetweenActivationAndLPClearing(),
    await testPagination201(),
    await testCleanupQuarantinesOnPIMismatch(),
    await testQuarantineRecoverySuccess(),
    await testListingUpdateSucceedsLPFails(),
  ];

  console.log('=== Checkout & Cleanup Concurrency Tests (7C.7) ===\n');

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
        console.log(`  [${sStatus}] ${s.piStatus} → ${s.actual} (expected ${s.expected})`);
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