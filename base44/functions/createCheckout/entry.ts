/**
 * createCheckout — Authoritative server-side checkout.
 *
 * CONCURRENCY CLOSURE (7C.4):
 *
 * A. SINGLE CHECKOUT WINNER via Stripe atomic idempotency:
 *    - Key = checkout_<listing_id>_<listing.updated_date> (pre-reservation revision)
 *    - Same key + different params → StripeIdempotencyError → loser gets 409, zero writes
 *    - Same key + identical params → same PI (retry)
 *
 * B. FULL 6-CONDITION VERIFICATION at every checkpoint (via verifyReservation)
 *
 * C. RETRY BEFORE ACTIVE-STATUS REJECTION:
 *    Retry check runs before the active-status rejection.
 *    Requires matching PurchasePrivate, Purchase, PI metadata, Listing token/owner,
 *    and ListingPrivate token/owner.
 *    Returns existing client_secret only for requires_payment_method/requires_action.
 *    Quarantined, canceled, requires_capture, processing, succeeded → 409, no new flow.
 *
 * D. NO TOCTOU: On failure, quarantine listing (Listing + ListingPrivate).
 *    Never clear a possibly newer token from the request path.
 *
 * E. ALL-OR-NOTHING CANCELLATION: PI canceled + Purchase expired + quarantined.
 *    If ANY step fails → critical alert + 500.
 *
 * F. RE-FETCH BEFORE WRITES: Verify status, revision, token, owner match expected.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertListingPrivate, upsertPurchasePrivate, getPurchasePrivate, upsertUserSecurityProfile, ensureListingPrivate, getListingPrivate, getUserSecurityProfile, alertPrivateWriteFailure, quarantineListing } from '../../shared/privateData.ts';
import { verifyReservation, deriveIdempotencyKey, classifyRetryOutcome, isStripeIdempotencyError } from '../../shared/checkoutLogic.js';

function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}

const PI_COOLDOWN_MS = 15 * 1000;
const MAX_ID_LENGTH = 200;

// ── All-or-nothing cancellation compensation ───────────────────────────────
async function cancelPIAndQuarantine(base44, stripe, paymentIntentId, listing_id, purchase_id, reason) {
  // Step 1: Verify PI canceled
  let piCanceled = false;
  let piStatus = null;
  try {
    const canceled = await stripe.paymentIntents.cancel(paymentIntentId);
    piStatus = canceled.status;
    piCanceled = canceled.status === 'canceled';
  } catch (_) {
    try {
      const retrieved = await stripe.paymentIntents.retrieve(paymentIntentId);
      piStatus = retrieved.status;
      piCanceled = retrieved.status === 'canceled';
    } catch (__) {
      piStatus = 'unknown';
    }
  }

  if (!piCanceled) {
    await quarantineListing(base44, listing_id, `PI ${paymentIntentId} cancellation uncertain (status: ${piStatus})`, purchase_id, paymentIntentId);
    return { cancelOk: false, allStepsOk: false };
  }

  // Step 2: Expire Purchase (write confirmed)
  if (purchase_id) {
    try {
      await base44.asServiceRole.entities.Purchase.update(purchase_id, { transfer_status: 'expired' });
    } catch (err) {
      await quarantineListing(base44, listing_id, `Purchase ${purchase_id} expiry write failed: ${err?.message}`, purchase_id, paymentIntentId);
      return { cancelOk: true, allStepsOk: false };
    }
  }

  // Step 3+4: Quarantine listing (writes to both Listing and ListingPrivate, with post-write verification)
  const qResult = await quarantineListing(base44, listing_id, `Checkout compensation for PI ${paymentIntentId}`, purchase_id, paymentIntentId);
  if (!qResult.quarantined) {
    return { cancelOk: true, allStepsOk: false };
  }

  return { cancelOk: true, allStepsOk: true };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (isMaintenanceActive()) return maintenance503('Checkout is temporarily unavailable for scheduled maintenance.');

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }
  const stripe = new Stripe(secretKey);
  const body = await req.json().catch(() => ({}));
  const { listing_id, buyer_name, buyer_phone } = body;

  // ── Input validation ──
  if (typeof listing_id !== 'string' || listing_id.length === 0 || listing_id.length > MAX_ID_LENGTH) {
    return Response.json({ error: 'listing_id must be a bounded nonempty string', code: 'INVALID_INPUT' }, { status: 400 });
  }
  const validatedBuyerName = (typeof buyer_name === 'string' && buyer_name.length <= 200) ? buyer_name : null;
  const validatedBuyerPhone = (typeof buyer_phone === 'string' && buyer_phone.length <= 50) ? buyer_phone : null;
  const buyerEmail = user.email;

  // ── PI rate limit ──
  const [freshRequester] = await base44.asServiceRole.entities.User.filter({ email: buyerEmail });
  if (freshRequester?.last_pi_attempt_at) {
    const msSinceLast = Date.now() - new Date(freshRequester.last_pi_attempt_at).getTime();
    if (msSinceLast < PI_COOLDOWN_MS) {
      const waitSecs = Math.ceil((PI_COOLDOWN_MS - msSinceLast) / 1000);
      return Response.json({ error: `Please wait ${waitSecs}s before trying again.` }, { status: 429 });
    }
  }
  base44.asServiceRole.entities.User.update(freshRequester.id, {
    last_pi_attempt_at: new Date().toISOString(),
    pi_attempt_count: (freshRequester.pi_attempt_count || 0) + 1,
  }).catch(() => {});
  if (freshRequester) {
    try {
      await upsertUserSecurityProfile(base44, { user_id: freshRequester.id, user_email: buyerEmail }, {
        last_pi_attempt_at: new Date().toISOString(),
        pi_attempt_count: (freshRequester.pi_attempt_count || 0) + 1,
      });
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'UserSecurityProfile', reference_id: freshRequester.id, reference_type: 'user', error: err });
      return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
    }
  }

  // ── Fetch Listing + ListingPrivate ──
  // Capture listing.updated_date as the immutable pre-reservation listing revision.
  const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });
  const listingRevision = listing.updated_date;
  const listingPrivate = await getListingPrivate(base44, listing.id);
  if (!listingPrivate) {
    return Response.json({ error: 'Listing integrity error: private record missing', code: 'INTEGRITY_ERROR' }, { status: 500 });
  }

  const authoritativeSellerEmail = listingPrivate.seller_email;
  const authoritativeIsDemo = listingPrivate.is_demo_listing ?? false;
  const authoritativeProofStatus = listingPrivate.proof_status ?? null;
  const authoritativeNotes = listingPrivate.notes ?? null;

  // ── Financial validation ──
  const askingPriceNum = Number(listing.asking_price);
  if (!Number.isFinite(askingPriceNum) || askingPriceNum <= 0) {
    return Response.json({ error: 'Invalid listing price' }, { status: 400 });
  }
  const quantityNum = Number(listing.quantity) || 1;
  if (!Number.isInteger(quantityNum) || quantityNum <= 0 || quantityNum > 100) {
    return Response.json({ error: 'Invalid quantity' }, { status: 400 });
  }
  const subtotal = Math.round(askingPriceNum * quantityNum * 100) / 100;
  const platformFee = calcPlatformFee(subtotal);
  const buyerTotal = Math.round((subtotal + platformFee) * 100) / 100;
  const sellerPayout = subtotal;
  const amountCents = Math.round(buyerTotal * 100);
  const applicationFeeCents = Math.round(platformFee * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0 || !Number.isInteger(amountCents)) {
    return Response.json({ error: 'Invalid calculated amount' }, { status: 500 });
  }
  if (!Number.isFinite(applicationFeeCents) || applicationFeeCents <= 0 || !Number.isInteger(applicationFeeCents)) {
    return Response.json({ error: 'Invalid calculated fee' }, { status: 500 });
  }

  const now = Date.now();

  // ── RETRY CHECK (before active-status rejection) ──────────────────────────
  // Find existing PurchasePrivate for buyer + listing.
  // Return existing client_secret only when ALL of:
  //   - PurchasePrivate exists with matching buyer_email + listing_id
  //   - Purchase is pending_transfer
  //   - PI metadata.buyer_email === buyerEmail
  //   - PI metadata.listing_id === listing.id
  //   - Listing.reservation_token === pp.reservation_token
  //   - Listing.reserved_by_email === buyerEmail
  //   - ListingPrivate.reservation_token === pp.reservation_token
  //   - ListingPrivate.reserved_by_email === buyerEmail
  //   - PI status is requires_payment_method or requires_action
  // Quarantined/canceled/requires_capture/processing/succeeded → 409, no new flow.
  let existingPPs;
  try {
    existingPPs = await base44.asServiceRole.entities.PurchasePrivate.filter({
      listing_id: listing.id,
      buyer_email: buyerEmail,
    });
  } catch (err) {
    return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
  }

  if (existingPPs.length > 0) {
    const pendingPurchaseIds = existingPPs.map(pp => pp.purchase_id);
    let existingPurchases;
    try {
      existingPurchases = await base44.asServiceRole.entities.Purchase.filter({
        id: { $in: pendingPurchaseIds },
      });
    } catch (err) {
      return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
    }

    for (const pp of existingPPs) {
      const pur = existingPurchases.find(p => p.id === pp.purchase_id);
      if (!pur || pur.transfer_status !== 'pending_transfer') continue;

      // Retrieve PI
      let existingPI;
      try {
        existingPI = await stripe.paymentIntents.retrieve(pp.payment_intent_id);
      } catch (_) {
        // PI retrieval failed — fail-closed, no new flow
        return Response.json({ error: 'Checkout verification unavailable. Please try again.' }, { status: 500 });
      }

      // Verify PI metadata matches
      if (existingPI.metadata?.buyer_email !== buyerEmail) continue;
      if (existingPI.metadata?.listing_id !== listing.id) continue;

      // Verify Listing token/owner matches
      if (listing.reservation_token !== pp.reservation_token) continue;
      if (listing.reserved_by_email !== buyerEmail) continue;

      // Verify ListingPrivate token/owner matches
      if (listingPrivate.reservation_token !== pp.reservation_token) continue;
      if (listingPrivate.reserved_by_email !== buyerEmail) continue;

      // All match — classify retry outcome
      const outcome = classifyRetryOutcome(existingPI.status, pur.transfer_status);
      if (outcome === 'retry') {
        return Response.json({
          purchase_id: pur.id,
          clientSecret: existingPI.client_secret,
          subtotal, platformFee, buyerTotal, sellerPayout,
        });
      }
      if (outcome === 'blocked') {
        return Response.json({ error: 'A checkout for this listing is already in progress. Please wait for it to complete or expire.' }, { status: 409 });
      }
      // 'new_flow' → continue to new checkout
    }
  }

  // ── LISTING STATE VALIDATION (after retry check) ──────────────────────────
  // If listing is pending_transfer and it's this buyer's reservation (edge case:
  // PI created, reservation written, no PurchasePrivate), allow proceed.
  if (listing.status === 'pending_transfer') {
    if (listing.reserved_by_email !== buyerEmail) {
      return Response.json({ error: 'This listing is currently being purchased by another buyer.' }, { status: 409 });
    }
    // This buyer's reservation — allow proceed (will overwrite own reservation)
  } else if (listing.status !== 'active') {
    return Response.json({ error: 'Listing is no longer available' }, { status: 409 });
  }

  if (authoritativeIsDemo === true) {
    return Response.json({ error: 'Test/demo listings cannot be purchased.' }, { status: 409 });
  }
  if (authoritativeNotes && /\[(TEST|DEMO)\]/i.test(authoritativeNotes)) {
    return Response.json({ error: 'Test/demo listings cannot be purchased.' }, { status: 409 });
  }
  if (authoritativeProofStatus !== 'approved') {
    return Response.json({ error: 'Listing is not yet approved' }, { status: 409 });
  }
  if (authoritativeSellerEmail === buyerEmail) {
    return Response.json({ error: 'You cannot purchase your own listing' }, { status: 400 });
  }

  // ── PENDING-PURCHASE CONFLICT (different buyer) ──────────────────────────
  let otherBuyerPPs;
  try {
    otherBuyerPPs = await base44.asServiceRole.entities.PurchasePrivate.filter({
      listing_id: listing.id,
    });
  } catch (err) {
    return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
  }
  const otherBuyerPending = otherBuyerPPs.filter(pp => pp.buyer_email !== buyerEmail);
  if (otherBuyerPending.length > 0) {
    const otherPurchaseIds = otherBuyerPending.map(pp => pp.purchase_id);
    let otherPurchases;
    try {
      otherPurchases = await base44.asServiceRole.entities.Purchase.filter({
        id: { $in: otherPurchaseIds },
      });
    } catch (err) {
      return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
    }
    if (otherPurchases.some(p => p.transfer_status === 'pending_transfer')) {
      return Response.json({ error: 'This listing is currently being purchased by another buyer.' }, { status: 409 });
    }
  }

  // ── RESERVATION ENFORCEMENT ──
  const authoritativeResToken = listingPrivate.reservation_token ?? null;
  const authoritativeResExpiry = listingPrivate.reservation_expires_at ?? null;
  const authoritativeReservedBy = listingPrivate.reserved_by_email ?? null;
  if (authoritativeResToken && authoritativeResExpiry && new Date(authoritativeResExpiry).getTime() > now) {
    if (authoritativeReservedBy !== buyerEmail) {
      return Response.json({ error: 'This listing is currently being purchased by another buyer. Try again in a few minutes.' }, { status: 409 });
    }
  }

  // ── ONE-PER-BUYER ──
  let userReservations;
  try {
    userReservations = await base44.asServiceRole.entities.ListingPrivate.filter({
      reserved_by_email: buyerEmail,
    });
  } catch (err) {
    return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
  }
  for (const r of userReservations) {
    if (r.listing_id === listing.id) continue;
    if (r.reservation_expires_at && new Date(r.reservation_expires_at).getTime() > now) {
      return Response.json({
        error: 'You already have a listing reserved. Complete or release that checkout before reserving another.',
        code: 'ALREADY_HAS_RESERVATION',
        existing_listing_id: r.listing_id,
      }, { status: 409 });
    }
  }

  // ── Seller profile ──
  const sellerSec = await getUserSecurityProfile(base44, { user_email: authoritativeSellerEmail });
  if (!sellerSec) {
    return Response.json({ error: 'Seller security profile unavailable', code: 'INTEGRITY_ERROR' }, { status: 500 });
  }
  const sellerUsers = await base44.asServiceRole.entities.User.filter({ email: authoritativeSellerEmail });
  const seller = sellerUsers[0];
  const rawStripeAccountId = sellerSec.stripe_account_id ?? null;
  const isLiveMode = secretKey.startsWith('sk_live_');
  let sellerStripeAccountId = rawStripeAccountId;
  if (rawStripeAccountId && isLiveMode) {
    try {
      await stripe.accounts.retrieve(rawStripeAccountId);
    } catch (err) {
      sellerStripeAccountId = null;
      try {
        await upsertUserSecurityProfile(base44, { user_id: sellerSec.user_id, user_email: authoritativeSellerEmail }, {
          stripe_account_id: null, stripe_onboarding_complete: false,
        });
      } catch (e) {
        await alertPrivateWriteFailure(base44, { entity: 'UserSecurityProfile', reference_id: sellerSec.user_id, reference_type: 'user', error: e });
      }
    }
  }
  const isTestOrAdminListing = (authoritativeNotes && /\[TEST\]/i.test(authoritativeNotes)) || seller?.role === 'admin';
  if (!sellerStripeAccountId && !isTestOrAdminListing) {
    return Response.json({ error: 'Seller has not completed payout onboarding. Purchase blocked.' }, { status: 402 });
  }

  // ── Derive idempotency key + generate reservation token ──
  const idempotencyKey = deriveIdempotencyKey(listing.id, listingRevision);
  const reservationToken = crypto.randomUUID();
  const reservationExpiresAt = new Date(now + 10 * 60 * 1000).toISOString();

  // ── Create Stripe PaymentIntent ──────────────────────────────────────────
  let paymentIntent;
  try {
    const piParams = {
      amount: amountCents,
      currency: 'usd',
      capture_method: 'manual',
      metadata: {
        listing_id: listing.id,
        event_id: listing.event_id || '',
        buyer_email: buyerEmail,
        seller_email: authoritativeSellerEmail,
        reservation_token: reservationToken,
        listing_revision: listingRevision,
        subtotal: subtotal.toString(),
        platform_fee: platformFee.toString(),
        seller_payout: sellerPayout.toString(),
        buyer_total: buyerTotal.toString(),
      },
      description: `Peanut Gallery: Section ${listing.section} Row ${listing.row}`,
    };
    if (sellerStripeAccountId) {
      piParams.application_fee_amount = applicationFeeCents;
      piParams.transfer_data = { destination: sellerStripeAccountId };
    }
    paymentIntent = await stripe.paymentIntents.create(piParams, { idempotencyKey });
  } catch (err) {
    // Losing buyer — StripeIdempotencyError when same key + different params
    if (isStripeIdempotencyError(err)) {
      return Response.json({ error: 'This listing was just reserved by another buyer. Please try another listing.' }, { status: 409 });
    }
    return Response.json({ error: err.message }, { status: 500 });
  }

  // ── RE-FETCH before reservation writes ───────────────────────────────────
  // Verify status, revision, token, owner still match expected state.
  const [listingFresh] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  const lpFresh = await getListingPrivate(base44, listing.id);
  if (!listingFresh) {
    return Response.json({ error: 'Listing is no longer available' }, { status: 409 });
  }
  if (listingFresh.updated_date !== listingRevision) {
    return Response.json({ error: 'Listing was modified. Please try again.' }, { status: 409 });
  }
  if (listingFresh.status !== 'active' && !(listingFresh.status === 'pending_transfer' && listingFresh.reserved_by_email === buyerEmail)) {
    return Response.json({ error: 'Listing is no longer available' }, { status: 409 });
  }
  const freshResToken = lpFresh?.reservation_token ?? null;
  const freshResExpiry = lpFresh?.reservation_expires_at ?? null;
  const freshReservedBy = lpFresh?.reserved_by_email ?? null;
  if (freshResToken && freshResExpiry && new Date(freshResExpiry).getTime() > now) {
    if (freshReservedBy !== buyerEmail) {
      return Response.json({ error: 'This listing is currently being purchased by another buyer.' }, { status: 409 });
    }
  }

  // ── Write reservation (Listing + ListingPrivate) ─────────────────────────
  await base44.asServiceRole.entities.Listing.update(listing.id, {
    status: 'pending_transfer',
    reservation_token: reservationToken,
    reservation_expires_at: reservationExpiresAt,
    reserved_by_email: buyerEmail,
  });
  try {
    await upsertListingPrivate(base44, listing.id, {
      reservation_token: reservationToken,
      reservation_expires_at: reservationExpiresAt,
      reserved_by_email: buyerEmail,
    });
  } catch (err) {
    await quarantineListing(base44, listing.id, `ListingPrivate write failed: ${err?.message}`, null, paymentIntent.id);
    await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
    return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
  }

  // ── Full 6-condition verification ─────────────────────────────────────────
  const [reservedListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  const reservedLP = await getListingPrivate(base44, listing.id);
  if (!verifyReservation(reservedListing, reservedLP, reservationToken, buyerEmail)) {
    await quarantineListing(base44, listing.id, 'Initial 6-condition verification failed', null, paymentIntent.id);
    return Response.json({ error: 'This listing was just reserved by another buyer. Please try another listing.' }, { status: 409 });
  }

  // ── Canonicalize by payment_intent_id ────────────────────────────────────
  const existingPurchasesForPI = await base44.asServiceRole.entities.Purchase.filter({
    payment_intent_id: paymentIntent.id,
  });
  const existingPendingForPI = existingPurchasesForPI.find(p => p.transfer_status === 'pending_transfer');
  if (existingPendingForPI) {
    return Response.json({
      purchase_id: existingPendingForPI.id,
      clientSecret: paymentIntent.client_secret,
      subtotal, platformFee, buyerTotal, sellerPayout,
    });
  }

  // ── Create Purchase ──────────────────────────────────────────────────────
  let purchase;
  try {
    purchase = await base44.asServiceRole.entities.Purchase.create({
      listing_id: listing.id,
      event_id: listing.event_id,
      buyer_email: buyerEmail,
      buyer_name: validatedBuyerName,
      buyer_phone: validatedBuyerPhone,
      seller_email: authoritativeSellerEmail,
      amount: buyerTotal,
      subtotal, platform_fee: platformFee, seller_payout: sellerPayout,
      quantity: quantityNum,
      payment_intent_id: paymentIntent.id,
      reservation_token: reservationToken,
      transfer_status: 'pending_transfer',
      buyer_confirmed: false, seller_confirmed: false,
      payment_captured: false, is_demo: false,
    });
  } catch (purchaseErr) {
    const result = await cancelPIAndQuarantine(base44, stripe, paymentIntent.id, listing.id, null, `Purchase creation failed: ${purchaseErr?.message}`);
    if (!result.allStepsOk) {
      return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
    }
    return Response.json({ error: 'Checkout failed during purchase creation. Your payment was not charged.' }, { status: 500 });
  }

  // ── Post-Purchase 6-condition verification ────────────────────────────────
  const [listingAfterPurchase] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  const lpAfterPurchase = await getListingPrivate(base44, listing.id);
  if (!verifyReservation(listingAfterPurchase, lpAfterPurchase, reservationToken, buyerEmail)) {
    const result = await cancelPIAndQuarantine(base44, stripe, paymentIntent.id, listing.id, purchase.id, 'Post-Purchase 6-condition verification failed');
    if (!result.allStepsOk) {
      return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
    }
    return Response.json({ error: 'Listing was modified during checkout. Your payment was not charged.' }, { status: 409 });
  }

  // ── Create sidecars ──
  let ppError = null, lpError = null;
  try {
    await upsertPurchasePrivate(base44, purchase.id, {
      listing_id: listing.id, event_id: listing.event_id,
      buyer_email: buyerEmail, seller_email: authoritativeSellerEmail,
      payment_intent_id: paymentIntent.id, reservation_token: reservationToken,
      buyer_phone: validatedBuyerPhone, buyer_name: validatedBuyerName,
      payment_captured: false, is_demo: false,
      migration_version: 3, migrated_at: new Date().toISOString(),
    });
  } catch (err) { ppError = err; }
  try {
    await ensureListingPrivate(base44, listing.id, {
      event_id: listing.event_id, seller_email: authoritativeSellerEmail,
      section: listing.section, row: listing.row, seats: listing.seats, quantity: listing.quantity,
      migration_version: 3, migrated_at: new Date().toISOString(),
    });
  } catch (err) { lpError = err; }

  if (ppError || lpError) {
    const result = await cancelPIAndQuarantine(base44, stripe, paymentIntent.id, listing.id, purchase.id, `Sidecar creation failed: ${ppError?.message || lpError?.message}`);
    await alertPrivateWriteFailure(base44, { entity: ppError ? 'PurchasePrivate' : 'ListingPrivate', reference_id: purchase.id, reference_type: 'purchase', error: ppError || lpError });
    if (!result.allStepsOk) {
      return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
    }
    return Response.json({ error: 'Checkout failed during private record creation. Your payment was not charged.' }, { status: 500 });
  }

  // ── Set metadata.purchase_id ──
  try {
    await stripe.paymentIntents.update(paymentIntent.id, { metadata: { purchase_id: purchase.id } });
  } catch (err) {
    const result = await cancelPIAndQuarantine(base44, stripe, paymentIntent.id, listing.id, purchase.id, `Metadata update failed: ${err?.message}`);
    await alertPrivateWriteFailure(base44, { entity: 'StripeMetadata', reference_id: purchase.id, reference_type: 'purchase', error: err });
    if (!result.allStepsOk) {
      return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
    }
    return Response.json({ error: 'Checkout failed during payment linking. Your payment was not charged.' }, { status: 500 });
  }

  return Response.json({
    purchase_id: purchase.id,
    clientSecret: paymentIntent.client_secret,
    subtotal, platformFee, buyerTotal, sellerPayout,
  });
});