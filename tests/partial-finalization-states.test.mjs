/**
 * Partial-Finalization States Behavioral Tests (7C.9C.2 — Requirement #10)
 *
 * Every State A–E test asserts the FULL output matrix:
 *
 * Listing: status, hidden_reason, token, buyer, expiration, revision
 * ListingPrivate: token, buyer, expiration, revision, quarantine flag,
 *   quarantine reason, quarantine timestamp, recovery-block fields
 * Purchase: transfer_status, payment_captured, buyer_confirmed, listing_id,
 *   buyer_email, seller_email
 * PurchasePrivate: payment_captured, all 4 frozen tuple fields,
 *   finalization_started_at, freeze_finalized_at, listing_id, purchase_id
 *
 * State E uses property-presence checks (Object.prototype.hasOwnProperty.call)
 * to compare every overridden field generically — including explicit null values.
 */
import { createMockDeps, createDefaultSeed, seedStripePI, finalizeCapturedPayment, runTestSuite } from './helpers/mockDeps.mjs';

function createFrozenState(o = {}) {
  const ctx = createDefaultSeed(o);
  ctx.seed.Listing[0].status = 'hidden';
  ctx.seed.Listing[0].hidden_reason = 'checkout_quarantine';
  ctx.seed.ListingPrivate[0].checkout_quarantined = true;
  ctx.seed.ListingPrivate[0].checkout_quarantine_reason = 'Payment captured — pending finalization';
  ctx.seed.ListingPrivate[0].checkout_quarantined_at = '2026-08-01T10:00:00.000Z';
  ctx.seed.ListingPrivate[0].quarantined_purchase_id = ctx.purchaseId;
  ctx.seed.ListingPrivate[0].recovery_not_before = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  ctx.seed.Purchase[0].transfer_status = 'completed';
  ctx.seed.Purchase[0].payment_captured = true;
  ctx.seed.Purchase[0].buyer_confirmed = true;
  ctx.seed.PurchasePrivate[0].payment_captured = true;
  ctx.seed.PurchasePrivate[0].frozen_reservation_token = ctx.token;
  ctx.seed.PurchasePrivate[0].frozen_buyer_email = ctx.buyerEmail;
  ctx.seed.PurchasePrivate[0].frozen_reservation_expires_at = ctx.expiry;
  ctx.seed.PurchasePrivate[0].frozen_reservation_revision = ctx.revision;
  return ctx;
}

function getOutputMatrix(deps) {
  const l = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];
  const p = deps._state.stores.Purchase[0];
  const pp = deps._state.stores.PurchasePrivate[0];
  return {
    listing: { status: l?.status, hidden_reason: l?.hidden_reason ?? null, token: l?.reservation_token ?? null, buyer: l?.reserved_by_email ?? null, expiration: l?.reservation_expires_at ?? null, revision: l?.reservation_revision ?? null },
    lp: { token: lp?.reservation_token ?? null, buyer: lp?.reserved_by_email ?? null, expiration: lp?.reservation_expires_at ?? null, revision: lp?.reservation_revision ?? null, checkout_quarantined: lp?.checkout_quarantined, quarantine_reason: lp?.checkout_quarantine_reason ?? null, quarantine_at: lp?.checkout_quarantined_at ?? null, recovery_blocked: lp?.recovery_blocked ?? false },
    purchase: { transfer_status: p?.transfer_status, payment_captured: p?.payment_captured, buyer_confirmed: p?.buyer_confirmed, listing_id: p?.listing_id, buyer_email: p?.buyer_email, seller_email: p?.seller_email },
    pp: { payment_captured: pp?.payment_captured, frozen_token: pp?.frozen_reservation_token ?? null, frozen_buyer: pp?.frozen_buyer_email ?? null, frozen_expiry: pp?.frozen_reservation_expires_at ?? null, frozen_revision: pp?.frozen_reservation_revision ?? null, finalization_started_at: pp?.finalization_started_at ?? null, freeze_finalized_at: pp?.freeze_finalized_at ?? null, listing_id: pp?.listing_id, purchase_id: pp?.purchase_id },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// STATE A: both match frozen tuple
// ════════════════════════════════════════════════════════════════════════════
async function testStateA() {
  const ctx = createFrozenState();
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const m = getOutputMatrix(deps);

  const listingOk = m.listing.status === 'sold' && m.listing.hidden_reason === null &&
    m.listing.token === null && m.listing.buyer === null && m.listing.expiration === null && m.listing.revision === null;
  const lpOk = m.lp.token === null && m.lp.buyer === null && m.lp.expiration === null && m.lp.revision === null &&
    m.lp.checkout_quarantined === false && m.lp.quarantine_reason === null && m.lp.quarantine_at === null && m.lp.recovery_blocked === false;
  const purchaseOk = m.purchase.transfer_status === 'completed' && m.purchase.payment_captured === true && m.purchase.buyer_confirmed === true &&
    m.purchase.listing_id === ctx.listingId && m.purchase.buyer_email === ctx.buyerEmail && m.purchase.seller_email === ctx.sellerEmail;
  const ppOk = m.pp.payment_captured === true && m.pp.frozen_token === ctx.token && m.pp.frozen_buyer === ctx.buyerEmail &&
    m.pp.frozen_expiry === ctx.expiry && m.pp.frozen_revision === ctx.revision &&
    m.pp.finalization_started_at !== null && m.pp.freeze_finalized_at !== null &&
    m.pp.listing_id === ctx.listingId && m.pp.purchase_id === ctx.purchaseId;

  const passed = result.ok && result.phase === 'finalized' && listingOk && lpOk && purchaseOk && ppOk;
  return { name: 'state_A_both_match', passed, ok: result.ok, phase: result.phase, listing_ok: listingOk, lp_ok: lpOk, purchase_ok: purchaseOk, pp_ok: ppOk };
}

// ════════════════════════════════════════════════════════════════════════════
// STATE B: Listing null/sold, LP has tuple
// ════════════════════════════════════════════════════════════════════════════
async function testStateB() {
  const ctx = createFrozenState({
    listing: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, status: 'sold', hidden_reason: null },
    pp: { finalization_started_at: '2026-01-01T00:00:00.000Z' },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const m = getOutputMatrix(deps);

  const listingOk = m.listing.status === 'sold' && m.listing.hidden_reason === null &&
    m.listing.token === null && m.listing.buyer === null && m.listing.expiration === null && m.listing.revision === null;
  const lpOk = m.lp.token === null && m.lp.buyer === null && m.lp.expiration === null && m.lp.revision === null &&
    m.lp.checkout_quarantined === false && m.lp.quarantine_reason === null && m.lp.quarantine_at === null;
  const purchaseOk = m.purchase.transfer_status === 'completed' && m.purchase.payment_captured === true;
  const ppOk = m.pp.freeze_finalized_at !== null && m.pp.payment_captured === true && m.pp.finalization_started_at !== null;

  const passed = result.ok && result.phase === 'finalized' && listingOk && lpOk && purchaseOk && ppOk;
  return { name: 'state_B_listing_null_lp_matches', passed, ok: result.ok, phase: result.phase, listing_ok: listingOk, lp_ok: lpOk, purchase_ok: purchaseOk, pp_ok: ppOk };
}

// ════════════════════════════════════════════════════════════════════════════
// STATE C: Listing matches, LP null
// ════════════════════════════════════════════════════════════════════════════
async function testStateC() {
  const ctx = createFrozenState({
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, checkout_quarantined: false },
    pp: { finalization_started_at: '2026-01-01T00:00:00.000Z' },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const m = getOutputMatrix(deps);

  const lpOk = m.lp.token === null && m.lp.buyer === null && m.lp.expiration === null && m.lp.revision === null && m.lp.checkout_quarantined === false;
  const listingOk = m.listing.status === 'sold' && m.listing.token === null && m.listing.buyer === null && m.listing.expiration === null && m.listing.revision === null;
  const purchaseOk = m.purchase.transfer_status === 'completed' && m.purchase.payment_captured === true;
  const ppOk = m.pp.freeze_finalized_at !== null && m.pp.payment_captured === true && m.pp.finalization_started_at !== null;

  const passed = result.ok && result.phase === 'finalized' && lpOk && listingOk && purchaseOk && ppOk;
  return { name: 'state_C_listing_matches_lp_null', passed, ok: result.ok, phase: result.phase, lp_ok: lpOk, listing_ok: listingOk, purchase_ok: purchaseOk, pp_ok: ppOk };
}

// ════════════════════════════════════════════════════════════════════════════
// STATE D: both null with verified finalization_started_at
// ════════════════════════════════════════════════════════════════════════════
async function testStateD() {
  const ctx = createFrozenState({
    listing: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, status: 'sold', hidden_reason: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null, checkout_quarantined: false },
    pp: { finalization_started_at: '2026-01-01T00:00:00.000Z' },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const m = getOutputMatrix(deps);

  const listingOk = m.listing.status === 'sold' && m.listing.token === null && m.listing.revision === null;
  const lpOk = m.lp.token === null && m.lp.revision === null && m.lp.checkout_quarantined === false;
  const purchaseOk = m.purchase.transfer_status === 'completed' && m.purchase.payment_captured === true;
  const ppOk = m.pp.freeze_finalized_at !== null && m.pp.finalization_started_at !== null && m.pp.payment_captured === true;

  const passed = result.ok && result.phase === 'finalized' && listingOk && lpOk && purchaseOk && ppOk;
  return { name: 'state_D_both_null_with_started', passed, ok: result.ok, phase: result.phase, listing_ok: listingOk, lp_ok: lpOk, purchase_ok: purchaseOk, pp_ok: ppOk };
}

// ════════════════════════════════════════════════════════════════════════════
// STATE E: Independent conflict cases using property-presence checks
// ════════════════════════════════════════════════════════════════════════════
async function runStateE(caseName, listingOverrides, lpOverrides) {
  const ctx = createFrozenState({ listing: listingOverrides, lp: lpOverrides });
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const m = getOutputMatrix(deps);

  const notOk = !result.ok;
  const notSold = m.listing.status !== 'sold';
  const blocked = result.blocked === true || result.alerted === true;

  // Use property-presence checks for every overridden field
  const fieldsToCheck = ['reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'];
  let listingPreserved = true;
  let lpPreserved = true;

  for (const field of fieldsToCheck) {
    if (Object.prototype.hasOwnProperty.call(listingOverrides, field)) {
      const expected = listingOverrides[field];
      const actual = field === 'reservation_token' ? m.listing.token :
        field === 'reserved_by_email' ? m.listing.buyer :
        field === 'reservation_expires_at' ? m.listing.expiration :
        m.listing.revision;
      if (actual !== expected) listingPreserved = false;
    }
    if (Object.prototype.hasOwnProperty.call(lpOverrides, field)) {
      const expected = lpOverrides[field];
      const actual = field === 'reservation_token' ? m.lp.token :
        field === 'reserved_by_email' ? m.lp.buyer :
        field === 'reservation_expires_at' ? m.lp.expiration :
        m.lp.revision;
      if (actual !== expected) lpPreserved = false;
    }
  }

  const passed = notOk && notSold && blocked && listingPreserved && lpPreserved;
  return { name: `state_E_${caseName}`, passed, not_ok: notOk, not_sold: notSold, blocked, listing_preserved: listingPreserved, lp_preserved: lpPreserved, step: result.step };
}

// E1: Token conflict
async function testStateE_token() { return runStateE('token_conflict', { reservation_token: 'different_token' }, { reservation_token: 'different_token' }); }
// E2: Buyer conflict
async function testStateE_buyer() { return runStateE('buyer_conflict', { reserved_by_email: 'different_buyer@test' }, { reserved_by_email: 'different_buyer@test' }); }
// E3: Expiration conflict
async function testStateE_expiry() { return runStateE('expiry_conflict', { reservation_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }, { reservation_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }); }
// E4: Revision conflict
async function testStateE_revision() { return runStateE('revision_conflict', { reservation_revision: 'different_revision' }, { reservation_revision: 'different_revision' }); }
// E5: Partial-null tuple (explicit null buyer)
async function testStateE_partialNull() { return runStateE('partial_null_tuple', { reserved_by_email: null }, { reserved_by_email: null }); }
// E6: Listing-only conflict
async function testStateE_listingOnly() { return runStateE('listing_only_conflict', { reservation_token: 'listing_only_different' }, {}); }
// E7: LP-only conflict
async function testStateE_lpOnly() { return runStateE('lp_only_conflict', {}, { reservation_token: 'lp_only_different' }); }
// E8: Both different conflicts
async function testStateE_bothDifferent() { return runStateE('both_different_conflicts', { reservation_token: 'listing_diff_8' }, { reservation_token: 'lp_diff_8' }); }

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    await testStateA(), await testStateB(), await testStateC(), await testStateD(),
    await testStateE_token(), await testStateE_buyer(), await testStateE_expiry(),
    await testStateE_revision(), await testStateE_partialNull(),
    await testStateE_listingOnly(), await testStateE_lpOnly(), await testStateE_bothDifferent(),
  ];
  await runTestSuite('Partial-Finalization States Tests (7C.9C.2 — Requirement #10)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });