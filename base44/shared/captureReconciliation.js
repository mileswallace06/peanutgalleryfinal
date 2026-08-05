/**
 * captureReconciliation.js — Shared captured-payment reconciliation state machine.
 *
 * 7C.9C: Prevents old payments from destroying newer reservations.
 *
 * Used by BOTH captureOrchestrator.js (capturePayment) and webhookOrchestrator.js
 * (payment_intent.succeeded). This ensures that whether capture is triggered by
 * the frontend or by a Stripe webhook, the same idempotent four-record
 * reconciliation runs.
 *
 * CONFLICT DETECTION (7C.9C correction 1):
 *   Before writing, re-fetch all four records and compare reservation tuples.
 *   - If the listing is already sold AND every reservation field is null on
 *     both records AND PP says captured AND Purchase says completed → idempotent.
 *   - If both listing records contain the purchase's ORIGINAL reservation tuple
 *     (matching token + buyer) → safe to clear and mark sold.
 *   - If either record contains a DIFFERENT non-null token, buyer, or
 *     reservation generation → PRESERVE the newer reservation. Do NOT clear it
 *     or mark sold. Quarantine, create a critical alert, return non-2xx.
 *   - Partial old-state/null-state combinations may only be repaired if no
 *     conflicting non-null value exists.
 *
 * POST-WRITE VERIFICATION (7C.9C correction 6):
 *   A reservation is cleared only when ALL SIX authoritative fields are null:
 *   Listing token, Listing buyer, Listing expiration,
 *   ListingPrivate token, ListingPrivate buyer, ListingPrivate expiration.
 *   Injected failure of either expiration clear must make reconciliation fail.
 *
 * deps = { entities, now }
 * Returns: { ok: boolean, step?: string, error?: string, idempotent?: boolean }
 */
import {
  getPurchasePrivate, upsertPurchasePrivate,
  getListingPrivate, upsertListingPrivate,
  alertPrivateWriteFailure,
  quarantineListing,
} from './orchestratorHelpers.js';

export async function reconcileCapturedPayment(deps, purchase, pp, pi) {
  if (!purchase || !pp || !pi) return { ok: false, step: 'input', error: 'missing arguments' };
  if (pi.status !== 'succeeded') return { ok: false, step: 'pi_status', error: `PI status ${pi.status}` };

  const authoritativeListingId = pp.listing_id;
  const purchaseId = purchase.id;
  const originalToken = pp.reservation_token;
  const originalBuyer = pp.buyer_email;

  // ── Step 0: Re-fetch ALL FOUR records ─────────────────────────────────────
  const [listingFresh] = await deps.entities.Listing.filter({ id: authoritativeListingId });
  const lpFresh = await getListingPrivate(deps, authoritativeListingId);
  const [purchaseFresh] = await deps.entities.Purchase.filter({ id: purchaseId });
  const ppFresh = await getPurchasePrivate(deps, purchaseId);

  if (!listingFresh || !lpFresh || !purchaseFresh || !ppFresh) {
    return { ok: false, step: 'prefetch', error: 'missing record' };
  }

  // ── Step 0a: Idempotent completion check ───────────────────────────────────
  // Listing is already sold, all six reservation fields are null, PP captured,
  // Purchase completed → already done, return ok.
  const listingAllNull = !listingFresh.reservation_token && !listingFresh.reserved_by_email && !listingFresh.reservation_expires_at;
  const lpAllNull = !lpFresh.reservation_token && !lpFresh.reserved_by_email && !lpFresh.reservation_expires_at;

  if (listingFresh.status === 'sold' && listingAllNull && lpAllNull &&
      ppFresh.payment_captured === true && purchaseFresh.transfer_status === 'completed') {
    return { ok: true, idempotent: true };
  }

  // ── Step 0b: Conflict detection — different non-null reservation ──────────
  // If either listing record contains a DIFFERENT non-null token or buyer,
  // preserve it. Do not clear it or mark sold. Quarantine + alert.
  const listingHasConflictingToken = listingFresh.reservation_token && listingFresh.reservation_token !== originalToken;
  const lpHasConflictingToken = lpFresh.reservation_token && lpFresh.reservation_token !== originalToken;
  const listingHasConflictingBuyer = listingFresh.reserved_by_email && listingFresh.reserved_by_email !== originalBuyer;
  const lpHasConflictingBuyer = lpFresh.reserved_by_email && lpFresh.reserved_by_email !== originalBuyer;

  if (listingHasConflictingToken || lpHasConflictingToken || listingHasConflictingBuyer || lpHasConflictingBuyer) {
    // Quarantine the listing (preserves the newer reservation)
    try {
      await quarantineListing(deps, authoritativeListingId,
        `Reconciliation conflict: newer reservation exists. PP token=${originalToken}, Listing token=${listingFresh.reservation_token}, LP token=${lpFresh.reservation_token}. Purchase: ${purchaseId}.`,
        purchaseId, pi.id);
    } catch (_) { /* quarantineListing creates its own alerts */ }
    // Create a critical alert for investigation
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `Reconciliation conflict — newer reservation preserved — ${authoritativeListingId}`,
        description: `PI ${pi.id} succeeded but listing has a different non-null reservation. PP token=${originalToken}, Listing token=${listingFresh.reservation_token}, LP token=${lpFresh.reservation_token}. Listing quarantined. Manual investigation required.`,
        reference_type: 'listing',
        reference_id: authoritativeListingId,
      });
    } catch (_) { /* alert failure must not suppress the error */ }
    return { ok: false, step: 'conflict', error: 'newer reservation preserved — listing quarantined' };
  }

  // ── Step 0c: Safe to proceed — no conflicting non-null values ─────────────
  // Any non-null values match the purchase's original tuple. We can safely
  // clear them. Null values are already clear.

  // ── Step 1: PurchasePrivate (authoritative) ──────────────────────────────
  if (ppFresh.payment_captured !== true || ppFresh.payment_capture_failed !== false) {
    try {
      await upsertPurchasePrivate(deps, purchaseId, { payment_captured: true, payment_capture_failed: false });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchaseId, reference_type: 'purchase', error: err });
      return { ok: false, step: 'pp', error: err?.message || 'PP write failed' };
    }
  }

  // ── Step 2: Purchase (mirror) — includes buyer_confirmed ──────────────────
  const purchaseNeedsUpdate =
    purchaseFresh.transfer_status !== 'completed' ||
    purchaseFresh.payment_captured !== true ||
    purchaseFresh.payment_capture_failed !== false ||
    purchaseFresh.buyer_confirmed !== true;
  if (purchaseNeedsUpdate) {
    try {
      await deps.entities.Purchase.update(purchaseId, {
        transfer_status: 'completed',
        payment_captured: true,
        payment_capture_failed: false,
        buyer_confirmed: true,
      });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'Purchase', reference_id: purchaseId, reference_type: 'purchase', error: err });
      return { ok: false, step: 'purchase', error: err?.message || 'Purchase write failed' };
    }
  }

  // ── Step 3: ListingPrivate (clear ALL reservation fields) ──────────────────
  if (lpFresh.reservation_token || lpFresh.reserved_by_email || lpFresh.reservation_expires_at) {
    try {
      await upsertListingPrivate(deps, authoritativeListingId, {
        reserved_by_email: null, reservation_token: null, reservation_expires_at: null,
      });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate', reference_id: authoritativeListingId, reference_type: 'listing', error: err });
      return { ok: false, step: 'lp', error: err?.message || 'LP write failed' };
    }
  }

  // ── Step 4: Listing (sold + clear ALL reservation fields) ──────────────────
  const listingNeedsUpdate =
    listingFresh.status !== 'sold' ||
    listingFresh.reservation_token ||
    listingFresh.reserved_by_email ||
    listingFresh.reservation_expires_at;
  if (listingNeedsUpdate) {
    try {
      await deps.entities.Listing.update(authoritativeListingId, {
        status: 'sold',
        reservation_token: null,
        reservation_expires_at: null,
        reserved_by_email: null,
      });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'Listing', reference_id: authoritativeListingId, reference_type: 'listing', error: err });
      return { ok: false, step: 'listing', error: err?.message || 'Listing write failed' };
    }
  }

  // ── Step 5: Re-fetch and verify ALL FOUR records ──────────────────────────
  // Verification includes status, token, buyer, AND reservation_expires_at
  // on BOTH listing records (6 fields total for reservation clearing).
  const [verifyListing] = await deps.entities.Listing.filter({ id: authoritativeListingId });
  const verifyLP = await getListingPrivate(deps, authoritativeListingId);
  const [verifyPurchase] = await deps.entities.Purchase.filter({ id: purchaseId });
  const verifyPP = await getPurchasePrivate(deps, purchaseId);

  const listingCleared =
    verifyListing?.status === 'sold' &&
    verifyListing?.reservation_token === null &&
    verifyListing?.reserved_by_email === null &&
    verifyListing?.reservation_expires_at === null;
  const lpCleared =
    verifyLP?.reservation_token === null &&
    verifyLP?.reserved_by_email === null &&
    verifyLP?.reservation_expires_at === null;
  const purchaseConsistent =
    verifyPurchase?.transfer_status === 'completed' &&
    verifyPurchase?.payment_captured === true &&
    verifyPurchase?.payment_capture_failed === false &&
    verifyPurchase?.buyer_confirmed === true;
  const ppConsistent =
    verifyPP?.payment_captured === true &&
    verifyPP?.payment_capture_failed === false;

  const allConsistent = listingCleared && lpCleared && purchaseConsistent && ppConsistent;

  if (!allConsistent) {
    await alertPrivateWriteFailure(deps, {
      entity: 'CaptureVerification', reference_id: purchaseId, reference_type: 'purchase',
      error: new Error(`Post-capture verification failed. Listing.status=${verifyListing?.status}, Listing.token=${verifyListing?.reservation_token}, Listing.expiry=${verifyListing?.reservation_expires_at}, LP.token=${verifyLP?.reservation_token}, LP.expiry=${verifyLP?.reservation_expires_at}, Purchase.status=${verifyPurchase?.transfer_status}, PP.captured=${verifyPP?.payment_captured}`),
    });
    return { ok: false, step: 'verify', error: 'consistency check failed — reservation not fully cleared' };
  }

  return { ok: true };
}