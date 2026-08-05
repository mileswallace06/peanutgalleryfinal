/**
 * confirmCheckoutOrchestrator.js — Dependency-injected checkout confirmation.
 *
 * This is the ACTUAL production confirmCheckoutAuthorized workflow.
 * Tests invoke this module directly with mock deps.
 *
 * deps = {
 *   entities: { Listing, ListingPrivate, Purchase, PurchasePrivate,
 *               User, UserSecurityProfile, AdminAlert, Notification },
 *   stripe: StripeClient,
 *   user: { id, email, role, full_name },
 *   now: () => number,
 *   isMaintenanceActive: () => boolean,
 * }
 *
 * Returns: { status, body }
 *
 * KEY PRINCIPLES:
 *   1. Require PurchasePrivate and ListingPrivate — no public fallbacks.
 *   2. Use PurchasePrivate.authorization_confirmed_at as the authoritative marker.
 *   3. Always validate exact PI metadata; do not repair missing metadata here.
 *   4. Validate current Listing + ListingPrivate token, buyer, matching expiration,
 *      pending_transfer status, non-expiry, and isFailClosed=false before enqueueing.
 *   5. Use authoritativePaymentIntentId everywhere.
 *   6. Repair partial public/private marker divergence before returning success.
 */
import { isFailClosed } from './checkoutLogic.js';
import {
  getPurchasePrivate, upsertPurchasePrivate,
  getListingPrivate,
  alertPrivateWriteFailure,
} from './orchestratorHelpers.js';

// Deps-based sale notification enqueue (mirrors saleNotification.ts but injectable)
async function enqueueSaleNotificationDeps(deps, purchase, listing, pp) {
  const key = `sale_created:${purchase.id}`;
  const sellerEmail = pp?.seller_email ?? purchase.seller_email;
  const title = '🎉 Your ticket sold!';
  const body = `Tap to transfer your tickets and receive payment. Sec ${listing?.section || ''}, Row ${listing?.row || ''}.`;

  // Dedup check
  const existing = await deps.entities.Notification.filter({ idempotency_key: key }).catch(() => []);
  if (existing.length > 0) {
    return { enqueued: false, reason: 'duplicate', idempotency_key: key };
  }

  await deps.entities.Notification.create({
    user_email: sellerEmail,
    type: 'sale_created',
    title, body,
    read: false,
    reference_type: 'purchase',
    reference_id: purchase.id,
    action_url: `/purchase/${purchase.id}`,
    icon: '🎟️',
    idempotency_key: key,
    dispatch_status: 'pending',
  });

  // Stamp seller_notified_at (idempotent marker)
  const notifiedAt = new Date(deps.now()).toISOString();
  try {
    await deps.entities.Purchase.update(purchase.id, { seller_notified_at: notifiedAt });
  } catch (err) { /* best effort */ }
  try {
    await upsertPurchasePrivate(deps, purchase.id, { seller_notified_at: notifiedAt });
  } catch (err) { /* best effort */ }

  return { enqueued: true, idempotency_key: key };
}

export async function runConfirmCheckoutAuthorized(deps, params) {
  const { entities, stripe, user, now, isMaintenanceActive } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance', code: 'MAINTENANCE' } };

  const { purchase_id } = params;
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
  const authoritativeListingId = pp.listing_id;
  const authoritativeReservationToken = pp.reservation_token;

  if (!authoritativePaymentIntentId) {
    return { status: 500, body: { error: 'Payment verification failed' } };
  }

  // Authorization check
  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return { status: 403, body: { error: 'Not authorized for this purchase' } };
  }
  if (pp.is_demo === true || purchase.is_demo) return { status: 200, body: { status: 'demo' } };
  if (purchase.transfer_status === 'expired') return { status: 409, body: { error: 'Purchase is expired' } };
  if (purchase.transfer_status === 'disputed') return { status: 409, body: { error: 'Purchase is disputed' } };
  if (purchase.transfer_status === 'completed') return { status: 200, body: { status: 'already_completed' } };

  // Use PurchasePrivate.authorization_confirmed_at as the authoritative marker
  const authConfirmedAt = pp.authorization_confirmed_at;

  // If not yet authorized, verify PI and stamp marker
  if (!authConfirmedAt) {
    let pi;
    try {
      pi = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
    } catch (err) {
      return { status: 500, body: { error: 'Payment verification failed' } };
    }

    if (!['requires_capture', 'succeeded'].includes(pi.status)) {
      return { status: 402, body: { error: 'Payment not authorized' } };
    }

    // Always validate exact PI metadata — do not repair missing metadata here
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
    if (Math.round((purchase.amount || 0) * 100) !== pi.amount) {
      return { status: 500, body: { error: 'Payment verification failed' } };
    }

    // Require ListingPrivate — no public fallback
    const lp = await getListingPrivate(deps, authoritativeListingId);
    if (!lp) return { status: 500, body: { error: 'ListingPrivate not found', code: 'INTEGRITY_ERROR' } };

    // Fetch Listing
    const [listing] = await entities.Listing.filter({ id: authoritativeListingId });
    if (!listing) return { status: 500, body: { error: 'Payment verification failed' } };

    // Verify seller match
    if (lp.seller_email !== authoritativeSellerEmail) {
      return { status: 500, body: { error: 'Payment verification failed' } };
    }

    // Validate current Listing + ListingPrivate token, buyer, matching expiration,
    // pending_transfer status, non-expiry, and isFailClosed=false immediately before enqueueing
    if (isFailClosed(listing, lp)) {
      return { status: 409, body: { error: 'Listing is under review' } };
    }
    if (listing.status !== 'pending_transfer') {
      return { status: 409, body: { error: 'Listing is no longer reserved' } };
    }
    if (lp.reservation_token !== authoritativeReservationToken || listing.reservation_token !== authoritativeReservationToken) {
      return { status: 409, body: { error: 'Reservation token mismatch' } };
    }
    if (lp.reserved_by_email !== authoritativeBuyerEmail || listing.reserved_by_email !== authoritativeBuyerEmail) {
      return { status: 409, body: { error: 'Reservation buyer mismatch' } };
    }
    // Matching expiration
    const lpExpiry = lp.reservation_expires_at ? new Date(lp.reservation_expires_at).getTime() : 0;
    const listingExpiry = listing.reservation_expires_at ? new Date(listing.reservation_expires_at).getTime() : 0;
    if (lpExpiry !== listingExpiry) {
      return { status: 409, body: { error: 'Reservation expiration mismatch' } };
    }
    // Non-expiry
    if (lpExpiry <= now()) {
      return { status: 409, body: { error: 'Reservation has expired' } };
    }

    // Write authorization_confirmed_at to PP (authoritative) first
    const confirmedAt = new Date(now()).toISOString();
    try {
      await upsertPurchasePrivate(deps, purchase.id, { authorization_confirmed_at: confirmedAt });
    } catch (err) {
      await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
      return { status: 500, body: { error: 'Failed to confirm authorization. Please try again.' } };
    }

    // Repair partial public/private marker divergence before returning success
    if (purchase.authorization_confirmed_at !== confirmedAt) {
      try {
        await entities.Purchase.update(purchase.id, { authorization_confirmed_at: confirmedAt });
      } catch (err) {
        // PP is authoritative — alert but continue
        await alertPrivateWriteFailure(deps, { entity: 'Purchase', reference_id: purchase.id, reference_type: 'purchase', error: err });
      }
    }
  }

  // Enqueue seller notification (NO inline send)
  const [listing] = await entities.Listing.filter({ id: authoritativeListingId }).catch(() => []);
  try {
    await enqueueSaleNotificationDeps(deps, purchase, listing, pp);
  } catch (err) {
    return { status: 500, body: { error: 'Could not notify seller — please retry' } };
  }

  // Return authoritative marker from PP
  const ppFinal = await getPurchasePrivate(deps, purchase.id);
  return {
    status: 200,
    body: {
      status: 'confirmed',
      authorization_confirmed_at: ppFinal?.authorization_confirmed_at || null,
      seller_notified_at: ppFinal?.seller_notified_at || null,
    },
  };
}