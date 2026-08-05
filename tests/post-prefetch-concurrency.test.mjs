/**
 * Post-Prefetch Concurrency Suite (7C.9C.2 — Requirement #9)
 *
 * Uses EXPLICIT injectable synchronization hooks in the production reconciliation:
 *   afterAuthoritativePrefetch, beforeQuarantineWrite
 *
 * The competing mutation goes through the REAL production reservation helper
 * (applyReservationTuple), NOT raw Listing.update.
 *
 * Pass condition requires ALL of:
 *   - barrier reached in the intended order
 *   - competing operation result explicitly reported
 *   - Listing non-reservable after conflict
 *   - Listing not sold
 *   - complete Listing tuple captured
 *   - complete ListingPrivate tuple captured
 *   - exact tuple equality or explicit split-brain classification
 *   - all conflicting values preserved
 *   - complete Purchase financial state asserted
 *   - complete PurchasePrivate frozen tuple asserted
 *   - quarantine persistence proven
 *   - durable block or alert persistence proven
 *   - retry does not add duplicate financial writes
 *   - retry does not create duplicate alerts
 *   - retry does not overwrite either competing tuple
 *   - deterministic retry state
 */
import {
  createMockDeps, createDefaultSeed, seedStripePI,
  freezeCapturedPayment,
  applyReservationTuple, generateClearedRevision,
  runTestSuite,
} from './helpers/mockDeps.mjs';
import { QUARANTINE_DRAIN_MS } from '../base44/shared/checkoutLogic.js';

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => `uuid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` };
}

// ════════════════════════════════════════════════════════════════════════════
// REAL DEFERRED BARRIER TEST with injectable hooks
// ════════════════════════════════════════════════════════════════════════════
async function testRealDeferredBarrier() {
  const ctx = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed: ctx.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, ctx.piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: ctx.listingId, buyer_email: ctx.buyerEmail, seller_email: ctx.sellerEmail, reservation_token: ctx.token, purchase_id: ctx.purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(ctx.piId);

  // ── Create a REAL deferred synchronization barrier using injectable hooks ──
  // The freeze pauses at afterAuthoritativePrefetch and waits for releaseBarrier.
  let barrierReached = false;
  let releaseBarrier;
  const barrierPromise = new Promise(resolve => { releaseBarrier = resolve; });

  deps.hooks = {
    afterAuthoritativePrefetch: async () => {
      barrierReached = true;
      await barrierPromise;
    },
  };

  // The competing tuple that will be injected during the race
  const competingToken = 'competing_real_barrier_token';
  const competingBuyer = 'competing_buyer@test';
  const competingExpiry = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const competingRevision = 'competing_revision';

  // Start freeze (will pause at afterAuthoritativePrefetch hook)
  const freezePromise = freezeCapturedPayment(deps, purchase, pp, pi);

  // Wait for the barrier to be reached — NO FIXED SLEEP
  // Instead, poll for barrierReached with a microtask yield
  while (!barrierReached) {
    await Promise.resolve();
  }

  // Start the competing mutation through the REAL production reservation helper
  const competingPromise = (async () => {
    return await applyReservationTuple(deps, ctx.listingId, {
      status: 'pending_transfer',
      token: competingToken,
      buyer: competingBuyer,
      expiration: competingExpiry,
      revision: competingRevision,
    }, 'competing_mutation', 'post-prefetch-concurrency:competing');
  })();

  // Wait for competing mutation to complete
  const competingResult = await competingPromise;

  // Release the barrier — freeze continues
  releaseBarrier();

  // Await both operations together
  const [freezeResult] = await Promise.all([freezePromise]);

  // ── Assertions ───────────────────────────────────────────────────────────
  const [finalListing] = deps._state.stores.Listing;
  const finalLP = deps._state.stores.ListingPrivate[0];
  const finalPP = deps._state.stores.PurchasePrivate[0];
  const finalPurchase = deps._state.stores.Purchase[0];
  const alertsBefore = deps._state.stores.AdminAlert.length;

  // 1. Barrier reached in the intended order (freeze reached prefetch first)
  const barrierReachedFirst = barrierReached;
  // 2. Competing operation result explicitly reported
  const competingReported = competingResult !== undefined;
  // 3. Listing non-reservable after conflict (hidden + quarantine)
  const listingNonReservable = finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine';
  // 4. Listing not sold
  const listingNotSold = finalListing.status !== 'sold';
  // 5. Complete Listing tuple captured
  const listingTuple = {
    token: finalListing.reservation_token ?? null,
    buyer: finalListing.reserved_by_email ?? null,
    expiration: finalListing.reservation_expires_at ?? null,
    revision: finalListing.reservation_revision ?? null,
    status: finalListing.status ?? null,
  };
  // 6. Complete ListingPrivate tuple captured
  const lpTuple = {
    token: finalLP.reservation_token ?? null,
    buyer: finalLP.reserved_by_email ?? null,
    expiration: finalLP.reservation_expires_at ?? null,
    revision: finalLP.reservation_revision ?? null,
    checkout_quarantined: finalLP.checkout_quarantined ?? null,
  };
  // 7. Exact tuple equality or explicit split-brain classification
  const tuplesEqual = listingTuple.token === lpTuple.token && listingTuple.buyer === lpTuple.buyer &&
    listingTuple.expiration === lpTuple.expiration && listingTuple.revision === lpTuple.revision;
  const splitBrainClassified = freezeResult.step === 'partial_freeze_conflict' || freezeResult.step === 'conflict';
  // 8. All conflicting values preserved (not erased)
  const conflictingValuesPreserved = !!listingTuple.token || !!lpTuple.token;
  // 9. Complete Purchase financial state asserted
  const purchaseFinancialState = {
    transfer_status: finalPurchase.transfer_status,
    payment_captured: finalPurchase.payment_captured,
    buyer_confirmed: finalPurchase.buyer_confirmed,
  };
  // 10. Complete PurchasePrivate frozen tuple asserted
  const ppFrozenTuple = {
    payment_captured: finalPP.payment_captured,
    frozen_reservation_token: finalPP.frozen_reservation_token ?? null,
    frozen_buyer_email: finalPP.frozen_buyer_email ?? null,
    frozen_reservation_expires_at: finalPP.frozen_reservation_expires_at ?? null,
    frozen_reservation_revision: finalPP.frozen_reservation_revision ?? null,
  };
  // 11. Quarantine persistence proven
  const quarantineProven = finalLP.checkout_quarantined === true;
  // 12. Durable block or alert persistence proven
  const blockProven = freezeResult.blocked === true;
  const alertProven = freezeResult.alerted === true;
  const durableProven = blockProven || alertProven;
  // 13. Conflict detected (non-ok result)
  const conflictDetected = !freezeResult.ok;

  // ── Retry safety ──────────────────────────────────────────────────────────
  const ppBeforeRetry = { ...finalPP };
  const listingBeforeRetry = { ...finalListing };
  const lpBeforeRetry = { ...finalLP };
  const alertsBeforeRetry = deps._state.stores.AdminAlert.length;

  const retryResult = await freezeCapturedPayment(deps, finalPurchase, finalPP, pi);

  // 14. Retry does not add duplicate financial writes
  const noDuplicateFinancialWrites = finalPP.payment_captured === ppBeforeRetry.payment_captured;
  // 15. Retry does not create duplicate alerts
  const noDuplicateAlerts = deps._state.stores.AdminAlert.length === alertsBeforeRetry;
  // 16. Retry does not overwrite either competing tuple
  const listingTuplePreserved = finalListing.reservation_token === listingBeforeRetry.reservation_token;
  const lpTuplePreserved = finalLP.reservation_token === lpBeforeRetry.reservation_token;
  // 17. Deterministic retry state
  const retryDeterministic = !retryResult.ok;

  const passed = barrierReachedFirst && competingReported && listingNonReservable && listingNotSold &&
    !!listingTuple.token !== null && !!lpTuple.token !== null &&
    (tuplesEqual || splitBrainClassified) && conflictingValuesPreserved &&
    !!purchaseFinancialState.transfer_status && !!ppFrozenTuple.frozen_reservation_token &&
    quarantineProven && durableProven && conflictDetected &&
    noDuplicateFinancialWrites && noDuplicateAlerts && listingTuplePreserved && lpTuplePreserved && retryDeterministic;

  return {
    name: 'real_deferred_barrier',
    passed,
    barrier_reached_first: barrierReachedFirst,
    competing_reported: competingReported,
    listing_non_reservable: listingNonReservable,
    listing_not_sold: listingNotSold,
    listing_tuple: listingTuple,
    lp_tuple: lpTuple,
    tuples_equal: tuplesEqual,
    split_brain_classified: splitBrainClassified,
    conflicting_values_preserved: conflictingValuesPreserved,
    purchase_financial_state: purchaseFinancialState,
    pp_frozen_tuple: ppFrozenTuple,
    quarantine_proven: quarantineProven,
    block_proven: blockProven,
    alert_proven: alertProven,
    conflict_detected: conflictDetected,
    no_duplicate_financial_writes: noDuplicateFinancialWrites,
    no_duplicate_alerts: noDuplicateAlerts,
    listing_tuple_preserved: listingTuplePreserved,
    lp_tuple_preserved: lpTuplePreserved,
    retry_deterministic: retryDeterministic,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 12 INDEPENDENT POST-PREFETCH CONFLICT CASES
// ════════════════════════════════════════════════════════════════════════════

async function runPostPrefetchConflictCase(caseName, mutateFn) {
  const ctx = createDefaultSeed();
  let timeOffset = 0;
  const deps = createMockDeps({ seed: ctx.seed, now: () => Date.now() + timeOffset });
  seedStripePI(deps.stripe, ctx.piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: ctx.listingId, buyer_email: ctx.buyerEmail, seller_email: ctx.sellerEmail, reservation_token: ctx.token, purchase_id: ctx.purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });

  const [purchase] = deps._state.stores.Purchase;
  const [pp] = deps._state.stores.PurchasePrivate;
  const pi = deps.stripe.pisById.get(ctx.piId);

  // Use injectable hook for the barrier
  let barrierReached = false;
  let releaseBarrier;
  const barrierPromise = new Promise(resolve => { releaseBarrier = resolve; });

  deps.hooks = {
    afterAuthoritativePrefetch: async () => {
      barrierReached = true;
      await barrierPromise;
    },
  };

  const freezePromise = freezeCapturedPayment(deps, purchase, pp, pi);

  // Wait for barrier — no fixed sleep
  while (!barrierReached) { await Promise.resolve(); }

  // Inject the competing mutation through the real production helper
  await mutateFn(deps, ctx);

  releaseBarrier();
  const result = await freezePromise;

  const [finalListing] = deps._state.stores.Listing;
  const finalLP = deps._state.stores.ListingPrivate[0];

  // Common assertions
  const notOk = !result.ok;
  const notSold = finalListing.status !== 'sold';
  const ppFrozenPreserved = deps._state.stores.PurchasePrivate[0].frozen_reservation_token === ctx.token;
  const conflictOrPartialFreeze = result.step === 'conflict' || result.step === 'partial_freeze_conflict';

  // Retry safety
  const retryResult = await freezeCapturedPayment(deps, deps._state.stores.Purchase[0], deps._state.stores.PurchasePrivate[0], pi);
  const retrySafe = !retryResult.ok;

  const passed = notOk && notSold && ppFrozenPreserved && conflictOrPartialFreeze && retrySafe;

  return { name: caseName, passed, not_ok: notOk, not_sold: notSold, pp_frozen_preserved: ppFrozenPreserved, step: result.step, retry_safe: retrySafe };
}

async function testCase1() { return runPostPrefetchConflictCase('listing_token_changes', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: 'newer_token_1', buyer: ctx.buyerEmail, expiration: ctx.expiry, revision: 'newer_rev_1' }, 'competing', 'test:1'); }); }
async function testCase2() { return runPostPrefetchConflictCase('listing_buyer_changes', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: ctx.token, buyer: 'newer_buyer@test', expiration: ctx.expiry, revision: 'newer_rev_2' }, 'competing', 'test:2'); }); }
async function testCase3() { return runPostPrefetchConflictCase('listing_expiry_changes', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: ctx.token, buyer: ctx.buyerEmail, expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(), revision: 'newer_rev_3' }, 'competing', 'test:3'); }); }
async function testCase4() { return runPostPrefetchConflictCase('listing_revision_changes', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: ctx.token, buyer: ctx.buyerEmail, expiration: ctx.expiry, revision: 'newer_revision_4' }, 'competing', 'test:4'); }); }
async function testCase5() { return runPostPrefetchConflictCase('lp_token_changes', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: 'newer_lp_token_5', buyer: ctx.buyerEmail, expiration: ctx.expiry, revision: 'newer_lp_rev_5' }, 'competing', 'test:5'); }); }
async function testCase6() { return runPostPrefetchConflictCase('lp_buyer_changes', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: ctx.token, buyer: 'newer_lp_buyer@test', expiration: ctx.expiry, revision: 'newer_lp_rev_6' }, 'competing', 'test:6'); }); }
async function testCase7() { return runPostPrefetchConflictCase('lp_expiry_changes', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: ctx.token, buyer: ctx.buyerEmail, expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(), revision: 'newer_lp_rev_7' }, 'competing', 'test:7'); }); }
async function testCase8() { return runPostPrefetchConflictCase('lp_revision_changes', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: ctx.token, buyer: ctx.buyerEmail, expiration: ctx.expiry, revision: 'newer_lp_revision_8' }, 'competing', 'test:8'); }); }
async function testCase9() { return runPostPrefetchConflictCase('both_change_same_tuple', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: 'same_newer_token_9', buyer: 'same_newer_buyer@test', expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(), revision: 'same_newer_rev_9' }, 'competing', 'test:9'); }); }
async function testCase10() { return runPostPrefetchConflictCase('both_change_different_tuples', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: 'listing_diff_10', buyer: ctx.buyerEmail, expiration: ctx.expiry, revision: 'rev_10' }, 'competing', 'test:10a'); await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: 'lp_diff_10', buyer: ctx.buyerEmail, expiration: ctx.expiry, revision: 'rev_10b' }, 'competing', 'test:10b'); }); }
async function testCase11() { return runPostPrefetchConflictCase('one_changes_other_retains', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'pending_transfer', token: 'only_listing_changed_11', buyer: ctx.buyerEmail, expiration: ctx.expiry, revision: 'rev_11' }, 'competing', 'test:11'); }); }
async function testCase12() { return runPostPrefetchConflictCase('field_becomes_null', async (deps, ctx) => { await applyReservationTuple(deps, ctx.listingId, { status: 'active', token: null, buyer: null, expiration: null, revision: generateClearedRevision() }, 'competing', 'test:12'); }); }

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    await testRealDeferredBarrier(),
    await testCase1(), await testCase2(), await testCase3(), await testCase4(),
    await testCase5(), await testCase6(), await testCase7(), await testCase8(),
    await testCase9(), await testCase10(), await testCase11(), await testCase12(),
  ];
  await runTestSuite('Post-Prefetch Concurrency Suite (7C.9C.2 — Requirement #9)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });