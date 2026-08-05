/**
 * Shared mock infrastructure for 7C.9C.2 behavioral tests.
 * Provides mock Stripe, entity stores, and dependency injection.
 */
import { initializeLegacyRevision, durableBlockAndAlert, generateRevision } from '../../base44/shared/orchestratorHelpers.js';
import { freezeCapturedPayment, finalizeCapturedPayment } from '../../base44/shared/captureReconciliation.js';
import { runReserveListing } from '../../base44/shared/reserveOrchestrator.js';
import { runReleaseReservation } from '../../base44/shared/releaseOrchestrator.js';
import { runAbortCheckout } from '../../base44/shared/abortOrchestrator.js';
import { runCancelPurchase } from '../../base44/shared/cancelOrchestrator.js';
import { runProcessTransferReminders } from '../../base44/shared/remindersOrchestrator.js';
import { applyReservationTuple, generateClearedRevision } from '../../base44/shared/tupleTransition.js';

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => `uuid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` };
}

export {
  initializeLegacyRevision, durableBlockAndAlert, generateRevision,
  freezeCapturedPayment, finalizeCapturedPayment,
  runReserveListing, runReleaseReservation, runAbortCheckout, runCancelPurchase, runProcessTransferReminders,
  applyReservationTuple, generateClearedRevision,
};

// ── Mock Stripe ──────────────────────────────────────────────────────────────
export function createMockStripe(config = {}) {
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
      } else if (value && typeof value === 'object' && !Array.isArray(value) && value.$gte) {
        if (!record[key] || record[key] < value.$gte) return false;
      } else if (value && typeof value === 'object' && !Array.isArray(value) && value.$lte) {
        if (!record[key] || record[key] > value.$lte) return false;
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

export function createMockDeps(config = {}) {
  const stores = { Listing: [], ListingPrivate: [], Purchase: [], PurchasePrivate: [], User: [], UserSecurityProfile: [], AdminAlert: [], Notification: [] };
  const hooks = config.hooks || {};
  const providerCalls = { push: 0, email: 0 };
  const silentDropFields = config.silentDropFields || {};
  const filterHooks = config.filterHooks || {};

  function createStore(name) {
    return {
      filter: async (query, sort, limit, skip) => {
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
        if (hooks[`after_${name}_create`]) hooks[`after_${name}_create`](record);
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
    generateRevision: config.generateRevision,
    hooks: config.hooks || {},
    sendUserNotification: config.sendUserNotification || (async () => { providerCalls.push++; providerCalls.email++; return { push: { sent: true }, email: { sent: true } }; }),
    _state: { stores, hooks, providerCalls, silentDropFields, filterHooks },
  };
  return deps;
}

// ── Seed helpers ──────────────────────────────────────────────────────────
export function createDefaultSeed(o = {}) {
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

export function seedStripePI(stripe, piId, opts = {}) {
  stripe.pisById.set(piId, {
    id: piId, client_secret: `secret_${piId}`,
    status: opts.status || 'requires_payment_method',
    amount: opts.amount || 10500, currency: 'usd',
    metadata: opts.metadata || {},
    transfer_data: opts.transfer_data,
  });
}

// ── Test runner helper ────────────────────────────────────────────────────
export async function runTestSuite(suiteName, tests) {
  console.log(`=== ${suiteName} ===\n`);
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
        console.log(`  [${sStatus}] ${s.case || s.label}`);
      }
    }
    console.log();
    if (!t.passed) allPassed = false;
  }
  console.log(`=== Overall: ${allPassed ? 'PASS' : 'FAIL'} ===`);
  console.log(`Tests run: ${tests.length}, Passed: ${tests.filter(t => t.passed).length}, Failed: ${tests.filter(t => !t.passed).length}`);
  if (!allPassed) process.exit(1);
}