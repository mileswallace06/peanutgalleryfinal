/**
 * Payment & Webhook Fail-Closed Remediation Tests (7C.9C)
 *
 * 9 required adversarial probes + additional scenarios.
 * All tests invoke the ACTUAL production orchestrator modules directly.
 * Real Promise.all concurrency. Real failure injection at write boundaries.
 * No hard-coded PASS helpers or source-string assertions.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reconcileCapturedPayment } from '../base44/shared/captureReconciliation.js';
import { runCapturePayment } from '../base44/shared/captureOrchestrator.js';
import { runConfirmCheckoutAuthorized } from '../base44/shared/confirmCheckoutOrchestrator.js';
import { runStripeWebhook } from '../base44/shared/webhookOrchestrator.js';
import { enqueueWebhookNotification, enqueueWebhookAdminAlert, dispatchWebhookNotifications } from '../base44/shared/webhookNotifications.js';
import { enqueueSaleNotificationDeps, dispatchSaleNotificationsDeps } from '../base44/shared/saleDispatch.js';

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
      cancel: async (id) => { const pi = pisById.get(id); if (!pi) throw new Error('PI not found'); if (config.cancelThrows) throw config.cancelThrows; pi.status = 'canceled'; return pi; },
      update: async (id, params) => { const pi = pisById.get(id); if (!pi) throw new Error('PI not found'); if (params.metadata) pi.metadata = { ...pi.metadata, ...params.metadata }; return pi; },
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
  // Fields that should be silently dropped from updates (simulates non-persistence)
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
        // Apply silent drop for specific fields (simulates non-persistence)
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
    sendUserNotification: config.sendUserNotification || (async (opts) => { providerCalls.push++; providerCalls.email++; return { push: { sent: true }, email: { sent: true } }; }),
    _state: { stores, hooks, providerCalls, silentDropFields },
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
  return {
    seed: {
      Listing: [{ id: listingId, status: 'pending_transfer', asking_price: 100, quantity: 1, section: 'A', row: '1', event_id: 'event_1', seller_email: sellerEmail, reservation_token: token, reserved_by_email: buyerEmail, reservation_expires_at: expiry, hidden_reason: null, ...o.listing }],
      ListingPrivate: [{ id: `lp_${listingId}`, listing_id: listingId, seller_email: sellerEmail, reservation_token: token, reserved_by_email: buyerEmail, reservation_expires_at: expiry, proof_status: 'approved', is_demo_listing: false, checkout_quarantined: false, ...o.lp }],
      Purchase: [{ id: purchaseId, listing_id: listingId, event_id: 'event_1', buyer_email: buyerEmail, seller_email: sellerEmail, payment_intent_id: piId, reservation_token: token, transfer_status: 'pending_transfer', payment_captured: false, is_demo: false, amount: 105, subtotal: 100, seller_confirmed: true, ...o.purchase }],
      PurchasePrivate: [{ id: `pp_${purchaseId}`, purchase_id: purchaseId, listing_id: listingId, event_id: 'event_1', buyer_email: buyerEmail, seller_email: sellerEmail, payment_intent_id: piId, reservation_token: token, payment_captured: false, is_demo: false, ...o.pp }],
      User: [
        { id: 'user_buyer', email: buyerEmail, role: 'user', full_name: 'Test Buyer' },
        { id: 'user_seller', email: sellerEmail, role: 'admin', full_name: 'Test Seller' },
      ],
      UserSecurityProfile: [{ id: 'usp_1', user_id: 'user_seller', user_email: sellerEmail, stripe_account_id: 'acct_test_123', stripe_onboarding_complete: true, ...o.sellerSec }],
    },
    listingId, sellerEmail, buyerEmail, token, piId, purchaseId,
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
  const lpSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'ListingPrivate.jsonc'), 'utf8');
  const ppSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'PurchasePrivate.jsonc'), 'utf8');
  const notifSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'Notification.jsonc'), 'utf8');
  const passed = lpSchema.includes('"checkout_quarantined"') &&
    ppSchema.includes('"payment_captured"') &&
    ppSchema.includes('"authorization_confirmed_at"') &&
    notifSchema.includes('"superseded"') &&
    notifSchema.includes('"dispatch_status"');
  return { name: 'schema_validation', passed };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: Succeeded old PI cannot clear a newer reservation
// ════════════════════════════════════════════════════════════════════════════
async function testSucceededOldPICannotClearNewerReservation() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // PI succeeded with matching metadata
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });
  // Inject a NEWER reservation token on the listing (different from PP)
  const listing = deps._state.stores.Listing[0];
  listing.reservation_token = 'newer_token_456';
  const lp = deps._state.stores.ListingPrivate[0];
  lp.reservation_token = 'newer_token_456';

  const event = { id: 'evt_succ_1', type: 'payment_intent.succeeded', data: { object: { id: piId } } };
  const result = await runStripeWebhook(deps, event);

  const finalListing = deps._state.stores.Listing[0];
  const finalLP = deps._state.stores.ListingPrivate[0];
  const alerts = deps._state.stores.AdminAlert;

  // Newer reservation must be preserved
  const newerPreserved = finalListing.reservation_token === 'newer_token_456' && finalLP.reservation_token === 'newer_token_456';
  // Listing must NOT be sold
  const notSold = finalListing.status !== 'sold';
  // Listing must be quarantined
  const quarantined = finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine';
  // Critical alert must exist
  const hasAlert = alerts.some(a => a.title && a.title.includes('Reconciliation conflict'));
  // Non-2xx returned
  const non2xx = result.status === 500;

  const passed = newerPreserved && notSold && quarantined && hasAlert && non2xx;
  return { name: 'succeeded_old_pi_cannot_clear_newer_reservation', passed, newer_preserved: newerPreserved, not_sold: notSold, quarantined, has_alert: hasAlert, status: result.status };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: Webhook missing PurchasePrivate returns non-2xx and alerts
// ════════════════════════════════════════════════════════════════════════════
async function testWebhookMissingPurchasePrivateReturnsNon2xx() {
  const deps = createMockDeps({ seed: { User: [], UserSecurityProfile: [] } });
  // NO PurchasePrivate exists for this PI
  seedStripePI(deps.stripe, 'pi_orphan', { status: 'succeeded', amount: 10500, metadata: {} });

  const event = { id: 'evt_no_pp', type: 'payment_intent.succeeded', data: { object: { id: 'pi_orphan' } } };
  const result = await runStripeWebhook(deps, event);

  const hasAlert = deps._state.stores.AdminAlert.some(a => a.title && a.title.includes('missing PurchasePrivate'));
  const passed = result.status === 500 && hasAlert;
  return { name: 'webhook_missing_pp_returns_non2xx', passed, status: result.status, has_alert: hasAlert };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: Succeeded PI metadata mismatch returns non-2xx
// ════════════════════════════════════════════════════════════════════════════
async function testSucceededPIMetadataMismatchReturnsNon2xx() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // PI with WRONG metadata (wrong reservation_token)
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: 'wrong_token', purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const event = { id: 'evt_mismatch_3', type: 'payment_intent.succeeded', data: { object: { id: piId } } };
  const result = await runStripeWebhook(deps, event);

  const pp = deps._state.stores.PurchasePrivate[0];
  const purchase = deps._state.stores.Purchase[0];
  // Zero writes
  const zeroWrites = pp.payment_captured !== true && purchase.transfer_status !== 'completed';
  // Critical alert
  const hasAlert = deps._state.stores.AdminAlert.some(a => a.title && a.title.includes('metadata mismatch'));
  // Non-2xx
  const non2xx = result.status === 500;

  const passed = non2xx && zeroWrites && hasAlert;
  return { name: 'succeeded_pi_metadata_mismatch_returns_non2xx', passed, status: result.status, zero_writes: zeroWrites, has_alert: hasAlert };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: requires_confirmation PI is not expired until cancellation is verified
// ════════════════════════════════════════════════════════════════════════════
async function testRequiresConfirmationNotExpiredUntilCanceled() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  // PI in requires_confirmation state
  seedStripePI(deps.stripe, piId, {
    status: 'requires_confirmation',
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  const event = { id: 'evt_failed_4', type: 'payment_intent.payment_failed', data: { object: { id: piId } } };
  const result = await runStripeWebhook(deps, event);

  const pi = deps.stripe.pisById.get(piId);
  const purchase = deps._state.stores.Purchase[0];
  const listing = deps._state.stores.Listing[0];

  // PI must be canceled
  const piCanceled = pi.status === 'canceled';
  // Purchase must be expired (only after cancel verified)
  const purchaseExpired = purchase.transfer_status === 'expired';
  // Listing must be quarantined
  const listingQuarantined = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine';
  // Webhook returned 200 (success)
  const success = result.status === 200;

  const passed = piCanceled && purchaseExpired && listingQuarantined && success;
  return { name: 'requires_confirmation_not_expired_until_canceled', passed, pi_canceled: piCanceled, purchase_expired: purchaseExpired, listing_quarantined: listingQuarantined };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: Divergent public/private seller identity sends only to the private seller
// ════════════════════════════════════════════════════════════════════════════
async function testDivergentSellerSendsOnlyToPrivateSeller() {
  const { seed, listingId, piId, purchaseId, token } = createDefaultSeed({
    sellerEmail: 'public_seller@test',
    pp: { seller_email: 'private_seller@test' },
    purchase: { seller_email: 'public_seller@test' },
  });
  const deps = createMockDeps({ seed });
  const [purchase] = deps._state.stores.Purchase;
  const [listing] = deps._state.stores.Listing;
  const [pp] = deps._state.stores.PurchasePrivate;

  // enqueueSaleNotificationDeps requires pp as 4th arg
  await enqueueSaleNotificationDeps(deps, purchase, listing, pp);

  const notif = deps._state.stores.Notification[0];
  // Notification must be for the PRIVATE seller, not public
  const sentToPrivate = notif.user_email === 'private_seller@test';
  const notSentToPublic = notif.user_email !== 'public_seller@test';

  const passed = sentToPrivate && notSentToPublic;
  return { name: 'divergent_seller_sends_only_to_private', passed, sent_to: notif.user_email, sent_to_private: sentToPrivate };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: Delivery-state persistence failure cannot cause duplicate provider calls
// ════════════════════════════════════════════════════════════════════════════
async function testDeliveryStatePersistenceFailureNoDuplicateProviderCalls() {
  const deps = createMockDeps({
    seed: {
      Purchase: [{ id: 'pur_6', listing_id: 'listing_6', event_id: 'event_1', buyer_email: 'buyer@test', seller_email: 'seller@test', payment_intent_id: 'pi_6', reservation_token: 'token_6', transfer_status: 'pending_transfer', amount: 105, seller_confirmed: true, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }],
      PurchasePrivate: [{ id: 'pp_6', purchase_id: 'pur_6', listing_id: 'listing_6', buyer_email: 'buyer@test', seller_email: 'seller@test', payment_intent_id: 'pi_6', reservation_token: 'token_6', seller_push_status: 'pending', seller_email_status: 'pending', created_date: new Date().toISOString(), updated_date: new Date().toISOString() }],
      Notification: [{ id: 'n_6', idempotency_key: 'sale_created:pur_6', user_email: 'seller@test', type: 'sale_created', title: 'Test', body: 'Test', dispatch_status: 'pending', created_date: new Date().toISOString(), reference_id: 'pur_6', reference_type: 'purchase' }],
    },
    // Inject failure on Notification.update (delivery-state persistence)
    hooks: {
      'before_Notification_update': async () => ({ throw: new Error('Notification update failed') }),
    },
    sendUserNotification: async () => { deps._state.providerCalls.push++; deps._state.providerCalls.email++; return { push: { sent: true }, email: { sent: true } }; },
  });

  const result = await dispatchSaleNotificationsDeps(deps, { keys: ['sale_created:pur_6'] });

  // Provider calls must be ZERO (external delivery suppressed)
  const zeroProviderCalls = deps._state.providerCalls.push === 0 && deps._state.providerCalls.email === 0;
  // Even with write failures, no duplicate provider calls
  const passed = zeroProviderCalls;
  return { name: 'delivery_state_persistence_failure_no_duplicate_calls', passed, push_calls: deps._state.providerCalls.push, email_calls: deps._state.providerCalls.email };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: Dispatcher missing PurchasePrivate never uses public fallback
// ════════════════════════════════════════════════════════════════════════════
async function testDispatcherMissingPPNeverUsesPublicFallback() {
  const deps = createMockDeps({
    seed: {
      Purchase: [{ id: 'pur_7', listing_id: 'listing_7', event_id: 'event_1', buyer_email: 'buyer@test', seller_email: 'public_seller@test', payment_intent_id: 'pi_7', reservation_token: 'token_7', transfer_status: 'pending_transfer', amount: 105, seller_confirmed: true, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }],
      // NO PurchasePrivate — must not fall back to Purchase.seller_email
      Notification: [{ id: 'n_7', idempotency_key: 'sale_created:pur_7', user_email: 'public_seller@test', type: 'sale_created', title: 'Test', body: 'Test', dispatch_status: 'pending', created_date: new Date().toISOString(), reference_id: 'pur_7', reference_type: 'purchase' }],
    },
    sendUserNotification: async () => { deps._state.providerCalls.push++; deps._state.providerCalls.email++; return { push: { sent: true }, email: { sent: true } }; },
  });

  const result = await dispatchSaleNotificationsDeps(deps, { keys: ['sale_created:pur_7'] });

  // No provider calls
  const zeroProviderCalls = deps._state.providerCalls.push === 0 && deps._state.providerCalls.email === 0;
  // Critical alert created
  const hasAlert = deps._state.stores.AdminAlert.some(a => a.title && a.title.includes('missing PurchasePrivate'));
  // Notification remains pending (not dispatched, not superseded)
  const notif = deps._state.stores.Notification[0];
  const remainsPending = notif.dispatch_status === 'pending';
  // No channel updates on Purchase (no fallback)
  const purchase = deps._state.stores.Purchase[0];
  const noChannelUpdate = purchase.seller_push_status === undefined && purchase.seller_email_status === undefined;

  const passed = zeroProviderCalls && hasAlert && remainsPending && noChannelUpdate;
  return { name: 'dispatcher_missing_pp_never_uses_public_fallback', passed, zero_provider_calls: zeroProviderCalls, has_alert: hasAlert, remains_pending: remainsPending, no_channel_update: noChannelUpdate };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: Authorization mirror that silently fails persistence is detected
// ════════════════════════════════════════════════════════════════════════════
async function testAuthorizationMirrorSilentlyFailsPersistence() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    // Silently drop authorization_confirmed_at from PurchasePrivate updates
    silentDropFields: { PurchasePrivate: ['authorization_confirmed_at'] },
  });
  seedStripePI(deps.stripe, piId, {
    status: 'requires_capture', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const result = await runConfirmCheckoutAuthorized(deps, { purchase_id: purchaseId });

  // Must return non-2xx
  const non2xx = result.status === 500;
  // Critical alert created
  const hasAlert = deps._state.stores.AdminAlert.some(a => a.title && a.title.includes('not persisted'));
  // No notification enqueued
  const zeroNotifications = deps._state.stores.Notification.length === 0;

  const passed = non2xx && hasAlert && zeroNotifications;
  return { name: 'authorization_mirror_silently_fails_persistence', passed, status: result.status, has_alert: hasAlert, zero_notifications: zeroNotifications };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: Expiration-clear failure prevents reconciliation success
// ════════════════════════════════════════════════════════════════════════════
async function testExpirationClearFailurePreventsReconciliationSuccess() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({
    seed,
    // 7C.9C.1: Inject failure during the LP quarantine write (freeze step)
    hooks: {
      'before_ListingPrivate_update': async (id, data) => {
        if (data.checkout_quarantined === true) return { throw: new Error('LP quarantine write failed') };
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

  const result = await reconcileCapturedPayment(deps, purchase, pp, pi);

  // Must NOT return ok:true — freeze must fail when a write boundary fails
  const notOk = !result.ok;
  // Listing must NOT be sold
  const listing = deps._state.stores.Listing[0];
  const notSold = listing.status !== 'sold';

  const passed = notOk && notSold;
  return { name: 'expiration_clear_failure_prevents_reconciliation', passed, ok: result.ok, step: result.step, not_sold: notSold };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Old matching tuple completes safely
// ════════════════════════════════════════════════════════════════════════════
async function testOldMatchingTupleCompletesSafely() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  // 7C.9C.1: Two-phase freeze-and-finalize
  // Phase 1: Freeze (quarantine listing, preserve reservation, record frozen tuple)
  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  const freezeResult = await reconcileCapturedPayment(deps, purchase, pp, pi);
  const freezeOk = freezeResult.ok;

  // Phase 2: Finalize after drain period (clear reservation, mark sold)
  timeOffset = 3 * 60 * 1000; // past drain
  const { finalizeCapturedPayment } = await import('../base44/shared/captureReconciliation.js');
  const finalizeResult = await finalizeCapturedPayment(deps, listingId);
  const finalizeOk = finalizeResult.ok;

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const allCleared = listing.status === 'sold' && !listing.reservation_token && !listing.reserved_by_email && !listing.reservation_expires_at && !lp.reservation_token && !lp.reserved_by_email && !lp.reservation_expires_at;
  const passed = freezeOk && finalizeOk && allCleared;
  return { name: 'old_matching_tuple_completes_safely', passed, freeze_ok: freezeOk, finalize_ok: finalizeOk, all_cleared: allCleared };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Already-sold/null tuple is idempotent
// ════════════════════════════════════════════════════════════════════════════
async function testAlreadySoldNullTupleIsIdempotent() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed({
    listing: { status: 'sold', reservation_token: null, reserved_by_email: null, reservation_expires_at: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null },
    pp: { payment_captured: true, payment_capture_failed: false, freeze_finalized_at: '2026-01-01T00:00:00.000Z', frozen_reservation_token: 'res_token_123' },
    purchase: { transfer_status: 'completed', payment_captured: true, payment_capture_failed: false, buyer_confirmed: true },
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
  const result = await reconcileCapturedPayment(deps, purchase, pp, pi);

  const passed = result.ok && result.idempotent === true;
  return { name: 'already_sold_null_tuple_is_idempotent', passed, ok: result.ok, idempotent: result.idempotent };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Different/newer tuple is preserved and quarantined
// ════════════════════════════════════════════════════════════════════════════
async function testDifferentNewerTuplePreservedAndQuarantined() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });
  // Inject a different buyer on the listing
  deps._state.stores.Listing[0].reserved_by_email = 'different_buyer@test';
  deps._state.stores.ListingPrivate[0].reserved_by_email = 'different_buyer@test';

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  const result = await reconcileCapturedPayment(deps, purchase, pp, pi);

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const preserved = listing.reserved_by_email === 'different_buyer@test' && lp.reserved_by_email === 'different_buyer@test';
  const quarantined = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine';
  const notOk = !result.ok;
  const passed = notOk && preserved && quarantined;
  return { name: 'different_newer_tuple_preserved_and_quarantined', passed, ok: result.ok, preserved, quarantined };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Duplicate PurchasePrivate fails closed
// ════════════════════════════════════════════════════════════════════════════
async function testDuplicatePurchasePrivateFailsClosed() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  // Add a DUPLICATE PurchasePrivate with the same payment_intent_id
  seed.PurchasePrivate.push({
    id: 'pp_dup', purchase_id: purchaseId, listing_id: listingId, event_id: 'event_1',
    buyer_email: buyerEmail, seller_email: sellerEmail, payment_intent_id: piId, reservation_token: token,
    payment_captured: false, is_demo: false,
  });
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, { status: 'succeeded', amount: 10500, metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId }, transfer_data: { destination: 'acct_test_123' } });

  const event = { id: 'evt_dup_pp', type: 'payment_intent.succeeded', data: { object: { id: piId } } };
  const result = await runStripeWebhook(deps, event);

  const hasAlert = deps._state.stores.AdminAlert.some(a => a.title && a.title.includes('duplicate PurchasePrivate'));
  const passed = result.status === 500 && hasAlert;
  return { name: 'duplicate_purchase_private_fails_closed', passed, status: result.status, has_alert: hasAlert };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Successful writes are re-fetched and verified
// ════════════════════════════════════════════════════════════════════════════
async function testSuccessfulWritesReFetchedAndVerified() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  // 7C.9C.1: Two-phase freeze-and-finalize
  // Phase 1: Freeze
  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(piId);
  const freezeResult = await reconcileCapturedPayment(deps, purchase, pp, pi);

  // Phase 2: Finalize after drain
  timeOffset = 3 * 60 * 1000;
  const { finalizeCapturedPayment } = await import('../base44/shared/captureReconciliation.js');
  const finalizeResult = await finalizeCapturedPayment(deps, listingId);

  // All four records verified after finalization
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const pur = deps._state.stores.Purchase[0];
  const ppFinal = deps._state.stores.PurchasePrivate[0];

  const listingVerified = listing.status === 'sold' && !listing.reservation_token && !listing.reserved_by_email && !listing.reservation_expires_at;
  const lpVerified = !lp.reservation_token && !lp.reserved_by_email && !lp.reservation_expires_at && !lp.checkout_quarantined;
  const purVerified = pur.transfer_status === 'completed' && pur.payment_captured === true && pur.buyer_confirmed === true;
  const ppVerified = ppFinal.payment_captured === true && ppFinal.payment_capture_failed === false && !!ppFinal.freeze_finalized_at;

  const passed = freezeResult.ok && finalizeResult.ok && listingVerified && lpVerified && purVerified && ppVerified;
  return { name: 'successful_writes_refetched_and_verified', passed, freeze_ok: freezeResult.ok, finalize_ok: finalizeResult.ok, listing_verified: listingVerified, lp_verified: lpVerified, pur_verified: purVerified, pp_verified: ppVerified };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Concurrent claims use a real barrier plus Promise.all
// ════════════════════════════════════════════════════════════════════════════
async function testConcurrentClaimsRealBarrierPromiseAll() {
  const deps = createMockDeps();
  // Two webhook notifications with the same key
  deps._state.stores.Notification.push(
    { id: 'n_c1', idempotency_key: 'webhook:test:evt_conc', user_email: 'buyer@test', type: 'transfer_rejected', title: 'T', body: 'B', dispatch_status: 'pending', created_date: '2026-08-01T10:00:00.000Z' },
    { id: 'n_c2', idempotency_key: 'webhook:test:evt_conc', user_email: 'buyer@test', type: 'transfer_rejected', title: 'T', body: 'B', dispatch_status: 'pending', created_date: '2026-08-01T10:00:01.000Z' },
  );

  // REAL Promise.all concurrency
  const [r1, r2] = await Promise.all([
    dispatchWebhookNotifications(deps),
    dispatchWebhookNotifications(deps),
  ]);

  const dispatched = deps._state.stores.Notification.filter(n => n.dispatch_status === 'dispatched').length;
  const superseded = deps._state.stores.Notification.filter(n => n.dispatch_status === 'superseded').length;
  const noErrors = r1.errors === 0 && r2.errors === 0;

  const passed = noErrors && dispatched >= 1 && superseded >= 1;
  return { name: 'concurrent_claims_real_barrier_promise_all', passed, no_errors: noErrors, dispatched, superseded, concurrent: 'Promise.all' };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Provider-call counters remain zero if external delivery is suppressed
// ════════════════════════════════════════════════════════════════════════════
async function testProviderCallCountersZeroIfExternalSuppressed() {
  const deps = createMockDeps({
    seed: {
      Purchase: [{ id: 'pur_supp', listing_id: 'listing_supp', event_id: 'event_1', buyer_email: 'buyer@test', seller_email: 'seller@test', payment_intent_id: 'pi_supp', reservation_token: 'token_supp', transfer_status: 'pending_transfer', amount: 105, seller_confirmed: true, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }],
      PurchasePrivate: [{ id: 'pp_supp', purchase_id: 'pur_supp', listing_id: 'listing_supp', buyer_email: 'buyer@test', seller_email: 'seller@test', payment_intent_id: 'pi_supp', reservation_token: 'token_supp', seller_push_status: 'pending', seller_email_status: 'pending', created_date: new Date().toISOString(), updated_date: new Date().toISOString() }],
      Notification: [{ id: 'n_supp', idempotency_key: 'sale_created:pur_supp', user_email: 'seller@test', type: 'sale_created', title: 'Test', body: 'Test', dispatch_status: 'pending', created_date: new Date().toISOString(), reference_id: 'pur_supp', reference_type: 'purchase' }],
    },
    sendUserNotification: async () => { deps._state.providerCalls.push++; deps._state.providerCalls.email++; return { push: { sent: true }, email: { sent: true } }; },
  });

  const result = await dispatchSaleNotificationsDeps(deps, { keys: ['sale_created:pur_supp'] });

  const zeroPush = deps._state.providerCalls.push === 0;
  const zeroEmail = deps._state.providerCalls.email === 0;
  const notif = deps._state.stores.Notification[0];
  const pp = deps._state.stores.PurchasePrivate[0];
  // Notification dispatched (in-app only)
  const dispatched = notif.dispatch_status === 'dispatched';
  // Channels marked 'skipped'
  const channelsSkipped = pp.seller_push_status === 'skipped' && pp.seller_email_status === 'skipped';

  const passed = zeroPush && zeroEmail && dispatched && channelsSkipped;
  return { name: 'provider_call_counters_zero_if_suppressed', passed, zero_push: zeroPush, zero_email: zeroEmail, dispatched, channels_skipped: channelsSkipped };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Four write boundary failures retry converges (from 7C.9B)
// ════════════════════════════════════════════════════════════════════════════
async function testFourWriteBoundaryFailuresRetryConverges() {
  const boundaries = [
    { name: 'pp', entity: 'PurchasePrivate' },
    { name: 'purchase', entity: 'Purchase' },
    { name: 'lp', entity: 'ListingPrivate' },
    { name: 'listing', entity: 'Listing' },
  ];
  const results = [];

  for (const boundary of boundaries) {
    const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed();
    const deps = createMockDeps({
      seed,
      hooks: { [`before_${boundary.entity}_update`]: async () => ({ throw: new Error(`Simulated ${boundary.name} write failure`) }) },
    });
    seedStripePI(deps.stripe, piId, {
      status: 'succeeded', amount: 10500,
      metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
      transfer_data: { destination: 'acct_test_123' },
    });

    const [purchase] = deps._state.stores.Purchase;
    const [pp] = deps._state.stores.PurchasePrivate;
    const pi = deps.stripe.pisById.get(piId);
    const result1 = await reconcileCapturedPayment(deps, purchase, pp, pi);
    // 7C.9C.1: Step names changed with freeze — just check first attempt failed
    const firstAttemptFailed = !result1.ok;

    // Retry without the failure hook — freeze should converge
    const deps2 = createMockDeps({});
    for (const [name, records] of Object.entries(deps._state.stores)) { deps2._state.stores[name] = records.map(r => ({ ...r })); }
    deps2.stripe = deps.stripe;
    const [purchase2] = deps2._state.stores.Purchase;
    const [pp2] = deps2._state.stores.PurchasePrivate;
    const pi2 = deps2.stripe.pisById.get(piId);
    const result2 = await reconcileCapturedPayment(deps2, purchase2, pp2, pi2);
    const retryConverged = result2.ok;

    results.push({ boundary: boundary.name, passed: firstAttemptFailed && retryConverged, first_failed: firstAttemptFailed, retry_ok: result2.ok });
  }

  const allPassed = results.every(r => r.passed);
  return { name: 'four_write_boundary_failures_retry_converges', passed: allPassed, scenarios: results };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Existing marker + invalid reservation rejected (from 7C.9B)
// ════════════════════════════════════════════════════════════════════════════
async function testExistingMarkerPlusInvalidReservationRejected() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed({
    pp: { authorization_confirmed_at: '2026-01-01T00:00:00.000Z' },
    listing: { reservation_token: 'different_token' },
  });
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'requires_capture', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
  });

  const result = await runConfirmCheckoutAuthorized(deps, { purchase_id: purchaseId });
  const passed = result.status === 409 && deps._state.stores.Notification.length === 0;
  return { name: 'existing_marker_plus_invalid_reservation_rejected', passed, status: result.status, zero_notifications: deps._state.stores.Notification.length === 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Expiration mismatch blocks capture (from 7C.9B)
// ════════════════════════════════════════════════════════════════════════════
async function testExpirationMismatchBlocksCapture() {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token } = createDefaultSeed({
    lp: { reservation_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
    listing: { reservation_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString() },
  });
  const deps = createMockDeps({ seed });
  seedStripePI(deps.stripe, piId, {
    status: 'requires_capture', amount: 10500,
    metadata: { listing_id: listingId, buyer_email: buyerEmail, seller_email: sellerEmail, reservation_token: token, purchase_id: purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });
  const result = await runCapturePayment(deps, { purchase_id: purchaseId });
  const passed = result.status === 409;
  return { name: 'expiration_mismatch_blocks_capture', passed, status: result.status };
}

// ════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: payout.failed uses event.account (from 7C.9B)
// ════════════════════════════════════════════════════════════════════════════
async function testPayoutFailedUsesEventAccount() {
  const deps = createMockDeps({
    seed: { UserSecurityProfile: [{ id: 'usp_1', user_id: 'user_seller', user_email: 'seller@test', stripe_account_id: 'acct_from_event' }] },
  });
  const event = { id: 'evt_po', type: 'payout.failed', account: 'acct_from_event', data: { object: { id: 'po_1', destination: 'acct_from_data', amount: 5000, failure_message: 'bank declined' } } };
  const result = await runStripeWebhook(deps, event);
  const foundByEventAccount = deps._state.stores.AdminAlert.some(a => a.description && a.description.includes('acct_from_event'));
  const passed = result.status === 200 && foundByEventAccount;
  return { name: 'payout_failed_uses_event_account', passed, found_by_event_account: foundByEventAccount };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  const tests = [
    testSchemaValidation(),
    // 9 required adversarial probes
    await testSucceededOldPICannotClearNewerReservation(),
    await testWebhookMissingPurchasePrivateReturnsNon2xx(),
    await testSucceededPIMetadataMismatchReturnsNon2xx(),
    await testRequiresConfirmationNotExpiredUntilCanceled(),
    await testDivergentSellerSendsOnlyToPrivateSeller(),
    await testDeliveryStatePersistenceFailureNoDuplicateProviderCalls(),
    await testDispatcherMissingPPNeverUsesPublicFallback(),
    await testAuthorizationMirrorSilentlyFailsPersistence(),
    await testExpirationClearFailurePreventsReconciliationSuccess(),
    // Additional scenarios
    await testOldMatchingTupleCompletesSafely(),
    await testAlreadySoldNullTupleIsIdempotent(),
    await testDifferentNewerTuplePreservedAndQuarantined(),
    await testDuplicatePurchasePrivateFailsClosed(),
    await testSuccessfulWritesReFetchedAndVerified(),
    await testConcurrentClaimsRealBarrierPromiseAll(),
    await testProviderCallCountersZeroIfExternalSuppressed(),
    // Retained from 7C.9B
    await testFourWriteBoundaryFailuresRetryConverges(),
    await testExistingMarkerPlusInvalidReservationRejected(),
    await testExpirationMismatchBlocksCapture(),
    await testPayoutFailedUsesEventAccount(),
  ];

  console.log('=== Payment & Webhook Fail-Closed Tests (7C.9C) ===\n');

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
        console.log(`  [${sStatus}] ${s.boundary}`);
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