/**
 * createCheckout — Authoritative server-side checkout.
 *
 * The ONLY path that creates a real Purchase record. The frontend must never
 * call Purchase.create directly.
 *
 * Flow:
 *   1. Authenticate the caller. buyer_email is ALWAYS user.email — any
 *      buyer_email supplied by the frontend is ignored.
 *   2. Fetch the authoritative Listing + ListingPrivate + Event + seller
 *      security profile (service role). ListingPrivate is REQUIRED — no
 *      fallback to Listing for seller_email, proof_status, demo flag, or
 *      reservation fields.
 *   3. Validate the listing is active, approved, and not the seller's own.
 *   4. Enforce the 10-minute reservation (reuse or establish) + per-user PI
 *      rate limit + one-reservation-per-buyer + one-pending-purchase rules.
 *   5. Calculate subtotal, platform fee (5%, min $1), buyer total, and seller
 *      payout (100% of subtotal) server-side.
 *   6. Create the Stripe PaymentIntent (manual capture) with metadata linking
 *      it to the listing, buyer, seller, reservation, and fee breakdown.
 *      Seller identity in metadata is the authoritative private seller email.
 *   7. Create the Purchase record (service role) with all authoritative fields.
 *      Purchase creation failure cancels and verifies the PaymentIntent.
 *   8. Verify listing status + reservation token after Purchase creation.
 *   9. Set Stripe metadata.purchase_id (required). Failure triggers
 *      cancellation/expiry/release compensation.
 *  10. Return { purchase_id, clientSecret, subtotal, platformFee,
 *              buyerTotal, sellerPayout }. No reservationToken or
 *              paymentIntentId in the response.
 *
 * If the card confirmation later fails, the Stripe webhook
 * (payment_intent.payment_failed) expires the Purchase and restores the
 * listing; the reservation also self-expires after 10 minutes.
 *
 * COMPENSATION RULES:
 *   - Every checkout failure after reservation reconciles BOTH Listing and
 *     ListingPrivate.
 *   - A reservation is cleared ONLY if its current token still equals this
 *     checkout's token.
 *   - If Stripe cancellation cannot be verified as canceled, a neutral error
 *     is returned and a CRITICAL AdminAlert containing the PI ID is created.
 *   - If seller management wins during checkout, the PI is cancelled/verified,
 *     the Purchase is expired, the seller's final non-public status is
 *     preserved, and only this checkout's token is cleared.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertListingPrivate, upsertPurchasePrivate, upsertUserSecurityProfile, ensureListingPrivate, getListingPrivate, getUserSecurityProfile, alertPrivateWriteFailure } from '../../shared/privateData.ts';

// ── Fee engine (mirrors feeEngine.js ACTIVE_FEE_MODEL_ID = 'buyer_5_min_1') ──
function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}

const PI_COOLDOWN_MS = 15 * 1000; // 15 seconds between attempts per user

// ── Clear reservation only if current token still equals this checkout's token ──
async function reconcileReservationIfTokenMatches(base44, listing_id, token, revertStatus) {
  const lpFresh = await getListingPrivate(base44, listing_id);
  if (!lpFresh) return;
  // Only clear if the current reservation token still equals this checkout's token
  if (lpFresh.reservation_token !== token) return;
  await base44.asServiceRole.entities.Listing.update(listing_id, {
    status: revertStatus || 'active',
    reservation_token: null,
    reservation_expires_at: null,
    reserved_by_email: null,
  }).catch(() => {});
  await upsertListingPrivate(base44, listing_id, {
    reservation_token: null,
    reservation_expires_at: null,
    reserved_by_email: null,
  }).catch(() => {});
}

// ── Cancel PI, verify cancellation, expire Purchase, reconcile reservation ──
async function cancelPIAndReconcile(base44, stripe, paymentIntentId, listing_id, purchase_id, reservationToken, sellerFinalStatus) {
  let cancelOk = false;
  let piFinalStatus = null;
  let cancelError = null;
  try {
    const canceled = await stripe.paymentIntents.cancel(paymentIntentId);
    piFinalStatus = canceled.status;
    cancelOk = canceled.status === 'canceled';
  } catch (cancelErr) {
    cancelError = cancelErr;
    try {
      const retrieved = await stripe.paymentIntents.retrieve(paymentIntentId);
      piFinalStatus = retrieved.status;
      if (retrieved.status === 'canceled') cancelOk = true;
    } catch (retErr) {
      cancelError = retErr;
    }
  }
  if (purchase_id) {
    await base44.asServiceRole.entities.Purchase.update(purchase_id, { transfer_status: 'expired' }).catch(() => {});
  }
  // Reconcile both Listing and ListingPrivate — clear only if token matches
  await reconcileReservationIfTokenMatches(base44, listing_id, reservationToken, sellerFinalStatus);
  if (!cancelOk) {
    try {
      await base44.asServiceRole.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `UNCCANCELLED PaymentIntent ${paymentIntentId}`,
        description: `Checkout failed but PaymentIntent ${paymentIntentId} could NOT be cancelled (status: ${piFinalStatus || 'unknown'}). PI may be authorizable/capturable — immediate manual intervention required. Error: ${cancelError?.message || 'unknown'}`,
        reference_type: 'purchase',
        reference_id: purchase_id || listing_id,
      });
    } catch (_) {}
    return { cancelOk: false };
  }
  return { cancelOk: true };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Phase 0 maintenance gate — fail-closed. createCheckout is real-money only
  // with no dry-run path, so EVERY caller (including admins) is blocked while
  // maintenance is active. Zero writes / zero Stripe calls occur before this.
  if (isMaintenanceActive()) return maintenance503('Checkout is temporarily unavailable for scheduled maintenance.');

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const body = await req.json().catch(() => ({}));
  const { listing_id, buyer_name, buyer_phone } = body;

  if (!listing_id) {
    return Response.json({ error: 'listing_id is required' }, { status: 400 });
  }

  // buyer_email is ALWAYS the authenticated user. A buyer_email supplied by
  // the frontend is intentionally ignored — it cannot determine ownership.
  const buyerEmail = user.email;

  // ── Per-user PI rate limit ───────────────────────────────────────────────
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
  // Phase 1B: mirror PI rate-limit fields to UserSecurityProfile (authoritative).
  // Required private write — failure must STOP before any Stripe PaymentIntent call.
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

  // ── Fetch authoritative listing ──────────────────────────────────────────
  const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }
  // Phase 1B: ListingPrivate is REQUIRED — no fallback to Listing for
  // seller_email, proof_status, demo flag, or reservation fields.
  const listingPrivate = await getListingPrivate(base44, listing.id);
  if (!listingPrivate) {
    return Response.json({ error: 'Listing integrity error: private record missing', code: 'INTEGRITY_ERROR' }, { status: 500 });
  }
  const authoritativeSellerEmail = listingPrivate.seller_email;
  const authoritativeReservedBy = listingPrivate.reserved_by_email ?? null;
  const authoritativeResToken = listingPrivate.reservation_token ?? null;
  const authoritativeResExpiry = listingPrivate.reservation_expires_at ?? null;
  const authoritativeIsDemo = listingPrivate.is_demo_listing ?? false;
  const authoritativeProofStatus = listingPrivate.proof_status ?? null;
  const authoritativeNotes = listingPrivate.notes ?? null;

  // Hard reject test/demo/hidden/draft listings — a real Stripe PaymentIntent
  // is NEVER created for a non-marketplace listing. Admin role does not bypass.
  if (authoritativeIsDemo === true) {
    return Response.json({ error: 'Test/demo listings cannot be purchased.' }, { status: 409 });
  }
  if (authoritativeNotes && /\[(TEST|DEMO)\]/i.test(authoritativeNotes)) {
    return Response.json({ error: 'Test/demo listings cannot be purchased.' }, { status: 409 });
  }
  if (listing.status !== 'active') {
    return Response.json({ error: 'Listing is no longer available' }, { status: 409 });
  }
  if (authoritativeProofStatus !== 'approved') {
    return Response.json({ error: 'Listing is not yet approved' }, { status: 409 });
  }
  if (authoritativeSellerEmail === buyerEmail) {
    return Response.json({ error: 'You cannot purchase your own listing' }, { status: 400 });
  }

  // ── Reservation enforcement (10-minute lock) ─────────────────────────────
  const now = Date.now();
  if (
    authoritativeResToken &&
    authoritativeResExpiry &&
    new Date(authoritativeResExpiry).getTime() > now
  ) {
    if (authoritativeReservedBy !== buyerEmail) {
      return Response.json({ error: 'This listing is currently being purchased by another buyer. Try again in a few minutes.' }, { status: 409 });
    }
  }

  // One-per-buyer: block if user has an active reservation on a DIFFERENT listing
  // Uses ListingPrivate (authoritative for reservation fields)
  const userReservations = await base44.asServiceRole.entities.ListingPrivate.filter({
    reserved_by_email: buyerEmail,
  }).catch(() => []);
  for (const r of userReservations) {
    if (r.listing_id === listing.id) continue;
    if (r.reservation_expires_at && new Date(r.reservation_expires_at).getTime() > now) {
      return Response.json({
        error: 'You already have a listing reserved. Complete or release that checkout before reserving another.',
        code: 'ALREADY_HAS_RESERVATION',
        existing_listing_id: r.listing_id,
      }, { status: 409 });
    }
    // Clear expired reservation on both Listing and ListingPrivate
    await base44.asServiceRole.entities.Listing.update(r.listing_id, {
      reserved_by_email: null,
      reservation_token: null,
      reservation_expires_at: null,
    }).catch(() => {});
    await upsertListingPrivate(base44, r.listing_id, {
      reserved_by_email: null,
      reservation_token: null,
      reservation_expires_at: null,
    }).catch(() => {});
  }

  // Block if user already has an active pending purchase for this listing
  const existingUserPurchase = await base44.asServiceRole.entities.Purchase.filter({
    listing_id: listing.id,
    buyer_email: buyerEmail,
    transfer_status: 'pending_transfer',
  }).catch(() => []);
  if (existingUserPurchase.length > 0) {
    return Response.json({ error: 'You already have a pending purchase for this listing.' }, { status: 409 });
  }

  // Establish / refresh reservation token (10-minute expiry)
  const reservationToken = crypto.randomUUID();
  const reservationExpiresAt = new Date(now + 10 * 60 * 1000).toISOString();
  // Capture exact previous reservation values for compensation
  const prevListingStatus = listing.status;
  const prevReservedBy = authoritativeReservedBy;
  const prevResToken = authoritativeResToken;
  const prevResExpiry = authoritativeResExpiry;
  await base44.asServiceRole.entities.Listing.update(listing.id, {
    status: 'pending_transfer',
    reservation_token: reservationToken,
    reservation_expires_at: reservationExpiresAt,
    reserved_by_email: buyerEmail,
  });
  // Phase 1B: mirror reservation to ListingPrivate (authoritative private destination).
  // Required private write — failure must STOP before any Stripe PaymentIntent is created.
  try {
    await upsertListingPrivate(base44, listing.id, {
      reservation_token: reservationToken,
      reservation_expires_at: reservationExpiresAt,
      reserved_by_email: buyerEmail,
    });
  } catch (err) {
    // Revert Listing to exact previous values, alert, stop
    await base44.asServiceRole.entities.Listing.update(listing.id, {
      status: prevListingStatus,
      reserved_by_email: prevReservedBy,
      reservation_token: prevResToken,
      reservation_expires_at: prevResExpiry,
    }).catch(() => {});
    await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
    return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
  }

  // Re-fetch to verify we own the reservation (last-write-wins check)
  const [reservedListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  const reservedLP = await getListingPrivate(base44, listing.id);
  if (!reservedListing || reservedListing.status !== 'pending_transfer' ||
      reservedLP?.reservation_token !== reservationToken) {
    return Response.json({ error: 'This listing was just reserved by another buyer. Please try another listing.' }, { status: 409 });
  }

  // ── Fetch seller UserSecurityProfile (authoritative for stripe_account_id) ──
  const sellerSec = await getUserSecurityProfile(base44, { user_email: authoritativeSellerEmail });
  if (!sellerSec) {
    // Reconcile reservation — clear only if our token still matches
    await reconcileReservationIfTokenMatches(base44, listing.id, reservationToken, 'active');
    return Response.json({ error: 'Seller security profile unavailable', code: 'INTEGRITY_ERROR' }, { status: 500 });
  }
  // Fetch seller User for role check only (role is on User, not UserSecurityProfile)
  const sellerUsers = await base44.asServiceRole.entities.User.filter({ email: authoritativeSellerEmail });
  const seller = sellerUsers[0];

  const rawStripeAccountId = sellerSec.stripe_account_id ?? null;
  const isLiveMode = secretKey.startsWith('sk_live_');

  let sellerStripeAccountId = rawStripeAccountId;
  if (rawStripeAccountId && isLiveMode) {
    try {
      await stripe.accounts.retrieve(rawStripeAccountId);
    } catch (err) {
      console.warn('[createCheckout] Seller account invalid in live mode:', rawStripeAccountId, err?.message);
      sellerStripeAccountId = null;
      // Clear stale account on UserSecurityProfile (authoritative)
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
    // Reconcile reservation — clear only if our token still matches
    await reconcileReservationIfTokenMatches(base44, listing.id, reservationToken, 'active');
    return Response.json({ error: 'Seller has not completed payout onboarding. Purchase blocked.' }, { status: 402 });
  }

  // ── Fee math (server-side, authoritative) ────────────────────────────────
  const subtotal = Math.round(listing.asking_price * (listing.quantity || 1) * 100) / 100;
  const platformFee = calcPlatformFee(subtotal);
  const buyerTotal = Math.round((subtotal + platformFee) * 100) / 100;
  const sellerPayout = subtotal;
  const amountCents = Math.round(buyerTotal * 100);
  const applicationFeeCents = Math.round(platformFee * 100);

  // ── Create Stripe PaymentIntent (manual capture) ─────────────────────────
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
    paymentIntent = await stripe.paymentIntents.create(piParams);
  } catch (err) {
    // Reconcile both Listing and ListingPrivate — clear only if token matches
    await reconcileReservationIfTokenMatches(base44, listing.id, reservationToken, 'active');
    return Response.json({ error: err.message }, { status: 500 });
  }

  // ── Create the Purchase record (service role — bypasses create RLS) ─────
  // Wrapped in try/catch — Purchase creation failure cancels and verifies PI.
  let purchase;
  try {
    purchase = await base44.asServiceRole.entities.Purchase.create({
      listing_id: listing.id,
      event_id: listing.event_id,
      buyer_email: buyerEmail,
      buyer_name: buyer_name || null,
      buyer_phone: buyer_phone || null,
      seller_email: authoritativeSellerEmail,
      amount: buyerTotal,
      subtotal,
      platform_fee: platformFee,
      seller_payout: sellerPayout,
      quantity: listing.quantity || 1,
      payment_intent_id: paymentIntent.id,
      reservation_token: reservationToken,
      transfer_status: 'pending_transfer',
      buyer_confirmed: false,
      seller_confirmed: false,
      payment_captured: false,
      is_demo: false,
    });
  } catch (purchaseErr) {
    // Purchase creation failure — cancel PI, verify, reconcile both sidecars
    const result = await cancelPIAndReconcile(base44, stripe, paymentIntent.id, listing.id, null, reservationToken, 'active');
    if (result.cancelOk) {
      return Response.json({ error: 'Checkout failed during purchase creation. Your payment was not charged.' }, { status: 500 });
    }
    return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
  }

  // ── Post-Purchase verification: verify listing status + token ──
  const [listingAfterPurchase] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  const lpAfterPurchase = await getListingPrivate(base44, listing.id);
  if (!listingAfterPurchase || listingAfterPurchase.status !== 'pending_transfer' ||
      lpAfterPurchase?.reservation_token !== reservationToken) {
    // Seller management or another checkout won — compensate
    const sellerFinalStatus = listingAfterPurchase?.status || 'active';
    const result = await cancelPIAndReconcile(base44, stripe, paymentIntent.id, listing.id, purchase.id, reservationToken, sellerFinalStatus);
    if (result.cancelOk) {
      return Response.json({ error: 'Listing was modified during checkout. Your payment was not charged.' }, { status: 409 });
    }
    return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
  }

  // ── Phase 1B: create PurchasePrivate + ensure ListingPrivate sidecars ─────
  let ppError = null, lpError = null;
  try {
    await upsertPurchasePrivate(base44, purchase.id, {
      listing_id: listing.id, event_id: listing.event_id,
      buyer_email: buyerEmail, seller_email: authoritativeSellerEmail,
      payment_intent_id: paymentIntent.id, reservation_token: reservationToken,
      buyer_phone: buyer_phone || null, buyer_name: buyer_name || null,
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
    // Safe compensation: cancel PI, verify, expire Purchase, reconcile both sidecars.
    const result = await cancelPIAndReconcile(base44, stripe, paymentIntent.id, listing.id, purchase.id, reservationToken, 'active');
    await alertPrivateWriteFailure(base44, { entity: ppError ? 'PurchasePrivate' : 'ListingPrivate', reference_id: purchase.id, reference_type: 'purchase', error: ppError || lpError });
    if (result.cancelOk) {
      return Response.json({ error: 'Checkout failed during private record creation. Your payment was not charged.' }, { status: 500 });
    }
    return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
  }

  // ── Set Stripe metadata.purchase_id (REQUIRED) ──────────────────────────
  // Failure triggers cancellation/expiry/release compensation.
  try {
    await stripe.paymentIntents.update(paymentIntent.id, { metadata: { purchase_id: purchase.id } });
  } catch (err) {
    // metadata.purchase_id failure — cancel PI, verify, expire Purchase, reconcile
    const result = await cancelPIAndReconcile(base44, stripe, paymentIntent.id, listing.id, purchase.id, reservationToken, 'active');
    await alertPrivateWriteFailure(base44, { entity: 'StripeMetadata', reference_id: purchase.id, reference_type: 'purchase', error: err });
    if (result.cancelOk) {
      return Response.json({ error: 'Checkout failed during payment linking. Your payment was not charged.' }, { status: 500 });
    }
    return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
  }

  // ── Response: no reservationToken, no paymentIntentId ──
  return Response.json({
    purchase_id: purchase.id,
    clientSecret: paymentIntent.client_secret,
    subtotal,
    platformFee,
    buyerTotal,
    sellerPayout,
  });
});