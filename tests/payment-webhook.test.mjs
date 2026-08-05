/**
 * Payment & Webhook Fail-Closed Remediation Tests (7C.9)
 *
 * Tests invoke the ACTUAL production orchestrator modules directly:
 *   - runStripeWebhook (from webhookOrchestrator.js)
 *   - runCapturePayment (from captureOrchestrator.js)
 *   - runConfirmCheckoutAuthorized (from confirmCheckoutOrchestrator.js)
 *   - dispatchWebhookNotifications (from webhookNotifications.js)
 *
 * 10 test scenarios:
 *   1. Old failed event arriving after a newer reservation
 *   2. payment_failed after succeeded/requires_capture
 *   3. Public captured=true/private=false retry repair
 *   4. Private write/query failure causes Stripe retry
 *   5. Duplicate/concurrent webhook events
 *   6. Missing/divergent sidecars
 *   7. Stale public authorization marker
 *   8. Reservation metadata/current-state mismatch
 *   9. Captured payments can never be expired or released
 *   10. No duplicate provider delivery
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runStripeWebhook } from '../base44/shared/webhookOrchestrator.js';
import { runCapturePayment } from '../base44/shared/captureOrchestrator.js';
import { runConfirmCheckoutAuthorized } from '../base44/shared/confirmCheckoutOrchestrator.js';
import { dispatchWebhookNotifications } from '../base44/shared/webhookNotifications.js';

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
        if (config.transfer_data) pi.transfer_data = config.transfer_data;
        pisById.set(id, pi);
        return pi;
      },
      retrieve: async (id) => {
        if (!pisById.has(id)) throw new Error('PI not found');
        return pisById.get(id);
      },
      capture: async (id, opts) => {
        const pi = pisById.get(id);
        if (!pi) throw new Error('PI not found');
        if (config.captureThrows) throw config.captureThrows;
        pi.status = 'succeeded';
        return pi;
      },
      cancel: async (id) => {
        const pi = pisById.get(id);
        if (!pi) throw new Error('PI not found');
        pi.status = 'canceled';
        return pi;
      },
      update: async (id, params) => {
        const pi = pisById.get(id);
        if (!pi) throw new Error('PI not found');
        if (params.metadata) pi.metadata = { ...pi.metadata, ...params.metadata };
        return pi;
      },
    },
    accounts: { retrieve: async () => ({ charges_enabled: true }) },
  };
}

// ── Mock entity helpers ───────────────────────────────────────────────────
function applyFilter(records, query) {
  if (!query || Object.keys(query).length === 0) return [...records];
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
    const av = a[field] || ''; const bv = b[field] || '';
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

let idCounter = 0;
function genId(name) { return `${name.toLowerCase()}_${++idCounter}`; }

function createMockDeps(config = {}) {
  const stores = {
    Listing: [], ListingPrivate: [], Purchase: [], PurchasePrivate: [],
    User: [], UserSecurityProfile: [], AdminAlert: [], Notification: [],
  };
  const hooks = config.hooks || {};
  const providerCalls = { push: 0, email: 0 };

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
        stores[name][idx] = { ...stores[name][idx], ...data, updated_date: new Date().toISOString() };
        if (hooks[`after_${name}_update`]) hooks[`after_${name}_update`](stores[name][idx]);
        return stores[name][idx];
      },
      delete: async (id) => {
        const idx = stores[name].findIndex(r => r.id === id);
        if (idx !== -1) stores[name].splice(idx, 1);
      },
    };
  }

  // Seed
  if (config.seed) {
    for (const [entityName, records] of Object.entries(config.seed)) {
      for (const record of records) {
        stores[entityName].push({
          id: record.id || genId(entityName),
          created_date: record.created_date || '2026-08-01T10:00:00.000Z',
          updated_date: record.updated_date || '2026-08-01T10:00:00.000Z',
          ...record,
        });
      }
    }
  }

  const deps = {
    entities: {
      Listing: createStore('Listing'),
      ListingPrivate: createStore('ListingPrivate'),
      Purchase: createStore('Purchase'),
      PurchasePrivate: createStore('PurchasePrivate'),
      User: createStore('User'),
      UserSecurityProfile: createStore('UserSecurityProfile'),
      AdminAlert: createStore('AdminAlert'),
      Notification: createStore('Notification'),
    },
    stripe: config.stripe || createMockStripe(),
    user: config.user || { id: 'user_buyer', email: 'buyer@test', role: 'user', full_name: 'Test Buyer' },
    now: config.now || (() => Date.now()),
    isMaintenanceActive: config.isMaintenanceActive || (() => false),
    isLiveMode: config.isLiveMode ?? false,
    sendUserNotification: async (d, opts) => {
      providerCalls.push++;
      return { push: { sent: true }, email: { sent: false } };
    },
    sendTransactionalEmail: async (d, to, subject, body) => {
      providerCalls.email++;
      return { sent: true };
    },
    _state: { stores, hooks, providerCalls },
  };
  return deps;
}

// ── Seed helpers ──────────────────────────────────────────────────────────
function createDefaultSeed(overrides = {}) {
  const listingId = overrides.listingId || 'listing_1';
  const sellerEmail = 'seller@test';
  const buyerEmail = overrides.buyerEmail || 'buyer@test';
  const token = overrides.token || 'res_token_123';
  const piId = overrides.piId || 'pi_test_1';
  const purchaseId = overrides.purchaseId || 'pur_1';
  const expiry = overrides.expiry || new Date(Date.now() + 10 * 60 * 1000).toISOString();

  return {
    seed: {
      Listing: [{
        id: listingId, status: 'pending_transfer', asking_price: 100, quantity: 1,
        section: 'A', row: '1', event_id: 'event_1', seller_email: sellerEmail,
        reservation_token: token, reserved_by_email: buyerEmail,
        reservation_expires_at: expiry, hidden_reason: null,
        updated_date: '2026-08-01T10:00:00.000Z',
        ...overrides.listing,
      }],
      ListingPrivate: [{
        id: `lp_${listingId}`, listing_id: listingId, seller_email: sellerEmail,
        reservation_token: token, reserved_by_email: buyerEmail,
        reservation_expires_at: expiry, proof_status: 'approved',
        is_demo_listing: false, notes: null, seat_inventory_id: null,
        checkout_quarantined: false,
        ...overrides.lp,
      }],
      Purchase: [{
        id: purchaseId, listing_id: listingId, event_id: 'event_1',
        buyer_email: buyerEmail, seller_email: sellerEmail,
        payment_intent_id: piId, reservation_token: token,
        transfer_status: 'pending_transfer', payment_captured: false,
        is_demo: false, amount: 105, seller_confirmed: true,
        updated_date: '2026-08-01T10:00:00.000Z',
        ...overrides.purchase,
      }],
      PurchasePrivate: [{
        id: `pp_${purchaseId}`, purchase_id: purchaseId, listing_id: listingId,
        event_id: 'event_1', buyer_email: buyerEmail, seller_email: sellerEmail,
        payment_intent_id: piId, reservation_token: token,
        payment_captured: false, is_demo: false,
        updated_date: '2026-08-01T10:00:00.000Z',
        ...overrides.pp,
      }],
      User: [
        { id: 'user_buyer', email: buyerEmail, role: 'user', full_name: 'Test Buyer' },
        { id: 'user_seller', email: sellerEmail, role: 'admin', full_name: 'Test Seller' },
      ],
      UserSecurityProfile: [{
        id: 'usp_1', user_id: 'user_seller', user_email: sellerEmail,
        stripe_account_id: 'acct_test_123', stripe_onboarding_complete: true,
        ...overrides.sellerSec,
      }],
    },
    listingId, sellerEmail, buyerEmail, token, piId, purchaseId,
  };
}

function seedStripePI(stripe, piId, opts = {}) {
  stripe.pisById.set(piId, {
    id: piId, client_secret: `secret_${piId}`,
    status: opts.status || 'requires_payment_method',
    amount: opts.amount || 10500,
    currency: 'usd',
    metadata: opts.metadata || {},
    transfer_data: opts.transfer_data,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

// ── 1. Old failed event arriving after a newer reservation ───────────────
async function testOldFailedEventAfterNewerReservation() {
  const { seed, listingId, token, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // The old PI has the old reservation token in metadata
  seedStripePI(deps.stripe, piId, {
    status: 'requires_payment_method',
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  // A newer reservation takes over the listing (different token)
  const lp = deps._state.stores.ListingPrivate[0];
  lp.reservation_token = 'newer_token_456';
  const listing = deps._state.stores.Listing[0];
  listing.reservation_token = 'newer_token_456';

  // Old failed event arrives
  const event = {
    id: 'evt_old_failed_1', type: 'payment_intent.payment_failed',
    data: { object: { id: piId } },
  };
  const result = await runStripeWebhook(deps, event);

  // The new token must NOT be cleared
  const finalLP = deps._state.stores.ListingPrivate[0];
  const finalListing = deps._state.stores.Listing[0];
  const finalPurchase = deps._state.stores.Purchase[0];

  const newerTokenPreserved = finalLP.reservation_token === 'newer_token_456';
  const listingNotActivated = finalListing.status !== 'active';
  const purchaseNotExpired = finalPurchase.transfer_status === 'pending_transfer';
  const skippedUnknownToken = result.body.skipped === 'unknown_token';

  const passed = newerTokenPreserved && listingNotActivated && purchaseNotExpired && skippedUnknownToken;
  return { name: 'old_failed_event_after_newer_reservation', passed, newer_token_preserved: newerTokenPreserved, listing_not_activated: listingNotActivated, purchase_not_expired: purchaseNotExpired, skipped: result.body.skipped };
}

// ── 2. payment_failed after succeeded/requires_capture ───────────────────
async function testPaymentFailedAfterSucceededOrCapture() {
  const results = [];
  for (const piStatus of ['requires_capture', 'succeeded', 'processing']) {
    const { seed, listingId, token, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed();
    const deps = createMockDeps({ seed });
    seedStripePI(deps.stripe, piId, {
      status: piStatus,
      metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    });

    const event = { id: `evt_failed_${piStatus}`, type: 'payment_intent.payment_failed', data: { object: { id: piId } } };
    const result = await runStripeWebhook(deps, event);

    const finalPurchase = deps._state.stores.Purchase[0];
    const finalListing = deps._state.stores.Listing[0];

    const notExpired = finalPurchase.transfer_status === 'pending_transfer';
    const notActivated = finalListing.status === 'pending_transfer';
    const skipped = result.body.skipped === 'pi_in_capture_state';

    results.push({ piStatus, passed: notExpired && notActivated && skipped });
  }
  const allPassed = results.every(r => r.passed);
  return { name: 'payment_failed_after_succeeded_or_capture', passed: allPassed, scenarios: results };
}

// ── 3. Public captured=true/private=false retry repair ───────────────────
async function testPublicCapturedPrivateFalseRetryRepair() {
  const { seed, listingId, token, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed({
    purchase: { payment_captured: true }, // public already true
    pp: { payment_captured: false }, // private still false
  });
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded',
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  const event = { id: 'evt_succeeded_repair', type: 'payment_intent.succeeded', data: { object: { id: piId } } };
  const result = await runStripeWebhook(deps, event);

  const finalPP = deps._state.stores.PurchasePrivate[0];
  const finalPurchase = deps._state.stores.Purchase[0];

  const ppRepaired = finalPP.payment_captured === true;
  const purchaseStillTrue = finalPurchase.payment_captured === true;
  const returned200 = result.status === 200;

  const passed = ppRepaired && purchaseStillTrue && returned200;
  return { name: 'public_captured_private_false_retry_repair', passed, pp_repaired: ppRepaired, purchase_still_true: purchaseStillTrue, returned_200: returned200 };
}

// ── 4. Private write/query failure causes Stripe retry ───────────────────
async function testPrivateWriteFailureCausesRetry() {
  const { seed, listingId, token, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    hooks: {
      'before_PurchasePrivate_update': async () => ({ throw: new Error('Simulated PP write failure') }),
    },
  });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded',
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  const event = { id: 'evt_succeeded_fail', type: 'payment_intent.succeeded', data: { object: { id: piId } } };
  const result = await runStripeWebhook(deps, event);

  const returned500 = result.status === 500;
  const ppNotSet = deps._state.stores.PurchasePrivate[0].payment_captured !== true;

  const passed = returned500 && ppNotSet;
  return { name: 'private_write_failure_causes_retry', passed, returned_500: returned500, pp_not_set: ppNotSet };
}

// ── 5. Duplicate/concurrent webhook events ───────────────────────────────
async function testDuplicateConcurrentWebhookEvents() {
  const { seed, listingId, token, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'requires_payment_method',
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  const event = { id: 'evt_duplicate_1', type: 'payment_intent.payment_failed', data: { object: { id: piId } } };

  // First delivery
  const result1 = await runStripeWebhook(deps, event);
  // Second delivery (duplicate)
  const result2 = await runStripeWebhook(deps, event);

  // Count Notification records with this idempotency key
  const notifs = deps._state.stores.Notification.filter(n =>
    n.idempotency_key === `webhook:payment_failed:evt_duplicate_1`
  );
  const notifCount = notifs.length;

  // At most one notification enqueued
  const passed = notifCount <= 1;
  return { name: 'duplicate_concurrent_webhook_events', passed, notif_count: notifCount, result1_status: result1.status, result2_status: result2.status };
}

// ── 6. Missing/divergent sidecars ────────────────────────────────────────
async function testMissingDivergentSidecars() {
  const results = [];

  // 6a: Missing PurchasePrivate → capturePayment returns integrity error
  {
    const { seed, purchaseId } = createDefaultSeed();
    seed.PurchasePrivate = []; // no PP
    const deps = createMockDeps({ seed });
    const result = await runCapturePayment(deps, { purchase_id: purchaseId });
    const passed = result.status === 500 && result.body.code === 'INTEGRITY_ERROR';
    results.push({ scenario: 'capture_missing_pp', passed });
  }

  // 6b: Missing ListingPrivate → capturePayment returns integrity error
  {
    const { seed, purchaseId, piId } = createDefaultSeed();
    seed.ListingPrivate = [];
    const deps = createMockDeps({ seed });
    seedStripePI(deps.stripe, piId, { status: 'requires_capture', metadata: {} });
    const result = await runCapturePayment(deps, { purchase_id: purchaseId });
    const passed = result.status === 500 && result.body.code === 'INTEGRITY_ERROR';
    results.push({ scenario: 'capture_missing_lp', passed });
  }

  // 6c: Missing PurchasePrivate → confirmCheckoutAuthorized returns integrity error
  {
    const { seed, purchaseId } = createDefaultSeed();
    seed.PurchasePrivate = [];
    const deps = createMockDeps({ seed });
    const result = await runConfirmCheckoutAuthorized(deps, { purchase_id: purchaseId });
    const passed = result.status === 500 && result.body.code === 'INTEGRITY_ERROR';
    results.push({ scenario: 'confirm_missing_pp', passed });
  }

  const allPassed = results.every(r => r.passed);
  return { name: 'missing_divergent_sidecars', passed: allPassed, scenarios: results };
}

// ── 7. Stale public authorization marker ─────────────────────────────────
async function testStalePublicAuthorizationMarker() {
  const { seed, listingId, token, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed({
    purchase: { authorization_confirmed_at: '2026-01-01T00:00:00.000Z' }, // public has it
    pp: { authorization_confirmed_at: null }, // private doesn't
  });
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'requires_capture',
    amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  const result = await runConfirmCheckoutAuthorized(deps, { purchase_id: purchaseId });

  const finalPP = deps._state.stores.PurchasePrivate[0];
  const finalPurchase = deps._state.stores.Purchase[0];

  // PP should get authorization_confirmed_at set (repair divergence)
  const ppRepaired = finalPP.authorization_confirmed_at !== null;
  // Public marker should be updated to match PP
  const publicRepaired = finalPurchase.authorization_confirmed_at === finalPP.authorization_confirmed_at;
  const returned200 = result.status === 200;

  const passed = ppRepaired && publicRepaired && returned200;
  return { name: 'stale_public_authorization_marker', passed, pp_repaired: ppRepaired, public_repaired: publicRepaired, returned_200: returned200 };
}

// ── 8. Reservation metadata/current-state mismatch ───────────────────────
async function testReservationMetadataMismatch() {
  const results = [];

  // 8a: capturePayment — PI metadata reservation_token doesn't match PP
  {
    const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed();
    const deps = createMockDeps({ seed });
    seedStripePI(deps.stripe, piId, {
      status: 'requires_capture',
      amount: 10500,
      metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: 'wrong_token', purchase_id: purchaseId },
      transfer_data: { destination: 'acct_test_123' },
    });
    const result = await runCapturePayment(deps, { purchase_id: purchaseId });
    const passed = result.status === 500;
    results.push({ scenario: 'capture_pi_token_mismatch', passed });
  }

  // 8b: confirmCheckoutAuthorized — PI metadata reservation_token doesn't match PP
  {
    const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed();
    const deps = createMockDeps({ seed });
    seedStripePI(deps.stripe, piId, {
      status: 'requires_capture',
      amount: 10500,
      metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: 'wrong_token', purchase_id: purchaseId },
    });
    const result = await runConfirmCheckoutAuthorized(deps, { purchase_id: purchaseId });
    const passed = result.status === 500;
    results.push({ scenario: 'confirm_pi_token_mismatch', passed });
  }

  // 8c: capturePayment — Listing reservation token doesn't match PP
  {
    const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
    // Make Listing have a different token than PP
    seed.Listing[0].reservation_token = 'different_listing_token';
    const deps = createMockDeps({ seed });
    seedStripePI(deps.stripe, piId, {
      status: 'requires_capture',
      amount: 10500,
      metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
      transfer_data: { destination: 'acct_test_123' },
    });
    const result = await runCapturePayment(deps, { purchase_id: purchaseId });
    const passed = result.status === 409;
    results.push({ scenario: 'capture_listing_token_mismatch', passed });
  }

  const allPassed = results.every(r => r.passed);
  return { name: 'reservation_metadata_mismatch', passed: allPassed, scenarios: results };
}

// ── 9. Captured payments can never be expired or released ────────────────
async function testCapturedPaymentsNeverExpiredOrReleased() {
  const { seed, listingId, token, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed({
    pp: { payment_captured: true }, // PP says captured
  });
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'requires_payment_method', // PI failed
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  const event = { id: 'evt_failed_captured', type: 'payment_intent.payment_failed', data: { object: { id: piId } } };
  const result = await runStripeWebhook(deps, event);

  const finalPurchase = deps._state.stores.Purchase[0];
  const finalListing = deps._state.stores.Listing[0];
  const finalLP = deps._state.stores.ListingPrivate[0];

  const purchaseNotExpired = finalPurchase.transfer_status === 'pending_transfer';
  const listingNotQuarantined = finalListing.status !== 'hidden' || finalListing.hidden_reason !== 'checkout_quarantine';
  const lpNotQuarantined = finalLP.checkout_quarantined !== true;
  const skipped = result.body.skipped === 'already_captured';

  const passed = purchaseNotExpired && listingNotQuarantined && lpNotQuarantined && skipped;
  return { name: 'captured_payments_never_expired_or_released', passed, purchase_not_expired: purchaseNotExpired, listing_not_quarantined: listingNotQuarantined, lp_not_quarantined: lpNotQuarantined, skipped };
}

// ── 10. No duplicate provider delivery ───────────────────────────────────
async function testNoDuplicateProviderDelivery() {
  const { seed, listingId, token, piId, purchaseId, buyerEmail, sellerEmail } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'requires_payment_method',
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  const event = { id: 'evt_no_dup_1', type: 'payment_intent.payment_failed', data: { object: { id: piId } } };

  // Deliver the same event 3 times
  await runStripeWebhook(deps, event);
  await runStripeWebhook(deps, event);
  await runStripeWebhook(deps, event);

  // Now dispatch webhook notifications
  const dispatchResult = await dispatchWebhookNotifications(deps, {
    keys: [`webhook:payment_failed:evt_no_dup_1`],
  });

  // At most 1 push send
  const providerCalls = deps._state.providerCalls;
  const atMostOnePush = providerCalls.push <= 1;

  const passed = atMostOnePush && dispatchResult.dispatched <= 1;
  return { name: 'no_duplicate_provider_delivery', passed, push_calls: providerCalls.push, dispatched: dispatchResult.dispatched, superseded: dispatchResult.superseded };
}

// ── Schema validation ─────────────────────────────────────────────────────
function testSchemaSupportsQuarantine() {
  const listingSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'Listing.jsonc'), 'utf8');
  const lpSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'ListingPrivate.jsonc'), 'utf8');
  const ppSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'PurchasePrivate.jsonc'), 'utf8');
  const passed = listingSchema.includes('"checkout_quarantine"') &&
    lpSchema.includes('"checkout_quarantined"') &&
    ppSchema.includes('"payment_captured"') &&
    ppSchema.includes('"authorization_confirmed_at"');
  return { name: 'schema_supports_quarantine_and_capture', passed };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  const tests = [
    testSchemaSupportsQuarantine(),
    await testOldFailedEventAfterNewerReservation(),
    await testPaymentFailedAfterSucceededOrCapture(),
    await testPublicCapturedPrivateFalseRetryRepair(),
    await testPrivateWriteFailureCausesRetry(),
    await testDuplicateConcurrentWebhookEvents(),
    await testMissingDivergentSidecars(),
    await testStalePublicAuthorizationMarker(),
    await testReservationMetadataMismatch(),
    await testCapturedPaymentsNeverExpiredOrReleased(),
    await testNoDuplicateProviderDelivery(),
  ];

  console.log('=== Payment & Webhook Fail-Closed Tests (7C.9) ===\n');

  let allPassed = true;
  for (const t of tests) {
    const status = t.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${t.name}`);
    for (const [key, val] of Object.entries(t)) {
      if (key !== 'name' && key !== 'passed' && key !== 'scenarios') {
        console.log(`  ${key}: ${JSON.stringify(val)}`);
      }
    }
    if (t.scenarios) {
      for (const s of t.scenarios) {
        const sStatus = s.passed ? 'PASS' : 'FAIL';
        console.log(`  [${sStatus}] ${s.scenario || s.piStatus}`);
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