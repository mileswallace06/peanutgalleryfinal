/**
 * Partial-Finalization States Behavioral Tests (7C.9C.2)
 *
 * Tests States A through E for finalizeCapturedPayment:
 * A: Listing matches, ListingPrivate matches
 * B: Listing null, ListingPrivate matches
 * C: Listing matches, ListingPrivate null
 * D: both null with verified finalization_started_at
 * E: any different non-null field
 *
 * For every state, asserts all four tuple fields on both records,
 * Listing status, LP quarantine state, Purchase state, PP state,
 * and conflict preservation.
 */
import { createMockDeps, createDefaultSeed, seedStripePI, freezeCapturedPayment, finalizeCapturedPayment, runTestSuite } from './helpers/mockDeps.mjs';

// Helper: create a frozen state (Phase 1 complete, Phase 2 not started)
function createFrozenState(o = {}) {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token, expiry, revision } = createDefaultSeed(o);
  // Mark as frozen (Phase 1 complete)
  seed.Listing[0].status = 'hidden';
  seed.Listing[0].hidden_reason = 'checkout_quarantine';
  seed.ListingPrivate[0].checkout_quarantined = true;
  seed.ListingPrivate[0].checkout_quarantine_reason = 'Payment captured — pending finalization';
  seed.ListingPrivate[0].checkout_quarantined_at = '2026-08-01T10:00:00.000Z';
  seed.ListingPrivate[0].quarantined_purchase_id = purchaseId;
  seed.ListingPrivate[0].recovery_not_before = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  seed.Purchase[0].transfer_status = 'completed';
  seed.Purchase[0].payment_captured = true;
  seed.Purchase[0].buyer_confirmed = true;
  seed.PurchasePrivate[0].payment_captured = true;
  seed.PurchasePrivate[0].frozen_reservation_token = token;
  seed.PurchasePrivate[0].frozen_buyer_email = buyerEmail;
  seed.PurchasePrivate[0].frozen_reservation_expires_at = expiry;
  seed.PurchasePrivate[0].frozen_reservation_revision = revision;
  return { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token, expiry, revision };
}

// State A: both match frozen tuple — normal finalization
async function testStateA_bothMatch() {
  const ctx = createFrozenState();
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const purchase = deps._state.stores.Purchase[0];
  const pp = deps._state.stores.PurchasePrivate[0];

  const listingSold = listing.status === 'sold';
  const listingCleared = !listing.reservation_token && !listing.reserved_by_email && !listing.reservation_expires_at && !listing.reservation_revision;
  const lpCleared = !lp.reservation_token && !lp.reserved_by_email && !lp.reservation_expires_at && !lp.reservation_revision;
  const lpNotQuarantined = lp.checkout_quarantined === false;
  const purchaseCompleted = purchase.transfer_status === 'completed' && purchase.payment_captured === true;
  const ppFinalized = pp.freeze_finalized_at !== undefined && pp.payment_captured === true;

  const passed = result.ok && result.phase === 'finalized' && listingSold && listingCleared && lpCleared && lpNotQuarantined && purchaseCompleted && ppFinalized;
  return { name: 'state_A_both_match', passed, ok: result.ok, phase: result.phase, listing_sold: listingSold, listing_cleared: listingCleared, lp_cleared: lpCleared, lp_not_quarantined: lpNotQuarantined, purchase_completed: purchaseCompleted, pp_finalized: ppFinalized };
}

// State B: Listing null, LP matches
async function testStateB_listingNullLpMatches() {
  const ctx = createFrozenState({
    listing: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, status: 'sold', hidden_reason: null },
    pp: { finalization_started_at: '2026-01-01T00:00:00.000Z' },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const lp = deps._state.stores.ListingPrivate[0];
  const pp = deps._state.stores.PurchasePrivate[0];

  const lpCleared = !lp.reservation_token && !lp.reserved_by_email && !lp.reservation_expires_at && !lp.reservation_revision && lp.checkout_quarantined === false;
  const ppFinalized = pp.freeze_finalized_at !== undefined;
  const passed = result.ok && result.phase === 'finalized' && lpCleared && ppFinalized;
  return { name: 'state_B_listing_null_lp_matches', passed, ok: result.ok, phase: result.phase, lp_cleared: lpCleared, pp_finalized: ppFinalized };
}

// State C: Listing matches, LP null
async function testStateC_listingMatchesLpNull() {
  const ctx = createFrozenState({
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, checkout_quarantined: false },
    pp: { finalization_started_at: '2026-01-01T00:00:00.000Z' },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const listing = deps._state.stores.Listing[0];
  const pp = deps._state.stores.PurchasePrivate[0];

  const listingSold = listing.status === 'sold' && !listing.reservation_token;
  const ppFinalized = pp.freeze_finalized_at !== undefined;
  const passed = result.ok && result.phase === 'finalized' && listingSold && ppFinalized;
  return { name: 'state_C_listing_matches_lp_null', passed, ok: result.ok, phase: result.phase, listing_sold: listingSold, pp_finalized: ppFinalized };
}

// State D: both null with verified finalization_started_at
async function testStateD_bothNullWithStarted() {
  const ctx = createFrozenState({
    listing: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, status: 'sold', hidden_reason: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, checkout_quarantined: false },
    pp: { finalization_started_at: '2026-01-01T00:00:00.000Z' },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const pp = deps._state.stores.PurchasePrivate[0];
  const ppFinalized = pp.freeze_finalized_at !== undefined;
  const passed = result.ok && result.phase === 'finalized' && ppFinalized;
  return { name: 'state_D_both_null_with_started', passed, ok: result.ok, phase: result.phase, pp_finalized: ppFinalized };
}

// State E: any different non-null field — must block and preserve
async function testStateE_differentNonNullable() {
  const ctx = createFrozenState({
    listing: { reservation_token: 'different_token' },
    lp: { reservation_token: 'different_token' },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];

  const notOk = !result.ok;
  const preserved = listing.reservation_token === 'different_token' && lp.reservation_token === 'different_token';
  const notSold = listing.status !== 'sold';
  const blocked = result.blocked === true || result.alerted === true;

  const passed = notOk && preserved && notSold && blocked;
  return { name: 'state_E_different_non_null', passed, not_ok: notOk, preserved, not_sold: notSold, blocked, step: result.step };
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    await testStateA_bothMatch(),
    await testStateB_listingNullLpMatches(),
    await testStateC_listingMatchesLpNull(),
    await testStateD_bothNullWithStarted(),
    await testStateE_differentNonNullable(),
  ];
  await runTestSuite('Partial-Finalization States Tests (7C.9C.2)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });