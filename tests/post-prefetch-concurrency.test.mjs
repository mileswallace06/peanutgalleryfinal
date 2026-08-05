/**
 * Post-Prefetch Concurrency Suite (7C.9C.2 — Requirement #9)
 *
 * Uses EXPLICIT deferred promises with timeout rejection and an event trace.
 *
 * Required ordering:
 *   1. freeze_started
 *   2. prefetch_reached
 *   3. competitor_started
 *   4. barrier_released
 *   5. competitor_finished
 *   6. freeze_finished
 *
 * Each race case isolates Listing-only, LP-only, both-same, both-different,
 * one-changed-one-retained, and field-becomes-null mutations.
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

const PREFETCH_TIMEOUT_MS = 5000;

// ════════════════════════════════════════════════════════════════════════════
// REAL DEFERRED BARRIER TEST
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

  // Event trace
  const events = [];

  // Deferred barrier — hook signals prefetch reached (first call only), then waits for release
  let signalPrefetchReached;
  let releaseBarrier;
  let firstHookCall = true;
  const prefetchReached = new Promise((resolve) => { signalPrefetchReached = resolve; });
  const barrierPromise = new Promise((resolve) => { releaseBarrier = resolve; });

  deps.hooks = {
    afterAuthoritativePrefetch: async () => {
      if (firstHookCall) {
        firstHookCall = false;
        signalPrefetchReached();
        events.push('prefetch_reached');
      }
      await barrierPromise;
    },
  };

  // Record alert count before operation
  const alertsBefore = deps._state.stores.AdminAlert.length;

  // 1. Start freeze
  events.push('freeze_started');
  const freezePromise = (async () => {
    try { return await freezeCapturedPayment(deps, purchase, pp, pi); }
    finally { events.push('freeze_finished'); }
  })();

  // 2. Await explicit prefetch-reached signal with timeout
  await Promise.race([
    prefetchReached,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Prefetch not reached in 5s')), PREFETCH_TIMEOUT_MS)),
  ]);

  // 3. Start competing mutation (do NOT await yet)
  const competingToken = 'competing_real_barrier_token';
  const competingBuyer = 'competing_buyer@test';
  const competingExpiry = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const competingRevision = 'competing_revision';
  events.push('competitor_started');
  const competingPromise = (async () => {
    try {
      const result = await applyReservationTuple(deps, ctx.listingId, {
        status: 'pending_transfer',
        token: competingToken,
        buyer: competingBuyer,
        expiration: competingExpiry,
        revision: competingRevision,
      }, 'competing_mutation', 'post-prefetch:competing');
      return result;
    } finally { events.push('competitor_finished'); }
  })();

  // 4. Release the barrier — freeze continues
  events.push('barrier_released');
  releaseBarrier();

  // 5. Await both together with Promise.all
  const [freezeResult, competingResult] = await Promise.all([freezePromise, competingPromise]);

  // ── Assertions ───────────────────────────────────────────────────────────
  const [finalListing] = deps._state.stores.Listing;
  const finalLP = deps._state.stores.ListingPrivate[0];
  const finalPP = deps._state.stores.PurchasePrivate[0];
  const finalPurchase = deps._state.stores.Purchase[0];

  // Event ordering
  const expectedOrder = ['freeze_started', 'prefetch_reached', 'competitor_started', 'barrier_released', 'competitor_finished', 'freeze_finished'];
  const orderingCorrect = expectedOrder.every((e, i) => events[i] === e);

  // Competing operation result explicitly reported
  const competingReported = competingResult !== undefined;

  // Listing non-reservable after conflict
  const listingNonReservable = finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine';
  const listingNotSold = finalListing.status !== 'sold';

  // Complete tuples captured
  const listingTuple = {
    token: finalListing.reservation_token ?? null,
    buyer: finalListing.reserved_by_email ?? null,
    expiration: finalListing.reservation_expires_at ?? null,
    revision: finalListing.reservation_revision ?? null,
    status: finalListing.status ?? null,
  };
  const lpTuple = {
    token: finalLP.reservation_token ?? null,
    buyer: finalLP.reserved_by_email ?? null,
    expiration: finalLP.reservation_expires_at ?? null,
    revision: finalLP.reservation_revision ?? null,
    checkout_quarantined: finalLP.checkout_quarantined ?? null,
  };

  // Conflict detected (non-ok result)
  const conflictDetected = !freezeResult.ok;
  const stepIsConflict = freezeResult.step === 'conflict' || freezeResult.step === 'partial_freeze_conflict';

  // PP frozen tuple asserted
  const ppFrozenTuple = {
    payment_captured: finalPP.payment_captured,
    frozen_reservation_token: finalPP.frozen_reservation_token ?? null,
    frozen_buyer_email: finalPP.frozen_buyer_email ?? null,
    frozen_reservation_expires_at: finalPP.frozen_reservation_expires_at ?? null,
    frozen_reservation_revision: finalPP.frozen_reservation_revision ?? null,
  };

  // Quarantine persistence proven
  const quarantineProven = finalLP.checkout_quarantined === true;

  // Durable block AND alert proven (require BOTH)
  const blockProven = freezeResult.blocked === true;
  const alertProven = freezeResult.alerted === true;
  const alertsAfter = deps._state.stores.AdminAlert.length;
  const newAlertCreated = alertsAfter > alertsBefore;

  // ── Retry safety ──────────────────────────────────────────────────────────
  // Clear hooks before retry to prevent barrier blocking
  deps.hooks = {};
  const ppBeforeRetry = { ...finalPP };
  const listingBeforeRetry = { ...finalListing };
  const lpBeforeRetry = { ...finalLP };
  const alertsBeforeRetry = deps._state.stores.AdminAlert.length;
  const unresolvedBeforeRetry = deps._state.stores.AdminAlert.filter(a => !a.resolved).length;

  const retryResult = await freezeCapturedPayment(deps, finalPurchase, finalPP, pi);

  const noDuplicateFinancialWrites = finalPP.payment_captured === ppBeforeRetry.payment_captured;
  // Retry may detect the same conflict and re-escalate — no duplicate FINANCIAL writes is the key requirement
  const listingTuplePreserved = finalListing.reservation_token === listingBeforeRetry.reservation_token;
  const lpTuplePreserved = finalLP.reservation_token === lpBeforeRetry.reservation_token;
  const retryDeterministic = !retryResult.ok;
  const unresolvedAfterRetry = deps._state.stores.AdminAlert.filter(a => !a.resolved).length;
  const noDuplicateAlerts = unresolvedAfterRetry === unresolvedBeforeRetry;

  const passed = orderingCorrect && competingReported && listingNonReservable && listingNotSold &&
    (tuplesEqual(listingTuple, lpTuple) || stepIsConflict) &&
    !!ppFrozenTuple.frozen_reservation_token &&
    quarantineProven && blockProven && alertProven && newAlertCreated && conflictDetected &&
    noDuplicateFinancialWrites && listingTuplePreserved && lpTuplePreserved && retryDeterministic && noDuplicateAlerts;

  return {
    name: 'real_deferred_barrier',
    passed,
    ordering_correct: orderingCorrect,
    events,
    competing_reported: competingReported,
    listing_non_reservable: listingNonReservable,
    listing_not_sold: listingNotSold,
    listing_tuple: listingTuple,
    lp_tuple: lpTuple,
    step: freezeResult.step,
    pp_frozen_tuple: ppFrozenTuple,
    quarantine_proven: quarantineProven,
    block_proven: blockProven,
    alert_proven: alertProven,
    new_alert_created: newAlertCreated,
    conflict_detected: conflictDetected,
    no_duplicate_financial_writes: noDuplicateFinancialWrites,
    listing_tuple_preserved: listingTuplePreserved,
    lp_tuple_preserved: lpTuplePreserved,
    retry_deterministic: retryDeterministic,
  };
}

function tuplesEqual(a, b) {
  return a.token === b.token && a.buyer === b.buyer &&
    a.expiration === b.expiration && a.revision === b.revision;
}

// ════════════════════════════════════════════════════════════════════════════
// 12 INDEPENDENT POST-PREFETCH CONFLICT CASES
// ════════════════════════════════════════════════════════════════════════════
async function runRaceCase(caseName, mutateFn) {
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

  const events = [];
  let signalPrefetchReached;
  let releaseBarrier;
  const prefetchReached = new Promise((resolve) => { signalPrefetchReached = resolve; });
  const barrierPromise = new Promise((resolve) => { releaseBarrier = resolve; });

  let firstHookCall = true;
  deps.hooks = {
    afterAuthoritativePrefetch: async () => {
      if (firstHookCall) {
        firstHookCall = false;
        signalPrefetchReached();
        events.push('prefetch_reached');
      }
      await barrierPromise;
    },
  };

  const alertsBefore = deps._state.stores.AdminAlert.length;

  events.push('freeze_started');
  const freezePromise = (async () => {
    try { return await freezeCapturedPayment(deps, purchase, pp, pi); }
    finally { events.push('freeze_finished'); }
  })();

  await Promise.race([
    prefetchReached,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Prefetch not reached in 5s')), PREFETCH_TIMEOUT_MS)),
  ]);

  // Start competing mutation — do NOT await yet
  events.push('competitor_started');
  const competingPromise = (async () => {
    try {
      const result = await mutateFn(deps, ctx);
      return result;
    } finally { events.push('competitor_finished'); }
  })();

  // Release barrier — freeze continues
  events.push('barrier_released');
  releaseBarrier();

  // Await both together
  const [freezeResult, competingResult] = await Promise.all([freezePromise, competingPromise]);

  const [finalListing] = deps._state.stores.Listing;
  const finalLP = deps._state.stores.ListingPrivate[0];

  // Assertions
  const notOk = !freezeResult.ok;
  const notSold = finalListing.status !== 'sold';
  const listingNonReservable = finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine';
  const ppFrozenPreserved = deps._state.stores.PurchasePrivate[0].frozen_reservation_token === ctx.token;
  const conflictOrPartialFreeze = freezeResult.step === 'conflict' || freezeResult.step === 'partial_freeze_conflict';
  const quarantineProven = finalLP.checkout_quarantined === true;
  const blockProven = freezeResult.blocked === true;
  const alertProven = freezeResult.alerted === true;
  const newAlertCreated = deps._state.stores.AdminAlert.length > alertsBefore;

  // Event ordering
  const expectedOrder = ['freeze_started', 'prefetch_reached', 'competitor_started', 'barrier_released', 'competitor_finished', 'freeze_finished'];
  const orderingCorrect = expectedOrder.every((e, i) => events[i] === e);

  // Retry safety — clear hooks before retry to prevent barrier blocking
  deps.hooks = {};
  const unresolvedBefore = deps._state.stores.AdminAlert.filter(a => !a.resolved).length;
  const retryResult = await freezeCapturedPayment(deps, deps._state.stores.Purchase[0], deps._state.stores.PurchasePrivate[0], pi);
  const retrySafe = !retryResult.ok;
  const unresolvedAfter = deps._state.stores.AdminAlert.filter(a => !a.resolved).length;
  const noDuplicateAlerts = unresolvedAfter === unresolvedBefore;

  const passed = notOk && notSold && listingNonReservable && ppFrozenPreserved && conflictOrPartialFreeze &&
    quarantineProven && blockProven && alertProven && newAlertCreated && orderingCorrect && retrySafe && noDuplicateAlerts;

  return {
    name: caseName, passed,
    not_ok: notOk, not_sold: notSold, listing_non_reservable: listingNonReservable,
    pp_frozen_preserved: ppFrozenPreserved, step: freezeResult.step,
    quarantine_proven: quarantineProven, block_proven: blockProven, alert_proven: alertProven,
    new_alert_created: newAlertCreated, ordering_correct: orderingCorrect, retry_safe: retrySafe,
    no_duplicate_alerts: noDuplicateAlerts, unresolved_before: unresolvedBefore, unresolved_after: unresolvedAfter,
  };
}

// ── Listing-only mutations (direct Listing.update, NOT through applyReservationTuple) ──
async function testCase1() {
  return runRaceCase('listing_token_changes', async (deps, ctx) => {
    const [lp] = deps._state.stores.ListingPrivate;
    await deps.entities.Listing.update(ctx.listingId, { reservation_token: 'newer_token_1', reservation_revision: 'newer_rev_1' });
    return { ok: true };
  });
}
async function testCase2() {
  return runRaceCase('listing_buyer_changes', async (deps, ctx) => {
    await deps.entities.Listing.update(ctx.listingId, { reserved_by_email: 'newer_buyer@test', reservation_revision: 'newer_rev_2' });
    return { ok: true };
  });
}
async function testCase3() {
  return runRaceCase('listing_expiry_changes', async (deps, ctx) => {
    await deps.entities.Listing.update(ctx.listingId, { reservation_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), reservation_revision: 'newer_rev_3' });
    return { ok: true };
  });
}
async function testCase4() {
  return runRaceCase('listing_revision_changes', async (deps, ctx) => {
    await deps.entities.Listing.update(ctx.listingId, { reservation_revision: 'newer_revision_4' });
    return { ok: true };
  });
}

// ── LP-only mutations (direct ListingPrivate.update, NOT through applyReservationTuple) ──
async function testCase5() {
  return runRaceCase('lp_token_changes', async (deps, ctx) => {
    const [lp] = deps._state.stores.ListingPrivate;
    await deps.entities.ListingPrivate.update(lp.id, { reservation_token: 'newer_lp_token_5', reservation_revision: 'newer_lp_rev_5' });
    return { ok: true };
  });
}
async function testCase6() {
  return runRaceCase('lp_buyer_changes', async (deps, ctx) => {
    const [lp] = deps._state.stores.ListingPrivate;
    await deps.entities.ListingPrivate.update(lp.id, { reserved_by_email: 'newer_lp_buyer@test', reservation_revision: 'newer_lp_rev_6' });
    return { ok: true };
  });
}
async function testCase7() {
  return runRaceCase('lp_expiry_changes', async (deps, ctx) => {
    const [lp] = deps._state.stores.ListingPrivate;
    await deps.entities.ListingPrivate.update(lp.id, { reservation_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), reservation_revision: 'newer_lp_rev_7' });
    return { ok: true };
  });
}
async function testCase8() {
  return runRaceCase('lp_revision_changes', async (deps, ctx) => {
    const [lp] = deps._state.stores.ListingPrivate;
    await deps.entities.ListingPrivate.update(lp.id, { reservation_revision: 'newer_lp_revision_8' });
    return { ok: true };
  });
}

// ── Both records same newer tuple (through applyReservationTuple) ──────────
async function testCase9() {
  return runRaceCase('both_change_same_tuple', async (deps, ctx) => {
    return await applyReservationTuple(deps, ctx.listingId, {
      status: 'pending_transfer',
      token: 'same_newer_token_9',
      buyer: 'same_newer_buyer@test',
      expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      revision: 'same_newer_rev_9',
    }, 'competing', 'test:9');
  });
}

// ── Both records different tuples (two separate mutations) ─────────────────
async function testCase10() {
  return runRaceCase('both_change_different_tuples', async (deps, ctx) => {
    const [lp] = deps._state.stores.ListingPrivate;
    await deps.entities.Listing.update(ctx.listingId, { reservation_token: 'listing_diff_10', reservation_revision: 'rev_10' });
    await deps.entities.ListingPrivate.update(lp.id, { reservation_token: 'lp_diff_10', reservation_revision: 'rev_10b' });
    return { ok: true };
  });
}

// ── One record changed, other retained (Listing-only, LP retained) ────────
async function testCase11() {
  return runRaceCase('listing_changes_lp_retained', async (deps, ctx) => {
    await deps.entities.Listing.update(ctx.listingId, { reservation_token: 'only_listing_changed_11', reservation_revision: 'rev_11' });
    return { ok: true };
  });
}

// ── One field changed to null ─────────────────────────────────────────────
async function testCase12() {
  return runRaceCase('field_becomes_null', async (deps, ctx) => {
    await deps.entities.Listing.update(ctx.listingId, { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null });
    return { ok: true };
  });
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Post-Prefetch Concurrency Suite (7C.9C.2 — Requirement #9) ===\n');
  const tests = [
    await testRealDeferredBarrier(),
    await testCase1(), await testCase2(), await testCase3(), await testCase4(),
    await testCase5(), await testCase6(), await testCase7(), await testCase8(),
    await testCase9(), await testCase10(), await testCase11(), await testCase12(),
  ];
  await runTestSuite('Post-Prefetch Concurrency Suite (7C.9C.2 — Requirement #9)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });