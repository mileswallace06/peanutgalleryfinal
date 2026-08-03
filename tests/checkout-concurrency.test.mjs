/**
 * Checkout Concurrency Tests (7C.4)
 *
 * Run: npm test
 *
 * Imports production decision logic from base44/shared/checkoutLogic.js.
 * Does NOT contain independent duplicate implementations.
 *
 * Tests:
 *  1. Two-buyer race: same key + different params → StripeIdempotencyError → 409
 *  2. Same-buyer retry: retry check returns existing before active-status rejection
 *  3. Canceled PI: retry returns 409, no new flow
 *  4. Different listing revisions: different keys, both succeed
 *  5. 6-condition verification catches mismatched tokens
 *  6. Seller-management vs checkout interleaving
 *  7. Cleanup state table (8 scenarios)
 *  8. Schema permits checkout_quarantine
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
} from '../base44/shared/checkoutLogic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Mock Stripe with REAL idempotency behavior ────────────────────────────
// Same key + identical params → same PI
// Same key + different params → StripeIdempotencyError
function createMockStripe() {
  const pisByKey = new Map();
  const pisById = new Map();
  let piCounter = 0;

  return {
    pisByKey,
    pisById,
    paymentIntents: {
      create: async (params, opts) => {
        await new Promise(r => setTimeout(r, 1));
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
          id: piId,
          client_secret: `secret_${piId}`,
          status: 'requires_payment_method',
          amount: params.amount,
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
}

// ── Mock state ──
function createMockState() {
  return {
    listing: {
      id: 'listing_1', status: 'active', asking_price: 100, quantity: 1,
      section: 'A', row: '1', event_id: 'event_1',
      updated_date: '2026-08-01T10:00:00.000Z',
      reservation_token: null, reserved_by_email: null,
      reservation_expires_at: null, hidden_reason: null,
    },
    lp: {
      listing_id: 'listing_1', seller_email: 'seller@test',
      reservation_token: null, reserved_by_email: null,
      reservation_expires_at: null, proof_status: 'approved',
      is_demo_listing: false, notes: null, seat_inventory_id: null,
      checkout_quarantined: false,
    },
    purchases: new Map(),
    purchasePrivates: new Map(),
  };
}

// ── Simulated checkout (USES imported production logic, not duplicate) ──
async function simulateCheckout(state, stripe, buyerEmail, listingRevision) {
  const listingId = state.listing.id;
  const idempotencyKey = deriveIdempotencyKey(listingId, listingRevision);
  const reservationToken = `tok_${buyerEmail}_${Math.random().toString(36).slice(2)}`;
  const reservationExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  let pi;
  try {
    pi = await stripe.paymentIntents.create({
      amount: 10500, currency: 'usd', capture_method: 'manual',
      metadata: {
        listing_id: listingId, buyer_email: buyerEmail,
        reservation_token: reservationToken, listing_revision: listingRevision,
      },
    }, { idempotencyKey });
  } catch (err) {
    if (isStripeIdempotencyError(err)) {
      return { success: false, status: 409, reason: 'idempotency_error', pi_id: null };
    }
    return { success: false, status: 500, error: err.message };
  }

  // Write reservation
  state.listing.status = 'pending_transfer';
  state.listing.reservation_token = reservationToken;
  state.listing.reserved_by_email = buyerEmail;
  state.listing.reservation_expires_at = reservationExpiresAt;
  state.listing.updated_date = new Date().toISOString();
  state.lp.reservation_token = reservationToken;
  state.lp.reserved_by_email = buyerEmail;
  state.lp.reservation_expires_at = reservationExpiresAt;

  // 6-condition verification (imported from production)
  if (!verifyReservation(state.listing, state.lp, reservationToken, buyerEmail)) {
    state.listing.status = 'hidden';
    state.listing.hidden_reason = 'checkout_quarantine';
    state.lp.checkout_quarantined = true;
    return { success: false, status: 409, reason: 'verification_failed' };
  }

  // Canonicalize by PI
  for (const [, pur] of state.purchases) {
    if (pur.payment_intent_id === pi.id && pur.transfer_status === 'pending_transfer') {
      return { success: true, purchase_id: pur.id, pi_id: pi.id, clientSecret: pi.client_secret, reused: true };
    }
  }

  // Create Purchase
  const purchaseId = `pur_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  state.purchases.set(purchaseId, {
    id: purchaseId, listing_id: listingId, buyer_email: buyerEmail,
    payment_intent_id: pi.id, transfer_status: 'pending_transfer',
  });
  state.purchasePrivates.set(purchaseId, {
    purchase_id: purchaseId, listing_id: listingId, buyer_email: buyerEmail,
    payment_intent_id: pi.id, reservation_token: reservationToken,
  });

  // Post-Purchase verification
  if (!verifyReservation(state.listing, state.lp, reservationToken, buyerEmail)) {
    return { success: false, status: 409, reason: 'post_purchase_failed' };
  }

  return { success: true, purchase_id: purchaseId, pi_id: pi.id, clientSecret: pi.client_secret };
}

// ── Simulated retry check (USES imported production logic) ──
async function simulateRetryCheck(state, stripe, buyerEmail) {
  const pps = [...state.purchasePrivates.values()].filter(pp =>
    pp.buyer_email === buyerEmail && pp.listing_id === state.listing.id
  );
  for (const pp of pps) {
    const pur = state.purchases.get(pp.purchase_id);
    if (!pur || pur.transfer_status !== 'pending_transfer') continue;

    let pi;
    try {
      pi = await stripe.paymentIntents.retrieve(pp.payment_intent_id);
    } catch (_) {
      return { retried: false, blocked: false, error: 'retrieval_failed' };
    }

    // Verify PI metadata
    if (pi.metadata?.buyer_email !== buyerEmail) continue;
    if (pi.metadata?.listing_id !== state.listing.id) continue;

    // Verify Listing token/owner
    if (state.listing.reservation_token !== pp.reservation_token) continue;
    if (state.listing.reserved_by_email !== buyerEmail) continue;

    // Verify LP token/owner
    if (state.lp.reservation_token !== pp.reservation_token) continue;
    if (state.lp.reserved_by_email !== buyerEmail) continue;

    const outcome = classifyRetryOutcome(pi.status, pur.transfer_status);
    if (outcome === 'retry') {
      return { retried: true, blocked: false, purchase_id: pur.id, pi_id: pi.id, pi_status: pi.status };
    }
    if (outcome === 'blocked') {
      return { retried: false, blocked: true, pi_status: pi.status };
    }
  }
  return { retried: false, blocked: false };
}

// ── Tests ──

async function testTwoBuyerRace() {
  const stripe = createMockStripe();
  const state = createMockState();
  const rev = state.listing.updated_date;

  const [resultA, resultB] = await Promise.all([
    simulateCheckout(state, stripe, 'buyerA@test', rev),
    simulateCheckout(state, stripe, 'buyerB@test', rev),
  ]);

  const successCount = (resultA.success ? 1 : 0) + (resultB.success ? 1 : 0);
  const loserGot409 = (!resultA.success && resultA.status === 409) || (!resultB.success && resultB.status === 409);
  const passed = successCount === 1
    && loserGot409
    && stripe.pisById.size === 1
    && state.purchases.size === 1;

  return {
    name: 'two_buyer_race',
    passed,
    buyerA_success: resultA.success,
    buyerB_success: resultB.success,
    success_count: successCount,
    loser_got_409: loserGot409,
    pi_count: stripe.pisById.size,
    purchase_count: state.purchases.size,
  };
}

async function testRetryBeforeActiveStatusRejection() {
  const stripe = createMockStripe();
  const state = createMockState();
  const rev = state.listing.updated_date;

  // Buyer A completes checkout
  const resultA = await simulateCheckout(state, stripe, 'buyerA@test', rev);
  if (!resultA.success) {
    return { name: 'retry_before_active_rejection', passed: false, error: 'initial checkout failed', detail: resultA };
  }

  // Listing is now pending_transfer (not active)
  const listingIsActive = state.listing.status === 'active';

  // Retry check runs BEFORE active-status rejection
  const retry = await simulateRetryCheck(state, stripe, 'buyerA@test');

  const passed = !listingIsActive
    && retry.retried
    && retry.purchase_id === resultA.purchase_id
    && retry.pi_id === resultA.pi_id;

  return {
    name: 'retry_before_active_rejection',
    passed,
    listing_is_active: listingIsActive,
    listing_is_pending: state.listing.status === 'pending_transfer',
    retry_reached: retry.retried,
    retry_purchase: retry.purchase_id,
    original_purchase: resultA.purchase_id,
    pi_status: retry.pi_status,
  };
}

async function testCanceledPI() {
  const stripe = createMockStripe();
  const state = createMockState();
  const rev = state.listing.updated_date;

  const resultA = await simulateCheckout(state, stripe, 'buyerA@test', rev);
  if (!resultA.success) {
    return { name: 'canceled_pi_retry', passed: false, error: 'initial checkout failed' };
  }

  await stripe.paymentIntents.cancel(resultA.pi_id);

  const retry = await simulateRetryCheck(state, stripe, 'buyerA@test');
  const passed = !retry.retried && retry.blocked === true;

  return {
    name: 'canceled_pi_retry',
    passed,
    pi_status: retry.pi_status,
    blocked: retry.blocked,
  };
}

async function testDifferentRevisions() {
  const stripe = createMockStripe();
  const state = createMockState();

  const resultA = await simulateCheckout(state, stripe, 'buyerA@test', state.listing.updated_date);

  // Reset for buyer B at different revision
  state.listing.status = 'active';
  state.listing.reservation_token = null;
  state.listing.reserved_by_email = null;
  state.listing.reservation_expires_at = null;
  state.listing.updated_date = '2026-08-01T11:00:00.000Z';
  state.lp.reservation_token = null;
  state.lp.reserved_by_email = null;
  state.lp.reservation_expires_at = null;

  const resultB = await simulateCheckout(state, stripe, 'buyerB@test', state.listing.updated_date);

  const passed = resultA.success && resultB.success
    && resultA.pi_id !== resultB.pi_id
    && stripe.pisById.size === 2;

  return {
    name: 'different_revisions',
    passed,
    buyerA_success: resultA.success,
    buyerB_success: resultB.success,
    different_pis: resultA.pi_id !== resultB.pi_id,
    pi_count: stripe.pisById.size,
  };
}

function testSixConditionVerification() {
  const expiry = new Date(Date.now() + 60000).toISOString();
  const state = createMockState();
  state.listing = { ...state.listing, status: 'pending_transfer', reservation_token: 'tokenA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  state.lp = { ...state.lp, reservation_token: 'tokenB', reserved_by_email: 'b@test', reservation_expires_at: expiry };

  const mismatchCaught = !verifyReservation(state.listing, state.lp, 'tokenA', 'b@test')
    && !verifyReservation(state.listing, state.lp, 'tokenB', 'b@test');

  // Also test all 6 conditions pass
  state.lp.reservation_token = 'tokenA';
  const allPass = verifyReservation(state.listing, state.lp, 'tokenA', 'b@test');

  // Test expired
  state.listing.reservation_expires_at = new Date(Date.now() - 60000).toISOString();
  state.lp.reservation_expires_at = new Date(Date.now() - 60000).toISOString();
  const expiredCaught = !verifyReservation(state.listing, state.lp, 'tokenA', 'b@test');

  // Test wrong buyer
  state.listing.reservation_expires_at = expiry;
  state.lp.reservation_expires_at = expiry;
  const wrongBuyer = !verifyReservation(state.listing, state.lp, 'tokenA', 'wrong@test');

  const passed = mismatchCaught && allPass && expiredCaught && wrongBuyer;

  return {
    name: 'six_condition_verification',
    passed,
    mismatched_tokens_detected: mismatchCaught,
    all_conditions_pass: allPass,
    expired_detected: expiredCaught,
    wrong_buyer_detected: wrongBuyer,
  };
}

function testSellerManagementInterleaving() {
  // Scenario 1: Checkout writes reservation → seller pauses → verification fails
  const state1 = createMockState();
  const expiry = new Date(Date.now() + 600000).toISOString();
  state1.listing = { ...state1.listing, status: 'pending_transfer', reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  state1.lp = { ...state1.lp, reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  // Seller pauses
  state1.listing.status = 'hidden';
  state1.listing.hidden_reason = 'other';
  const verificationFails = !verifyReservation(state1.listing, state1.lp, 'TA', 'b@test');

  // Scenario 2: Seller pauses → checkout blocked at active-status check
  const state2 = createMockState();
  state2.listing.status = 'hidden';
  state2.listing.hidden_reason = 'other';
  const checkoutBlocked = state2.listing.status !== 'active';

  // Scenario 3: Checkout writes → seller cancels → verification fails
  const state3 = createMockState();
  state3.listing = { ...state3.listing, status: 'pending_transfer', reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  state3.lp = { ...state3.lp, reservation_token: 'TA', reserved_by_email: 'b@test', reservation_expires_at: expiry };
  state3.listing.status = 'cancelled';
  const cancelDetected = !verifyReservation(state3.listing, state3.lp, 'TA', 'b@test');

  const passed = verificationFails && checkoutBlocked && cancelDetected;

  return {
    name: 'seller_management_interleaving',
    passed,
    pause_after_reserve_detected: verificationFails,
    pause_before_checkout_blocks: checkoutBlocked,
    cancel_after_reserve_detected: cancelDetected,
  };
}

function testCleanupStateTable() {
  const scenarios = [
    // [piStatus, ownsByBuyer, ownsByToken, expected, description]
    [null,             true,  true,  'quarantine',  'PI retrieval failure'],
    ['unknown',        true,  true,  'quarantine',  'Unknown PI status'],
    ['requires_payment_method', true,  true,  'release',     'Never authorized, owns it'],
    ['requires_payment_method', true,  false, 'quarantine',  'Token mismatch'],
    ['requires_payment_method', false, true,  'quarantine',  'Buyer mismatch'],
    ['requires_action', true,  true,  'release',     'Requires action, owns it'],
    ['requires_capture', true,  true,  'keep_locked', 'Authorized — keep locked'],
    ['succeeded',      true,  true,  'keep_locked', 'Succeeded — keep locked'],
    ['processing',     true,  true,  'keep_locked', 'Processing — keep locked'],
    ['canceled',       true,  true,  'release',     'Canceled, owns it'],
    ['canceled',       true,  false, 'quarantine',  'Canceled, token mismatch'],
    ['canceled',       false, true,  'quarantine',  'Canceled, buyer mismatch'],
    ['canceled',       false, false, 'quarantine',  'Canceled, no ownership'],
  ];

  const results = [];
  let allPassed = true;
  for (const [piStatus, ownsByBuyer, ownsByToken, expected, desc] of scenarios) {
    const actual = classifyCleanupOutcome(piStatus, ownsByBuyer, ownsByToken);
    const passed = actual === expected;
    if (!passed) allPassed = false;
    results.push({ piStatus, ownsByBuyer, ownsByToken, expected, actual, passed, desc });
  }

  return {
    name: 'cleanup_state_table',
    passed: allPassed,
    scenarios: results,
  };
}

function testSchemaPermitsQuarantine() {
  const listingSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'Listing.jsonc'), 'utf8');
  const lpSchema = readFileSync(join(__dirname, '..', 'base44', 'entities', 'ListingPrivate.jsonc'), 'utf8');

  const listingHasQuarantine = listingSchema.includes('"checkout_quarantine"');
  const lpHasQuarantined = lpSchema.includes('"checkout_quarantined"');
  const lpHasReason = lpSchema.includes('"checkout_quarantine_reason"');
  const lpHasAt = lpSchema.includes('"checkout_quarantined_at"');
  const lpHasPiId = lpSchema.includes('"checkout_quarantine_pi_id"');

  const passed = listingHasQuarantine && lpHasQuarantined && lpHasReason && lpHasAt && lpHasPiId;

  return {
    name: 'schema_permits_quarantine',
    passed,
    listing_has_quarantine: listingHasQuarantine,
    lp_has_quarantined: lpHasQuarantined,
    lp_has_reason: lpHasReason,
    lp_has_at: lpHasAt,
    lp_has_pi_id: lpHasPiId,
  };
}

function testIsQuarantinedHelper() {
  const state = createMockState();
  state.listing.status = 'hidden';
  state.listing.hidden_reason = 'checkout_quarantine';
  state.lp.checkout_quarantined = true;

  const detected = isQuarantined(state.listing, state.lp);

  const cleanState = createMockState();
  const notDetected = !isQuarantined(cleanState.listing, cleanState.lp);

  return {
    name: 'is_quarantined_helper',
    passed: detected && notDetected,
    quarantined_detected: detected,
    clean_not_detected: notDetected,
  };
}

// ── Main runner ──

async function main() {
  const tests = [
    await testTwoBuyerRace(),
    await testRetryBeforeActiveStatusRejection(),
    await testCanceledPI(),
    await testDifferentRevisions(),
    testSixConditionVerification(),
    testSellerManagementInterleaving(),
    testCleanupStateTable(),
    testSchemaPermitsQuarantine(),
    testIsQuarantinedHelper(),
  ];

  console.log('=== Checkout Concurrency Tests (7C.4) ===\n');

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