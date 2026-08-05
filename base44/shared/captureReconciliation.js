/**
 * captureReconciliation.js — Two-phase freeze-and-finalize reconciliation.
 *
 * 7C.9C.1: Replaces the TOCTOU-vulnerable check-then-clear design with a
 * two-phase approach that is safe under Base44's lack of atomic compare-and-set.
 *
 * PHASE 1 — freezeCapturedPayment (called immediately when Stripe succeeds):
 *   1. Re-fetch all four records (Listing, ListingPrivate, Purchase, PurchasePrivate).
 *   2. Idempotent check: already finalized (sold + all null + PP.freeze_finalized_at set) → ok.
 *   3. Idempotent check: already frozen (PP.frozen_reservation_token set, freeze_finalized_at null) → ok.
 *   4. Conflict check: different non-null token/buyer on either listing record → quarantine, alert, non-2xx.
 *   5. Expiration split-brain: Listing and LP have matching token/buyer but different expiration → quarantine, alert, non-2xx.
 *   6. Record PP: payment_captured=true, frozen_reservation_token, frozen_buyer_email, frozen_reservation_expires_at.
 *   7. Record Purchase: transfer_status=completed, payment_captured=true, buyer_confirmed=true.
 *   8. Quarantine listing (PRESERVE reservation fields, set recovery_not_before = now + drain).
 *   9. Verify all four records persisted correctly — re-fetch and check.
 *  10. Return non-2xx if ANY persistence or verification fails.
 *  Does NOT clear reservation fields. Does NOT mark listing sold.
 *
 * PHASE 2 — finalizeCapturedPayment (called by cleanup orchestrator after drain):
 *   1. Re-fetch all four records.
 *   2. Require both listing records to remain non-reservable (hidden + checkout_quarantine).
 *   3. Compare current reservation fields against PP's frozen tuple.
 *   4. If tuple matches → clear reservation fields, mark sold, un-quarantine, set freeze_finalized_at.
 *   5. If already sold + all null + freeze_finalized_at set → idempotent.
 *   6. If different non-null tuple → preserve it, set recovery_blocked, alert.
 *   7. Verify all final fields through re-fetching before returning success.
 *
 * deps = { entities, now }
 */
import {
  getPurchasePrivate, upsertPurchasePrivate,
  getListingPrivate, upsertListingPrivate,
  alertPrivateWriteFailure,
  quarantineListing,
} from './orchestratorHelpers.js';
import { QUARANTINE_DRAIN_MS } from './checkoutLogic.js';

// ── Phase 1: Freeze ──────────────────────────────────────────────────────────
export async function freezeCapturedPayment(deps, purchase, pp, pi) {
  if (!purchase || !pp || !pi) return { ok: false, step: 'input', error: 'missing arguments' };
  if (pi.status !== 'succeeded') return { ok: false, step: 'pi_status', error: `PI status ${pi.status}` };

  const listingId = pp.listing_id;
  const purchaseId = purchase.id;
  const originalToken = pp.reservation_token;
  const originalBuyer = pp.buyer_email;

  // ── Step 0: Re-fetch ALL FOUR records ─────────────────────────────────────
  const [listingFresh] = await deps.entities.Listing.filter({ id: listingId });
  const lpFresh = await getListingPrivate(deps, listingId);
  const [purchaseFresh] = await deps.entities.Purchase.filter({ id: purchaseId });
  const ppFresh = await getPurchasePrivate(deps, purchaseId);

  if (!listingFresh || !lpFresh || !purchaseFresh || !ppFresh) {
    return { ok: false, step: 'prefetch', error: 'missing record' };
  }

  // ── Step 0a: Idempotent — already finalized ────────────────────────────────
  const listingAllNull = !listingFresh.reservation_token && !listingFresh.reserved_by_email && !listingFresh.reservation_expires_at;
  const lpAllNull = !lpFresh.reservation_token && !lpFresh.reserved_by_email && !lpFresh.reservation_expires_at;
  if (listingFresh.status === 'sold' && listingAllNull && lpAllNull &&
      ppFresh.payment_captured === true && ppFresh.freeze_finalized_at) {
    return { ok: true, idempotent: true, phase: 'already_finalized' };
  }

  // ── Step 0b: Idempotent — already frozen, waiting for finalization ──────────
  // Require ALL freeze steps completed: PP frozen, Purchase completed, listing quarantined.
  // A partial freeze (e.g., PP written but Purchase not) must fall through and complete.
  if (ppFresh.frozen_reservation_token && !ppFresh.freeze_finalized_at &&
      ppFresh.payment_captured === true &&
      purchaseFresh.transfer_status === 'completed' && purchaseFresh.payment_captured === true &&
      listingFresh.status === 'hidden' && listingFresh.hidden_reason === 'checkout_quarantine' &&
      lpFresh.checkout_quarantined === true) {
    return { ok: true, idempotent: true, phase: 'already_frozen' };
  }

  // ── Step 0c: Conflict detection — different non-null reservation ──────────
  const listingHasConflictingToken = listingFresh.reservation_token && listingFresh.reservation_token !== originalToken;
  const lpHasConflictingToken = lpFresh.reservation_token && lpFresh.reservation_token !== originalToken;
  const listingHasConflictingBuyer = listingFresh.reserved_by_email && listingFresh.reserved_by_email !== originalBuyer;
  const lpHasConflictingBuyer = lpFresh.reserved_by_email && lpFresh.reserved_by_email !== originalBuyer;

  if (listingHasConflictingToken || lpHasConflictingToken || listingHasConflictingBuyer || lpHasConflictingBuyer) {
    // Quarantine preserves the newer reservation — does NOT clear it
    const qResult = await quarantineListing(deps, listingId,
      `Reconciliation conflict: newer reservation exists. PP token=${originalToken}, Listing token=${listingFresh.reservation_token}, LP token=${lpFresh.reservation_token}. Purchase: ${purchaseId}.`,
      purchaseId, pi.id);
    // Check the quarantine result — do NOT assume it succeeded
    let alertCreated = false;
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `Reconciliation conflict — newer reservation preserved — ${listingId}`,
        description: `PI ${pi.id} succeeded but listing has a different non-null reservation. PP token=${originalToken}, Listing token=${listingFresh.reservation_token}, LP token=${lpFresh.reservation_token}. Listing quarantined: ${qResult.quarantined}. Manual investigation required.`,
        reference_type: 'listing',
        reference_id: listingId,
      });
      alertCreated = true;
    } catch (_) { /* alert failure must not suppress the error */ }

    // If quarantine failed AND alert failed, return non-2xx with clear failure
    if (!qResult.quarantined && !alertCreated) {
      return { ok: false, step: 'conflict', error: 'newer reservation detected, quarantine AND alert both failed' };
    }
    return { ok: false, step: 'conflict', error: 'newer reservation preserved — listing quarantined' };
  }

  // ── Step 0d: Expiration split-brain detection ──────────────────────────────
  // Listing and LP have matching token/buyer but different expiration timestamps
  const lpExpiryMs = lpFresh.reservation_expires_at ? new Date(lpFresh.reservation_expires_at).getTime() : 0;
  const listingExpiryMs = listingFresh.reservation_expires_at ? new Date(listingFresh.reservation_expires_at).getTime() : 0;
  if (lpExpiryMs !== listingExpiryMs && lpExpiryMs > 0 && listingExpiryMs > 0) {
    const qResult = await quarantineListing(deps, listingId,
      `Expiration split-brain: Listing expiry=${listingFresh.reservation_expires_at}, LP expiry=${lpFresh.reservation_expires_at}. Token/buyer match but expiration differs. Purchase: ${purchaseId}.`,
      purchaseId, pi.id);
    let alertCreated = false;
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `Expiration split-brain — ${listingId}`,
        description: `PI ${pi.id} succeeded but Listing and LP have different expiration timestamps despite matching token/buyer. Listing: ${listingFresh.reservation_expires_at}, LP: ${lpFresh.reservation_expires_at}. Quarantined: ${qResult.quarantined}. Manual investigation required.`,
        reference_type: 'listing',
        reference_id: listingId,
      });
      alertCreated = true;
    } catch (_) { /* alert failure must not suppress the error */ }

    if (!qResult.quarantined && !alertCreated) {
      return { ok: false, step: 'expiration_split_brain', error: 'quarantine AND alert both failed' };
    }
    return { ok: false, step: 'expiration_split_brain', error: 'expiration mismatch — listing quarantined' };
  }

  // ── Step 1: Freeze PurchasePrivate — record immutable tuple ────────────────
  const frozenTuple = {
    payment_captured: true,
    payment_capture_failed: false,
    frozen_reservation_token: originalToken,
    frozen_buyer_email: originalBuyer,
    frozen_reservation_expires_at: ppFresh.reservation_expires_at,
  };
  try {
    await upsertPurchasePrivate(deps, purchaseId, frozenTuple);
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchaseId, reference_type: 'purchase', error: err });
    return { ok: false, step: 'pp_freeze', error: err?.message || 'PP freeze write failed' };
  }

  // ── Step 2: Freeze Purchase — financial state ──────────────────────────────
  try {
    await deps.entities.Purchase.update(purchaseId, {
      transfer_status: 'completed',
      payment_captured: true,
      payment_capture_failed: false,
      buyer_confirmed: true,
    });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'Purchase', reference_id: purchaseId, reference_type: 'purchase', error: err });
    return { ok: false, step: 'purchase_freeze', error: err?.message || 'Purchase freeze write failed' };
  }

  // ── Step 3: Quarantine listing — PRESERVE reservation fields ───────────────
  // quarantineListing sets Listing to hidden/checkout_quarantine and LP.checkout_quarantined=true
  // It does NOT clear reservation fields — they are preserved for Phase 2 comparison.
  const drainNotBefore = new Date(deps.now() + QUARANTINE_DRAIN_MS).toISOString();
  const qResult = await quarantineListing(deps, listingId,
    `Payment captured — pending finalization. PI: ${pi.id}. Purchase: ${purchaseId}. Frozen tuple: token=${originalToken}, buyer=${originalBuyer}.`,
    purchaseId, pi.id);

  // Set recovery_not_before for the drain period
  if (qResult.quarantined) {
    try {
      await upsertListingPrivate(deps, listingId, { recovery_not_before: drainNotBefore });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate', reference_id: listingId, reference_type: 'listing', error: err });
      return { ok: false, step: 'drain_set', error: err?.message || 'recovery_not_before write failed' };
    }
  } else {
    // Quarantine failed — check if it was already quarantined (idempotent) or genuinely failed
    // Re-fetch to check
    const [checkListing] = await deps.entities.Listing.filter({ id: listingId });
    const checkLP = await getListingPrivate(deps, listingId);
    if (!checkListing || checkListing.status !== 'hidden' || checkListing.hidden_reason !== 'checkout_quarantine' ||
        !checkLP || !checkLP.checkout_quarantined) {
      // Quarantine genuinely failed — return non-2xx
      let alertCreated = false;
      try {
        await deps.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `Freeze quarantine failed — ${listingId}`,
          description: `PI ${pi.id} succeeded but quarantine write failed. Purchase: ${purchaseId}. Payment captured but listing not quarantined. Manual resolution required.`,
          reference_type: 'listing',
          reference_id: listingId,
        });
        alertCreated = true;
      } catch (_) { /* alert failure must not suppress the error */ }
      return { ok: false, step: 'quarantine', error: alertCreated ? 'quarantine write failed — alert created' : 'quarantine AND alert both failed' };
    }
  }

  // ── Step 4: Verify ALL FOUR records persisted correctly ────────────────────
  const [verifyListing] = await deps.entities.Listing.filter({ id: listingId });
  const verifyLP = await getListingPrivate(deps, listingId);
  const [verifyPurchase] = await deps.entities.Purchase.filter({ id: purchaseId });
  const verifyPP = await getPurchasePrivate(deps, purchaseId);

  const listingFrozen = verifyListing?.status === 'hidden' && verifyListing?.hidden_reason === 'checkout_quarantine';
  const lpFrozen = verifyLP?.checkout_quarantined === true;
  // Reservation fields must be PRESERVED (not cleared)
  const reservationPreserved =
    verifyLP?.reservation_token !== null && verifyLP?.reservation_token !== undefined;
  const purchaseFrozen =
    verifyPurchase?.transfer_status === 'completed' &&
    verifyPurchase?.payment_captured === true;
  const ppFrozen =
    verifyPP?.payment_captured === true &&
    verifyPP?.frozen_reservation_token === originalToken &&
    verifyPP?.frozen_buyer_email === originalBuyer &&
    !verifyPP?.freeze_finalized_at;

  const allFrozen = listingFrozen && lpFrozen && purchaseFrozen && ppFrozen && reservationPreserved;

  if (!allFrozen) {
    await alertPrivateWriteFailure(deps, {
      entity: 'FreezeVerification', reference_id: purchaseId, reference_type: 'purchase',
      error: new Error(`Freeze verification failed. Listing.status=${verifyListing?.status}, LP.quarantined=${verifyLP?.checkout_quarantined}, LP.token=${verifyLP?.reservation_token}, Purchase.status=${verifyPurchase?.transfer_status}, PP.captured=${verifyPP?.payment_captured}, PP.frozen_token=${verifyPP?.frozen_reservation_token}, PP.finalized=${verifyPP?.freeze_finalized_at}`),
    });
    return { ok: false, step: 'verify', error: 'freeze verification failed — records not fully frozen' };
  }

  return { ok: true, phase: 'frozen' };
}

// ── Phase 2: Finalize ────────────────────────────────────────────────────────
// Called by the cleanup orchestrator after the drain period.
// Compares current reservation fields against PP's frozen tuple.
export async function finalizeCapturedPayment(deps, listingId) {
  // ── Step 0: Re-fetch all records ───────────────────────────────────────────
  const lpFresh = await getListingPrivate(deps, listingId);
  if (!lpFresh) return { ok: false, step: 'prefetch_lp', error: 'LP not found' };

  const purchaseId = lpFresh.quarantined_purchase_id;
  if (!purchaseId) return { ok: false, step: 'no_purchase', error: 'no quarantined_purchase_id' };

  const pp = await getPurchasePrivate(deps, purchaseId);
  if (!pp) return { ok: false, step: 'no_pp', error: 'PP not found' };

  const [purchase] = await deps.entities.Purchase.filter({ id: purchaseId });
  if (!purchase) return { ok: false, step: 'no_purchase_record', error: 'Purchase not found' };

  const [listing] = await deps.entities.Listing.filter({ id: listingId });
  if (!listing) return { ok: false, step: 'no_listing', error: 'Listing not found' };

  // ── Step 0a: Must be a capture freeze (PP has frozen tuple) ────────────────
  if (!pp.frozen_reservation_token || pp.payment_captured !== true) {
    return { ok: false, step: 'not_frozen', error: 'not a capture freeze quarantine' };
  }

  // ── Step 0b: Idempotent — already finalized ────────────────────────────────
  if (pp.freeze_finalized_at && listing.status === 'sold') {
    return { ok: true, idempotent: true, phase: 'already_finalized' };
  }

  // ── Step 1: Require both listing records to remain non-reservable ───────────
  if (listing.status !== 'hidden' || listing.hidden_reason !== 'checkout_quarantine') {
    return { ok: false, step: 'not_quarantined', error: `Listing not quarantined (status=${listing.status})` };
  }
  if (!lpFresh.checkout_quarantined) {
    return { ok: false, step: 'lp_not_quarantined', error: 'LP not quarantined' };
  }

  // ── Step 2: Compare current reservation fields against frozen tuple ────────
  const frozenToken = pp.frozen_reservation_token;
  const frozenBuyer = pp.frozen_buyer_email;

  const currentTokenListing = listing.reservation_token;
  const currentTokenLP = lpFresh.reservation_token;
  const currentBuyerListing = listing.reserved_by_email;
  const currentBuyerLP = lpFresh.reserved_by_email;

  // If any current field is a DIFFERENT non-null value → conflict
  const listingTokenConflict = currentTokenListing && currentTokenListing !== frozenToken;
  const lpTokenConflict = currentTokenLP && currentTokenLP !== frozenToken;
  const listingBuyerConflict = currentBuyerListing && currentBuyerListing !== frozenBuyer;
  const lpBuyerConflict = currentBuyerLP && currentBuyerLP !== frozenBuyer;

  if (listingTokenConflict || lpTokenConflict || listingBuyerConflict || lpBuyerConflict) {
    // Preserve the conflicting tuple — do NOT overwrite or clear
    try {
      await upsertListingPrivate(deps, listingId, {
        recovery_blocked: true,
        recovery_blocked_reason: `Finalization conflict: current reservation differs from frozen tuple. Frozen token=${frozenToken}, Listing token=${currentTokenListing}, LP token=${currentTokenLP}. Manual resolution required.`,
        recovery_blocked_at: new Date(deps.now()).toISOString(),
      });
    } catch (_) { /* best effort — alert is the durable record */ }
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `Finalization conflict — reservation mismatch — ${listingId}`,
        description: `Frozen token=${frozenToken}, buyer=${frozenBuyer}. Current Listing token=${currentTokenListing}, LP token=${currentTokenLP}. Listing buyer=${currentBuyerListing}, LP buyer=${currentBuyerLP}. Reservation preserved. Manual resolution required.`,
        reference_type: 'listing',
        reference_id: listingId,
      });
    } catch (_) { /* alert failure must not suppress the error */ }
    return { ok: false, step: 'conflict', error: 'current reservation differs from frozen tuple — preserved and blocked' };
  }

  // ── Step 3: Tuple matches (or fields are null) — safe to finalize ──────────
  // Clear reservation fields, mark sold, un-quarantine, set freeze_finalized_at

  // Step 3a: Clear ListingPrivate reservation fields
  try {
    await upsertListingPrivate(deps, listingId, {
      reservation_token: null,
      reserved_by_email: null,
      reservation_expires_at: null,
      checkout_quarantined: false,
      checkout_quarantine_reason: null,
      checkout_quarantined_at: null,
    });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate', reference_id: listingId, reference_type: 'listing', error: err });
    return { ok: false, step: 'lp_clear', error: err?.message || 'LP clear failed' };
  }

  // Step 3b: Clear Listing reservation fields and mark sold
  try {
    await deps.entities.Listing.update(listingId, {
      status: 'sold',
      reservation_token: null,
      reserved_by_email: null,
      reservation_expires_at: null,
      hidden_reason: null,
    });
  } catch (err) {
    // LP was already cleared — restore quarantine
    await restoreQuarantineState(deps, listingId, 'Listing sold write failed during finalization');
    await alertPrivateWriteFailure(deps, { entity: 'Listing', reference_id: listingId, reference_type: 'listing', error: err });
    return { ok: false, step: 'listing_sold', error: err?.message || 'Listing sold write failed' };
  }

  // Step 3c: Set freeze_finalized_at on PurchasePrivate
  try {
    await upsertPurchasePrivate(deps, purchaseId, {
      freeze_finalized_at: new Date(deps.now()).toISOString(),
    });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchaseId, reference_type: 'purchase', error: err });
    return { ok: false, step: 'pp_finalize', error: err?.message || 'PP finalize write failed' };
  }

  // ── Step 4: Re-fetch and verify ALL final fields ───────────────────────────
  const [verifyListing] = await deps.entities.Listing.filter({ id: listingId });
  const verifyLP = await getListingPrivate(deps, listingId);
  const verifyPP = await getPurchasePrivate(deps, purchaseId);

  const listingFinal =
    verifyListing?.status === 'sold' &&
    verifyListing?.reservation_token === null &&
    verifyListing?.reserved_by_email === null &&
    verifyListing?.reservation_expires_at === null &&
    verifyListing?.hidden_reason === null;
  const lpFinal =
    verifyLP?.reservation_token === null &&
    verifyLP?.reserved_by_email === null &&
    verifyLP?.reservation_expires_at === null &&
    verifyLP?.checkout_quarantined === false;
  const ppFinal = !!verifyPP?.freeze_finalized_at;

  const allFinal = listingFinal && lpFinal && ppFinal;

  if (!allFinal) {
    await alertPrivateWriteFailure(deps, {
      entity: 'FinalizeVerification', reference_id: purchaseId, reference_type: 'purchase',
      error: new Error(`Finalization verification failed. Listing.status=${verifyListing?.status}, Listing.token=${verifyListing?.reservation_token}, LP.token=${verifyLP?.reservation_token}, LP.quarantined=${verifyLP?.checkout_quarantined}, PP.finalized=${verifyPP?.freeze_finalized_at}`),
    });
    return { ok: false, step: 'verify', error: 'finalization verification failed — records not fully finalized' };
  }

  return { ok: true, phase: 'finalized' };
}

// Helper: restore quarantine state on failure
async function restoreQuarantineState(deps, listingId, reason) {
  try {
    await deps.entities.Listing.update(listingId, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
  } catch (_) { /* best effort */ }
  try {
    await upsertListingPrivate(deps, listingId, { checkout_quarantined: true, checkout_quarantine_reason: reason });
  } catch (_) { /* best effort */ }
}

// Backward-compatible export — delegates to freezeCapturedPayment
export async function reconcileCapturedPayment(deps, purchase, pp, pi) {
  return await freezeCapturedPayment(deps, purchase, pp, pi);
}