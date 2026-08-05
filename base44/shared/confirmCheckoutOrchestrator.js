/**
 * confirmCheckoutOrchestrator.js — Dependency-injected checkout confirmation.
 *
 * 7C.9C correction 5: Verify authorization markers actually persist.
 *   - Write ONE exact timestamp to Purchase AND PurchasePrivate.
 *   - Re-fetch BOTH records.
 *   - Require BOTH persisted timestamps to equal that exact value.
 *   - Do not enqueue the seller notification until verification succeeds.
 *   - A missing, failed, or silently non-persisted mirror returns non-2xx
 *     and creates an alert.
 *
 * deps = { entities, stripe, user, now, isMaintenanceActive }
 * Returns: { status, body }
 */
import { isFailClosed } from './checkoutLogic.js';
import {
  getPurchasePrivate, upsertPurchasePrivate,
  getListingPrivate,
  alertPrivateWriteFailure,
} from './orchestratorHelpers.js';
import { enqueueSaleNotificationDeps } from './saleDispatch.js';

export async function runConfirmCheckoutAuthorized(deps, params) {
  const { entities, stripe, user, now, isMaintenanceActive } = deps;

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (isMaintenanceActive()) return { status: 503, body: { error: 'Maintenance', code: 'MAINTENANCE' } };

  const { purchase_id } = params;
  if (!purchase_id) return { status: 400, body: { error: 'purchase_id is required' } };

  // ── 1. Retrieve authoritative Purchase ────────────────────────────────────
  const [purchase] = await entities.Purchase.filter({ id: purchase_id });
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  // ── 2. Require PurchasePrivate — no public fallback ────────────────────────
  const pp = await getPurchasePrivate(deps, purchase.id);
  if (!pp) return { status: 500, body: { error: 'PurchasePrivate not found', code: 'INTEGRITY_ERROR' } };

  const authoritativeBuyerEmail = pp.buyer_email;
  const authoritativeSellerEmail = pp.seller_email;
  const authoritativePaymentIntentId = pp.payment_intent_id;
  const authoritativeListingId = pp.listing_id;
  const authoritativeReservationToken = pp.reservation_token;

  if (!authoritativePaymentIntentId) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'NO_PI_ID' } };
  }

  // ── 3. Authorization check ────────────────────────────────────────────────
  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return { status: 403, body: { error: 'Not authorized for this purchase' } };
  }
  if (pp.is_demo === true || purchase.is_demo) return { status: 200, body: { status: 'demo' } };
  if (purchase.transfer_status === 'expired') return { status: 409, body: { error: 'Purchase is expired' } };
  if (purchase.transfer_status === 'disputed') return { status: 409, body: { error: 'Purchase is disputed' } };

  // ── 4. ALWAYS retrieve the live PaymentIntent — never bypass ───────────────
  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(authoritativePaymentIntentId);
  } catch (_) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_RETRIEVE_FAILED' } };
  }

  // ── 5. Require requires_capture or succeeded ────────────────────────────────
  if (!['requires_capture', 'succeeded'].includes(pi.status)) {
    return { status: 402, body: { error: 'Payment not authorized', code: 'PI_NOT_AUTHORIZED' } };
  }

  // ── 6. Validate exact PI metadata and amount — always, no bypass ──────────
  const md = pi.metadata || {};
  if (!md.purchase_id || md.purchase_id !== purchase.id) return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  if (!md.listing_id || md.listing_id !== authoritativeListingId) return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  if (!md.buyer_email || md.buyer_email !== authoritativeBuyerEmail) return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  if (!md.seller_email || md.seller_email !== authoritativeSellerEmail) return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  if (!md.reservation_token || md.reservation_token !== authoritativeReservationToken) return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH' } };
  if (Math.round((purchase.amount || 0) * 100) !== pi.amount) return { status: 500, body: { error: 'Payment verification failed', code: 'AMOUNT_MISMATCH' } };

  // ── 7. Re-fetch Listing and ListingPrivate ─────────────────────────────────
  const lp = await getListingPrivate(deps, authoritativeListingId);
  if (!lp) return { status: 500, body: { error: 'ListingPrivate not found', code: 'INTEGRITY_ERROR' } };

  const [listing] = await entities.Listing.filter({ id: authoritativeListingId });
  if (!listing) return { status: 500, body: { error: 'Listing not found', code: 'INTEGRITY_ERROR' } };

  // ── 8. Validate seller, token, buyer, matching expiration, non-expiry,
  //         pending_transfer, and fail-closed state ───────────────────────────
  if (lp.seller_email !== authoritativeSellerEmail) return { status: 500, body: { error: 'Seller mismatch', code: 'INTEGRITY_ERROR' } };
  if (isFailClosed(listing, lp)) return { status: 409, body: { error: 'Listing is under review' } };
  if (purchase.transfer_status === 'completed') {
    return { status: 200, body: { status: 'already_completed', authorization_confirmed_at: pp.authorization_confirmed_at, seller_notified_at: pp.seller_notified_at } };
  }
  if (listing.status !== 'pending_transfer') return { status: 409, body: { error: 'Listing is no longer reserved' } };
  if (lp.reservation_token !== authoritativeReservationToken || listing.reservation_token !== authoritativeReservationToken) return { status: 409, body: { error: 'Reservation token mismatch' } };
  if (lp.reserved_by_email !== authoritativeBuyerEmail || listing.reserved_by_email !== authoritativeBuyerEmail) return { status: 409, body: { error: 'Reservation buyer mismatch' } };
  const lpExpiry = lp.reservation_expires_at ? new Date(lp.reservation_expires_at).getTime() : 0;
  const listingExpiry = listing.reservation_expires_at ? new Date(listing.reservation_expires_at).getTime() : 0;
  if (lpExpiry === 0 || listingExpiry === 0) return { status: 409, body: { error: 'Reservation expiration missing' } };
  if (lpExpiry !== listingExpiry) return { status: 409, body: { error: 'Reservation expiration mismatch' } };
  if (lpExpiry <= now()) return { status: 409, body: { error: 'Reservation has expired' } };

  // ── 9. Write ONE exact timestamp to BOTH records and VERIFY persistence ───
  // 7C.9C correction 5: The timestamp must be identical on both records,
  // and we must re-fetch to confirm it persisted.
  const confirmedAt = new Date(now()).toISOString();

  // Write to PurchasePrivate (authoritative)
  try {
    await upsertPurchasePrivate(deps, purchase.id, { authorization_confirmed_at: confirmedAt });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return { status: 500, body: { error: 'Failed to confirm authorization. Please try again.', code: 'PP_MARKER_WRITE_FAILED' } };
  }

  // Write to Purchase (mirror) — same exact timestamp
  try {
    await entities.Purchase.update(purchase.id, { authorization_confirmed_at: confirmedAt });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'Purchase', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return { status: 500, body: { error: 'Failed to mirror authorization marker', code: 'PURCHASE_MARKER_WRITE_FAILED' } };
  }

  // ── Re-fetch BOTH records and verify the timestamp persisted ───────────────
  const ppVerify = await getPurchasePrivate(deps, purchase.id);
  const [purchaseVerify] = await entities.Purchase.filter({ id: purchase.id });

  if (!ppVerify || ppVerify.authorization_confirmed_at !== confirmedAt) {
    // Silently non-persisted PP marker — fail closed
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `Authorization marker not persisted — PurchasePrivate — ${purchase.id}`,
        description: `Wrote authorization_confirmed_at=${confirmedAt} but re-fetch returned ${ppVerify?.authorization_confirmed_at}. Seller notification NOT enqueued. Manual investigation required.`,
        reference_type: 'purchase',
        reference_id: purchase.id,
      });
    } catch (_) { /* alert failure must not suppress the error */ }
    return { status: 500, body: { error: 'Authorization marker verification failed', code: 'PP_MARKER_VERIFY_FAILED' } };
  }

  if (!purchaseVerify || purchaseVerify.authorization_confirmed_at !== confirmedAt) {
    // Silently non-persisted Purchase marker — fail closed
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `Authorization marker not persisted — Purchase — ${purchase.id}`,
        description: `Wrote authorization_confirmed_at=${confirmedAt} but re-fetch returned ${purchaseVerify?.authorization_confirmed_at}. Seller notification NOT enqueued. Manual investigation required.`,
        reference_type: 'purchase',
        reference_id: purchase.id,
      });
    } catch (_) { /* alert failure must not suppress the error */ }
    return { status: 500, body: { error: 'Authorization marker mirror verification failed', code: 'PURCHASE_MARKER_VERIFY_FAILED' } };
  }

  // ── 10. Enqueue seller notification (only after verification succeeds) ────
  const [listingForNotif] = await entities.Listing.filter({ id: authoritativeListingId }).catch(() => []);
  try {
    await enqueueSaleNotificationDeps(deps, purchase, listingForNotif, ppVerify);
  } catch (_) {
    return { status: 500, body: { error: 'Could not notify seller — please retry', code: 'NOTIFY_FAILED' } };
  }

  // ── 11. Return authoritative marker from PP ────────────────────────────────
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