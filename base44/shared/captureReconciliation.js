/**
 * captureReconciliation.js — Two-phase freeze-and-finalize reconciliation.
 *
 * 7C.9C.2: Complete frozen tuple (token + buyer + expiration + revision),
 * authoritative expiration sourcing from Listing/LP, exact Phase 1/2
 * verification, partial-freeze detection, null-tuple rejection, and
 * partial-finalization state machine with finalization_started_at marker.
 *
 * PHASE 1 — freezeCapturedPayment:
 *   1. Re-fetch all four records.
 *   2. Derive expiration from Listing and ListingPrivate (both must match exactly, both non-null).
 *   3. Read reservation_revision from Listing and ListingPrivate (both must match).
 *   4. Idempotent: already_finalized — verify ALL fields (PP finalized, Purchase completed,
 *      Listing sold+null, LP null+not quarantined, no conflicting tuple).
 *   5. Idempotent: already_frozen — verify ALL freeze steps (PP frozen tuple complete,
 *      Purchase completed, Listing hidden+quarantine, LP quarantined, reservation
 *      preserved on BOTH records, drain set, revision matches).
 *   6. Conflict: different non-null token/buyer/expiration/revision → quarantine, alert, non-2xx.
 *   7. Record PP: payment_captured, frozen_reservation_token, frozen_buyer_email,
 *      frozen_reservation_expires_at (from Listing/LP), frozen_reservation_revision.
 *   8. Record Purchase: completed, captured, buyer_confirmed.
 *   9. Quarantine listing (PRESERVE reservation fields, set recovery_not_before).
 *  10. Verify ALL four records — re-fetch and check every required field.
 *
 * PHASE 2 — finalizeCapturedPayment:
 *   1. Re-fetch all four records.
 *   2. Already-finalized idempotency: verify ALL fields (PP finalized, Purchase completed,
 *      Listing sold+null, LP null+not quarantined, no conflicting tuple).
 *   3. Require PP frozen tuple (all four fields non-null).
 *   4. Require both listing records hidden + checkout_quarantine.
 *   5. Compare complete tuple (token + buyer + expiration + revision) on BOTH Listing and LP.
 *      All four fields must be non-null and exactly match the frozen tuple.
 *      Null/partially-null → block, preserve, alert, non-2xx.
 *   6. Set finalization_started_at on PP BEFORE clearing any reservation field.
 *   7. Clear LP reservation fields (token, buyer, expiration, revision, quarantine).
 *   8. Clear Listing reservation fields, mark sold.
 *   9. Set freeze_finalized_at on PP.
 *  10. Verify ALL final fields through re-fetching.
 *
 * PARTIAL-FINALIZATION STATE MACHINE:
 *   On retry after partial failure:
 *   - If finalization_started_at exists AND current tuple matches frozen tuple →
 *     continue from where left off (idempotent writes to already-cleared fields).
 *   - If finalization_started_at exists AND a DIFFERENT non-null tuple exists →
 *     block, preserve, alert, non-2xx.
 *   - If finalization_started_at does NOT exist AND tuples are null →
 *     NOT a valid state (no verified finalization progress) → block, alert, non-2xx.
 *   - If finalization_started_at does NOT exist AND tuples match frozen tuple →
 *     normal first-time finalization.
 */
import {
  getPurchasePrivate, upsertPurchasePrivate,
  getListingPrivate, upsertListingPrivate,
  alertPrivateWriteFailure,
  quarantineListing,
  durableBlockAndAlert,
  initializeLegacyRevision,
} from './orchestratorHelpers.js';
import { QUARANTINE_DRAIN_MS } from './checkoutLogic.js';

// ── Helper: compare complete reservation tuple ───────────────────────────────
// Returns true ONLY when all four fields are non-null AND exactly match.
// Null/partially-null is NEVER a match.
function tupleMatches(record, frozenToken, frozenBuyer, frozenExpiry, frozenRevision) {
  if (!record) return false;
  if (!record.reservation_token || !record.reserved_by_email || !record.reservation_expires_at || !record.reservation_revision) return false;
  return record.reservation_token === frozenToken &&
    record.reserved_by_email === frozenBuyer &&
    record.reservation_expires_at === frozenExpiry &&
    record.reservation_revision === frozenRevision;
}

// ── Helper: check if all reservation fields are null ─────────────────────────
function tupleIsNull(record) {
  if (!record) return true;
  return !record.reservation_token && !record.reserved_by_email && !record.reservation_expires_at && !record.reservation_revision;
}

// ── Helper: verify already-finalized state (complete) ────────────────────────
function isFullyFinalized(listing, lp, purchase, pp) {
  if (!listing || !lp || !purchase || !pp) return false;
  if (!pp.freeze_finalized_at) return false;
  if (pp.payment_captured !== true) return false;
  if (purchase.transfer_status !== 'completed' || purchase.payment_captured !== true) return false;
  if (listing.status !== 'sold') return false;
  if (listing.reservation_token || listing.reserved_by_email || listing.reservation_expires_at || listing.reservation_revision) return false;
  if (lp.reservation_token || lp.reserved_by_email || lp.reservation_expires_at || lp.reservation_revision) return false;
  if (lp.checkout_quarantined !== false) return false;
  return true;
}

// ── Phase 1: Freeze ──────────────────────────────────────────────────────────
export async function freezeCapturedPayment(deps, purchase, pp, pi) {
  if (!purchase || !pp || !pi) return { ok: false, step: 'input', error: 'missing arguments' };
  if (pi.status !== 'succeeded') return { ok: false, step: 'pi_status', error: `PI status ${pi.status}` };

  const listingId = pp.listing_id;
  const purchaseId = purchase.id;
  const originalToken = pp.reservation_token;
  const originalBuyer = pp.buyer_email;

  // ── Step 0: Re-fetch ALL FOUR records ─────────────────────────────────────
  let [listingFresh] = await deps.entities.Listing.filter({ id: listingId });
  let lpFresh = await getListingPrivate(deps, listingId);
  const [purchaseFresh] = await deps.entities.Purchase.filter({ id: purchaseId });
  const ppFresh = await getPurchasePrivate(deps, purchaseId);

  if (!listingFresh || !lpFresh || !purchaseFresh || !ppFresh) {
    return { ok: false, step: 'prefetch', error: 'missing record' };
  }

  // ── Step 0a: Idempotent — already finalized (complete verification) ────────
  if (isFullyFinalized(listingFresh, lpFresh, purchaseFresh, ppFresh)) {
    return { ok: true, idempotent: true, phase: 'already_finalized' };
  }

  // ── Step 0b: Idempotent — already frozen (complete verification) ────────────
  // Require ALL freeze steps completed: PP frozen tuple complete, Purchase completed,
  // Listing hidden+quarantine, LP quarantined, reservation preserved on BOTH records,
  // drain set, revision matches frozen value.
  if (ppFresh.frozen_reservation_token && !ppFresh.freeze_finalized_at &&
      ppFresh.payment_captured === true &&
      ppFresh.frozen_buyer_email && ppFresh.frozen_reservation_expires_at && ppFresh.frozen_reservation_revision &&
      purchaseFresh.transfer_status === 'completed' && purchaseFresh.payment_captured === true &&
      listingFresh.status === 'hidden' && listingFresh.hidden_reason === 'checkout_quarantine' &&
      lpFresh.checkout_quarantined === true &&
      lpFresh.recovery_not_before &&
      listingFresh.reservation_token === ppFresh.frozen_reservation_token &&
      listingFresh.reserved_by_email === ppFresh.frozen_buyer_email &&
      listingFresh.reservation_expires_at === ppFresh.frozen_reservation_expires_at &&
      listingFresh.reservation_revision === ppFresh.frozen_reservation_revision &&
      lpFresh.reservation_token === ppFresh.frozen_reservation_token &&
      lpFresh.reserved_by_email === ppFresh.frozen_buyer_email &&
      lpFresh.reservation_expires_at === ppFresh.frozen_reservation_expires_at &&
      lpFresh.reservation_revision === ppFresh.frozen_reservation_revision) {
    return { ok: true, idempotent: true, phase: 'already_frozen' };
  }

  // ── Step 0c: Derive expiration from Listing and ListingPrivate ─────────────
  // Both must match exactly and be non-null. Never source from PurchasePrivate.
  const listingExpiry = listingFresh.reservation_expires_at;
  const lpExpiry = lpFresh.reservation_expires_at;
  if (!listingExpiry || !lpExpiry) {
    return { ok: false, step: 'no_expiration', error: 'reservation expiration missing on Listing or LP' };
  }
  if (listingExpiry !== lpExpiry) {
    // Expiration split-brain — quarantine, durably block+alert, non-2xx
    const qResult = await quarantineListing(deps, listingId,
      `Expiration split-brain: Listing expiry=${listingExpiry}, LP expiry=${lpExpiry}. Purchase: ${purchaseId}.`,
      purchaseId, pi.id);
    const blockResult = await durableBlockAndAlert(deps, listingId,
      `Expiration split-brain: Listing expiry=${listingExpiry}, LP expiry=${lpExpiry}. PI: ${pi.id}. Quarantined: ${qResult.quarantined}. Manual resolution required.`,
      pi.id);
    if (!qResult.quarantined && !blockResult.blocked && !blockResult.alerted) {
      return { ok: false, step: 'expiration_split_brain', error: 'quarantine, block, AND alert all failed' };
    }
    return { ok: false, step: 'expiration_split_brain', error: 'expiration mismatch — listing quarantined', quarantined: qResult.quarantined, blocked: blockResult.blocked, alerted: blockResult.alerted };
  }
  const derivedExpiry = listingExpiry; // From Listing (verified == LP)

  // ── Step 0d: Read reservation_revision from Listing and ListingPrivate ────
  const listingRev = listingFresh.reservation_revision;
  const lpRev = lpFresh.reservation_revision;
  if (!listingRev || !lpRev) {
    // Legacy revision initialization — safe compatibility path
    const initResult = await initializeLegacyRevision(deps, listingId);
    if (!initResult.ok) {
      return { ok: false, step: 'legacy_revision_init', error: initResult.error };
    }
    // Re-fetch after initialization
    const [listingAfterInit] = await deps.entities.Listing.filter({ id: listingId });
    const lpAfterInit = await getListingPrivate(deps, listingId);
    if (!listingAfterInit?.reservation_revision || !lpAfterInit?.reservation_revision) {
      return { ok: false, step: 'legacy_revision_init_verify', error: 'revision not persisted after initialization' };
    }
    if (listingAfterInit.reservation_revision !== lpAfterInit.reservation_revision) {
      return { ok: false, step: 'legacy_revision_init_mismatch', error: 'revision mismatch after initialization' };
    }
    // Update local references with initialized revision
    listingFresh = listingAfterInit;
    lpFresh = lpAfterInit;
  }
  const derivedRevision = listingFresh.reservation_revision;

  // ── Step 0e: Conflict detection — different non-null reservation ──────────
  const listingHasConflictingToken = listingFresh.reservation_token && listingFresh.reservation_token !== originalToken;
  const lpHasConflictingToken = lpFresh.reservation_token && lpFresh.reservation_token !== originalToken;
  const listingHasConflictingBuyer = listingFresh.reserved_by_email && listingFresh.reserved_by_email !== originalBuyer;
  const lpHasConflictingBuyer = lpFresh.reserved_by_email && lpFresh.reserved_by_email !== originalBuyer;

  if (listingHasConflictingToken || lpHasConflictingToken || listingHasConflictingBuyer || lpHasConflictingBuyer) {
    const qResult = await quarantineListing(deps, listingId,
      `Reconciliation conflict: newer reservation exists. PP token=${originalToken}, Listing token=${listingFresh.reservation_token}, LP token=${lpFresh.reservation_token}. Purchase: ${purchaseId}.`,
      purchaseId, pi.id);
    const blockResult = await durableBlockAndAlert(deps, listingId,
      `Reconciliation conflict: newer reservation exists. PP token=${originalToken}, Listing token=${listingFresh.reservation_token}, LP token=${lpFresh.reservation_token}. PI: ${pi.id}. Quarantined: ${qResult.quarantined}. Manual resolution required.`,
      pi.id, `Reconciliation conflict — newer reservation preserved — ${listingId}`);
    if (!qResult.quarantined && !blockResult.blocked && !blockResult.alerted) {
      return { ok: false, step: 'conflict', error: 'quarantine, block, AND alert all failed' };
    }
    return { ok: false, step: 'conflict', error: `conflict detected — quarantined=${qResult.quarantined}, blocked=${blockResult.blocked}, alerted=${blockResult.alerted}`, quarantined: qResult.quarantined, blocked: blockResult.blocked, alerted: blockResult.alerted };
  }

  // ── Step 1: Freeze PurchasePrivate — record immutable tuple ────────────────
  const frozenTuple = {
    payment_captured: true,
    payment_capture_failed: false,
    frozen_reservation_token: originalToken,
    frozen_buyer_email: originalBuyer,
    frozen_reservation_expires_at: derivedExpiry,
    frozen_reservation_revision: derivedRevision,
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
  const drainNotBefore = new Date(deps.now() + QUARANTINE_DRAIN_MS).toISOString();
  const qResult = await quarantineListing(deps, listingId,
    `Payment captured — pending finalization. PI: ${pi.id}. Purchase: ${purchaseId}. Frozen tuple: token=${originalToken}, buyer=${originalBuyer}, expiry=${derivedExpiry}, revision=${derivedRevision}.`,
    purchaseId, pi.id);

  if (qResult.quarantined) {
    try {
      await upsertListingPrivate(deps, listingId, { recovery_not_before: drainNotBefore });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate', reference_id: listingId, reference_type: 'listing', error: err });
      return { ok: false, step: 'drain_set', error: err?.message || 'recovery_not_before write failed' };
    }
  } else {
    // Quarantine failed — check if already quarantined (idempotent) or genuinely failed
    const [checkListing] = await deps.entities.Listing.filter({ id: listingId });
    const checkLP = await getListingPrivate(deps, listingId);
    if (!checkListing || checkListing.status !== 'hidden' || checkListing.hidden_reason !== 'checkout_quarantine' ||
        !checkLP || !checkLP.checkout_quarantined) {
      let alertCreated = false;
      try {
        await deps.entities.AdminAlert.create({
          alert_type: 'admin_action_required', priority: 'critical',
          title: `Freeze quarantine failed — ${listingId}`,
          description: `PI ${pi.id} succeeded but quarantine write failed. Purchase: ${purchaseId}. Manual resolution required.`,
          reference_type: 'listing', reference_id: listingId,
        });
        alertCreated = true;
      } catch (_) { /* alert failure must not suppress the error */ }
      return { ok: false, step: 'quarantine', error: alertCreated ? 'quarantine write failed — alert created' : 'quarantine AND alert both failed' };
    }
    // Already quarantined — set drain
    try {
      await upsertListingPrivate(deps, listingId, { recovery_not_before: drainNotBefore });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate', reference_id: listingId, reference_type: 'listing', error: err });
      return { ok: false, step: 'drain_set', error: err?.message || 'recovery_not_before write failed' };
    }
  }

  // ── Step 4: Verify ALL FOUR records persisted correctly ────────────────────
  const [verifyListing] = await deps.entities.Listing.filter({ id: listingId });
  const verifyLP = await getListingPrivate(deps, listingId);
  const [verifyPurchase] = await deps.entities.Purchase.filter({ id: purchaseId });
  const verifyPP = await getPurchasePrivate(deps, purchaseId);

  const listingFrozen = verifyListing?.status === 'hidden' && verifyListing?.hidden_reason === 'checkout_quarantine';
  const lpFrozen = verifyLP?.checkout_quarantined === true;
  const lpDrainSet = !!verifyLP?.recovery_not_before;
  // Reservation fields must be PRESERVED on BOTH records (not cleared)
  const listingTuplePreserved = verifyListing?.reservation_token === originalToken &&
    verifyListing?.reserved_by_email === originalBuyer &&
    verifyListing?.reservation_expires_at === derivedExpiry &&
    verifyListing?.reservation_revision === derivedRevision;
  const lpTuplePreserved = verifyLP?.reservation_token === originalToken &&
    verifyLP?.reserved_by_email === originalBuyer &&
    verifyLP?.reservation_expires_at === derivedExpiry &&
    verifyLP?.reservation_revision === derivedRevision;
  const purchaseFrozen = verifyPurchase?.transfer_status === 'completed' && verifyPurchase?.payment_captured === true;
  const ppFrozen = verifyPP?.payment_captured === true &&
    verifyPP?.frozen_reservation_token === originalToken &&
    verifyPP?.frozen_buyer_email === originalBuyer &&
    verifyPP?.frozen_reservation_expires_at === derivedExpiry &&
    verifyPP?.frozen_reservation_revision === derivedRevision &&
    !verifyPP?.freeze_finalized_at;

  const allFrozen = listingFrozen && lpFrozen && lpDrainSet && listingTuplePreserved && lpTuplePreserved && purchaseFrozen && ppFrozen;

  if (!allFrozen) {
    await alertPrivateWriteFailure(deps, {
      entity: 'FreezeVerification', reference_id: purchaseId, reference_type: 'purchase',
      error: new Error(`Freeze verification failed. listingFrozen=${listingFrozen}, lpFrozen=${lpFrozen}, drainSet=${lpDrainSet}, listingTuple=${listingTuplePreserved}, lpTuple=${lpTuplePreserved}, purchaseFrozen=${purchaseFrozen}, ppFrozen=${ppFrozen}`),
    });
    return { ok: false, step: 'verify', error: 'freeze verification failed — records not fully frozen' };
  }

  return { ok: true, phase: 'frozen' };
}

// ── Phase 2: Finalize ────────────────────────────────────────────────────────
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

  // ── Step 0a: Must be a capture freeze (PP has complete frozen tuple) ────────
  if (!pp.frozen_reservation_token || !pp.frozen_buyer_email ||
      !pp.frozen_reservation_expires_at || !pp.frozen_reservation_revision ||
      pp.payment_captured !== true) {
    return { ok: false, step: 'not_frozen', error: 'not a complete capture freeze tuple' };
  }

  const frozenToken = pp.frozen_reservation_token;
  const frozenBuyer = pp.frozen_buyer_email;
  const frozenExpiry = pp.frozen_reservation_expires_at;
  const frozenRevision = pp.frozen_reservation_revision;

  // ── Step 0b: Already-finalized idempotency (complete verification) ──────────
  if (isFullyFinalized(listing, lpFresh, purchase, pp)) {
    return { ok: true, idempotent: true, phase: 'already_finalized' };
  }

  // ── Step 1: Determine finalization phase ────────────────────────────────────
  const hasFinalizationStarted = !!pp.finalization_started_at;

  // ── Step 1a (first-time only): Require both listing records quarantined ─────
  if (!hasFinalizationStarted) {
    if (listing.status !== 'hidden' || listing.hidden_reason !== 'checkout_quarantine') {
      return { ok: false, step: 'not_quarantined', error: `Listing not quarantined (status=${listing.status})` };
    }
    if (!lpFresh.checkout_quarantined) {
      return { ok: false, step: 'lp_not_quarantined', error: 'LP not quarantined' };
    }
  }

  // ── Step 2: Compare complete tuple on BOTH Listing and ListingPrivate ───────
  // All four fields must be non-null and exactly match the frozen tuple.
  // Null/partially-null is NOT a match — unless finalization_started_at proves
  // this is a partial-finalization retry for the same frozen tuple.
  const listingMatches = tupleMatches(listing, frozenToken, frozenBuyer, frozenExpiry, frozenRevision);
  const lpMatches = tupleMatches(lpFresh, frozenToken, frozenBuyer, frozenExpiry, frozenRevision);
  const listingNull = tupleIsNull(listing);
  const lpNull = tupleIsNull(lpFresh);

  // Determine if we can proceed and which steps remain
  let needClearLP, needClearListing, needSetFinalized;

  if (listingMatches && lpMatches) {
    // Both match — normal first-time or retry before any clearing
    needClearLP = true; needClearListing = true; needSetFinalized = true;
  }
  else if (hasFinalizationStarted && listingNull && lpMatches) {
    // State B: Listing already cleared, LP still has tuple — clear LP, ensure Listing sold, finalize
    needClearLP = true; needClearListing = true; needSetFinalized = true;
  }
  else if (hasFinalizationStarted && lpNull && listingMatches) {
    // LP reservation fields cleared but may still be quarantined, Listing still has tuple
    needClearLP = true; needClearListing = true; needSetFinalized = true;
  }
  else if (hasFinalizationStarted && listingNull && lpNull) {
    // Both reservation tuples cleared but not yet finalized
    needClearLP = lpFresh.checkout_quarantined !== false;
    needClearListing = listing.status !== 'sold';
    needSetFinalized = true;
  }
  else {
    // State E: Any different non-null field exists → preserve, durably block, alert, non-2xx
    const blockResult = await durableBlockAndAlert(deps, listingId,
      `Finalization blocked: tuple does not match frozen tuple and no verified finalization progress. Frozen token=${frozenToken}, Listing token=${listing?.reservation_token}, LP token=${lpFresh?.reservation_token}. ListingNull=${listingNull}, LPNull=${lpNull}, hasFinalizationStarted=${hasFinalizationStarted}. Manual resolution required.`,
      null);
    return { ok: false, step: 'conflict', error: 'current reservation does not match frozen tuple and no verified finalization progress — preserved', blocked: blockResult.blocked, alerted: blockResult.alerted };
  }

  // ── Step 3a: Set finalization_started_at BEFORE clearing any field ──────────
  if (!hasFinalizationStarted) {
    try {
      await upsertPurchasePrivate(deps, purchaseId, {
        finalization_started_at: new Date(deps.now()).toISOString(),
      });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchaseId, reference_type: 'purchase', error: err });
      return { ok: false, step: 'finalization_start', error: err?.message || 'finalization_started_at write failed' };
    }
    const ppCheck = await getPurchasePrivate(deps, purchaseId);
    if (!ppCheck?.finalization_started_at) {
      return { ok: false, step: 'finalization_start_verify', error: 'finalization_started_at not persisted' };
    }
  }

  // ── Step 3b: Clear ListingPrivate reservation fields ───────────────────────
  if (needClearLP) {
    try {
      await upsertListingPrivate(deps, listingId, {
        reservation_token: null,
        reserved_by_email: null,
        reservation_expires_at: null,
        reservation_revision: null,
        checkout_quarantined: false,
        checkout_quarantine_reason: null,
        checkout_quarantined_at: null,
      });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate', reference_id: listingId, reference_type: 'listing', error: err });
      return { ok: false, step: 'lp_clear', error: err?.message || 'LP clear failed' };
    }
    const lpCheck = await getListingPrivate(deps, listingId);
    // Verify ALL reservation fields are null AND quarantine fields cleared
    if (lpCheck?.reservation_token || lpCheck?.reserved_by_email || lpCheck?.reservation_expires_at ||
        lpCheck?.reservation_revision || lpCheck?.checkout_quarantined !== false ||
        lpCheck?.checkout_quarantine_reason || lpCheck?.checkout_quarantined_at) {
      if (lpCheck?.reservation_token && lpCheck.reservation_token !== frozenToken) {
        const blockResult = await durableBlockAndAlert(deps, listingId,
          `Conflicting token appeared during LP clear: ${lpCheck.reservation_token} vs frozen ${frozenToken}. Manual resolution required.`,
          null);
        return { ok: false, step: 'lp_clear_conflict', error: 'conflicting token appeared during LP clear — preserved', blocked: blockResult.blocked, alerted: blockResult.alerted };
      }
      return { ok: false, step: 'lp_clear_verify', error: `LP not fully cleared: token=${lpCheck?.reservation_token}, buyer=${lpCheck?.reserved_by_email}, expiry=${lpCheck?.reservation_expires_at}, revision=${lpCheck?.reservation_revision}, quarantined=${lpCheck?.checkout_quarantined}, reason=${lpCheck?.checkout_quarantine_reason}, ts=${lpCheck?.checkout_quarantined_at}` };
    }
  }

  // ── Step 3c: Clear Listing reservation fields and mark sold ────────────────
  if (needClearListing) {
    if (listing.status !== 'sold') {
      try {
        await deps.entities.Listing.update(listingId, {
          status: 'sold',
          reservation_token: null,
          reserved_by_email: null,
          reservation_expires_at: null,
          reservation_revision: null,
          hidden_reason: null,
        });
      } catch (err) {
        try { await deps.entities.Listing.update(listingId, { status: 'hidden', hidden_reason: 'checkout_quarantine' }); } catch (_) {}
        try { await upsertListingPrivate(deps, listingId, { checkout_quarantined: true, checkout_quarantine_reason: 'Listing sold write failed during finalization' }); } catch (_) {}
        await alertPrivateWriteFailure(deps, { entity: 'Listing', reference_id: listingId, reference_type: 'listing', error: err });
        return { ok: false, step: 'listing_sold', error: err?.message || 'Listing sold write failed' };
      }
      const [listingCheck] = await deps.entities.Listing.filter({ id: listingId });
      // Verify ALL fields: status sold, token null, buyer null, expiry null, revision null, hidden reason null
      if (listingCheck?.status !== 'sold' || listingCheck?.reservation_token ||
          listingCheck?.reserved_by_email || listingCheck?.reservation_expires_at ||
          listingCheck?.reservation_revision || listingCheck?.hidden_reason) {
        if (listingCheck?.reservation_token && listingCheck.reservation_token !== frozenToken) {
          const blockResult = await durableBlockAndAlert(deps, listingId,
            `Conflicting token on Listing during sold write: ${listingCheck.reservation_token} vs frozen ${frozenToken}. Manual resolution required.`,
            null);
          return { ok: false, step: 'listing_sold_conflict', error: 'conflicting token on Listing — preserved', blocked: blockResult.blocked, alerted: blockResult.alerted };
        }
        return { ok: false, step: 'listing_sold_verify', error: `Listing not fully sold/cleared: status=${listingCheck?.status}, token=${listingCheck?.reservation_token}, buyer=${listingCheck?.reserved_by_email}, expiry=${listingCheck?.reservation_expires_at}, revision=${listingCheck?.reservation_revision}, hiddenReason=${listingCheck?.hidden_reason}` };
      }
    }
  }

  // ── Step 3d: Set freeze_finalized_at on PurchasePrivate ────────────────────
  if (!pp.freeze_finalized_at) {
    try {
      await upsertPurchasePrivate(deps, purchaseId, {
        freeze_finalized_at: new Date(deps.now()).toISOString(),
      });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchaseId, reference_type: 'purchase', error: err });
      return { ok: false, step: 'pp_finalize', error: err?.message || 'PP finalize write failed' };
    }
  }

  // ── Step 4: Re-fetch and verify ALL final fields ───────────────────────────
  const [verifyListing] = await deps.entities.Listing.filter({ id: listingId });
  const verifyLP = await getListingPrivate(deps, listingId);
  const verifyPP = await getPurchasePrivate(deps, purchaseId);
  const [verifyPurchase] = await deps.entities.Purchase.filter({ id: purchaseId });

  if (!isFullyFinalized(verifyListing, verifyLP, verifyPurchase, verifyPP)) {
    await alertPrivateWriteFailure(deps, {
      entity: 'FinalizeVerification', reference_id: purchaseId, reference_type: 'purchase',
      error: new Error(`Finalization verification failed. Listing.status=${verifyListing?.status}, Listing.token=${verifyListing?.reservation_token}, LP.token=${verifyLP?.reservation_token}, LP.quarantined=${verifyLP?.checkout_quarantined}, PP.finalized=${verifyPP?.freeze_finalized_at}, Purchase.status=${verifyPurchase?.transfer_status}`),
    });
    return { ok: false, step: 'verify', error: 'finalization verification failed — records not fully finalized' };
  }

  return { ok: true, phase: 'finalized' };
}

// Backward-compatible export — delegates to freezeCapturedPayment
export async function reconcileCapturedPayment(deps, purchase, pp, pi) {
  return await freezeCapturedPayment(deps, purchase, pp, pi);
}