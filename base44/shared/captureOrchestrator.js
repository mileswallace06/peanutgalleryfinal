/**
 * captureOrchestrator.js — Dependency-injected payment capture logic.
 *
 * 7C.9B: Idempotent captured-payment reconciliation state machine.
 *
 * deps = {
 *   entities: { Listing, ListingPrivate, Purchase, PurchasePrivate,
 *               User, UserSecurityProfile, AdminAlert },
 *   stripe: StripeClient,
 *   user: { id, email, role, full_name },
 *   now: () => number,
 *   isMaintenanceActive: () => boolean,
 *   isLiveMode: boolean,
 * }
 * Returns: { status, body }
 *
 * KEY PRINCIPLES:
 *   1. Require PurchasePrivate, ListingPrivate, and UserSecurityProfile — no public fallbacks.
 *   2. Use authoritativePaymentIntentId for retrieve, metadata checks, and capture.
 *   3. If PI is `succeeded`, call reconcileCapturedPayment (retry-safe, no active reservation needed).
 *   4. If PI is `requires_capture`, require the COMPLETE pre-capture tuple (section 2),
 *      capture, then reconcile.
 *   5. Never return `already_completed` without verifying all four records.
 *   6. A retry after failure at any write boundary repairs missing steps and converges.
 *   7. For non-demo: require acct_ prefix, onboarding complete, and exact destination match.
 */
import { isFailClosed } from './checkoutLogic.js';
import {
  getPurchasePrivate,
  getListingPrivate,
  getUserSecurityProfile,
} from './orchestratorHelpers.js';
import { reconcileCapturedPayment } from './captureReconciliation.js';

function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}

export async function runCapturePayment(deps, params) {
  const { entities, stripe, user, now, isMaintenanceActive } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance', code: 'MAINTENANCE' } };

  const { purchase_id, optimistic_id } = params;
  if (!purchase_id) return { status: 400, body: { error: 'purchase_id is required' } };

  // ── 1. Retrieve authoritative Purchase ────────────────────────────────────
  const [purchase] = await entities.Purchase.filter({ id: purchase_id });
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  // ── 2. Require PurchasePrivate — no public fallback ───────────────────────
  const pp = await getPurchasePrivate(deps, purchase.id);
  if (!pp) return { status: 500, body: { error: 'PurchasePrivate not found', code: 'INTEGRITY_ERROR' } };

  const authoritativeBuyerEmail = pp.buyer_email;
  const authoritativeSellerEmail = pp.seller_email;
  const authoritativePaymentIntentId = pp.payment_intent_id;
  const authoritativeReservationToken = pp.reservation_token;
  const authoritativeListingId = pp.listing_id;

  if (!authoritativePaymentIntentId) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'NO_PI_ID' } };
  }

  // ── 3. Require ListingPrivate ─────────────────────────────────────────────
  const lp = await getListingPrivate(deps, authoritativeListingId);
  if (!lp) return { status: 500, body: { error: 'ListingPrivate not found', code: 'INTEGRITY_ERROR' } };

  // ── 4. Require UserSecurityProfile ─────────────────────────────────────────
  const sellerSec = await getUserSecurityProfile(deps, { user_email: authoritativeSellerEmail });
  if (!sellerSec) return { status: 500, body: { error: 'Seller security profile unavailable', code: 'INTEGRITY_ERROR' } };

  // ── 5. Demo / disputed / expired checks ───────────────────────────────────
  if (pp.is_demo === true || purchase.is_demo) {
    return { status: 409, body: { error: 'Cannot capture a demo purchase' } };
  }
  if (purchase.transfer_status === 'disputed') {
    return { status: 409, body: { error: 'Cannot capture payment on a disputed purchase' } };
  }
  if (purchase.transfer_status === 'expired') {
    return { status: 409, body: { error: 'Cannot capture payment on an expired purchase' } };
  }

  // ── 6. Authorization ──────────────────────────────────────────────────────
  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return { status: 403, body: { error: 'Not authorized as buyer' } };
  }

  // ── 7. Retrieve live PaymentIntent ────────────────────────────────────────
  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
  } catch (err) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_RETRIEVE_FAILED' } };
  }

  // ── 8. Verify exact PI metadata against PurchasePrivate ────────────────────
  const md = pi.metadata || {};
  if (!md.purchase_id || md.purchase_id !== purchase.id) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  }
  if (!md.listing_id || md.listing_id !== authoritativeListingId) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  }
  if (!md.buyer_email || md.buyer_email !== authoritativeBuyerEmail) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  }
  if (!md.seller_email || md.seller_email !== authoritativeSellerEmail) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  }
  if (!md.reservation_token || md.reservation_token !== authoritativeReservationToken) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  }

  // ── 9. Fetch Listing for amount verification ───────────────────────────────
  const [listing] = await entities.Listing.filter({ id: authoritativeListingId });
  if (!listing) return { status: 404, body: { error: 'Listing not found' } };

  const expectedSubtotal = Math.round(listing.asking_price * (listing.quantity || 1) * 100) / 100;
  const expectedPlatformFee = calcPlatformFee(expectedSubtotal);
  const expectedBuyerTotal = Math.round((expectedSubtotal + expectedPlatformFee) * 100) / 100;
  const expectedAmountCents = Math.round(expectedBuyerTotal * 100);
  if (pi.amount !== expectedAmountCents || (pi.currency || 'usd') !== 'usd') {
    return { status: 500, body: { error: 'Payment verification failed', code: 'AMOUNT_MISMATCH' } };
  }
  if (Math.round((purchase.amount || 0) * 100) !== expectedAmountCents) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'AMOUNT_MISMATCH' } };
  }

  // ── 10. Destination verification (non-demo only) ───────────────────────────
  const sellerStripeAccountId = sellerSec.stripe_account_id;
  if (!sellerStripeAccountId || !sellerStripeAccountId.startsWith('acct_')) {
    return { status: 402, body: { error: 'Seller payout account not configured', code: 'NO_STRIPE_ACCOUNT' } };
  }
  if (sellerSec.stripe_onboarding_complete !== true) {
    return { status: 402, body: { error: 'Seller has not completed payout onboarding', code: 'ONBOARDING_INCOMPLETE' } };
  }
  if (!pi.transfer_data?.destination) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'NO_DESTINATION' } };
  }
  if (pi.transfer_data.destination !== sellerStripeAccountId) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'DESTINATION_MISMATCH' } };
  }

  // ── 11. If PI is already `succeeded`, reconcile (retry-safe) ──────────────
  // Does NOT require an active reservation — uses exact PI metadata and PP ownership.
  if (pi.status === 'succeeded') {
    const result = await reconcileCapturedPayment(deps, purchase, pp, pi);
    if (!result.ok) {
      return { status: 500, body: { error: 'Payment captured but record sync failed. Please contact support.', code: `RECONCILE_FAILED:${result.step}`, step: result.step } };
    }
    return { status: 200, body: { status: 'completed', payment_captured: true, optimistic_id } };
  }

  // ── 12. If PI is `requires_capture`, require the COMPLETE pre-capture tuple ─
  if (pi.status === 'requires_capture') {
    // Require seller confirmed
    if (!purchase.seller_confirmed) {
      return { status: 409, body: { error: 'Cannot confirm receipt before seller confirms transfer' } };
    }

    // Re-fetch fresh Listing + LP
    const [listingFresh] = await entities.Listing.filter({ id: authoritativeListingId });
    const lpFresh = await getListingPrivate(deps, authoritativeListingId);
    if (!listingFresh || !lpFresh) {
      return { status: 500, body: { error: 'Payment verification failed', code: 'INTEGRITY_ERROR' } };
    }

    // Neither listing record is fail-closed or quarantined
    if (isFailClosed(listingFresh, lpFresh)) {
      return { status: 409, body: { error: 'Listing is under review' } };
    }

    // Both remain pending_transfer
    if (listingFresh.status !== 'pending_transfer') {
      return { status: 409, body: { error: 'Listing is no longer reserved' } };
    }

    // Same listing ID across PP, LP, and Listing
    if (lpFresh.listing_id !== authoritativeListingId || listingFresh.id !== authoritativeListingId) {
      return { status: 500, body: { error: 'Listing ID mismatch', code: 'INTEGRITY_ERROR' } };
    }

    // LP seller equals PP seller
    if (lpFresh.seller_email !== authoritativeSellerEmail) {
      return { status: 500, body: { error: 'Seller mismatch', code: 'INTEGRITY_ERROR' } };
    }

    // Listing and LP tokens both exactly equal PP token
    if (lpFresh.reservation_token !== authoritativeReservationToken || listingFresh.reservation_token !== authoritativeReservationToken) {
      return { status: 409, body: { error: 'Reservation token mismatch' } };
    }

    // Listing and LP reserved buyers both exactly equal PP buyer
    if (lpFresh.reserved_by_email !== authoritativeBuyerEmail || listingFresh.reserved_by_email !== authoritativeBuyerEmail) {
      return { status: 409, body: { error: 'Reservation buyer mismatch' } };
    }

    // Listing and LP expiration timestamps both exist, are equal, and are still future
    const lpExpiry = lpFresh.reservation_expires_at ? new Date(lpFresh.reservation_expires_at).getTime() : 0;
    const listingExpiry = listingFresh.reservation_expires_at ? new Date(listingFresh.reservation_expires_at).getTime() : 0;
    if (lpExpiry === 0 || listingExpiry === 0) {
      return { status: 409, body: { error: 'Reservation expiration missing' } };
    }
    if (lpExpiry !== listingExpiry) {
      return { status: 409, body: { error: 'Reservation expiration mismatch' } };
    }
    if (lpExpiry <= now()) {
      return { status: 409, body: { error: 'Reservation has expired' } };
    }

    // ── 13. Capture ────────────────────────────────────────────────────────
    let capturedPI;
    try {
      capturedPI = await stripe.paymentIntents.capture(authoritativePaymentIntentId, {
        idempotencyKey: `capture-${purchase.id}`,
      });
    } catch (stripeErr) {
      return { status: 500, body: { error: 'Payment capture failed. Our team has been notified.', code: 'CAPTURE_FAILED' } };
    }

    if (capturedPI.status !== 'succeeded') {
      return { status: 402, body: { error: `Payment not completed (status: ${capturedPI.status}). No charge was finalized.` } };
    }

    // ── 14. Reconcile all four records ────────────────────────────────────
    // Re-fetch PI to get the verified succeeded state
    const piSucceeded = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
    const result = await reconcileCapturedPayment(deps, purchase, pp, piSucceeded);
    if (!result.ok) {
      return { status: 500, body: { error: 'Payment captured but record sync failed. Please contact support.', code: `RECONCILE_FAILED:${result.step}`, step: result.step } };
    }
    return { status: 200, body: { status: 'completed', payment_captured: true, optimistic_id } };
  }

  // PI is in an unexpected state (canceled, processing, requires_payment_method, etc.)
  return { status: 402, body: { error: `Payment not in capturable state (status: ${pi.status}).`, code: 'PI_NOT_CAPTURABLE' } };
}