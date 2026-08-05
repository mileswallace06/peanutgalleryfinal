/**
 * captureReconciliation.js — Shared captured-payment reconciliation state machine.
 *
 * Used by BOTH captureOrchestrator.js (capturePayment) and webhookOrchestrator.js
 * (payment_intent.succeeded). This ensures that whether capture is triggered by
 * the frontend or by a Stripe webhook, the same idempotent four-record
 * reconciliation runs.
 *
 * PRINCIPLE: If the Stripe PI is verified `succeeded`, reconcile ALL FOUR records
 * every time — regardless of which records are already set. This makes the
 * function retry-safe: a failure at any write boundary can be retried and will
 * converge to a consistent final state.
 *
 * Does NOT require an active reservation — uses exact immutable PI metadata and
 * authoritative PurchasePrivate ownership. This is critical for the webhook path
 * where the reservation may have already been cleared by a prior partial run.
 *
 * deps = { entities, now }
 * Returns: { ok: boolean, step?: string, error?: string }
 */
import {
  getPurchasePrivate, upsertPurchasePrivate,
  getListingPrivate, upsertListingPrivate,
  alertPrivateWriteFailure,
} from './orchestratorHelpers.js';

export async function reconcileCapturedPayment(deps, purchase, pp, pi) {
  if (!purchase || !pp || !pi) return { ok: false, step: 'input', error: 'missing arguments' };
  if (pi.status !== 'succeeded') return { ok: false, step: 'pi_status', error: `PI status ${pi.status}` };

  const authoritativeListingId = pp.listing_id;
  const purchaseId = purchase.id;

  // ── Step 1: PurchasePrivate (authoritative) ──────────────────────────────
  if (pp.payment_captured !== true || pp.payment_capture_failed !== false) {
    try {
      await upsertPurchasePrivate(deps, purchaseId, { payment_captured: true, payment_capture_failed: false });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchaseId, reference_type: 'purchase', error: err });
      return { ok: false, step: 'pp', error: err?.message || 'PP write failed' };
    }
  }

  // ── Step 2: Purchase (mirror) — includes buyer_confirmed ──────────────────
  const [purchaseFresh] = await deps.entities.Purchase.filter({ id: purchaseId });
  const purchaseNeedsUpdate =
    !purchaseFresh ||
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

  // ── Step 3: ListingPrivate (clear reservation fields) ─────────────────────
  const lpFresh = await getListingPrivate(deps, authoritativeListingId);
  if (lpFresh && (lpFresh.reservation_token || lpFresh.reserved_by_email || lpFresh.reservation_expires_at)) {
    try {
      await upsertListingPrivate(deps, authoritativeListingId, {
        reserved_by_email: null, reservation_token: null, reservation_expires_at: null,
      });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate', reference_id: authoritativeListingId, reference_type: 'listing', error: err });
      return { ok: false, step: 'lp', error: err?.message || 'LP write failed' };
    }
  }

  // ── Step 4: Listing (sold + clear reservation) ────────────────────────────
  const [listingFresh] = await deps.entities.Listing.filter({ id: authoritativeListingId });
  const listingNeedsUpdate =
    !listingFresh ||
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
  const [verifyListing] = await deps.entities.Listing.filter({ id: authoritativeListingId });
  const verifyLP = await getListingPrivate(deps, authoritativeListingId);
  const [verifyPurchase] = await deps.entities.Purchase.filter({ id: purchaseId });
  const verifyPP = await getPurchasePrivate(deps, purchaseId);

  const allConsistent =
    verifyListing?.status === 'sold' &&
    verifyListing?.reservation_token === null &&
    verifyListing?.reserved_by_email === null &&
    verifyLP?.reservation_token === null &&
    verifyLP?.reserved_by_email === null &&
    verifyPurchase?.transfer_status === 'completed' &&
    verifyPurchase?.payment_captured === true &&
    verifyPurchase?.payment_capture_failed === false &&
    verifyPurchase?.buyer_confirmed === true &&
    verifyPP?.payment_captured === true &&
    verifyPP?.payment_capture_failed === false;

  if (!allConsistent) {
    await alertPrivateWriteFailure(deps, {
      entity: 'CaptureVerification', reference_id: purchaseId, reference_type: 'purchase',
      error: new Error(`Post-capture consistency check failed. Listing.status=${verifyListing?.status}, LP.token=${verifyLP?.reservation_token}, Purchase.status=${verifyPurchase?.transfer_status}, Purchase.captured=${verifyPurchase?.payment_captured}, PP.captured=${verifyPP?.payment_captured}`),
    });
    return { ok: false, step: 'verify', error: 'consistency check failed' };
  }

  return { ok: true };
}