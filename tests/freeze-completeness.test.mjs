/**
 * Freeze-Tuple Completeness and Idempotent Finalization Tests (7C.9C.2)
 *
 * Tests the complete frozen tuple (token + buyer + expiration + revision),
 * authoritative expiration sourcing, exact Phase 1/2 verification,
 * partial-freeze detection, null-tuple rejection, and partial-finalization
 * state machine.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { freezeCapturedPayment, finalizeCapturedPayment } from '../base44/shared/captureReconciliation.js';
import { QUARANTINE_DRAIN_MS } from '../base44/shared/checkoutLogic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => `uuid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` };
}

// ── Mock Stripe ──────────────────────────────────────────────────────────────
function createMockStripe() {
  const pisById = new Map();
  return {
    pisById,
    paymentIntents: {
      create: async (params) => { const id = `pi_test_${pisById.size + 1}`; const pi = { id, client_secret: `secret_${id}`, status: 'requires_payment_method', amount: params.amount, metadata: { ...params.metadata } }; pisById.set(id, pi); return pi; },
      retrieve: async (id) => { if (!pisById.has(id)) throw new Error('PI not found'); return pisById.get(id); },
      capture: async (id) => { const pi = pisById.get(id); pi.status = 'succeeded'; return pi; },
      cancel: async (id) => { const pi = pisById.get(id); pi.status = 'canceled'; return pi; },
      update: async (id, params) => { const pi = pisById.get(id); if (params.metadata) pi.metadata = { ...pi.metadata, ...params.metadata }; return pi; },
    },
    accounts: { retrieve: async () => ({ charges_enabled: true }) },
  };
}

// ── Mock entity store ──────────────────────────────────────────────────────────
function applyFilter(records, query) {
  if (!query || Object.keys(query).length === 0) return [...records];
  return records.filter(record => {
    for (const [key, value] of Object.entries(query)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && value.$in) {
        if (!value.$in.includes(record[key])) return false;
      } else { if (record[key] !== value) return false; }
    }
    return true;
  });
}
function applySort(records, sort) {
  if (!sort) return records;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...records].sort((a, b) => { const av = a[field] || ''; const bv = b[field] || ''; if (av < bv) return desc ? 1 : -1; if (av > bv) return desc ? -1 : 1; return 0; });
}
let idCounter = 0;
function genId(name) { return `${name.toLowerCase()}_${++idCounter}`; }

function createMockDeps(config = {}) {
  const stores = { Listing: [], ListingPrivate: [], Purchase: [], PurchasePrivate: [], User: [], UserSecurityProfile: [], AdminAlert: [], Notification: [] };
  const hooks = config.hooks || {};
  const providerCalls = { push: 0, email: 0 };
  const silentDropFields = config.silentDropFields || {};

  function createStore(name) {
    return {
      filter: async (query, sort, limit, skip) => {
        let results = applyFilter(stores[name], query);
        if (sort) results = applySort(results, sort);
        if (skip) results = results.slice(skip);
        if (limit) results = results.slice(0, limit);
        return results;
      },
      create: async (data) => {
        if (hooks[`before_${name}_create`]) { const r = await hooks[`before_${name}_create`](); if (r?.throw) throw r.throw; }
        const id = data.id || genId(name);
        const record = { id, created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...data };
        stores[name].push(record);
        return record;
      },
      update: async (id, data) => {
        if (hooks[`before_${name}_update`]) { const r = await hooks[`before_${name}_update`](id, data); if (r?.throw) throw r.throw; }
        const idx = stores[name].findIndex(r => r.id === id);
        if (idx === -1) throw new Error(`${name} ${id} not found`);
        const dataToApply = { ...data };
        if (silentDropFields[name]) {
          for (const field of silentDropFields[name]) { delete dataToApply[field]; }
        }
        stores[name][idx] = { ...stores[name][idx], ...dataToApply, updated_date: new Date().toISOString() };
        if (hooks[`after_${name}_update`]) hooks[`after_${name}_update`](stores[name][idx]);
        return stores[name][idx];
      },
      delete: async (id) => { const idx = stores[name].findIndex(r => r.id === id); if (idx !== -1) stores[name].splice(idx, 1); },
    };
  }

  if (config.seed) {
    for (const [entityName, records] of Object.entries(config.seed)) {
      for (const record of records) {
        stores[entityName].push({ id: record.id || genId(entityName), created_date: record.created_date || '2026-08-01T10:00:00.000Z', updated_date: record.updated_date || '2026-08-01T10:00:00.000Z', ...record });
      }
    }
  }

  const deps = {
    entities: {
      Listing: createStore('Listing'), ListingPrivate: createStore('ListingPrivate'),
      Purchase: createStore('Purchase'), PurchasePrivate: createStore('PurchasePrivate'),
      User: createStore('User'), UserSecurityProfile: createStore('UserSecurityProfile'),
      AdminAlert: createStore('AdminAlert'), Notification: createStore('Notification'),
    },
    stripe: config.stripe || createMockStripe(),
    user: config.user || { id: 'user_buyer', email: 'buyer@test', role: 'user', full_name: 'Test Buyer' },
    now: config.now || (() => Date.now()),
    isMaintenanceActive: config.isMaintenanceActive || (() => false),
    isLiveMode: config.isLiveMode ?? false,
    sendUserNotification: config.sendUserNotification || (async () => { providerCalls.push++; providerCalls.email++; return { push: { sent: true }, email: { sent: true } }; }),
    _state: { stores, hooks, providerCalls, silentDropFields },
  };
  return deps;
}

// ── Seed helper ──────────────────────────────────────────────────────────────
function createDefaultSeed(o = {}) {
  const listingId = o.listingId || 'listing_1';
  const sellerEmail = o.sellerEmail || 'seller@test';
  const buyerEmail = o.buyerEmail || 'buyer@test';
  const token = o.token || 'res_token_123';
  const piId = o.piId || 'pi_test_1';
  const purchaseId = o.purchaseId || 'pur_1';
  const expiry = o.expiry || new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const revision = o.revision || 'rev_001';
  return {
    seed: {
      Listing: [{ id: listingId, status: 'pending_transfer', asking_price: 100, quantity: 1, section: 'A', row: '1', event_id: 'event_1', seller_email: sellerEmail, reservation_token: token, reserved_by_email: buyerEmail, reservation_expires_at: expiry, reservation_revision: revision, hidden_reason: null, ...o.listing }],
      ListingPrivate: [{ id: `lp_${listingId}`, listing_id: listingId, seller_email: sellerEmail, reservation_token: token, reserved_by_email: buyerEmail, reservation_expires_at: expiry, reservation_revision: revision, proof_status: 'approved', is_demo_listing: false, checkout_quarantined: false, ...o.lp }],
      Purchase: [{ id: purchaseId, listing_id: listingId, event_id: 'event_1', buyer_email: buyerEmail, seller_email: sellerEmail, payment_intent_id: piId, reservation_token: token, transfer_status: 'pending_transfer', payment_captured: false, is_demo: false, amount: 105, subtotal: 100, seller_confirmed: true, ...o.purchase }],
      PurchasePrivate: [{ id: `pp_${purchaseId}`, purchase_id: purchaseId, listing_id: listingId, event_id: 'event_1', buyer_email: buyerEmail, seller_email: sellerEmail, payment_intent_id: piId, reservation_token: token, payment_captured: false, is_demo: false, ...o.pp }],
      User: [
        { id: 'user_buyer', email: buyerEmail, role: 'user', full_name: 'Test Buyer' },
        { id: 'user_seller', email: sellerEmail, role: 'admin', full_name: 'Test Seller' },
      ],
      UserSecurityProfile: [{ id: 'usp_1', user_id: 'user_seller', user_email: sellerEmail, stripe_account_id: 'acct_test_123', stripe_onboarding_complete: true, ...o.sellerSec }],
    },
    listingId, sellerEmail, buyerEmail, token, piId, purchaseId, expiry, revision,
  };
}

function seedStripePI(stripe, piId, opts = {}) {
  stripe.pisById.set(piId, {
    id: piId, client_secret: `secret_${piId}`,
    status: opts.status || 'requires_payment_method',
    amount: opts.amount || 10500, currency: 'usd',
    metadata: opts.metadata || {},
    transfer_data: opts.transfer_data,
  });
}

function defaultMetadata(seed) {
  return { listing_id: seed.listingId, buyer_email: seed.buyerEmail, seller_email: seed.sellerEmail, reservation_token: seed.token, purchase_id: seed.purchaseId };
}

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA VALIDATION (source-only)
// ════════════════════════════════════════════════════════════════════════════
function testSchemaValidation() {
  const ppSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'PurchasePrivate.jsonc'), 'utf8');
  const listingSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'Listing.jsonc'), 'utf8');
  const lpSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'ListingPrivate.jsonc'), 'utf8');
  const passed =
    ppSchema.includes('"frozen_reservation_token"') &&
    ppSchema.includes('"frozen_buyer_email"') &&
    ppSchema.includes('"frozen_reservation_expires_at"') &&
    ppSchema.includes('"frozen_reservation_revision"') &&
    ppSchema.includes('"freeze_finalized_at"') &&
    ppSchema.includes('"finalization_started_at"') &&
    listingSchema.includes('"reservation_revision"') &&
    lpSchema.includes('"reservation_revision"');
  return { name: 'schema_validation', passed, type: 'source-only' };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: Frozen expiration derived from matching Listing/LP (not PP)
// ════════════════════════════════════════════════════════════════════════════
async function testFrozenExpirationFromListingLP() {
  const s = createDefaultSeed();
  const deps = createMockDeps({ seed: s.seed });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  const ppFinal = deps._state.stores.PurchasePrivate[0];
  // Frozen expiration must equal the Listing/LP expiration (not undefined from PP)
  const expirationMatches = ppFinal.frozen_reservation_expires_at === s.expiry;
  const notUndefined = ppFinal.frozen_reservation_expires_at !== undefined && ppFinal.frozen_reservation_expires_at !== null;

  const passed = result.ok && expirationMatches && notUndefined;
  return { name: 'frozen_expiration_from_listing_lp', passed, type: 'runtime', ok: result.ok, expiration_matches: expirationMatches, not_undefined: notUndefined, frozen_expiry: ppFinal.frozen_reservation_expires_at };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: Frozen expiration persists and is re-fetched exactly
// ════════════════════════════════════════════════════════════════════════════
async function testFrozenExpirationPersistsAndRefetched() {
  const s = createDefaultSeed();
  const deps = createMockDeps({ seed: s.seed });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  // Re-fetch PP
  const [ppRefetched] = await deps.entities.PurchasePrivate.filter({ purchase_id: s.purchaseId });
  const persists = ppRefetched?.frozen_reservation_expires_at === s.expiry;

  const passed = result.ok && persists;
  return { name: 'frozen_expiration_persists_refetched', passed, type: 'runtime', ok: result.ok, persists };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: Frozen revision persists and is re-fetched exactly
// ════════════════════════════════════════════════════════════════════════════
async function testFrozenRevisionPersistsAndRefetched() {
  const s = createDefaultSeed();
  const deps = createMockDeps({ seed: s.seed });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  const [ppRefetched] = await deps.entities.PurchasePrivate.filter({ purchase_id: s.purchaseId });
  const persists = ppRefetched?.frozen_reservation_revision === s.revision;

  const passed = result.ok && persists;
  return { name: 'frozen_revision_persists_refetched', passed, type: 'runtime', ok: result.ok, persists };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: Expiration changes after freeze → finalization blocked
// ════════════════════════════════════════════════════════════════════════════
async function testExpirationChangesAfterFreezeBlocked() {
  const s = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed: s.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  // Phase 1: Freeze
  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  await freezeCapturedPayment(deps, purchase, pp, pi);

  // Change expiration AFTER freeze
  const newExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  deps._state.stores.Listing[0].reservation_expires_at = newExpiry;
  deps._state.stores.ListingPrivate[0].reservation_expires_at = newExpiry;

  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  // Phase 2: Finalize
  const result = await finalizeCapturedPayment(deps, s.listingId);

  const notOk = !result.ok;
  const listing = deps._state.stores.Listing[0];
  const notSold = listing.status !== 'sold';
  const preserved = listing.reservation_expires_at === newExpiry;

  const passed = notOk && notSold && preserved;
  return { name: 'expiration_changes_after_freeze_blocked', passed, type: 'runtime', not_ok: notOk, not_sold: notSold, preserved, step: result.step };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: Revision changes after freeze → finalization blocked
// ════════════════════════════════════════════════════════════════════════════
async function testRevisionChangesAfterFreezeBlocked() {
  const s = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed: s.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  await freezeCapturedPayment(deps, purchase, pp, pi);

  // Change revision AFTER freeze
  deps._state.stores.Listing[0].reservation_revision = 'rev_002';
  deps._state.stores.ListingPrivate[0].reservation_revision = 'rev_002';

  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  const result = await finalizeCapturedPayment(deps, s.listingId);

  const notOk = !result.ok;
  const listing = deps._state.stores.Listing[0];
  const notSold = listing.status !== 'sold';

  const passed = notOk && notSold;
  return { name: 'revision_changes_after_freeze_blocked', passed, type: 'runtime', not_ok: notOk, not_sold: notSold, step: result.step };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: Listing tuple null while LP still matches → no auto finalization
// ════════════════════════════════════════════════════════════════════════════
async function testListingNullLPMatchesNoAutoFinalization() {
  const s = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed: s.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  await freezeCapturedPayment(deps, purchase, pp, pi);

  // Null out Listing reservation tuple
  deps._state.stores.Listing[0].reservation_token = null;
  deps._state.stores.Listing[0].reserved_by_email = null;
  deps._state.stores.Listing[0].reservation_expires_at = null;
  deps._state.stores.Listing[0].reservation_revision = null;

  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  const result = await finalizeCapturedPayment(deps, s.listingId);

  // Must NOT return ok — null is not a tuple match
  const notOk = !result.ok;
  const listing = deps._state.stores.Listing[0];
  const notSold = listing.status !== 'sold';

  const passed = notOk && notSold;
  return { name: 'listing_null_lp_matches_no_auto_finalization', passed, type: 'runtime', not_ok: notOk, not_sold: notSold, step: result.step };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: LP tuple null while Listing still matches → no auto finalization
// ════════════════════════════════════════════════════════════════════════════
async function testLPNullListingMatchesNoAutoFinalization() {
  const s = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed: s.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  await freezeCapturedPayment(deps, purchase, pp, pi);

  // Null out LP reservation tuple
  deps._state.stores.ListingPrivate[0].reservation_token = null;
  deps._state.stores.ListingPrivate[0].reserved_by_email = null;
  deps._state.stores.ListingPrivate[0].reservation_expires_at = null;
  deps._state.stores.ListingPrivate[0].reservation_revision = null;

  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  const result = await finalizeCapturedPayment(deps, s.listingId);

  const notOk = !result.ok;
  const listing = deps._state.stores.Listing[0];
  const notSold = listing.status !== 'sold';

  const passed = notOk && notSold;
  return { name: 'lp_null_listing_matches_no_auto_finalization', passed, type: 'runtime', not_ok: notOk, not_sold: notSold, step: result.step };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: Both tuples null, hidden, no finalization-started → no false success
// ════════════════════════════════════════════════════════════════════════════
async function testBothNullNoFinalizationStartedNoFalseSuccess() {
  const s = createDefaultSeed({
    listing: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, checkout_quarantined: true },
    pp: { payment_captured: true, frozen_reservation_token: 'res_token_123', frozen_buyer_email: 'buyer@test', frozen_reservation_expires_at: '2026-08-01T10:10:00.000Z', frozen_reservation_revision: 'rev_001' },
    purchase: { transfer_status: 'completed', payment_captured: true, buyer_confirmed: true },
  });
  s.seed.Listing[0].status = 'hidden';
  s.seed.Listing[0].hidden_reason = 'checkout_quarantine';

  let timeOffset = QUARANTINE_DRAIN_MS + 60000;
  const deps = createMockDeps({ seed: s.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const result = await finalizeCapturedPayment(deps, s.listingId);

  // Both tuples are null but no finalization_started_at — must NOT return ok
  const notOk = !result.ok;

  const passed = notOk;
  return { name: 'both_null_no_finalization_started_no_false_success', passed, type: 'runtime', not_ok: notOk, step: result.step };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: PP freeze succeeds but Listing quarantine fails → retry no false already_frozen
// ════════════════════════════════════════════════════════════════════════════
async function testPPFreezeSucceedsListingQuarantineFailsRetryNoFalseAlreadyFrozen() {
  const s = createDefaultSeed();
  const deps = createMockDeps({
    seed: s.seed,
    hooks: {
      'before_Listing_update': (id, data) => {
        if (data.status === 'hidden' && data.hidden_reason === 'checkout_quarantine') {
          return { throw: new Error('Listing quarantine write failed') };
        }
      },
    },
  });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result1 = await freezeCapturedPayment(deps, purchase, pp, pi);

  // First attempt must fail
  const firstFailed = !result1.ok;

  // Retry without hooks
  const deps2 = createMockDeps({});
  for (const [name, records] of Object.entries(deps._state.stores)) { deps2._state.stores[name] = records.map(r => ({ ...r })); }
  deps2.stripe = deps.stripe;
  const [purchase2] = deps2._state.stores.Purchase;
  const [pp2] = deps2._state.stores.PurchasePrivate;
  const pi2 = deps2.stripe.pisById.get(s.piId);
  const result2 = await freezeCapturedPayment(deps2, purchase2, pp2, pi2);

  // Retry must NOT return false already_frozen — it must complete or fail honestly
  const retryNotFalseAlreadyFrozen = !(result2.idempotent === true && result2.phase === 'already_frozen' && !verifyAllFreezeSteps(deps2, s));

  const passed = firstFailed && (result2.ok || retryNotFalseAlreadyFrozen);
  return { name: 'pp_freeze_succeeds_listing_quarantine_fails_retry_no_false_already_frozen', passed, type: 'runtime', first_failed: firstFailed, retry_ok: result2.ok, retry_phase: result2.phase };
}

function verifyAllFreezeSteps(deps, s) {
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const pp = deps._state.stores.PurchasePrivate[0];
  const purchase = deps._state.stores.Purchase[0];
  return listing?.status === 'hidden' && listing?.hidden_reason === 'checkout_quarantine' &&
    lp?.checkout_quarantined === true &&
    pp?.payment_captured === true && pp?.frozen_reservation_token === s.token &&
    purchase?.transfer_status === 'completed' && purchase?.payment_captured === true;
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 10: PP + Purchase succeed but LP quarantine fails → retry repairs or blocks
// ════════════════════════════════════════════════════════════════════════════
async function testPPPurchaseSucceedLPQuarantineFailsRetryRepairsOrBlocks() {
  const s = createDefaultSeed();
  const deps = createMockDeps({
    seed: s.seed,
    hooks: {
      'before_ListingPrivate_update': (id, data) => {
        if (data.checkout_quarantined === true) {
          return { throw: new Error('LP quarantine write failed') };
        }
      },
    },
  });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result1 = await freezeCapturedPayment(deps, purchase, pp, pi);

  const firstFailed = !result1.ok;

  // Retry without hooks
  const deps2 = createMockDeps({});
  for (const [name, records] of Object.entries(deps._state.stores)) { deps2._state.stores[name] = records.map(r => ({ ...r })); }
  deps2.stripe = deps.stripe;
  const [purchase2] = deps2._state.stores.Purchase;
  const [pp2] = deps2._state.stores.PurchasePrivate;
  const pi2 = deps2.stripe.pisById.get(s.piId);
  const result2 = await freezeCapturedPayment(deps2, purchase2, pp2, pi2);

  // Retry must either succeed (repaired) or fail honestly (blocked) — never false already_frozen
  const notFalseAlreadyFrozen = !(result2.idempotent === true && result2.phase === 'already_frozen' && !verifyAllFreezeSteps(deps2, s));

  const passed = firstFailed && (result2.ok || notFalseAlreadyFrozen);
  return { name: 'pp_purchase_succeed_lp_quarantine_fails_retry_repairs_or_blocks', passed, type: 'runtime', first_failed: firstFailed, retry_ok: result2.ok, retry_phase: result2.phase };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 11: recovery_not_before silently fails → freeze returns non-2xx
// ════════════════════════════════════════════════════════════════════════════
async function testRecoveryNotBeforeSilentlyFailsNon2xx() {
  const s = createDefaultSeed();
  const deps = createMockDeps({
    seed: s.seed,
    silentDropFields: { ListingPrivate: ['recovery_not_before'] },
  });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  const notOk = !result.ok;

  const passed = notOk;
  return { name: 'recovery_not_before_silently_fails_non2xx', passed, type: 'runtime', not_ok: notOk, step: result.step };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 12: Frozen expiration silently fails → freeze returns non-2xx
// ════════════════════════════════════════════════════════════════════════════
async function testFrozenExpirationSilentlyFailsNon2xx() {
  const s = createDefaultSeed();
  const deps = createMockDeps({
    seed: s.seed,
    silentDropFields: { PurchasePrivate: ['frozen_reservation_expires_at'] },
  });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  const notOk = !result.ok;

  const passed = notOk;
  return { name: 'frozen_expiration_silently_fails_non2xx', passed, type: 'runtime', not_ok: notOk, step: result.step };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 13: Frozen revision silently fails → freeze returns non-2xx
// ════════════════════════════════════════════════════════════════════════════
async function testFrozenRevisionSilentlyFailsNon2xx() {
  const s = createDefaultSeed();
  const deps = createMockDeps({
    seed: s.seed,
    silentDropFields: { PurchasePrivate: ['frozen_reservation_revision'] },
  });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  const notOk = !result.ok;

  const passed = notOk;
  return { name: 'frozen_revision_silently_fails_non2xx', passed, type: 'runtime', not_ok: notOk, step: result.step };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 14: freeze_finalized_at exists but LP still has reservation token → not already-finalized
// ════════════════════════════════════════════════════════════════════════════
async function testFreezeFinalizedAtButLPHasTokenNotAlreadyFinalized() {
  const s = createDefaultSeed({
    listing: { status: 'sold', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, hidden_reason: null },
    lp: { reservation_token: 'stray_token', reserved_by_email: 'buyer@test', reservation_expires_at: '2026-08-01T10:10:00.000Z', reservation_revision: 'rev_001', checkout_quarantined: false },
    pp: { payment_captured: true, freeze_finalized_at: '2026-01-01T00:00:00.000Z', frozen_reservation_token: 'res_token_123', frozen_buyer_email: 'buyer@test', frozen_reservation_expires_at: '2026-08-01T10:10:00.000Z', frozen_reservation_revision: 'rev_001' },
    purchase: { transfer_status: 'completed', payment_captured: true, buyer_confirmed: true },
  });
  const deps = createMockDeps({ seed: s.seed });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  // Must NOT return already_finalized — LP has a stray token
  const notAlreadyFinalized = !(result.ok && result.idempotent && result.phase === 'already_finalized');

  const passed = notAlreadyFinalized;
  return { name: 'freeze_finalized_at_but_lp_has_token_not_already_finalized', passed, type: 'runtime', not_already_finalized: notAlreadyFinalized, ok: result.ok, phase: result.phase };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 15: Listing sold but LP still quarantined → not already-finalized
// ════════════════════════════════════════════════════════════════════════════
async function testListingSoldButLPQuarantinedNotAlreadyFinalized() {
  const s = createDefaultSeed({
    listing: { status: 'sold', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, hidden_reason: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, checkout_quarantined: true },
    pp: { payment_captured: true, freeze_finalized_at: '2026-01-01T00:00:00.000Z', frozen_reservation_token: 'res_token_123', frozen_buyer_email: 'buyer@test', frozen_reservation_expires_at: '2026-08-01T10:10:00.000Z', frozen_reservation_revision: 'rev_001' },
    purchase: { transfer_status: 'completed', payment_captured: true, buyer_confirmed: true },
  });
  const deps = createMockDeps({ seed: s.seed });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  // Must NOT return already_finalized — LP is still quarantined
  const notAlreadyFinalized = !(result.ok && result.idempotent && result.phase === 'already_finalized');

  const passed = notAlreadyFinalized;
  return { name: 'listing_sold_but_lp_quarantined_not_already_finalized', passed, type: 'runtime', not_already_finalized: notAlreadyFinalized, ok: result.ok, phase: result.phase };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 16: Matching complete tuple finalizes successfully
// ════════════════════════════════════════════════════════════════════════════
async function testMatchingCompleteTupleFinalizesSuccessfully() {
  const s = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed: s.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const freezeResult = await freezeCapturedPayment(deps, purchase, pp, pi);

  timeOffset = QUARANTINE_DRAIN_MS + 60000;
  const finalizeResult = await finalizeCapturedPayment(deps, s.listingId);

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const ppFinal = deps._state.stores.PurchasePrivate[0];

  const listingSold = listing.status === 'sold' && !listing.reservation_token && !listing.reserved_by_email && !listing.reservation_expires_at;
  const lpCleared = !lp.reservation_token && !lp.reserved_by_email && !lp.reservation_expires_at && !lp.checkout_quarantined;
  const ppFinalized = !!ppFinal.freeze_finalized_at;

  const passed = freezeResult.ok && finalizeResult.ok && listingSold && lpCleared && ppFinalized;
  return { name: 'matching_complete_tuple_finalizes_successfully', passed, type: 'runtime', freeze_ok: freezeResult.ok, finalize_ok: finalizeResult.ok, listing_sold: listingSold, lp_cleared: lpCleared, pp_finalized: ppFinalized };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 17: Fully finalized state is idempotent
// ════════════════════════════════════════════════════════════════════════════
async function testFullyFinalizedIdempotent() {
  const s = createDefaultSeed({
    listing: { status: 'sold', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, hidden_reason: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, checkout_quarantined: false, quarantined_purchase_id: 'pur_1' },
    pp: { payment_captured: true, freeze_finalized_at: '2026-01-01T00:00:00.000Z', frozen_reservation_token: 'res_token_123', frozen_buyer_email: 'buyer@test', frozen_reservation_expires_at: '2026-08-01T10:10:00.000Z', frozen_reservation_revision: 'rev_001' },
    purchase: { transfer_status: 'completed', payment_captured: true, buyer_confirmed: true },
  });
  const deps = createMockDeps({ seed: s.seed });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  // Test both freeze and finalize idempotency
  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  const freezeResult = await freezeCapturedPayment(deps, purchase, pp, pi);
  const finalizeResult = await finalizeCapturedPayment(deps, s.listingId);

  const passed = freezeResult.ok && freezeResult.idempotent && freezeResult.phase === 'already_finalized' &&
    finalizeResult.ok && finalizeResult.idempotent && finalizeResult.phase === 'already_finalized';
  return { name: 'fully_finalized_idempotent', passed, type: 'runtime', freeze_ok: freezeResult.ok, freeze_phase: freezeResult.phase, finalize_ok: finalizeResult.ok, finalize_phase: finalizeResult.phase };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 18: Every Phase 2 write boundary can fail once and retry converges
// ════════════════════════════════════════════════════════════════════════════
async function testPhase2WriteBoundaryFailuresRetryConverges() {
  const boundaries = [
    { name: 'finalization_started', entity: 'PurchasePrivate', matchFn: (id, data) => data.finalization_started_at !== undefined },
    { name: 'lp_clear', entity: 'ListingPrivate', matchFn: (id, data) => data.reservation_token === null && data.checkout_quarantined === false },
    { name: 'listing_sold', entity: 'Listing', matchFn: (id, data) => data.status === 'sold' },
    { name: 'pp_finalize', entity: 'PurchasePrivate', matchFn: (id, data) => data.freeze_finalized_at !== undefined },
  ];

  const results = [];
  for (const boundary of boundaries) {
    const s = createDefaultSeed();
    let timeOffset = 0;
    const deps = createMockDeps({
      seed: s.seed,
      now: () => Date.now() + timeOffset,
      hooks: {
        [`before_${boundary.entity}_update`]: (id, data) => {
          if (boundary.matchFn(id, data)) {
            return { throw: new Error(`Simulated ${boundary.name} write failure`) };
          }
        },
      },
    });
    seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

    // Phase 1: Freeze (no hook on freeze writes)
    const [purchase] = deps._state.stores.Purchase;
    const [pp] = deps._state.stores.PurchasePrivate;
    const pi = deps.stripe.pisById.get(s.piId);
    await freezeCapturedPayment(deps, purchase, pp, pi);

    timeOffset = QUARANTINE_DRAIN_MS + 60000;

    // Phase 2: Finalize (hook will trigger)
    const result1 = await finalizeCapturedPayment(deps, s.listingId);
    const firstFailed = !result1.ok;

    // Retry without hooks
    const deps2 = createMockDeps({});
    for (const [name, records] of Object.entries(deps._state.stores)) { deps2._state.stores[name] = records.map(r => ({ ...r })); }
    deps2.now = () => Date.now() + timeOffset;
    const result2 = await finalizeCapturedPayment(deps2, s.listingId);
    const retryConverged = result2.ok;

    results.push({ boundary: boundary.name, passed: firstFailed && retryConverged, first_failed: firstFailed, retry_ok: result2.ok });
  }

  const allPassed = results.every(r => r.passed);
  return { name: 'phase2_write_boundary_failures_retry_converges', passed: allPassed, type: 'runtime', results };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 19: Different non-null token during partial-finalization recovery → preserved and blocked
// ════════════════════════════════════════════════════════════════════════════
async function testDifferentNonNullTokenDuringPartialFinalizationPreservedAndBlocked() {
  const s = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed: s.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  await freezeCapturedPayment(deps, purchase, pp, pi);

  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  // Start finalization — LP clear will fail (simulating partial)
  let lpCleared = false;
  const depsFail = createMockDeps({
    seed: s.seed,
    now: () => Date.now() + timeOffset,
    hooks: {
      'before_ListingPrivate_update': (id, data) => {
        if (data.reservation_token === null && data.checkout_quarantined === false && !lpCleared) {
          lpCleared = true;
          return { throw: new Error('LP clear failed') };
        }
      },
    },
  });
  // Copy freeze state to depsFail
  for (const [name, records] of Object.entries(deps._state.stores)) {
    depsFail._state.stores[name] = records.map(r => ({ ...r }));
  }
  depsFail.stripe = deps.stripe;
  const result1 = await finalizeCapturedPayment(depsFail, s.listingId);
  const firstFailed = !result1.ok;

  // Inject a different non-null token
  depsFail._state.stores.Listing[0].reservation_token = 'different_token';
  depsFail._state.stores.ListingPrivate[0].reservation_token = 'different_token';

  // Retry
  const deps2 = createMockDeps({});
  for (const [name, records] of Object.entries(depsFail._state.stores)) {
    deps2._state.stores[name] = records.map(r => ({ ...r }));
  }
  deps2.now = () => Date.now() + timeOffset;
  const result2 = await finalizeCapturedPayment(deps2, s.listingId);

  // Must NOT return ok — different non-null token must be preserved and blocked
  const notOk = !result2.ok;
  const listing = deps2._state.stores.Listing[0];
  const tokenPreserved = listing.reservation_token === 'different_token';
  const notSold = listing.status !== 'sold';

  const passed = firstFailed && notOk && tokenPreserved && notSold;
  return { name: 'different_non_null_token_during_partial_finalization_preserved_and_blocked', passed, type: 'runtime', first_failed: firstFailed, not_ok: notOk, token_preserved: tokenPreserved, not_sold: notSold, step: result2.step };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 20: Provider-call counters remain zero
// ════════════════════════════════════════════════════════════════════════════
async function testProviderCallCountersZero() {
  const s = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed: s.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, s.piId, { status: 'succeeded', amount: 10500, metadata: defaultMetadata(s), transfer_data: { destination: 'acct_test_123' } });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(s.piId);
  await freezeCapturedPayment(deps, purchase, pp, pi);

  timeOffset = QUARANTINE_DRAIN_MS + 60000;
  await finalizeCapturedPayment(deps, s.listingId);

  const zeroPush = deps._state.providerCalls.push === 0;
  const zeroEmail = deps._state.providerCalls.email === 0;

  const passed = zeroPush && zeroEmail;
  return { name: 'provider_call_counters_zero', passed, type: 'runtime', zero_push: zeroPush, zero_email: zeroEmail };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 21: Function count remains 50 (source-only)
// ════════════════════════════════════════════════════════════════════════════
function testFunctionCountRemains50() {
  const funcDir = join(__dirname, '..', 'base44', 'functions');
  const allDirs = readdirSync(funcDir).filter(d => { try { return statSync(join(funcDir, d)).isDirectory(); } catch (_) { return false; } });
  const deployableDirs = allDirs.filter(d => { try { return statSync(join(funcDir, d, 'entry.ts')).isFile(); } catch (_) { return false; } });
  const emptyDirs = allDirs.filter(d => !deployableDirs.includes(d));
  // Assert exactly 50 deployable entry.ts functions.
  // Raw/empty counts reported separately — GitHub does not track empty dirs.
  const passed = deployableDirs.length === 50;
  return {
    name: 'function_count_unchanged',
    passed,
    type: 'source-only',
    deployable_count: deployableDirs.length,
    raw_count: allDirs.length,
    empty_count: emptyDirs.length,
    empty_dirs: emptyDirs,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  const tests = [
    testSchemaValidation(),
    await testFrozenExpirationFromListingLP(),
    await testFrozenExpirationPersistsAndRefetched(),
    await testFrozenRevisionPersistsAndRefetched(),
    await testExpirationChangesAfterFreezeBlocked(),
    await testRevisionChangesAfterFreezeBlocked(),
    await testListingNullLPMatchesNoAutoFinalization(),
    await testLPNullListingMatchesNoAutoFinalization(),
    await testBothNullNoFinalizationStartedNoFalseSuccess(),
    await testPPFreezeSucceedsListingQuarantineFailsRetryNoFalseAlreadyFrozen(),
    await testPPPurchaseSucceedLPQuarantineFailsRetryRepairsOrBlocks(),
    await testRecoveryNotBeforeSilentlyFailsNon2xx(),
    await testFrozenExpirationSilentlyFailsNon2xx(),
    await testFrozenRevisionSilentlyFailsNon2xx(),
    await testFreezeFinalizedAtButLPHasTokenNotAlreadyFinalized(),
    await testListingSoldButLPQuarantinedNotAlreadyFinalized(),
    await testMatchingCompleteTupleFinalizesSuccessfully(),
    await testFullyFinalizedIdempotent(),
    await testPhase2WriteBoundaryFailuresRetryConverges(),
    await testDifferentNonNullTokenDuringPartialFinalizationPreservedAndBlocked(),
    await testProviderCallCountersZero(),
    testFunctionCountRemains50(),
  ];

  console.log('=== Freeze-Tuple Completeness Tests (7C.9C.2) ===\n');

  let allPassed = true;
  for (const t of tests) {
    const status = t.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${t.name}`);
    for (const [key, val] of Object.entries(t)) {
      if (key !== 'name' && key !== 'passed' && key !== 'type') {
        console.log(`  ${key}: ${JSON.stringify(val)}`);
      }
    }
    console.log();
    if (!t.passed) allPassed = false;
  }

  console.log(`=== Overall: ${allPassed ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${tests.length}, Passed: ${tests.filter(t => t.passed).length}, Failed: ${tests.filter(t => !t.passed).length}`);

  if (!allPassed) process.exit(1);
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });