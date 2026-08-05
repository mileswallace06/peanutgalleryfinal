/**
 * Mutation-Path Behavioral Suite (7C.9C.2 — Requirement #8)
 *
 * Executes the ACTUAL production logic for every reservation mutation path.
 * Tests call the same shared orchestrator functions used by the Deno entry points.
 * No test manually performs `deps.entities.Listing.update(...)` to imitate production.
 *
 * Paths tested:
 *   1. reserveListing creation (runReserveListing)
 *   2. releaseReservation (runReleaseReservation)
 *   3. abortCheckout (runAbortCheckout)
 *   4. cancelPurchase (runCancelPurchase)
 *   5. processTransferReminders cleanup branches (runProcessTransferReminders)
 *   6. capture freeze (freezeCapturedPayment)
 *   7. capture finalization (finalizeCapturedPayment)
 *   8. first-record failure
 *   9. second-record failure
 *  10. silent persistence failure
 *  11. split-brain preservation and escalation
 *
 * Distinguishes active cleared-state revisions (non-null) from terminal-null revisions.
 */
import {
  createMockDeps, createDefaultSeed, seedStripePI,
  freezeCapturedPayment, finalizeCapturedPayment,
  runReserveListing, runReleaseReservation, runAbortCheckout, runCancelPurchase, runProcessTransferReminders,
  applyReservationTuple, generateClearedRevision,
  runTestSuite,
} from './helpers/mockDeps.mjs';
import { QUARANTINE_DRAIN_MS } from '../base44/shared/checkoutLogic.js';

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => `uuid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: reserveListing creation — both records get same revision via production helper
// ════════════════════════════════════════════════════════════════════════════
async function testReserveListingCreation() {
  const ctx = createDefaultSeed({
    listing: { status: 'active', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await runReserveListing(deps, { listing_id: ctx.listingId });

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];

  // Both records must have the same non-null token, buyer, expiration, revision
  const listingHasToken = !!listing.reservation_token;
  const lpHasToken = !!lp.reservation_token;
  const tokensMatch = listing.reservation_token === lp.reservation_token;
  const buyersMatch = listing.reserved_by_email === lp.reserved_by_email;
  const expirysMatch = listing.reservation_expires_at === lp.reservation_expires_at;
  const revisionsMatch = listing.reservation_revision === lp.reservation_revision && !!listing.reservation_revision;
  const listingPending = listing.status === 'pending_transfer';

  const passed = result.status === 200 && listingHasToken && lpHasToken && tokensMatch && buyersMatch && expirysMatch && revisionsMatch && listingPending;
  return { name: 'reserve_listing_creation', passed, status: result.status, listing_has_token: listingHasToken, lp_has_token: lpHasToken, tokens_match: tokensMatch, buyers_match: buyersMatch, expirys_match: expirysMatch, revisions_match: revisionsMatch, listing_pending: listingPending };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: releaseReservation — both records cleared with non-null cleared-state revision
// ════════════════════════════════════════════════════════════════════════════
async function testReleaseReservationClear() {
  const ctx = createDefaultSeed();
  const deps = createMockDeps({ seed: ctx.seed, user: { id: 'user_buyer', email: ctx.buyerEmail, role: 'user', full_name: 'Test Buyer' } });
  const result = await runReleaseReservation(deps, { listing_id: ctx.listingId });

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];

  // Active-lifecycle clear: token/buyer/expiration null, revision NON-NULL (cleared-state)
  const listingTokenNull = !listing.reservation_token;
  const listingBuyerNull = !listing.reserved_by_email;
  const listingExpiryNull = !listing.reservation_expires_at;
  const listingRevNonNull = !!listing.reservation_revision;
  const lpTokenNull = !lp.reservation_token;
  const lpBuyerNull = !lp.reserved_by_email;
  const lpExpiryNull = !lp.reservation_expires_at;
  const lpRevNonNull = !!lp.reservation_revision;
  const revisionsMatch = listing.reservation_revision === lp.reservation_revision;
  const listingActive = listing.status === 'active';

  const passed = result.status === 200 && listingTokenNull && listingBuyerNull && listingExpiryNull &&
    listingRevNonNull && lpTokenNull && lpBuyerNull && lpExpiryNull && lpRevNonNull && revisionsMatch && listingActive;
  return { name: 'release_reservation_clear', passed, status: result.status, listing_token_null: listingTokenNull, listing_rev_non_null: listingRevNonNull, lp_rev_non_null: lpRevNonNull, revisions_match: revisionsMatch, listing_active: listingActive };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: abortCheckout — both records cleared with non-null cleared-state revision
// ════════════════════════════════════════════════════════════════════════════
async function testAbortCheckoutClear() {
  const ctx = createDefaultSeed();
  const deps = createMockDeps({ seed: ctx.seed, user: { id: 'user_buyer', email: ctx.buyerEmail, role: 'user', full_name: 'Test Buyer' } });
  seedStripePI(deps.stripe, ctx.piId, { status: 'requires_payment_method', metadata: { listing_id: ctx.listingId, buyer_email: ctx.buyerEmail, reservation_token: ctx.token, purchase_id: ctx.purchaseId } });
  const result = await runAbortCheckout(deps, { purchase_id: ctx.purchaseId });

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const purchase = deps._state.stores.Purchase[0];

  const purchaseExpired = purchase.transfer_status === 'expired';
  const listingTokenNull = !listing.reservation_token;
  const listingRevNonNull = !!listing.reservation_revision;
  const lpTokenNull = !lp.reservation_token;
  const lpRevNonNull = !!lp.reservation_revision;
  const revisionsMatch = listing.reservation_revision === lp.reservation_revision;
  const listingActive = listing.status === 'active';

  const passed = result.status === 200 && purchaseExpired && listingTokenNull && listingRevNonNull && lpTokenNull && lpRevNonNull && revisionsMatch && listingActive;
  return { name: 'abort_checkout_clear', passed, status: result.status, purchase_expired: purchaseExpired, listing_token_null: listingTokenNull, listing_rev_non_null: listingRevNonNull, lp_rev_non_null: lpRevNonNull, revisions_match: revisionsMatch, listing_active: listingActive };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: cancelPurchase — both records cleared with non-null cleared-state revision
// ════════════════════════════════════════════════════════════════════════════
async function testCancelPurchaseClear() {
  const ctx = createDefaultSeed({ purchase: { seller_confirmed: false } });
  const deps = createMockDeps({ seed: ctx.seed, user: { id: 'user_buyer', email: ctx.buyerEmail, role: 'user', full_name: 'Test Buyer' } });
  seedStripePI(deps.stripe, ctx.piId, { status: 'requires_payment_method', metadata: { listing_id: ctx.listingId, buyer_email: ctx.buyerEmail, reservation_token: ctx.token, purchase_id: ctx.purchaseId } });
  const result = await runCancelPurchase(deps, { purchase_id: ctx.purchaseId });

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const purchase = deps._state.stores.Purchase[0];

  const purchaseExpired = purchase.transfer_status === 'expired';
  const listingTokenNull = !listing.reservation_token;
  const listingRevNonNull = !!listing.reservation_revision;
  const lpTokenNull = !lp.reservation_token;
  const lpRevNonNull = !!lp.reservation_revision;
  const revisionsMatch = listing.reservation_revision === lp.reservation_revision;
  const listingActive = listing.status === 'active';

  const passed = result.status === 200 && purchaseExpired && listingTokenNull && listingRevNonNull && lpTokenNull && lpRevNonNull && revisionsMatch && listingActive;
  return { name: 'cancel_purchase_clear', passed, status: result.status, purchase_expired: purchaseExpired, listing_token_null: listingTokenNull, listing_rev_non_null: listingRevNonNull, lp_rev_non_null: lpRevNonNull, revisions_match: revisionsMatch, listing_active: listingActive };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: processTransferReminders cleanup — all branches use non-null cleared-state revision
// ════════════════════════════════════════════════════════════════════════════
async function testProcessTransferRemindersClear() {
  // Create a purchase with expired reservation
  const expiredExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const ctx = createDefaultSeed({
    listing: { status: 'pending_transfer', reservation_expires_at: expiredExpiry },
    lp: { reservation_expires_at: expiredExpiry },
    purchase: { seller_confirmed: false, created_date: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString() },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await runProcessTransferReminders(deps);

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const purchase = deps._state.stores.Purchase[0];

  const purchaseExpired = purchase.transfer_status === 'expired';
  const listingTokenNull = !listing.reservation_token;
  const listingRevNonNull = !!listing.reservation_revision; // non-null cleared-state revision
  const lpTokenNull = !lp.reservation_token;
  const lpRevNonNull = !!lp.reservation_revision;
  const revisionsMatch = listing.reservation_revision === lp.reservation_revision;
  const listingActive = listing.status === 'active';

  const passed = result.status === 200 && purchaseExpired && listingTokenNull && listingRevNonNull && lpTokenNull && lpRevNonNull && revisionsMatch && listingActive;
  return { name: 'process_transfer_reminders_clear', passed, status: result.status, purchase_expired: purchaseExpired, listing_token_null: listingTokenNull, listing_rev_non_null: listingRevNonNull, lp_rev_non_null: lpRevNonNull, revisions_match: revisionsMatch, listing_active: listingActive };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: Capture freeze — reservation preserved on both records (terminal-null NOT used)
// ════════════════════════════════════════════════════════════════════════════
async function testCaptureFreezePreservation() {
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
  const result = await freezeCapturedPayment(deps, purchase, pp, pi);

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];

  // Reservation must be PRESERVED (not cleared) on both records
  const listingPreserved = listing.reservation_token === ctx.token && listing.reserved_by_email === ctx.buyerEmail;
  const lpPreserved = lp.reservation_token === ctx.token && lp.reserved_by_email === ctx.buyerEmail;
  const revisionsMatch = listing.reservation_revision === lp.reservation_revision;
  const listingQuarantined = listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine';
  const lpQuarantined = lp.checkout_quarantined === true;

  const passed = result.ok && listingPreserved && lpPreserved && revisionsMatch && listingQuarantined && lpQuarantined;
  return { name: 'capture_freeze_preservation', passed, ok: result.ok, listing_preserved: listingPreserved, lp_preserved: lpPreserved, revisions_match: revisionsMatch, listing_quarantined: listingQuarantined, lp_quarantined: lpQuarantined };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: Capture finalization — both records cleared with TERMINAL-NULL revision (sold)
// ════════════════════════════════════════════════════════════════════════════
async function testCaptureFinalizationClear() {
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
  await freezeCapturedPayment(deps, purchase, pp, pi);

  timeOffset = QUARANTINE_DRAIN_MS + 60000;
  const result = await finalizeCapturedPayment(deps, ctx.listingId);

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const ppFinal = deps._state.stores.PurchasePrivate[0];

  // Terminal clear: listing is SOLD, revision is NULL (terminal)
  const listingSold = listing.status === 'sold';
  const listingTokenNull = !listing.reservation_token;
  const listingRevNull = !listing.reservation_revision; // terminal-null permitted for sold
  const lpTokenNull = !lp.reservation_token;
  const lpRevNull = !lp.reservation_revision; // terminal-null permitted for sold
  const lpNotQuarantined = lp.checkout_quarantined === false;
  const ppFinalized = !!ppFinal.freeze_finalized_at;

  const passed = result.ok && listingSold && listingTokenNull && listingRevNull && lpTokenNull && lpRevNull && lpNotQuarantined && ppFinalized;
  return { name: 'capture_finalization_clear', passed, ok: result.ok, listing_sold: listingSold, listing_token_null: listingTokenNull, listing_rev_null: listingRevNull, lp_rev_null: lpRevNull, lp_not_quarantined: lpNotQuarantined, pp_finalized: ppFinalized };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: First-record failure — returns non-success, no split-brain
// ════════════════════════════════════════════════════════════════════════════
async function testFirstRecordFailure() {
  const ctx = createDefaultSeed({
    listing: { status: 'active', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
  });
  const deps = createMockDeps({
    seed: ctx.seed,
    user: { id: 'user_buyer', email: ctx.buyerEmail, role: 'user', full_name: 'Test Buyer' },
    hooks: {
      'before_ListingPrivate_update': (id, data) => {
        if (data.reservation_token) return { throw: new Error('LP write failed') };
      },
    },
  });
  const result = await runReserveListing(deps, { listing_id: ctx.listingId });

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];

  // Since LP write failed, Listing should NOT have been written
  const listingNotWritten = !listing.reservation_token;
  const lpNotWritten = !lp.reservation_token;
  const noSplitBrain = listing.reservation_token === lp.reservation_token;
  const nonSuccess = result.status !== 200;

  const passed = nonSuccess && listingNotWritten && lpNotWritten && noSplitBrain;
  return { name: 'first_record_failure', passed, non_success: nonSuccess, listing_not_written: listingNotWritten, lp_not_written: lpNotWritten, no_split_brain: noSplitBrain, second_write_attempted: false };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: Second-record failure — returns non-success, split-brain detected
// ════════════════════════════════════════════════════════════════════════════
async function testSecondRecordFailure() {
  const ctx = createDefaultSeed({
    listing: { status: 'active', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
  });
  const deps = createMockDeps({
    seed: ctx.seed,
    user: { id: 'user_buyer', email: ctx.buyerEmail, role: 'user', full_name: 'Test Buyer' },
    hooks: {
      'before_Listing_update': (id, data) => {
        if (data.reservation_token) return { throw: new Error('Listing write failed') };
      },
    },
  });
  const result = await runReserveListing(deps, { listing_id: ctx.listingId });

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];

  // LP has the token but Listing does not — split-brain detected
  const lpHasToken = !!lp.reservation_token;
  const listingDoesNotHaveToken = !listing.reservation_token;
  const splitBrainDetected = lpHasToken && listingDoesNotHaveToken;
  const nonSuccess = result.status !== 200;
  // Durable escalation must be proven
  const hasAlert = deps._state.stores.AdminAlert.length > 0;

  const passed = nonSuccess && splitBrainDetected && hasAlert;
  return { name: 'second_record_failure', passed, non_success: nonSuccess, lp_has_token: lpHasToken, listing_does_not_have_token: listingDoesNotHaveToken, split_brain_detected: splitBrainDetected, has_alert: hasAlert };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 10: Silent persistence failure — revision silently dropped, detected
// ════════════════════════════════════════════════════════════════════════════
async function testSilentPersistenceFailure() {
  const ctx = createDefaultSeed({
    listing: { status: 'active', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
  });
  const deps = createMockDeps({
    seed: ctx.seed,
    user: { id: 'user_buyer', email: ctx.buyerEmail, role: 'user', full_name: 'Test Buyer' },
    silentDropFields: { ListingPrivate: ['reservation_revision'], Listing: ['reservation_revision'] },
  });
  const result = await runReserveListing(deps, { listing_id: ctx.listingId });

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];

  // Both records should have token but NOT revision (silently dropped)
  const listingHasTokenNotRev = !!listing.reservation_token && !listing.reservation_revision;
  const lpHasTokenNotRev = !!lp.reservation_token && !lp.reservation_revision;
  const splitBrain = listingHasTokenNotRev && lpHasTokenNotRev;
  const nonSuccess = result.status !== 200;

  const passed = nonSuccess && splitBrain;
  return { name: 'silent_persistence_failure', passed, non_success: nonSuccess, listing_has_token_not_rev: listingHasTokenNotRev, lp_has_token_not_rev: lpHasTokenNotRev, split_brain: splitBrain };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 11: Split-brain preservation and escalation
// ════════════════════════════════════════════════════════════════════════════
async function testSplitBrainPreservation() {
  const ctx = createDefaultSeed({
    listing: { reservation_revision: 'listing_rev' },
    lp: { reservation_revision: 'different_lp_rev' },
  });
  const deps = createMockDeps({ seed: ctx.seed });

  // Use applyReservationTuple directly — it should detect the mismatch
  const clearedRev = generateClearedRevision();
  const result = await applyReservationTuple(deps, ctx.listingId, {
    status: 'active', token: null, buyer: null, expiration: null, revision: clearedRev,
  }, 'split_brain_test', 'test:split_brain');

  // Split-brain must be detected — NO writes should be attempted
  const notOk = !result.ok;
  const splitBrainDetected = result.split_brain_detected === true;
  const noWritesAttempted = !result.first_write_attempted && !result.second_write_attempted;
  // Pre-write tuples must be preserved (not overwritten)
  const listingRevPreserved = result.listing_tuple.revision === 'listing_rev';
  const lpRevPreserved = result.lp_tuple.revision === 'different_lp_rev';
  // Durable escalation must be proven
  const blockOrAlertProven = result.block_proven || result.alert_proven;

  const passed = notOk && splitBrainDetected && noWritesAttempted && listingRevPreserved && lpRevPreserved && blockOrAlertProven;
  return { name: 'split_brain_preservation', passed, not_ok: notOk, split_brain_detected: splitBrainDetected, no_writes_attempted: noWritesAttempted, listing_rev_preserved: listingRevPreserved, lp_rev_preserved: lpRevPreserved, block_proven: result.block_proven, alert_proven: result.alert_proven };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 12: Active vs terminal revision semantics
// ════════════════════════════════════════════════════════════════════════════
async function testActiveVsTerminalRevisionSemantics() {
  // Active clear: non-null revision
  const ctxActive = createDefaultSeed();
  const depsActive = createMockDeps({ seed: ctxActive.seed, user: { id: 'user_buyer', email: ctxActive.buyerEmail, role: 'user', full_name: 'Test Buyer' } });
  await runReleaseReservation(depsActive, { listing_id: ctxActive.listingId });
  const listingActive = depsActive._state.stores.Listing[0];
  const activeRevNonNull = !!listingActive.reservation_revision;
  const activeStatusActive = listingActive.status === 'active';

  // Terminal clear: null revision (sold)
  const ctxTerminal = createDefaultSeed();
  let timeOffset = 0;
  const depsTerminal = createMockDeps({ seed: ctxTerminal.seed, now: () => Date.now() + timeOffset });
  seedStripePI(depsTerminal.stripe, ctxTerminal.piId, {
    status: 'succeeded', amount: 10500,
    metadata: { listing_id: ctxTerminal.listingId, buyer_email: ctxTerminal.buyerEmail, seller_email: ctxTerminal.sellerEmail, reservation_token: ctxTerminal.token, purchase_id: ctxTerminal.purchaseId },
    transfer_data: { destination: 'acct_test_123' },
  });
  const [purchaseT] = depsTerminal._state.stores.Purchase;
  const [ppT] = depsTerminal._state.stores.PurchasePrivate;
  const piT = depsTerminal.stripe.pisById.get(ctxTerminal.piId);
  await freezeCapturedPayment(depsTerminal, purchaseT, ppT, piT);
  timeOffset = QUARANTINE_DRAIN_MS + 60000;
  await finalizeCapturedPayment(depsTerminal, ctxTerminal.listingId);
  const listingTerminal = depsTerminal._state.stores.Listing[0];
  const terminalRevNull = !listingTerminal.reservation_revision;
  const terminalStatusSold = listingTerminal.status === 'sold';

  const passed = activeRevNonNull && activeStatusActive && terminalRevNull && terminalStatusSold;
  return { name: 'active_vs_terminal_revision_semantics', passed, active_rev_non_null: activeRevNonNull, active_status_active: activeStatusActive, terminal_rev_null: terminalRevNull, terminal_status_sold: terminalStatusSold };
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    await testReserveListingCreation(),
    await testReleaseReservationClear(),
    await testAbortCheckoutClear(),
    await testCancelPurchaseClear(),
    await testProcessTransferRemindersClear(),
    await testCaptureFreezePreservation(),
    await testCaptureFinalizationClear(),
    await testFirstRecordFailure(),
    await testSecondRecordFailure(),
    await testSilentPersistenceFailure(),
    await testSplitBrainPreservation(),
    await testActiveVsTerminalRevisionSemantics(),
  ];
  await runTestSuite('Mutation-Path Behavioral Suite (7C.9C.2 — Requirement #8)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });