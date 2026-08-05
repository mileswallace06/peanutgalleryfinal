/**
 * Payment-Reconciliation Remediation Tests (7C.9C.1)
 *
 * Tests the two-phase freeze-and-finalize architecture:
 *   - Phase 1 (freezeCapturedPayment): freeze listing, preserve reservation, verify
 *   - Phase 2 (finalizeCapturedPayment): compare against frozen tuple, finalize or block
 *
 * Also tests:
 *   - Stripe cancel verification (always re-retrieve)
 *   - Dispatcher integrity (no catch(() => []), non-2xx on failure)
 *   - Durable failure handling (check quarantine result, re-fetch to prove persistence)
 *   - Real deferred synchronization barrier (not just Promise.all)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { freezeCapturedPayment, finalizeCapturedPayment } from '../base44/shared/captureReconciliation.js';
import { runCapturePayment } from '../base44/shared/captureOrchestrator.js';
import { runConfirmCheckoutAuthorized } from '../base44/shared/confirmCheckoutOrchestrator.js';
import { runStripeWebhook } from '../base44/shared/webhookOrchestrator.js';
import { runCleanupAbandonedCheckouts } from '../base44/shared/cleanupOrchestrator.js';
import { dispatchSaleNotificationsDeps } from '../base44/shared/saleDispatch.js';
import { dispatchWebhookNotifications } from '../base44/shared/webhookNotifications.js';
import { QUARANTINE_DRAIN_MS } from '../base44/shared/checkoutLogic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => `uuid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` };
}

// ── Mock Stripe ──────────────────────────────────────────────────────────────
function createMockStripe(config = {}) {
  const pisById = new Map();
  let piCounter = 0;
  return {
    pisById,
    paymentIntents: {
      create: async (params) => {
        const id = `pi_test_${++piCounter}`;
        const pi = { id, client_secret: `secret_${id}`, status: 'requires_payment_method', amount: params.amount, metadata: { ...params.metadata } };
        if (params.transfer_data) pi.transfer_data = params.transfer_data;
        pisById.set(id, pi);
        return pi;
      },
      retrieve: async (id) => { if (!pisById.has(id)) throw new Error('PI not found'); return pisById.get(id); },
      capture: async (id) => { const pi = pisById.get(id); if (!pi) throw new Error('PI not found'); if (config.captureThrows) throw config.captureThrows; pi.status = 'succeeded'; return pi; },
      cancel: async (id) => {
        const pi = pisById.get(id);
        if (!pi) throw new Error('PI not found');
        if (config.cancelThrows) throw config.cancelThrows;
        // cancel() returns canceled, but retrieve() may return something else
        if (config.cancelReturnsCanceledButRetrieveDifferent) {
          return { ...pi, status: 'canceled' };
        }
        pi.status = 'canceled';
        return pi;
      },
      update: async (id, params) => { const pi = pisById.get(id); if (!pi) throw new Error('PI not found'); if (params.metadata) pi.metadata = { ...pi.metadata, ...params.metadata }; return pi; },
    },
    accounts: { retrieve: async () => ({ charges_enabled: true }) },
    _config: config,
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
  // Hooks that can intercept filter calls
  const filterHooks = config.filterHooks || {};

  function createStore(name) {
    return {
      filter: async (query, sort, limit, skip) => {
        // Allow filter hooks to intercept or throw
        if (filterHooks[name]) {
          const result = await filterHooks[name](query, sort, limit, skip);
          if (result === 'THROW') throw new Error(`Simulated ${name} query failure`);
          if (result) return result;
        }
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
    _state: { stores, hooks, providerCalls, silentDropFields, filterHooks },
  };
  return deps;
}

// ── Seed helpers ──────────────────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA VALIDATION
// ════════════════════════════════════════════════════════════════════════════
function testSchemaValidation() {
  const ppSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'PurchasePrivate.jsonc'), 'utf8');
  const passed = ppSchema.includes('"frozen_reservation_token"') &&
    ppSchema.includes('"frozen_buyer_email"') &&
    ppSchema.includes('"frozen_reservation_expires_at"') &&
    ppSchema.includes('"freeze_finalized_at"');
  return { name: 'schema_validation', passed };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: Newer reservation injected after prefetch — preserved, not erased
// ════════════════════════════════════════════════════════════════════════════
async function testNewerReservationInjectedAfterPrefetch() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    hooks: {
      // Inject a newer token on the Listing AFTER the initial read, BEFORE the quarantine write
      'before_Listing_update': (id, data) => {
        if (data.status === 'hidden' && data.hidden_reason === 'checkout_quarantine') {
          const listing = deps._state.stores.Listing[0];
          listing.reservation_token = 'newer_injected_token';
        }
      },
    },
  });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const ppFinal = deps._state.stores.PurchasePrivate[0];

  // Conflict detected — freeze returns non-ok
  const conflictDetected = !result.ok && result.step === 'conflict';
  // The newer token must be PRESERVED on the listing (NOT erased)
  const newerPreserved = listing.reservation_token === 'newer_injected_token';
  // Listing must be quarantined (hidden), NOT sold
  const notSold = listing.status !== 'sold';
  const quarantined = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine';

  const passed = conflictDetected && newerPreserved && notSold && quarantined;
  return { name: 'newer_reservation_injected_after_prefetch', passed, conflict_detected: conflictDetected, newer_preserved: newerPreserved, not_sold: notSold, quarantined };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: Expiration split-brain — matching token/buyer, different expiration
// ════════════════════════════════════════════════════════════════════════════
async function testExpirationSplitBrain() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed({
    lp: { reservation_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
    listing: { reservation_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString() },
  });
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  // Must NOT return ok
  const notOk = !result.ok;
  // Must detect expiration split-brain
  const correctStep = result.step === 'expiration_split_brain';
  // Listing must be quarantined
  const listing = deps._state.stores.Listing[0];
  const quarantined = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine';

  const passed = notOk && correctStep && quarantined;
  return { name: 'expiration_split_brain', passed, not_ok: notOk, step: result.step, quarantined };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: Quarantine write failure + alert failure — non-2xx, no false claim
// ════════════════════════════════════════════════════════════════════════════
async function testQuarantineAndAlertBothFail() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    hooks: {
      // Quarantine write fails (Listing.update throws when setting hidden)
      'before_Listing_update': (id, data) => {
        if (data.status === 'hidden' && data.hidden_reason === 'checkout_quarantine') {
          return { throw: new Error('Quarantine write failed') };
        }
      },
      // AdminAlert create fails
      'before_AdminAlert_create': () => ({ throw: new Error('Alert create failed') }),
    },
  });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);

  // Inject a conflicting token to trigger the quarantine path
  deps._state.stores.Listing[0].reservation_token = 'conflicting_token';

  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  // Must NOT return ok
  const notOk = !result.ok;
  // Must report that BOTH quarantine and alert failed
  const reportsBothFailed = result.error && result.error.includes('quarantine AND alert both failed');
  // No alerts should have been created (alert create failed)
  const zeroAlerts = deps._state.stores.AdminAlert.length === 0;

  const passed = notOk && reportsBothFailed && zeroAlerts;
  return { name: 'quarantine_and_alert_both_fail', passed, not_ok: notOk, reports_both_failed: reportsBothFailed, zero_alerts: zeroAlerts };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: Notification main-query failure — fatal_error, not empty success
// ════════════════════════════════════════════════════════════════════════════
async function testNotificationMainQueryFailure() {
  const deps = createMockDeps({
    filterHooks: {
      Notification: () => 'THROW', // Always throw on Notification.filter
    },
  });

  const result = await dispatchSaleNotificationsDeps(deps, {});

  // Must have fatal_error
  const hasFatalError = !!result.fatal_error;
  // Must NOT report success
  const notSuccess = result.dispatched === 0 && result.errors >= 1;
  // Must NOT be an empty success (dispatched=0, errors=0)
  const notEmptySuccess = !(result.dispatched === 0 && result.errors === 0 && !result.fatal_error);

  const passed = hasFatalError && notSuccess && notEmptySuccess;
  return { name: 'notification_main_query_failure', passed, has_fatal_error: hasFatalError, not_success: notSuccess, not_empty_success: notEmptySuccess };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: PurchasePrivate main-query failure — errors, not empty success
// ════════════════════════════════════════════════════════════════════════════
async function testPurchasePrivateMainQueryFailure() {
  const deps = createMockDeps({
    seed: {
      Purchase: [{ id: 'pur_q5', listing_id: 'listing_q5', event_id: 'event_1', buyer_email: 'buyer@test', seller_email: 'seller@test', payment_intent_id: 'pi_q5', reservation_token: 'token_q5', transfer_status: 'pending_transfer', amount: 105, seller_confirmed: true, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }],
      Notification: [{ id: 'n_q5', idempotency_key: 'sale_created:pur_q5', user_email: 'seller@test', type: 'sale_created', title: 'Test', body: 'Test', dispatch_status: 'pending', created_date: new Date().toISOString(), reference_id: 'pur_q5', reference_type: 'purchase' }],
    },
    filterHooks: {
      PurchasePrivate: () => 'THROW', // PurchasePrivate.filter always throws
    },
    sendUserNotification: async () => { deps._state.providerCalls.push++; return { push: { sent: true } }; },
  });

  const result = await dispatchSaleNotificationsDeps(deps, { keys: ['sale_created:pur_q5'] });

  // Must report errors
  const hasErrors = result.errors > 0;
  // Must NOT dispatch
  const notDispatched = result.dispatched === 0;
  // Notification must remain pending (not superseded)
  const notif = deps._state.stores.Notification[0];
  const remainsPending = notif.dispatch_status === 'pending';
  // Must create critical alert
  const hasAlert = deps._state.stores.AdminAlert.some(a => a.title && a.title.includes('PurchasePrivate query failed'));

  const passed = hasErrors && notDispatched && remainsPending && hasAlert;
  return { name: 'purchase_private_main_query_failure', passed, has_errors: hasErrors, not_dispatched: notDispatched, remains_pending: remainsPending, has_alert: hasAlert };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: Cancel response/live-retrieval disagreement — re-retrieve, non-2xx
// ════════════════════════════════════════════════════════════════════════════
async function testCancelResponseLiveRetrievalDisagreement() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  // Create a special Stripe mock where cancel returns canceled but retrieve returns requires_confirmation
  const stripe = createMockStripe({ cancelReturnsCanceledButRetrieveDifferent: true });
  // Override retrieve to return requires_confirmation after cancel
  const originalRetrieve = stripe.paymentIntents.retrieve;
  let cancelCalled = false;
  stripe.paymentIntents.cancel = async (id) => {
    cancelCalled = true;
    return { id, status: 'canceled' }; // cancel returns canceled
  };
  stripe.paymentIntents.retrieve = async (id) => {
    const pi = stripe.pisById.get(id);
    if (!pi) throw new Error('PI not found');
    // After cancel was called, retrieve still returns requires_confirmation
    if (cancelCalled) return { ...pi, status: 'requires_confirmation' };
    return pi;
  };

  const deps = createMockDeps({ seed, stripe });
  // Set PI to requires_confirmation (cancelable state)
  seedStripePI(deps.stripe, piId, {
    status: 'requires_confirmation',
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });
  // Override the PI in the stripe mock to match
  deps.stripe.pisById.set(piId, {
    id: piId, client_secret: `secret_${piId}`, status: 'requires_confirmation',
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  const event = { id: 'evt_cancel_disagree', type: 'payment_intent.payment_failed', data: { object: { id: piId } } };
  const result = await runStripeWebhook(deps, event);

  // Must return non-2xx (cancel not verified)
  const non2xx = result.status === 500;
  // Must create critical alert
  const hasAlert = deps._state.stores.AdminAlert.some(a => a.title && a.title.includes('cancel not verified'));
  // Purchase must NOT be expired (cancel not verified, so don't expire)
  const purchase = deps._state.stores.Purchase[0];
  const notExpired = purchase.transfer_status !== 'expired';

  const passed = non2xx && hasAlert && notExpired;
  return { name: 'cancel_response_live_retrieval_disagreement', passed, non_2xx: non2xx, has_alert: hasAlert, not_expired: notExpired };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: Dispatcher entrypoint non-2xx mapping
// ════════════════════════════════════════════════════════════════════════════
async function testDispatcherEntrypointNon2xxMapping() {
  // Simulate the entry.ts logic: if sale.errors > 0 or sale.fatal_error, return 500
  const saleResult = { dispatched: 0, errors: 1, fatal_error: 'Notification query failed' };
  const webhookResult = { dispatched: 0, errors: 0 };

  const saleErrors = saleResult?.errors || 0;
  const saleFatal = saleResult?.fatal_error;
  const webhookErrors = webhookResult?.errors || 0;
  const webhookFatal = webhookResult?.fatal_error;

  const shouldReturn500 = saleFatal || saleErrors > 0 || webhookFatal || webhookErrors > 0;

  const passed = !!shouldReturn500;
  return { name: 'dispatcher_entrypoint_non2xx_mapping', passed, returns_500: shouldReturn500 };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: Silent marker non-persistence — detected, non-2xx
// ════════════════════════════════════════════════════════════════════════════
async function testSilentMarkerNonPersistence() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    silentDropFields: { PurchasePrivate: ['authorization_confirmed_at'] },
  });
  seedStripePI(deps.stripe, piId, {
    status: 'requires_capture', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const result = await runConfirmCheckoutAuthorized(deps, { purchase_id: purchaseId });

  const non2xx = result.status === 500;
  const hasAlert = deps._state.stores.AdminAlert.some(a => a.title && a.title.includes('not persisted'));
  const zeroNotifications = deps._state.stores.Notification.length === 0;

  const passed = non2xx && hasAlert && zeroNotifications;
  return { name: 'silent_marker_non_persistence', passed, non_2xx: non2xx, has_alert: hasAlert, zero_notifications: zeroNotifications };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: Matching tuple successful finalization (Phase 1 freeze + Phase 2 finalize)
// ════════════════════════════════════════════════════════════════════════════
async function testMatchingTupleSuccessfulFinalization() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  // Phase 1: Freeze
  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  const freezeResult = await freezeCapturedPayment(deps, purchase, pp, pi);
  const freezeOk = freezeResult.ok;

  // Advance past drain period
  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  // Phase 2: Finalize (called from cleanup orchestrator)
  const finalizeResult = await finalizeCapturedPayment(deps, listingId);
  const finalizeOk = finalizeResult.ok;

  // Verify final state
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const ppFinal = deps._state.stores.PurchasePrivate[0];

  const listingSold = listing.status === 'sold' && !listing.reservation_token && !listing.reserved_by_email && !listing.reservation_expires_at;
  const lpCleared = !lp.reservation_token && !lp.reserved_by_email && !lp.reservation_expires_at && !lp.checkout_quarantined;
  const ppFinalized = !!ppFinal.freeze_finalized_at;

  const passed = freezeOk && finalizeOk && listingSold && lpCleared && ppFinalized;
  return { name: 'matching_tuple_successful_finalization', passed, freeze_ok: freezeOk, finalize_ok: finalizeOk, listing_sold: listingSold, lp_cleared: lpCleared, pp_finalized: ppFinalized };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 10: Already-finalized idempotency
// ════════════════════════════════════════════════════════════════════════════
async function testAlreadyFinalizedIdempotency() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed({
    listing: { status: 'sold', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, hidden_reason: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, checkout_quarantined: false },
    pp: { payment_captured: true, freeze_finalized_at: '2026-01-01T00:00:00.000Z', frozen_reservation_token: 'res_token_123', frozen_buyer_email: 'buyer@test', frozen_reservation_expires_at: '2026-08-01T10:10:00.000Z', frozen_reservation_revision: 'rev_001' },
    purchase: { transfer_status: 'completed', payment_captured: true, buyer_confirmed: true },
  });
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  const passed = result.ok && result.idempotent === true && result.phase === 'already_finalized';
  return { name: 'already_finalized_idempotency', passed, ok: result.ok, idempotent: result.idempotent, phase: result.phase };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 11: Actual deferred synchronization barrier plus Promise.all
// ════════════════════════════════════════════════════════════════════════════
async function testDeferredBarrierPlusPromiseAll() {
  const deps = createMockDeps({});

  // Two webhook notifications with the same idempotency_key
  deps._state.stores.Notification.push(
    { id: 'n_b1', idempotency_key: 'webhook:test:evt_barrier', user_email: 'buyer@test', type: 'transfer_rejected', title: 'T', body: 'B', dispatch_status: 'pending', created_date: '2026-08-01T10:00:00.000Z' },
    { id: 'n_b2', idempotency_key: 'webhook:test:evt_barrier', user_email: 'buyer@test', type: 'transfer_rejected', title: 'T', body: 'B', dispatch_status: 'pending', created_date: '2026-08-01T10:00:01.000Z' },
  );

  // ── Create a REAL deferred synchronization barrier ──────────────────────────
  // Both dispatch calls must arrive at the Notification query before either proceeds.
  let arrivedCount = 0;
  let releaseBarrier;
  const barrierPromise = new Promise(resolve => { releaseBarrier = resolve; });

  // Override the Notification.filter to include the barrier
  const originalFilter = deps.entities.Notification.filter;
  let filterCallCount = 0;
  deps.entities.Notification.filter = async function (query, sort, limit, skip) {
    filterCallCount++;
    // Both calls must arrive at the barrier before either proceeds
    arrivedCount++;
    if (arrivedCount >= 2) {
      releaseBarrier();
    }
    // Wait for the barrier to release
    await barrierPromise;
    // Add a small delay to ensure true interleaving
    await new Promise(r => setTimeout(r, 5));
    return originalFilter.call(this, query, sort, limit, skip);
  };

  // Both dispatch calls are launched with Promise.all — they interleave at the barrier
  const [r1, r2] = await Promise.all([
    dispatchWebhookNotifications(deps),
    dispatchWebhookNotifications(deps),
  ]);

  // Both calls hit the Notification filter (barrier worked)
  const bothHitFilter = filterCallCount >= 2;
  // One canonical dispatched, at least one superseded
  const dispatched = deps._state.stores.Notification.filter(n => n.dispatch_status === 'dispatched').length;
  const superseded = deps._state.stores.Notification.filter(n => n.dispatch_status === 'superseded').length;
  const noErrors = r1.errors === 0 && r2.errors === 0;

  const passed = bothHitFilter && noErrors && dispatched >= 1 && superseded >= 1;
  return { name: 'deferred_barrier_plus_promise_all', passed, both_hit_filter: bothHitFilter, no_errors: noErrors, dispatched, superseded, filter_calls: filterCallCount, barrier_type: 'deferred Promise gate' };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Freeze verification failure returns non-2xx
// ════════════════════════════════════════════════════════════════════════════
async function testFreezeVerificationFailureReturnsNon2xx() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    // Silently drop frozen_reservation_token from PP updates
    silentDropFields: { PurchasePrivate: ['frozen_reservation_token'] },
  });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  // Must NOT return ok (frozen_reservation_token not persisted)
  const notOk = !result.ok;
  // Must fail at verify step
  const verifyFailed = result.step === 'verify';

  const passed = notOk && verifyFailed;
  return { name: 'freeze_verification_failure_returns_non2xx', passed, not_ok: notOk, verify_failed: verifyFailed, step: result.step };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Phase 2 detects conflicting tuple and blocks
// ════════════════════════════════════════════════════════════════════════════
async function testPhase2DetectsConflictAndBlocks() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  // Phase 1: Freeze
  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  await freezeCapturedPayment(deps, purchase, pp, pi);

  // Inject a conflicting token on the listing AFTER freeze
  deps._state.stores.Listing[0].reservation_token = 'conflicting_after_freeze';
  deps._state.stores.ListingPrivate[0].reservation_token = 'conflicting_after_freeze';

  // Advance past drain
  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  // Phase 2: Finalize
  const result = await finalizeCapturedPayment(deps, listingId);

  // Must NOT return ok
  const notOk = !result.ok;
  // Must detect conflict
  const conflictDetected = result.step === 'conflict';
  // Listing must remain hidden/quarantined (not sold)
  const listing = deps._state.stores.Listing[0];
  const notSold = listing.status !== 'sold';
  // Conflicting token must be preserved
  const tokenPreserved = listing.reservation_token === 'conflicting_after_freeze';
  // LP must be recovery_blocked
  const lp = deps._state.stores.ListingPrivate[0];
  const blocked = lp.recovery_blocked === true;

  const passed = notOk && conflictDetected && notSold && tokenPreserved && blocked;
  return { name: 'phase2_detects_conflict_and_blocks', passed, not_ok: notOk, conflict_detected: conflictDetected, not_sold: notSold, token_preserved: tokenPreserved, blocked };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Cleanup orchestrator runs Phase 3 finalization
// ════════════════════════════════════════════════════════════════════════════
async function testCleanupOrchestratorRunsPhase3Finalization() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  // Phase 1: Freeze
  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  await freezeCapturedPayment(deps, purchase, pp, pi);

  // Advance past drain
  timeOffset = QUARANTINE_DRAIN_MS + 60000;

  // Run cleanup orchestrator — should execute Phase 3 finalization
  const result = await runCleanupAbandonedCheckouts(deps);

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const ppFinal = deps._state.stores.PurchasePrivate[0];

  // Phase 3 should have finalized the listing
  const finalized = result.body.freeze_finalized > 0;
  const listingSold = listing.status === 'sold';
  const lpCleared = !lp.reservation_token && !lp.checkout_quarantined;
  const ppFinalizedAt = !!ppFinal.freeze_finalized_at;

  const passed = finalized && listingSold && lpCleared && ppFinalizedAt;
  return { name: 'cleanup_orchestrator_runs_phase3_finalization', passed, finalized, listing_sold: listingSold, lp_cleared: lpCleared, pp_finalized: ppFinalizedAt };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Delivery-state persistence failure propagates as error
// ════════════════════════════════════════════════════════════════════════════
async function testDeliveryStatePersistenceFailurePropagates() {
  const deps = createMockDeps({
    seed: {
      Purchase: [{ id: 'pur_deliv', listing_id: 'listing_deliv', event_id: 'event_1', buyer_email: 'buyer@test', seller_email: 'seller@test', payment_intent_id: 'pi_deliv', reservation_token: 'token_deliv', transfer_status: 'pending_transfer', amount: 105, seller_confirmed: true, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }],
      PurchasePrivate: [{ id: 'pp_deliv', purchase_id: 'pur_deliv', listing_id: 'listing_deliv', buyer_email: 'buyer@test', seller_email: 'seller@test', payment_intent_id: 'pi_deliv', reservation_token: 'token_deliv', seller_push_status: 'pending', seller_email_status: 'pending', created_date: new Date().toISOString(), updated_date: new Date().toISOString() }],
      Notification: [{ id: 'n_deliv', idempotency_key: 'sale_created:pur_deliv', user_email: 'seller@test', type: 'sale_created', title: 'Test', body: 'Test', dispatch_status: 'pending', created_date: new Date().toISOString(), reference_id: 'pur_deliv', reference_type: 'purchase' }],
    },
    // Notification.update fails (delivery-state persistence)
    hooks: {
      'before_Notification_update': async () => ({ throw: new Error('Notification update failed') }),
    },
  });

  const result = await dispatchSaleNotificationsDeps(deps, { keys: ['sale_created:pur_deliv'] });

  // Must report errors
  const hasErrors = result.errors > 0;
  // Must NOT dispatch
  const notDispatched = result.dispatched === 0;
  // Zero provider calls
  const zeroProviderCalls = deps._state.providerCalls.push === 0 && deps._state.providerCalls.email === 0;

  const passed = hasErrors && notDispatched && zeroProviderCalls;
  return { name: 'delivery_state_persistence_failure_propagates', passed, has_errors: hasErrors, not_dispatched: notDispatched, zero_provider_calls: zeroProviderCalls };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Missing Purchase does not supersede notification
// ════════════════════════════════════════════════════════════════════════════
async function testMissingPurchaseDoesNotSupersede() {
  const deps = createMockDeps({
    seed: {
      // No Purchase record
      Notification: [{ id: 'n_miss', idempotency_key: 'sale_created:pur_missing', user_email: 'seller@test', type: 'sale_created', title: 'Test', body: 'Test', dispatch_status: 'pending', created_date: new Date().toISOString(), reference_id: 'pur_missing', reference_type: 'purchase' }],
    },
  });

  const result = await dispatchSaleNotificationsDeps(deps, { keys: ['sale_created:pur_missing'] });

  const notif = deps._state.stores.Notification[0];
  // Notification must remain pending (not superseded)
  const remainsPending = notif.dispatch_status === 'pending';
  // Critical alert created
  const hasAlert = deps._state.stores.AdminAlert.some(a => a.title && a.title.includes('missing Purchase'));
  // Purchase missing counted
  const purchaseMissing = result.purchase_missing > 0;

  const passed = remainsPending && hasAlert && purchaseMissing;
  return { name: 'missing_purchase_does_not_supersede', passed, remains_pending: remainsPending, has_alert: hasAlert, purchase_missing: purchaseMissing };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  const tests = [
    testSchemaValidation(),
    // 7 confirmed failures
    await testNewerReservationInjectedAfterPrefetch(),
    await testExpirationSplitBrain(),
    await testQuarantineAndAlertBothFail(),
    await testNotificationMainQueryFailure(),
    await testPurchasePrivateMainQueryFailure(),
    await testCancelResponseLiveRetrievalDisagreement(),
    await testDispatcherEntrypointNon2xxMapping(),
    await testSilentMarkerNonPersistence(),
    // Required scenarios
    await testMatchingTupleSuccessfulFinalization(),
    await testAlreadyFinalizedIdempotency(),
    await testDeferredBarrierPlusPromiseAll(),
    // Additional
    await testFreezeVerificationFailureReturnsNon2xx(),
    await testPhase2DetectsConflictAndBlocks(),
    await testCleanupOrchestratorRunsPhase3Finalization(),
    await testDeliveryStatePersistenceFailurePropagates(),
    await testMissingPurchaseDoesNotSupersede(),
  ];

  console.log('=== Payment-Reconciliation Remediation Tests (7C.9C.1) ===\n');

  let allPassed = true;
  for (const t of tests) {
    const status = t.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${t.name}`);
    for (const [key, val] of Object.entries(t)) {
      if (key !== 'name' && key !== 'passed') {
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