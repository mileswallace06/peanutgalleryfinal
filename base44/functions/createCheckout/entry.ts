/**
 * createCheckout — Authoritative server-side checkout.
 *
 * CONCURRENCY CLOSURE (7C.3):
 *
 * A. SINGLE CHECKOUT WINNER via Stripe atomic idempotency:
 *    - Idempotency key = `checkout_${listing_id}_${listing.updated_date}`
 *      (immutable pre-reservation listing revision captured at fetch time).
 *    - Two buyers racing on the same listing revision get the same key.
 *    - Stripe returns the same PI for both; first buyer's metadata wins.
 *    - After create/retrieve, only the buyer in PI metadata may continue.
 *    - Every loser returns 409 and creates no Purchase, no reservation.
 *
 * B. FULL 6-CONDITION VERIFICATION at every checkpoint:
 *    Listing.status === pending_transfer
 *    Listing.reservation_token === request token
 *    Listing.reserved_by_email === authenticated buyer
 *    ListingPrivate.reservation_token === request token
 *    ListingPrivate.reserved_by_email === authenticated buyer
 *    both expirations current and consistent
 *
 * C. RETRY BEFORE CONFLICT:
 *    Retry check runs before the generic pending-purchase conflict.
 *    Returns existing Purchase/client_secret only for same buyer,
 *    canonical token, canonical PI, and client-confirmable PI status.
 *    requires_capture/succeeded/canceled/ambiguous → 409, no new flow.
 *
 * D. NO TOCTOU "TOKEN SAFE":
 *    On failure, quarantine listing (set hidden, do NOT clear token).
 *    Never clear a possibly newer token from the request path.
 *    Cleanup automation resolves quarantined listings.
 *
 * E. ALL-OR-NOTHING CANCELLATION:
 *    PI verified canceled + Purchase expiry confirmed + Listing quarantined
 *    + post-write verified. If ANY step fails → critical alert + 500.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertListingPrivate, upsertPurchasePrivate, getPurchasePrivate, upsertUserSecurityProfile, ensureListingPrivate, getListingPrivate, getUserSecurityProfile, alertPrivateWriteFailure } from '../../shared/privateData.ts';

function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}

const PI_COOLDOWN_MS = 15 * 1000;
const MAX_ID_LENGTH = 200;

// ── 6-condition reservation verification (pure) ───────────────────────────
function verifyReservation(listing, lp, token, buyerEmail) {
  if (!listing || !lp) return false;
  const now = Date.now();
  if (listing.status !== 'pending_transfer') return false;
  if (listing.reservation_token !== token) return false;
  if (listing.reserved_by_email !== buyerEmail) return false;
  if (lp.reservation_token !== token) return false;
  if (lp.reserved_by_email !== buyerEmail) return false;
  const lExpiry = listing.reservation_expires_at ? new Date(listing.reservation_expires_at).getTime() : 0;
  const lpExpiry = lp.reservation_expires_at ? new Date(lp.reservation_expires_at).getTime() : 0;
  if (lExpiry <= now || lpExpiry <= now) return false;
  if (lExpiry !== lpExpiry) return false;
  return true;
}

// ── Quarantine listing (no token clearing — no TOCTOU) ──────────────────────
// Sets listing to hidden with hidden_reason='checkout_quarantine'.
// Does NOT clear reservation_token. Post-write verified.
async function quarantineListing(base44, listing_id, reason, purchase_id) {
  try {
    await base44.asServiceRole.entities.Listing.update(listing_id, {
      status: 'hidden',
      hidden_reason: 'checkout_quarantine',
    });
  } catch (err) {
    try {
      await base44.asServiceRole.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `QUARANTINE FAILED for listing ${listing_id}`,
        description: `Failed to quarantine listing ${listing_id}: ${reason}. Error: ${err?.message}. Purchase: ${purchase_id || 'N/A'}.`,
        reference_type: 'listing',
        reference_id: listing_id,
      });
    } catch (_) {}
    return { quarantined: false, error: err };
  }
  // Post-write verification
  const [verifyListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  if (!verifyListing || verifyListing.status !== 'hidden' || verifyListing.hidden_reason !== 'checkout_quarantine') {
    try {
      await base44.asServiceRole.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `QUARANTINE VERIFICATION FAILED for listing ${listing_id}`,
        description: `Quarantine write succeeded but post-write verification failed. Status: ${verifyListing?.status}, hidden_reason: ${verifyListing?.hidden_reason}.`,
        reference_type: 'listing',
        reference_id: listing_id,
      });
    } catch (_) {}
    return { quarantined: false, error: new Error('Post-write verification failed') };
  }
  return { quarantined: true };
}

// ── All-or-nothing cancellation compensation ───────────────────────────────
// Step 1: Verify PI canceled (Stripe).
// Step 2: Expire Purchase (write confirmed).
// Step 3: Quarantine listing (Listing + LP reconciliation).
// Step 4: Post-write verified (inside quarantineListing).
// If ANY step fails → critical alert + return allStepsOk: false.
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
    await quarantineListing(base44, listing_id, `PI ${paymentIntentId} cancellation uncertain (status: ${piStatus})`, purchase_id);
    try {
      await base44.asServiceRole.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `UNCCANCELLED PaymentIntent ${paymentIntentId}`,
        description: `PI ${paymentIntentId} could NOT be cancelled (status: ${piStatus}). Purchase ${purchase_id || 'N/A'} NOT expired. Listing ${listing_id} quarantined. Reason: ${reason}.`,
        reference_type: 'purchase',
        reference_id: purchase_id || listing_id,
      });
    } catch (_) {}
    return { cancelOk: false, allStepsOk: false };
  }

  // Step 2: Expire Purchase (write confirmed)
  if (purchase_id) {
    try {
      await base44.asServiceRole.entities.Purchase.update(purchase_id, { transfer_status: 'expired' });
    } catch (err) {
      await quarantineListing(base44, listing_id, `Purchase ${purchase_id} expiry write failed`, purchase_id);
      try {
        await base44.asServiceRole.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `PURCHASE EXPIRY FAILED for ${purchase_id}`,
          description: `PI ${paymentIntentId} canceled but Purchase ${purchase_id} could not be expired. Listing ${listing_id} quarantined. Error: ${err?.message}.`,
          reference_type: 'purchase',
          reference_id: purchase_id,
        });
      } catch (_) {}
      return { cancelOk: true, allStepsOk: false };
    }
  }

  // Step 3+4: Quarantine listing (with post-write verification)
  const qResult = await quarantineListing(base44, listing_id, `Checkout compensation for PI ${paymentIntentId}`, purchase_id);
  if (!qResult.quarantined) {
    return { cancelOk: true, allStepsOk: false };
  }

  return { cancelOk: true, allStepsOk: true };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  // ── Fetch Listing + ListingPrivate ───────────────────────────────────────
  // Capture listing.updated_date as the immutable pre-reservation listing revision.
  const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }
  const listingRevision = listing.updated_date;
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

  // ── RETRY CHECK (before pending-purchase conflict) ────────────────────────
  // Find existing PurchasePrivate for buyer + listing. If a pending Purchase
  // exists with a client-confirmable PI, return existing client_secret.
  // requires_capture/succeeded/canceled/ambiguous → 409, no new flow.
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
    const pendingPPs = existingPPs;
    const pendingPurchaseIds = pendingPPs.map(pp => pp.purchase_id);
    let existingPurchases;
    try {
      existingPurchases = await base44.asServiceRole.entities.Purchase.filter({
        id: { $in: pendingPurchaseIds },
      });
    } catch (err) {
      return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
    }
    for (const pp of pendingPPs) {
      const pur = existingPurchases.find(p => p.id === pp.purchase_id);
      if (!pur || pur.transfer_status !== 'pending_transfer') continue;
      // Retrieve PI to check status
      try {
        const existingPI = await stripe.paymentIntents.retrieve(pp.payment_intent_id);
        if (existingPI.status === 'requires_payment_method' || existingPI.status === 'requires_action') {
          // Safe retry — return existing client_secret
          return Response.json({
            purchase_id: pur.id,
            clientSecret: existingPI.client_secret,
            subtotal,
            platformFee,
            buyerTotal,
            sellerPayout,
          });
        }
        // requires_capture/succeeded/canceled/ambiguous → don't return new flow
        return Response.json({ error: 'A checkout for this listing is already in progress. Please wait for it to complete or expire.' }, { status: 409 });
      } catch (_) {
        // PI retrieval failed — can't verify, don't create new flow
        return Response.json({ error: 'Checkout verification unavailable. Please try again.' }, { status: 500 });
      }
    }
  }

  // ── PENDING-PURCHASE CONFLICT (different buyer) ──────────────────────────
  // Block if a DIFFERENT buyer has a pending purchase for this listing.
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
    const hasOtherPending = otherPurchases.some(p => p.transfer_status === 'pending_transfer');
    if (hasOtherPending) {
      return Response.json({ error: 'This listing is currently being purchased by another buyer.' }, { status: 409 });
    }
  }

  // ── RESERVATION ENFORCEMENT ──────────────────────────────────────────────
  if (authoritativeResToken && authoritativeResExpiry && new Date(authoritativeResExpiry).getTime() > now) {
    if (authoritativeReservedBy !== buyerEmail) {
      return Response.json({ error: 'This listing is currently being purchased by another buyer. Try again in a few minutes.' }, { status: 409 });
    }
  }

  // ── ONE-PER-BUYER ────────────────────────────────────────────────────────
  // Block if buyer has active reservation on a DIFFERENT listing.
  // Skip expired reservations — do NOT clear them (no TOCTOU). Cleanup handles them.
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
    // Expired — skip, don't clear
  }

  // ── Fetch seller UserSecurityProfile ─────────────────────────────────────
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
      console.warn('[createCheckout] Seller account invalid in live mode:', rawStripeAccountId, err?.message);
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

  // ── Derive Stripe idempotency key from listing_id + listing revision ─────
  // listingRevision = listing.updated_date captured at fetch time (before any writes).
  // Two buyers racing on the same listing revision get the same key → one PI.
  const idempotencyKey = `checkout_${listing.id}_${listingRevision}`;
  const reservationToken = crypto.randomUUID();
  const reservationExpiresAt = new Date(now + 10 * 60 * 1000).toISOString();

  // ── Create Stripe PaymentIntent with idempotency key ─────────────────────
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
    return Response.json({ error: err.message }, { status: 500 });
  }

  // ── Verify PI winner: only the buyer in PI metadata may continue ──────────
  if (paymentIntent.metadata.buyer_email !== buyerEmail) {
    // Loser — Stripe returned another buyer's PI from the idempotency cache.
    // No writes, no Purchase. Just return 409.
    return Response.json({ error: 'This listing was just reserved by another buyer. Please try another listing.' }, { status: 409 });
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
    // LP write failed — quarantine listing (no token clearing)
    await quarantineListing(base44, listing.id, `ListingPrivate write failed: ${err?.message}`, null);
    await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
    return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
  }

  // ── Full 6-condition verification ─────────────────────────────────────────
  const [reservedListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  const reservedLP = await getListingPrivate(base44, listing.id);
  if (!verifyReservation(reservedListing, reservedLP, reservationToken, buyerEmail)) {
    // Verification failed — quarantine (no token clearing)
    await quarantineListing(base44, listing.id, 'Initial 6-condition verification failed', null);
    return Response.json({ error: 'This listing was just reserved by another buyer. Please try another listing.' }, { status: 409 });
  }

  // ── Canonicalize by payment_intent_id ────────────────────────────────────
  // Never allow two successful Purchase records for one PI.
  const existingPurchasesForPI = await base44.asServiceRole.entities.Purchase.filter({
    payment_intent_id: paymentIntent.id,
  });
  const existingPendingForPI = existingPurchasesForPI.find(p => p.transfer_status === 'pending_transfer');
  if (existingPendingForPI) {
    return Response.json({
      purchase_id: existingPendingForPI.id,
      clientSecret: paymentIntent.client_secret,
      subtotal,
      platformFee,
      buyerTotal,
      sellerPayout,
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
      subtotal,
      platform_fee: platformFee,
      seller_payout: sellerPayout,
      quantity: quantityNum,
      payment_intent_id: paymentIntent.id,
      reservation_token: reservationToken,
      transfer_status: 'pending_transfer',
      buyer_confirmed: false,
      seller_confirmed: false,
      payment_captured: false,
      is_demo: false,
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

  // ── Create PurchasePrivate + ensure ListingPrivate ───────────────────────
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

  // ── Set Stripe metadata.purchase_id (REQUIRED) ────────────────────────────
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
    subtotal,
    platformFee,
    buyerTotal,
    sellerPayout,
  });
});