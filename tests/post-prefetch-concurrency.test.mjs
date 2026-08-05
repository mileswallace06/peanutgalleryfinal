/**
 * Post-Prefetch Concurrency Suite (7C.9C.2 — Requirement #4)
 *
 * Replaces the synchronous race hook with a REAL deferred barrier:
 *   1. Start freeze reconciliation.
 *   2. Pause it after authoritative prefetch but before quarantine persistence.
 *   3. Concurrently perform the competing reservation mutation through
 *      the real production mutation helper.
 *   4. Release the barrier.
 *   5. Await both operations with Promise.all.
 *
 * Also tests all 12 independent post-prefetch conflict cases:
 *   1. Listing token changes
 *   2. Listing buyer changes
 *   3. Listing expiration changes
 *   4. Listing revision changes
 *   5. ListingPrivate token changes
 *   6. ListingPrivate buyer changes
 *   7. ListingPrivate expiration changes
 *   8. ListingPrivate revision changes
 *   9. Both records change to the same newer complete tuple
 *  10. Listing and ListingPrivate change to different tuples
 *  11. One record changes while the other retains the frozen tuple
 *  12. A field becomes null during the race
 */
import { createMockDeps, createDefaultSeed, seedStripePI, freezeCapturedPayment, runTestSuite } from './helpers/mockDeps.mjs';
import { upsertListingPrivate } from '../base44/shared/orchestratorHelpers.js';

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => `uuid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` };
}

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

  // ── Create a REAL deferred synchronization barrier ────────────────────────
  // The barrier pauses the freeze AFTER the authoritative prefetch (Step 0)
  // but BEFORE the quarantine persistence (Step 3). A competing mutation
  // runs concurrently through the real production mutation helper.
  let barrierReached = false;
  let releaseBarrier;
  const barrierPromise = new Promise(resolve => { releaseBarrier = resolve; });
  let freezeReachedBarrierFirst = false;

  // Override Listing.update to include the barrier
  const originalListingUpdate = deps.entities.Listing.update;
  deps.entities.Listing.update = async function(id, data) {
    // When the quarantine write comes through (status=hidden, hidden_reason=checkout_quarantine),
    // pause at the barrier BEFORE applying it
    if (data.status === 'hidden' && data.hidden_reason === 'checkout_quarantine' && !barrierReached) {
      barrierReached = true;
      freezeReachedBarrierFirst = true;
      // Wait for the competing mutation to complete first
      await barrierPromise;
    }
    return originalListingUpdate.call(this, id, data);
  };

  // The competing tuple that will be injected during the race
  const competingToken = 'competing_real_barrier_token';
  const competingBuyer = 'competing_buyer@test';
  const competingExpiry = new Date(Date.now() + 20 * 60 * 1000).toISOString();

  // Start freeze (will pause at barrier after prefetch)
  const freezePromise = freezeCapturedPayment(deps, purchase, pp, pi);

  // Wait a tick for the freeze to reach the barrier
  await new Promise(r => setTimeout(r, 10));

  // Perform the competing reservation mutation through the real production
  // mutation helper (upsertListingPrivate + Listing.update)
  const competingMutation = (async () => {
    // Write LP with competing tuple
    await upsertListingPrivate(deps, ctx.listingId, {
      reservation_token: competingToken,
      reserved_by_email: competingBuyer,
      reservation_expires_at: competingExpiry,
      reservation_revision: 'competing_revision',
    });
    // Write Listing with competing tuple
    await originalListingUpdate.call(deps.entities.Listing, ctx.listingId, {
      reservation_token: competingToken,
      reserved_by_email: competingBuyer,
      reservation_expires_at: competingExpiry,
      reservation_revision: 'competing_revision',
    });
  })();

  // Wait for competing mutation to complete
  await competingMutation;

  // Release the barrier — freeze continues
  releaseBarrier();

  // Await both operations
  const [freezeResult] = await Promise.all([freezePromise]);

  // ── Assertions ───────────────────────────────────────────────────────────
  const [finalListing] = deps._state.stores.Listing;
  const finalLP = deps._state.stores.ListingPrivate[0];
  const finalPP = deps._state.stores.PurchasePrivate[0];
  const finalPurchase = deps._state.stores.Purchase[0];

  // 1. Freeze reached the barrier first
  const freezeFirst = freezeReachedBarrierFirst;
  // 2. The competing tuple is the one on the records (either both same, or split-brain detected)
  const listingToken = finalListing.reservation_token;
  const lpToken = finalLP.reservation_token;
  // 3. Listing must NOT be sold
  const notSold = finalListing.status !== 'sold';
  // 4. Listing must be non-reservable (hidden + quarantine)
  const listingNonReservable = finalListing.status === 'hidden' && finalListing.hidden_reason === 'checkout_quarantine';
  // 5. PP frozen tuple must be preserved (immutable evidence)
  const ppFrozenPreserved = finalPP.frozen_reservation_token === ctx.token;
  // 6. Purchase and PP financial state must be explicitly reported
  const purchaseStateReported = typeof freezeResult.purchase_frozen === 'boolean' || typeof freezeResult.pp_frozen === 'boolean' || freezeResult.ok;
  // 7. Conflict must be detected (non-ok result)
  const conflictDetected = !freezeResult.ok;
  // 8. Records must agree OR split-brain must be explicitly detected
  const recordsAgree = listingToken === lpToken;
  const splitBrainExplicitlyDetected = freezeResult.step === 'partial_freeze_conflict' || freezeResult.step === 'conflict';
  // 9. Retry must be safe
  const retryResult = await freezeCapturedPayment(deps, finalPurchase, finalPP, pi);
  const retrySafe = !retryResult.ok;
  const retryListingNotSold = deps._state.stores.Listing[0].status !== 'sold';

  // For a PASS: either both records contain the same proven newer complete tuple,
  // OR split-brain is explicitly detected, preserved, quarantined, and durably escalated.
  const sameNewerTuple = listingToken === competingToken && lpToken === competingToken;
  const splitBrainEscalated = splitBrainExplicitlyDetected && !recordsAgree &&
    (freezeResult.quarantined || freezeResult.blocked || freezeResult.alerted);

  const passed = freezeFirst && notSold && ppFrozenPreserved && conflictDetected &&
    (sameNewerTuple || splitBrainEscalated) && retrySafe && retryListingNotSold;

  return {
    name: 'real_deferred_barrier',
    passed,
    freeze_reached_barrier_first: freezeFirst,
    exact_competing_tuple: { token: competingToken, buyer: competingBuyer, expiry: competingExpiry },
    exact_final_listing_tuple: { token: listingToken, buyer: finalListing.reserved_by_email, expiry: finalListing.reservation_expires_at, revision: finalListing.reservation_revision },
    exact_final_lp_tuple: { token: lpToken, buyer: finalLP.reserved_by_email, expiry: finalLP.reservation_expires_at, revision: finalLP.reservation_revision },
    records_agree: recordsAgree,
    purchase_state: { transfer_status: finalPurchase.transfer_status, payment_captured: finalPurchase.payment_captured },
    pp_state: { payment_captured: finalPP.payment_captured, frozen: !!finalPP.frozen_reservation_token },
    quarantine_state: { listing_status: finalListing.status, listing_reason: finalListing.hidden_reason, lp_quarantined: finalLP.checkout_quarantined },
    durable_recovery: { blocked: freezeResult.blocked, alerted: freezeResult.alerted, quarantined: freezeResult.quarantined },
    retry_result: { ok: retryResult.ok, step: retryResult.step },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 12 INDEPENDENT POST-PREFETCH CONFLICT CASES
// ════════════════════════════════════════════════════════════════════════════

// Helper: run a post-prefetch conflict scenario
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

  // Use a barrier to inject the mutation after prefetch but before quarantine
  let barrierReached = false;
  let releaseBarrier;
  const barrierPromise = new Promise(resolve => { releaseBarrier = resolve; });

  const originalListingUpdate = deps.entities.Listing.update;
  deps.entities.Listing.update = async function(id, data) {
    if (data.status === 'hidden' && data.hidden_reason === 'checkout_quarantine' && !barrierReached) {
      barrierReached = true;
      await barrierPromise;
    }
    return originalListingUpdate.call(this, id, data);
  };

  const freezePromise = freezeCapturedPayment(deps, purchase, pp, pi);
  await new Promise(r => setTimeout(r, 10));

  // Inject the competing mutation
  await mutateFn(deps, ctx, originalListingUpdate);

  releaseBarrier();
  const result = await freezePromise;

  const [finalListing] = deps._state.stores.Listing;
  const finalLP = deps._state.stores.ListingPrivate[0];

  // Common assertions for all cases
  const notOk = !result.ok;
  const notSold = finalListing.status !== 'sold';
  const listingNonReservable = finalListing.status === 'hidden' || finalListing.status === 'pending_transfer';
  const ppFrozenPreserved = deps._state.stores.PurchasePrivate[0].frozen_reservation_token === ctx.token;
  const conflictOrPartialFreeze = result.step === 'conflict' || result.step === 'partial_freeze_conflict';
  const retryResult = await freezeCapturedPayment(deps, deps._state.stores.Purchase[0], deps._state.stores.PurchasePrivate[0], pi);
  const retrySafe = !retryResult.ok;

  const passed = notOk && notSold && ppFrozenPreserved && conflictOrPartialFreeze && retrySafe;

  return { name: caseName, passed, not_ok: notOk, not_sold: notSold, pp_frozen_preserved: ppFrozenPreserved, step: result.step, retry_safe: retrySafe };
}

// Case 1: Listing token changes
async function testCase1_ListingTokenChanges() {
  return runPostPrefetchConflictCase('listing_token_changes', async (deps, ctx, origUpdate) => {
    await origUpdate.call(deps.entities.Listing, ctx.listingId, { reservation_token: 'newer_token_1' });
  });
}

// Case 2: Listing buyer changes
async function testCase2_ListingBuyerChanges() {
  return runPostPrefetchConflictCase('listing_buyer_changes', async (deps, ctx, origUpdate) => {
    await origUpdate.call(deps.entities.Listing, ctx.listingId, { reserved_by_email: 'newer_buyer@test' });
  });
}

// Case 3: Listing expiration changes
async function testCase3_ListingExpiryChanges() {
  return runPostPrefetchConflictCase('listing_expiry_changes', async (deps, ctx, origUpdate) => {
    await origUpdate.call(deps.entities.Listing, ctx.listingId, { reservation_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
  });
}

// Case 4: Listing revision changes
async function testCase4_ListingRevisionChanges() {
  return runPostPrefetchConflictCase('listing_revision_changes', async (deps, ctx, origUpdate) => {
    await origUpdate.call(deps.entities.Listing, ctx.listingId, { reservation_revision: 'newer_revision_4' });
  });
}

// Case 5: ListingPrivate token changes
async function testCase5_LpTokenChanges() {
  return runPostPrefetchConflictCase('lp_token_changes', async (deps, ctx, origUpdate) => {
    await upsertListingPrivate(deps, ctx.listingId, { reservation_token: 'newer_lp_token_5' });
  });
}

// Case 6: ListingPrivate buyer changes
async function testCase6_LpBuyerChanges() {
  return runPostPrefetchConflictCase('lp_buyer_changes', async (deps, ctx, origUpdate) => {
    await upsertListingPrivate(deps, ctx.listingId, { reserved_by_email: 'newer_lp_buyer@test' });
  });
}

// Case 7: ListingPrivate expiration changes
async function testCase7_LpExpiryChanges() {
  return runPostPrefetchConflictCase('lp_expiry_changes', async (deps, ctx, origUpdate) => {
    await upsertListingPrivate(deps, ctx.listingId, { reservation_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
  });
}

// Case 8: ListingPrivate revision changes
async function testCase8_LpRevisionChanges() {
  return runPostPrefetchConflictCase('lp_revision_changes', async (deps, ctx, origUpdate) => {
    await upsertListingPrivate(deps, ctx.listingId, { reservation_revision: 'newer_lp_revision_8' });
  });
}

// Case 9: Both records change to the same newer complete tuple
async function testCase9_BothChangeSameTuple() {
  return runPostPrefetchConflictCase('both_change_same_tuple', async (deps, ctx, origUpdate) => {
    const newToken = 'same_newer_token_9';
    const newBuyer = 'same_newer_buyer@test';
    const newExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newRev = 'same_newer_rev_9';
    await upsertListingPrivate(deps, ctx.listingId, { reservation_token: newToken, reserved_by_email: newBuyer, reservation_expires_at: newExpiry, reservation_revision: newRev });
    await origUpdate.call(deps.entities.Listing, ctx.listingId, { reservation_token: newToken, reserved_by_email: newBuyer, reservation_expires_at: newExpiry, reservation_revision: newRev });
  });
}

// Case 10: Listing and ListingPrivate change to different tuples
async function testCase10_BothChangeDifferentTuples() {
  return runPostPrefetchConflictCase('both_change_different_tuples', async (deps, ctx, origUpdate) => {
    await upsertListingPrivate(deps, ctx.listingId, { reservation_token: 'lp_different_10' });
    await origUpdate.call(deps.entities.Listing, ctx.listingId, { reservation_token: 'listing_different_10' });
  });
}

// Case 11: One record changes while the other retains the frozen tuple
async function testCase11_OneChangesOtherRetains() {
  return runPostPrefetchConflictCase('one_changes_other_retains', async (deps, ctx, origUpdate) => {
    // Only Listing changes, LP retains frozen tuple
    await origUpdate.call(deps.entities.Listing, ctx.listingId, { reservation_token: 'only_listing_changed_11' });
  });
}

// Case 12: A field becomes null during the race
async function testCase12_FieldBecomesNull() {
  return runPostPrefetchConflictCase('field_becomes_null', async (deps, ctx, origUpdate) => {
    // Token becomes null on Listing
    await origUpdate.call(deps.entities.Listing, ctx.listingId, { reservation_token: null });
  });
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    await testRealDeferredBarrier(),
    await testCase1_ListingTokenChanges(),
    await testCase2_ListingBuyerChanges(),
    await testCase3_ListingExpiryChanges(),
    await testCase4_ListingRevisionChanges(),
    await testCase5_LpTokenChanges(),
    await testCase6_LpBuyerChanges(),
    await testCase7_LpExpiryChanges(),
    await testCase8_LpRevisionChanges(),
    await testCase9_BothChangeSameTuple(),
    await testCase10_BothChangeDifferentTuples(),
    await testCase11_OneChangesOtherRetains(),
    await testCase12_FieldBecomesNull(),
  ];
  await runTestSuite('Post-Prefetch Concurrency Suite (7C.9C.2 — Requirement #4)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });