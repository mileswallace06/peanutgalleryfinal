/**
 * captureOrchestrator.js — Dependency-injected payment capture logic.
 *
 * This is the ACTUAL production capture workflow. Tests invoke this module
 * directly with mock deps.
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
 *
 * Returns: { status, body }
 *
 * KEY PRINCIPLES:
 *   1. Require PurchasePrivate, ListingPrivate, and UserSecurityProfile — no public fallbacks.
 *   2. Use authoritativePaymentIntentId for retrieve, metadata checks, and capture.
 *   3. Use UserSecurityProfile.stripe_account_id for destination verification.
 *   4. Re-fetch and verify the complete reservation tuple immediately before capture.
 *   5. Block expired or fail-closed reservations.
 *   6. Move buyer_confirmed until after verified Stripe success.
 *   7. Write ordering: PP → Purchase → LP → Listing. Never return success unless
 *      all four are verified consistent.
 */
import { isFailClosed } from './checkoutLogic.js';
import {
  getPurchasePrivate, upsertPurchasePrivate,
  getListingPrivate, upsertListingPrivate,
  getUserSecurityProfile,
  alertPrivateWriteFailure,
} from './orchestratorHelpers.js';

function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}

export async function runCapturePayment(deps, params) {
  const { entities, stripe, user, now, isMaintenanceActive } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance', code: 'MAINTENANCE' } };

  const { purchase_id, optimistic_id } = params;
  if (!purchase_id) return { status: 400, body: { error: 'purchase_id is required' } };

  // Re-fetch Purchase
  const [purchase] = await entities.Purchase.filter({ id: purchase_id });
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  // Require PurchasePrivate — no public fallback
  const pp = await getPurchasePrivate(deps, purchase.id);
  if (!pp) return { status: 500, body: { error: 'PurchasePrivate not found', code: 'INTEGRITY_ERROR' } };

  const authoritativeBuyerEmail = pp.buyer_email;
  const authoritativeSellerEmail = pp.seller_email;
  const authoritativePaymentIntentId = pp.payment_intent_id;
  const authoritativeReservationToken = pp.reservation_token;
  const authoritativeListingId = pp.listing_id;

  if (!authoritativePaymentIntentId) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }

  // Require ListingPrivate
  const lp = await getListingPrivate(deps, authoritativeListingId);
  if (!lp) return { status: 500, body: { error: 'ListingPrivate not found', code: 'INTEGRITY_ERROR' } };

  // Require UserSecurityProfile
  const sellerSec = await getUserSecurityProfile(deps, { user_email: authoritativeSellerEmail });
  if (!sellerSec) return { status: 500, body: { error: 'Seller security profile unavailable', code: 'INTEGRITY_ERROR' } };

  if (pp.is_demo === true || purchase.is_demo) {
    return { status: 409, body: { error: 'Cannot capture a demo purchase' } };
  }
  if (purchase.transfer_status === 'completed') return { status: 200, body: { status: 'already_completed' } };
  if (purchase.transfer_status === 'disputed') return { status: 409, body: { error: 'Cannot capture payment on a disputed purchase' } };
  if (purchase.transfer_status === 'expired') return { status: 409, body: { error: 'Cannot capture payment on an expired purchase' } };

  // Authorization
  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return { status: 403, body: { error: 'Not authorized as buyer' } };
  }

  // Require seller confirmed
  if (!purchase.seller_confirmed) {
    return { status: 409, body: { error: 'Cannot confirm receipt before seller confirms transfer' } };
  }

  // Retrieve PI using authoritativePaymentIntentId
  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
  } catch (err) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }

  // Validate exact PI metadata — all required, no optional, no repair
  const md = pi.metadata || {};
  if (!md.purchase_id || md.purchase_id !== purchase.id) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }
  if (!md.listing_id || md.listing_id !== authoritativeListingId) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }
  if (!md.buyer_email || md.buyer_email !== authoritativeBuyerEmail) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }
  if (!md.seller_email || md.seller_email !== authoritativeSellerEmail) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }
  if (!md.reservation_token || md.reservation_token !== authoritativeReservationToken) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }

  // Fetch Listing for amount verification
  const [listing] = await entities.Listing.filter({ id: authoritativeListingId });
  if (!listing) return { status: 404, body: { error: 'Listing not found' } };

  // Amount/currency validation
  const expectedSubtotal = Math.round(listing.asking_price * (listing.quantity || 1) * 100) / 100;
  const expectedPlatformFee = calcPlatformFee(expectedSubtotal);
  const expectedBuyerTotal = Math.round((expectedSubtotal + expectedPlatformFee) * 100) / 100;
  const expectedAmountCents = Math.round(expectedBuyerTotal * 100);
  if (pi.amount !== expectedAmountCents || (pi.currency || 'usd') !== 'usd') {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }
  if (Math.round((purchase.amount || 0) * 100) !== expectedAmountCents) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }

  // Destination verification using UserSecurityProfile.stripe_account_id
  const sellerStripeAccountId = sellerSec.stripe_account_id;
  if (sellerStripeAccountId) {
    if (!pi.transfer_data?.destination) {
      return { status: 500, body: { error: 'Payment verification failed' } };
    }
    if (pi.transfer_data.destination !== sellerStripeAccountId) {
      return { status: 500, body: { error: 'Payment verification failed' } };
    }
  }

  // Re-fetch and verify the complete reservation tuple immediately before capture
  const [listingFresh] = await entities.Listing.filter({ id: authoritativeListingId });
  const lpFresh = await getListingPrivate(deps, authoritativeListingId);
  if (!listingFresh || !lpFresh) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }

  // Block expired or fail-closed reservations
  if (isFailClosed(listingFresh, lpFresh)) {
    return { status: 409, body: { error: 'Listing is under review' } };
  }

  // Verify reservation tuple
  if (listingFresh.status !== 'pending_transfer') {
    return { status: 409, body: { error: 'Listing is no longer reserved' } };
  }
  if (lpFresh.reservation_token !== authoritativeReservationToken || listingFresh.reservation_token !== authoritativeReservationToken) {
    return { status: 409, body: { error: 'Reservation token mismatch' } };
  }
  if (lpFresh.reserved_by_email !== authoritativeBuyerEmail || listingFresh.reserved_by_email !== authoritativeBuyerEmail) {
    return { status: 409, body: { error: 'Reservation buyer mismatch' } };
  }
  const lpExpiry = lpFresh.reservation_expires_at ? new Date(lpFresh.reservation_expires_at).getTime() : 0;
  if (lpExpiry <= now()) {
    return { status: 409, body: { error: 'Reservation has expired' } };
  }

  // Capture (if needed) — use authoritativePaymentIntentId
  let finalStatus = pi.status;
  if (pi.status === 'requires_capture') {
    try {
      const captured = await stripe.paymentIntents.capture(authoritativePaymentIntentId, {
        idempotencyKey: `capture-${purchase.id}`,
      });
      finalStatus = captured.status;
    } catch (stripeErr) {
      // Mirror failure to PP (authoritative) then Purchase
      try {
        await upsertPurchasePrivate(deps, purchase.id, { payment_capture_failed: true });
      } catch (err) {
        await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
      }
      await entities.Purchase.update(purchase.id, { payment_capture_failed: true }).catch(() => {});
      return { status: 500, body: { error: 'Payment capture failed. Our team has been notified.' } };
    }
  }

  if (finalStatus !== 'succeeded') {
    return { status: 402, body: { error: `Payment not completed (status: ${finalStatus}). No charge was finalized.` } };
  }

  // ── Stripe confirmed success — finalize (idempotent $sets) ───────────────
  // Write ordering: PP → Purchase → LP → Listing. All awaited and verified.
  // buyer_confirmed is set AFTER verified Stripe success (moved from before capture).

  // 1. PP (authoritative)
  try {
    await upsertPurchasePrivate(deps, purchase.id, { payment_captured: true, payment_capture_failed: false });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return { status: 500, body: { error: 'Payment captured but record sync failed. Please contact support.' } };
  }

  // 2. Purchase (mirror) — includes buyer_confirmed moved after Stripe success
  try {
    await entities.Purchase.update(purchase.id, {
      transfer_status: 'completed',
      payment_captured: true,
      payment_capture_failed: false,
      buyer_confirmed: true,
    });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'Purchase', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return { status: 500, body: { error: 'Payment captured but record sync failed. Please contact support.' } };
  }

  // 3. LP (clear reservation)
  try {
    await upsertListingPrivate(deps, authoritativeListingId, {
      reserved_by_email: null, reservation_token: null, reservation_expires_at: null,
    });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate', reference_id: authoritativeListingId, reference_type: 'listing', error: err });
    return { status: 500, body: { error: 'Payment captured but record sync failed. Please contact support.' } };
  }

  // 4. Listing (sold)
  try {
    await entities.Listing.update(authoritativeListingId, {
      status: 'sold',
      reservation_token: null,
      reservation_expires_at: null,
      reserved_by_email: null,
    });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'Listing', reference_id: authoritativeListingId, reference_type: 'listing', error: err });
    return { status: 500, body: { error: 'Payment captured but record sync failed. Please contact support.' } };
  }

  // Verify all four entities are consistent
  const [verifyListing] = await entities.Listing.filter({ id: authoritativeListingId });
  const verifyLP = await getListingPrivate(deps, authoritativeListingId);
  const [verifyPurchase] = await entities.Purchase.filter({ id: purchase.id });
  const verifyPP = await getPurchasePrivate(deps, purchase.id);

  const allConsistent =
    verifyListing?.status === 'sold' &&
    verifyListing?.reservation_token === null &&
    verifyLP?.reservation_token === null &&
    verifyPurchase?.transfer_status === 'completed' &&
    verifyPurchase?.payment_captured === true &&
    verifyPurchase?.buyer_confirmed === true &&
    verifyPP?.payment_captured === true;

  if (!allConsistent) {
    await alertPrivateWriteFailure(deps, {
      entity: 'CaptureVerification', reference_id: purchase.id, reference_type: 'purchase',
      error: new Error(`Post-capture consistency check failed. Listing.status=${verifyListing?.status}, LP.token=${verifyLP?.reservation_token}, Purchase.status=${verifyPurchase?.transfer_status}, Purchase.captured=${verifyPurchase?.payment_captured}, PP.captured=${verifyPP?.payment_captured}`),
    });
    return { status: 500, body: { error: 'Payment captured but consistency check failed. Please contact support.' } };
  }

  return { status: 200, body: { status: 'completed', payment_captured: true, optimistic_id } };
}