/**
 * checkoutOrchestrator.js — Dependency-injected checkout orchestration.
 *
 * This is the ACTUAL production checkout workflow. Tests invoke this module
 * directly with mock deps — they do NOT simulate the workflow separately.
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
 */
import {
  verifyReservation,
  deriveIdempotencyKey,
  classifyRetryOutcome,
  isStripeIdempotencyError,
  isQuarantined,
  isRetryablePIStatus,
  verifyExactPIMetadata,
} from './checkoutLogic.js';
import {
  getListingPrivate,
  getPurchasePrivate,
  upsertListingPrivate,
  upsertPurchasePrivate,
  ensureListingPrivate,
  getUserSecurityProfile,
  upsertUserSecurityProfile,
  alertPrivateWriteFailure,
  quarantineListing,
  cancelPIAndQuarantine,
} from './orchestratorHelpers.js';

const PI_COOLDOWN_MS = 15 * 1000;
const MAX_ID_LENGTH = 200;
const RESERVATION_TTL_MS = 10 * 60 * 1000;

function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}

// Critical alert that always includes the PI ID (7C.7 fix #1)
async function criticalAlertWithPI(deps, listing_id, title, description, piId) {
  try {
    await deps.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'critical',
      title,
      description: `${description} PI ID: ${piId || 'N/A'}.`,
      reference_type: 'listing',
      reference_id: listing_id,
    });
  } catch (_) { /* alert failure must never throw */ }
}

// 7C.8 fix #6: Check quarantine results in checkout
// Every quarantineListing call must inspect the returned result.
// Failed quarantine must return neutral 500, create a critical alert with PI ID,
// and must NOT return an ordinary compensated/expired 409 telling the buyer to retry.
async function safeQuarantine(deps, listing_id, reason, purchase_id, pi_id) {
  const result = await quarantineListing(deps, listing_id, reason, purchase_id, pi_id);
  if (!result.quarantined) {
    await criticalAlertWithPI(deps, listing_id, `QUARANTINE WRITE FAILED for ${listing_id}`,
      `Quarantine write failed. Reason: ${reason}. Manual resolution required.`, pi_id);
    return { quarantined: false, status: 500, error: 'Checkout quarantine failed. Please contact support.' };
  }
  return { quarantined: true, recovery_blocked: result.recovery_blocked === true };
}

export async function runCreateCheckout(deps, params) {
  const { entities, stripe, user, now, isMaintenanceActive, isLiveMode } = deps;

  // 1. Auth check
  if (!user) return { status: 401, body: { error: 'Unauthorized' } };

  // 2. Maintenance check
  if (isMaintenanceActive()) {
    return { status: 503, body: { error: 'Checkout is temporarily unavailable for scheduled maintenance.', code: 'MAINTENANCE' } };
  }

  // 3. Input validation
  const { listing_id, buyer_name, buyer_phone } = params;
  if (typeof listing_id !== 'string' || listing_id.length === 0 || listing_id.length > MAX_ID_LENGTH) {
    return { status: 400, body: { error: 'listing_id must be a bounded nonempty string', code: 'INVALID_INPUT' } };
  }
  const validatedBuyerName = (typeof buyer_name === 'string' && buyer_name.length <= 200) ? buyer_name : null;
  const validatedBuyerPhone = (typeof buyer_phone === 'string' && buyer_phone.length <= 50) ? buyer_phone : null;
  const buyerEmail = user.email;

  // 4. Rate limit — authoritative source: UserSecurityProfile (7C.6 fix #8)
  const [freshRequester] = await entities.User.filter({ email: buyerEmail });
  if (!freshRequester) {
    return { status: 401, body: { error: 'Authenticated user record not found', code: 'USER_NOT_FOUND' } };
  }
  const buyerSec = await getUserSecurityProfile(deps, { user_id: freshRequester.id, user_email: buyerEmail });
  if (buyerSec?.last_pi_attempt_at) {
    const msSinceLast = now() - new Date(buyerSec.last_pi_attempt_at).getTime();
    if (msSinceLast < PI_COOLDOWN_MS) {
      const waitSecs = Math.ceil((PI_COOLDOWN_MS - msSinceLast) / 1000);
      return { status: 429, body: { error: `Please wait ${waitSecs}s before trying again.` } };
    }
  }
  // Write rate-limit to UserSecurityProfile ONLY — if write fails, fail checkout (7C.6 fix #8)
  try {
    await upsertUserSecurityProfile(deps, { user_id: freshRequester.id, user_email: buyerEmail }, {
      last_pi_attempt_at: new Date(now()).toISOString(),
      pi_attempt_count: (buyerSec?.pi_attempt_count || 0) + 1,
    });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'UserSecurityProfile', reference_id: freshRequester.id, reference_type: 'user', error: err });
    return { status: 500, body: { error: 'Checkout unavailable. Please try again.' } };
  }

  // 5. Fetch listing + LP
  const listings = await entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) return { status: 404, body: { error: 'Listing not found' } };
  const listingRevision = listing.updated_date;
  const listingPrivate = await getListingPrivate(deps, listing.id);
  if (!listingPrivate) {
    return { status: 500, body: { error: 'Listing integrity error: private record missing', code: 'INTEGRITY_ERROR' } };
  }

  const authoritativeSellerEmail = listingPrivate.seller_email;
  const authoritativeIsDemo = listingPrivate.is_demo_listing ?? false;
  const authoritativeProofStatus = listingPrivate.proof_status ?? null;
  const authoritativeNotes = listingPrivate.notes ?? null;

  // 6. Financial validation
  const askingPriceNum = Number(listing.asking_price);
  if (!Number.isFinite(askingPriceNum) || askingPriceNum <= 0) {
    return { status: 400, body: { error: 'Invalid listing price' } };
  }
  const quantityNum = Number(listing.quantity) || 1;
  if (!Number.isInteger(quantityNum) || quantityNum <= 0 || quantityNum > 100) {
    return { status: 400, body: { error: 'Invalid quantity' } };
  }
  const subtotal = Math.round(askingPriceNum * quantityNum * 100) / 100;
  const platformFee = calcPlatformFee(subtotal);
  const buyerTotal = Math.round((subtotal + platformFee) * 100) / 100;
  const sellerPayout = subtotal;
  const amountCents = Math.round(buyerTotal * 100);
  const applicationFeeCents = Math.round(platformFee * 100);

  // 7. Retry check — 7C.7: fail-closed, no best-effort cancel-and-continue
  // Never continue into a new checkout unless cancellation is positively verified.
  // On cancel failure or unverifiable status: quarantine both sidecars, create a
  // critical alert containing the PI ID, return 409/500, and create no new PI or Purchase.
  let existingPPs;
  try {
    existingPPs = await entities.PurchasePrivate.filter({ listing_id: listing.id, buyer_email: buyerEmail });
  } catch (err) {
    return { status: 500, body: { error: 'Checkout unavailable. Please try again.' } };
  }

  if (existingPPs.length > 0) {
    const pendingPurchaseIds = existingPPs.map(pp => pp.purchase_id).filter(Boolean);
    let existingPurchases = [];
    if (pendingPurchaseIds.length > 0) {
      try {
        existingPurchases = await entities.Purchase.filter({ id: { $in: pendingPurchaseIds } });
      } catch (err) {
        return { status: 500, body: { error: 'Checkout unavailable. Please try again.' } };
      }
    }

    for (const pp of existingPPs) {
      const pur = existingPurchases.find(p => p.id === pp.purchase_id);
      if (!pur || pur.transfer_status !== 'pending_transfer') continue;

      // Reject retry when quarantined
      if (isQuarantined(listing, listingPrivate)) {
        return { status: 409, body: { error: 'This listing is under review. Please try another listing.' } };
      }

      // Retrieve PI — failure → quarantine + critical alert (7C.8 fix #6: check result)
      let existingPI;
      try {
        existingPI = await stripe.paymentIntents.retrieve(pp.payment_intent_id);
      } catch (_) {
        const q = await safeQuarantine(deps, listing.id, `PI retrieval failed during retry. PI ID: ${pp.payment_intent_id}`, pur.id, pp.payment_intent_id);
        if (!q.quarantined) return { status: q.status, body: { error: q.error } };
        return { status: 409, body: { error: 'Checkout verification unavailable. Please contact support.' } };
      }

      // Require EXACT PI metadata match (7C.7 fix #2)
      if (!verifyExactPIMetadata(pur, pp, existingPI)) {
        const q = await safeQuarantine(deps, listing.id, `PI metadata mismatch — fail-closed. Metadata: ${JSON.stringify(existingPI.metadata)}`, pur.id, pp.payment_intent_id);
        if (!q.quarantined) return { status: q.status, body: { error: q.error } };
        return { status: 409, body: { error: 'Checkout verification failed. Please contact support.' } };
      }

      // Check if reservation is still valid (6-condition)
      if (verifyReservation(listing, listingPrivate, pp.reservation_token, buyerEmail)) {
        // Reservation is valid — classify retry outcome
        const outcome = classifyRetryOutcome(existingPI.status, pur.transfer_status);
        if (outcome === 'retry') {
          return { status: 200, body: { purchase_id: pur.id, clientSecret: existingPI.client_secret, subtotal, platformFee, buyerTotal, sellerPayout } };
        }
        if (outcome === 'blocked') {
          return { status: 409, body: { error: 'A checkout for this listing is already in progress. Please wait for it to complete or expire.' } };
        }
        // 'new_flow' shouldn't happen for pending purchase — fall through to fail-closed
      }

      // Reservation is invalid/expired — compensate old attempt (7C.7 fix #1)
      // NEVER continue to new checkout. NEVER best-effort cancel-and-continue.
      if (isRetryablePIStatus(existingPI.status)) {
        // Try to cancel old PI and positively verify canceled
        let cancelVerified = false;
        let cancelError = null;
        try {
          const canceled = await stripe.paymentIntents.cancel(pp.payment_intent_id);
          cancelVerified = canceled.status === 'canceled';
        } catch (err) {
          cancelError = err;
          try {
            const retrieved = await stripe.paymentIntents.retrieve(pp.payment_intent_id);
            cancelVerified = retrieved.status === 'canceled';
          } catch (__) { cancelVerified = false; }
        }

        if (!cancelVerified) {
          // Cancel failed or unverifiable — quarantine + critical alert with PI ID + 500
          const q = await safeQuarantine(deps, listing.id, `PI cancel failed during stale retry. PI ID: ${pp.payment_intent_id}. Error: ${cancelError?.message || 'unknown'}`, pur.id, pp.payment_intent_id);
          // Always alert about the PI cancel failure, even if quarantine succeeded
          await criticalAlertWithPI(deps, listing.id, `PI CANCEL FAILED for ${listing.id}`, `Cancel error: ${cancelError?.message || 'unknown'}. Manual cancellation required.`, pp.payment_intent_id);
          if (!q.quarantined) return { status: q.status, body: { error: q.error } };
          return { status: 500, body: { error: 'Checkout compensation failed. Please contact support.' } };
        }

        // Cancel succeeded — quarantine with durable snapshot + 409
        const q1 = await safeQuarantine(deps, listing.id, `Stale retry compensated — PI canceled. PI ID: ${pp.payment_intent_id}`, pur.id, pp.payment_intent_id);
        if (!q1.quarantined) return { status: q1.status, body: { error: q1.error } };
        return { status: 409, body: { error: 'Your previous checkout attempt has expired. Please try again.' } };
      } else if (existingPI.status === 'canceled') {
        // PI already canceled — quarantine with durable snapshot + 409
        const q2 = await safeQuarantine(deps, listing.id, `Stale retry — PI already canceled. PI ID: ${pp.payment_intent_id}`, pur.id, pp.payment_intent_id);
        if (!q2.quarantined) return { status: q2.status, body: { error: q2.error } };
        return { status: 409, body: { error: 'Your previous checkout attempt has expired. Please try again.' } };
      } else {
        // PI is authorized (requires_capture/succeeded/processing) or unknown —
        // Don't cancel (buyer may still complete). Quarantine + 409.
        const q3 = await safeQuarantine(deps, listing.id, `Stale retry — PI in state: ${existingPI.status}. PI ID: ${pp.payment_intent_id}`, pur.id, pp.payment_intent_id);
        if (!q3.quarantined) return { status: q3.status, body: { error: q3.error } };
        return { status: 409, body: { error: 'A checkout for this listing is already in progress.' } };
      }
    }
  }

  // 8. Quarantine check (before listing state validation)
  if (isQuarantined(listing, listingPrivate)) {
    return { status: 409, body: { error: 'This listing is under review. Please try another listing.' } };
  }

  // 9. Listing state validation
  if (listing.status === 'pending_transfer') {
    if (listing.reserved_by_email !== buyerEmail) {
      return { status: 409, body: { error: 'This listing is currently being purchased by another buyer.' } };
    }
  } else if (listing.status !== 'active') {
    return { status: 409, body: { error: 'Listing is no longer available' } };
  }

  if (authoritativeIsDemo === true) {
    return { status: 409, body: { error: 'Test/demo listings cannot be purchased.' } };
  }
  if (authoritativeNotes && /\[(TEST|DEMO)\]/i.test(authoritativeNotes)) {
    return { status: 409, body: { error: 'Test/demo listings cannot be purchased.' } };
  }
  if (authoritativeProofStatus !== 'approved') {
    return { status: 409, body: { error: 'Listing is not yet approved' } };
  }
  if (authoritativeSellerEmail === buyerEmail) {
    return { status: 400, body: { error: 'You cannot purchase your own listing' } };
  }

  // 9. Other buyer pending check
  let otherBuyerPPs;
  try {
    otherBuyerPPs = await entities.PurchasePrivate.filter({ listing_id: listing.id });
  } catch (err) {
    return { status: 500, body: { error: 'Checkout unavailable. Please try again.' } };
  }
  const otherBuyerPending = otherBuyerPPs.filter(pp => pp.buyer_email !== buyerEmail);
  if (otherBuyerPending.length > 0) {
    const otherPurchaseIds = otherBuyerPending.map(pp => pp.purchase_id).filter(Boolean);
    let otherPurchases = [];
    if (otherPurchaseIds.length > 0) {
      try {
        otherPurchases = await entities.Purchase.filter({ id: { $in: otherPurchaseIds } });
      } catch (err) {
        return { status: 500, body: { error: 'Checkout unavailable. Please try again.' } };
      }
    }
    if (otherPurchases.some(p => p.transfer_status === 'pending_transfer')) {
      return { status: 409, body: { error: 'This listing is currently being purchased by another buyer.' } };
    }
  }

  // 10. Reservation enforcement
  const authoritativeResToken = listingPrivate.reservation_token ?? null;
  const authoritativeResExpiry = listingPrivate.reservation_expires_at ?? null;
  const authoritativeReservedBy = listingPrivate.reserved_by_email ?? null;
  if (authoritativeResToken && authoritativeResExpiry && new Date(authoritativeResExpiry).getTime() > now()) {
    if (authoritativeReservedBy !== buyerEmail) {
      return { status: 409, body: { error: 'This listing is currently being purchased by another buyer. Try again in a few minutes.' } };
    }
  }

  // 11. One-per-buyer
  let userReservations;
  try {
    userReservations = await entities.ListingPrivate.filter({ reserved_by_email: buyerEmail });
  } catch (err) {
    return { status: 500, body: { error: 'Checkout unavailable. Please try again.' } };
  }
  for (const r of userReservations) {
    if (r.listing_id === listing.id) continue;
    if (r.reservation_expires_at && new Date(r.reservation_expires_at).getTime() > now()) {
      return { status: 409, body: { error: 'You already have a listing reserved. Complete or release that checkout before reserving another.', code: 'ALREADY_HAS_RESERVATION', existing_listing_id: r.listing_id } };
    }
  }

  // 12. Seller profile
  const sellerSec = await getUserSecurityProfile(deps, { user_email: authoritativeSellerEmail });
  if (!sellerSec) {
    return { status: 500, body: { error: 'Seller security profile unavailable', code: 'INTEGRITY_ERROR' } };
  }
  const sellerUsers = await entities.User.filter({ email: authoritativeSellerEmail });
  const seller = sellerUsers[0];
  const rawStripeAccountId = sellerSec.stripe_account_id ?? null;
  let sellerStripeAccountId = rawStripeAccountId;
  if (rawStripeAccountId && isLiveMode) {
    try {
      await stripe.accounts.retrieve(rawStripeAccountId);
    } catch (err) {
      sellerStripeAccountId = null;
      try {
        await upsertUserSecurityProfile(deps, { user_id: sellerSec.user_id, user_email: authoritativeSellerEmail }, { stripe_account_id: null, stripe_onboarding_complete: false });
      } catch (e) {
        await alertPrivateWriteFailure(deps, { entity: 'UserSecurityProfile', reference_id: sellerSec.user_id, reference_type: 'user', error: e });
      }
    }
  }
  const isTestOrAdminListing = (authoritativeNotes && /\[TEST\]/i.test(authoritativeNotes)) || seller?.role === 'admin';
  if (!sellerStripeAccountId && !isTestOrAdminListing) {
    return { status: 402, body: { error: 'Seller has not completed payout onboarding. Purchase blocked.' } };
  }

  // 13. Derive idempotency key + generate token
  const idempotencyKey = deriveIdempotencyKey(listing.id, listingRevision);
  const reservationToken = crypto.randomUUID();
  const reservationExpiresAt = new Date(now() + RESERVATION_TTL_MS).toISOString();

  // 14. Create PI — handle canceled PI from previous compensated attempt
  let paymentIntent;
  try {
    const piParams = {
      amount: amountCents, currency: 'usd', capture_method: 'manual',
      metadata: {
        listing_id: listing.id, event_id: listing.event_id || '',
        buyer_email: buyerEmail, seller_email: authoritativeSellerEmail,
        reservation_token: reservationToken, listing_revision: listingRevision,
        subtotal: subtotal.toString(), platform_fee: platformFee.toString(),
        seller_payout: sellerPayout.toString(), buyer_total: buyerTotal.toString(),
      },
      description: `Peanut Gallery: Section ${listing.section} Row ${listing.row}`,
    };
    if (sellerStripeAccountId) {
      piParams.application_fee_amount = applicationFeeCents;
      piParams.transfer_data = { destination: sellerStripeAccountId };
    }
    paymentIntent = await stripe.paymentIntents.create(piParams, { idempotencyKey });
    // If idempotency returned a canceled PI (from a previous compensated attempt),
    // create a new PI with a unique retry key
    if (paymentIntent.status === 'canceled') {
      const retryKey = `${idempotencyKey}_r${now()}`;
      paymentIntent = await stripe.paymentIntents.create(piParams, { idempotencyKey: retryKey });
    }
  } catch (err) {
    if (isStripeIdempotencyError(err)) {
      return { status: 409, body: { error: 'This listing was just reserved by another buyer. Please try another listing.' } };
    }
    return { status: 500, body: { error: err.message } };
  }

  // 15. Create Purchase (with PI ID + token) — recoverable record
  let purchase;
  try {
    purchase = await entities.Purchase.create({
      listing_id: listing.id, event_id: listing.event_id,
      buyer_email: buyerEmail, buyer_name: validatedBuyerName, buyer_phone: validatedBuyerPhone,
      seller_email: authoritativeSellerEmail,
      amount: buyerTotal, subtotal, platform_fee: platformFee, seller_payout: sellerPayout,
      quantity: quantityNum, payment_intent_id: paymentIntent.id, reservation_token: reservationToken,
      transfer_status: 'pending_transfer', buyer_confirmed: false, seller_confirmed: false,
      payment_captured: false, is_demo: false,
    });
  } catch (purchaseErr) {
    const result = await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, null, `Purchase creation failed: ${purchaseErr?.message}`);
    if (!result.allStepsOk) return { status: 500, body: { error: 'Checkout failed. Please contact support.' } };
    return { status: 500, body: { error: 'Checkout failed during purchase creation. Your payment was not charged.' } };
  }

  // 16. Create PurchasePrivate (with Purchase ID + PI ID + token) — recoverable record
  try {
    await upsertPurchasePrivate(deps, purchase.id, {
      listing_id: listing.id, event_id: listing.event_id,
      buyer_email: buyerEmail, seller_email: authoritativeSellerEmail,
      payment_intent_id: paymentIntent.id, reservation_token: reservationToken,
      buyer_phone: validatedBuyerPhone, buyer_name: validatedBuyerName,
      payment_captured: false, is_demo: false,
    });
  } catch (err) {
    const result = await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, purchase.id, `PurchasePrivate creation failed: ${err?.message}`);
    await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
    if (!result.allStepsOk) return { status: 500, body: { error: 'Checkout failed. Please contact support.' } };
    return { status: 500, body: { error: 'Checkout failed during private record creation. Your payment was not charged.' } };
  }

  // 17. Re-fetch listing, verify state (revision, status, token, owner)
  const [listingFresh] = await entities.Listing.filter({ id: listing.id });
  const lpFresh = await getListingPrivate(deps, listing.id);
  if (!listingFresh) {
    await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, purchase.id, 'Listing not found after PI creation');
    return { status: 409, body: { error: 'Listing is no longer available' } };
  }
  if (listingFresh.updated_date !== listingRevision) {
    await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, purchase.id, 'Listing revision mismatch');
    return { status: 409, body: { error: 'Listing was modified. Please try again.' } };
  }
  if (listingFresh.status !== 'active' && !(listingFresh.status === 'pending_transfer' && listingFresh.reserved_by_email === buyerEmail)) {
    await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, purchase.id, 'Listing status changed');
    return { status: 409, body: { error: 'Listing is no longer available' } };
  }
  const freshResToken = lpFresh?.reservation_token ?? null;
  const freshResExpiry = lpFresh?.reservation_expires_at ?? null;
  const freshReservedBy = lpFresh?.reserved_by_email ?? null;
  if (freshResToken && freshResExpiry && new Date(freshResExpiry).getTime() > now()) {
    if (freshReservedBy !== buyerEmail) {
      await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, purchase.id, 'Listing reserved by another buyer');
      return { status: 409, body: { error: 'This listing is currently being purchased by another buyer.' } };
    }
  }

  // 18. Write reservation (Listing + LP)
  try {
    await entities.Listing.update(listing.id, {
      status: 'pending_transfer', reservation_token: reservationToken,
      reservation_expires_at: reservationExpiresAt, reserved_by_email: buyerEmail,
    });
  } catch (err) {
    await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, purchase.id, `Listing reservation write failed: ${err?.message}`);
    return { status: 500, body: { error: 'Checkout failed during reservation. Your payment was not charged.' } };
  }
  try {
    await upsertListingPrivate(deps, listing.id, {
      reservation_token: reservationToken, reservation_expires_at: reservationExpiresAt, reserved_by_email: buyerEmail,
    });
  } catch (err) {
    await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, purchase.id, `LP reservation write failed: ${err?.message}`);
    await alertPrivateWriteFailure(deps, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
    return { status: 500, body: { error: 'Checkout failed during private record update. Your payment was not charged.' } };
  }

  // 19. Verify reservation (6-condition)
  const [reservedListing] = await entities.Listing.filter({ id: listing.id });
  const reservedLP = await getListingPrivate(deps, listing.id);
  if (!verifyReservation(reservedListing, reservedLP, reservationToken, buyerEmail)) {
    await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, purchase.id, '6-condition verification failed');
    return { status: 409, body: { error: 'This listing was just reserved by another buyer. Please try another listing.' } };
  }

  // 20. Set PI metadata.purchase_id
  try {
    await stripe.paymentIntents.update(paymentIntent.id, { metadata: { purchase_id: purchase.id } });
  } catch (err) {
    await cancelPIAndQuarantine(deps, paymentIntent.id, listing.id, purchase.id, `Metadata update failed: ${err?.message}`);
    await alertPrivateWriteFailure(deps, { entity: 'StripeMetadata', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return { status: 500, body: { error: 'Checkout failed during payment linking. Your payment was not charged.' } };
  }

  return { status: 200, body: { purchase_id: purchase.id, clientSecret: paymentIntent.client_secret, subtotal, platformFee, buyerTotal, sellerPayout } };
}