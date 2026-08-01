/**
 * createCheckout — Authoritative server-side checkout.
 *
 * The ONLY path that creates a real Purchase record.
 *
 * CONCURRENCY CLOSURE (7C.2):
 *   - Token-safe reconciliation: re-fetches BOTH Listing and ListingPrivate,
 *     clears each entity only when THAT entity's current token matches.
 *   - Uncertain PI cancellation: does NOT expire Purchase or release Listing;
 *     keeps listing locked, marks private failure state, creates critical alert.
 *   - Fail-closed queries: no catch-to-empty on safety queries.
 *   - Checkout idempotency: reuses reservation token, Stripe idempotency key,
 *     checks for existing Purchase before creating a new one.
 *   - Pre-write re-fetch: verifies listing is still active before reserving.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertListingPrivate, upsertPurchasePrivate, getPurchasePrivate, upsertUserSecurityProfile, ensureListingPrivate, getListingPrivate, getUserSecurityProfile, alertPrivateWriteFailure } from '../../shared/privateData.ts';

// ── Fee engine (mirrors feeEngine.js ACTIVE_FEE_MODEL_ID = 'buyer_5_min_1') ──
function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}

const PI_COOLDOWN_MS = 15 * 1000;
const MAX_ID_LENGTH = 200;

// ── Token-safe reconciliation ────────────────────────────────────────────────
// Re-fetches BOTH Listing and ListingPrivate. Clears fields on each entity
// only when THAT entity's current token equals this checkout's token.
// Never clears Listing token B merely because ListingPrivate has token A.
// Awaits writes, reports failure, re-fetches afterward to verify.
async function reconcileReservationTokenSafe(base44, listing_id, token, revertStatus) {
  const [listingRows, lpRows] = await Promise.all([
    base44.asServiceRole.entities.Listing.filter({ id: listing_id }),
    base44.asServiceRole.entities.ListingPrivate.filter({ listing_id }),
  ]);
  const l = listingRows[0];
  const lp = lpRows[0];

  // Clear Listing only if Listing's current token matches
  if (l && l.reservation_token === token) {
    const updateFields = {
      reservation_token: null,
      reservation_expires_at: null,
      reserved_by_email: null,
    };
    // Only revert status if the listing is still in our pending_transfer state
    if (revertStatus && l.status === 'pending_transfer') {
      updateFields.status = revertStatus;
    }
    try {
      await base44.asServiceRole.entities.Listing.update(listing_id, updateFields);
    } catch (err) {
      return { reconciled: false, error: err, entity: 'Listing' };
    }
  }

  // Clear ListingPrivate only if ListingPrivate's current token matches
  if (lp && lp.reservation_token === token) {
    try {
      await upsertListingPrivate(base44, listing_id, {
        reservation_token: null,
        reservation_expires_at: null,
        reserved_by_email: null,
      });
    } catch (err) {
      return { reconciled: false, error: err, entity: 'ListingPrivate' };
    }
  }

  // Re-fetch afterward to verify no newer winner was overwritten
  const [listingAfter, lpAfter] = await Promise.all([
    base44.asServiceRole.entities.Listing.filter({ id: listing_id }),
    base44.asServiceRole.entities.ListingPrivate.filter({ listing_id }),
  ]);
  const lAfter = listingAfter[0];
  const lpAfterRow = lpAfter[0];

  if (l?.reservation_token === token && lAfter?.reservation_token === token) {
    return { reconciled: false, error: new Error('Listing token not cleared'), entity: 'Listing' };
  }
  if (lp?.reservation_token === token && lpAfterRow?.reservation_token === token) {
    return { reconciled: false, error: new Error('ListingPrivate token not cleared'), entity: 'ListingPrivate' };
  }

  return { reconciled: true };
}

// ── Cancel PI, verify, conditionally expire+reconcile ───────────────────────
// Only verified `canceled` permits Purchase expiry and reservation release.
// Uncertain cancellation keeps listing locked, preserves state, alerts.
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

  if (!cancelOk) {
    // ── Uncertain cancellation ──
    // Do NOT expire Purchase, do NOT release/reactivate Listing.
    // Keep listing non-public/locked. Preserve state for admin resolution.
    // Mark private payment failure state where supported.
    if (purchase_id) {
      try {
        const pp = await getPurchasePrivate(base44, purchase_id);
        if (pp) {
          await base44.asServiceRole.entities.PurchasePrivate.update(pp.id, {
            payment_capture_failed: true,
            dispute_reason: `PI cancellation uncertain: ${piFinalStatus || 'unknown'}`,
          });
        }
      } catch (_) {}
    }
    try {
      await base44.asServiceRole.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `UNCCANCELLED PaymentIntent ${paymentIntentId}`,
        description: `Checkout failed but PaymentIntent ${paymentIntentId} could NOT be cancelled (status: ${piFinalStatus || 'unknown'}). PI may be authorizable/capturable — immediate manual intervention required. Purchase ${purchase_id || 'N/A'} is NOT expired. Listing ${listing_id} remains locked. Error: ${cancelError?.message || 'unknown'}`,
        reference_type: 'purchase',
        reference_id: purchase_id || listing_id,
      });
    } catch (_) {}
    return { cancelOk: false, reconciled: false };
  }

  // ── Cancellation verified — expire Purchase and reconcile ──
  if (purchase_id) {
    await base44.asServiceRole.entities.Purchase.update(purchase_id, { transfer_status: 'expired' }).catch(() => {});
  }
  const reconResult = await reconcileReservationTokenSafe(base44, listing_id, reservationToken, sellerFinalStatus);
  return { cancelOk: true, reconciled: reconResult.reconciled, reconError: reconResult.error };
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

  // ── Fetch authoritative listing ──────────────────────────────────────────
  const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }
  // ListingPrivate is REQUIRED — no fallback to Listing for any private field.
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

  // ── Reservation enforcement (10-minute lock) ─────────────────────────────
  const now = Date.now();
  if (authoritativeResToken && authoritativeResExpiry && new Date(authoritativeResExpiry).getTime() > now) {
    if (authoritativeReservedBy !== buyerEmail) {
      return Response.json({ error: 'This listing is currently being purchased by another buyer. Try again in a few minutes.' }, { status: 409 });
    }
  }

  // ── One-per-buyer: block if active reservation on a DIFFERENT listing ────
  // Uses ListingPrivate (authoritative). NO catch-to-empty — fail-closed.
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
    // Clear expired reservation — token-safe (uses the LP's own token)
    await reconcileReservationTokenSafe(base44, r.listing_id, r.reservation_token, 'active');
  }

  // ── Pending-purchase check using PurchasePrivate (authoritative identity) ──
  // Never uses Purchase.buyer_email for authorization or deduplication.
  let existingPendingPPs;
  try {
    existingPendingPPs = await base44.asServiceRole.entities.PurchasePrivate.filter({
      listing_id: listing.id,
      buyer_email: buyerEmail,
    });
  } catch (err) {
    return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
  }
  if (existingPendingPPs.length > 0) {
    const pendingPurchaseIds = existingPendingPPs.map(pp => pp.purchase_id);
    let existingPurchases;
    try {
      existingPurchases = await base44.asServiceRole.entities.Purchase.filter({
        id: { $in: pendingPurchaseIds },
      });
    } catch (err) {
      return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
    }
    const hasPending = existingPurchases.some(p => p.transfer_status === 'pending_transfer');
    if (hasPending) {
      return Response.json({ error: 'You already have a pending purchase for this listing.' }, { status: 409 });
    }
  }

  // ── Checkout idempotency: reuse existing unexpired reservation token ─────
  const hasExistingReservation = authoritativeResToken &&
    authoritativeResExpiry &&
    new Date(authoritativeResExpiry).getTime() > now &&
    authoritativeReservedBy === buyerEmail;
  const reservationToken = hasExistingReservation ? authoritativeResToken : crypto.randomUUID();
  const reservationExpiresAt = hasExistingReservation ? authoritativeResExpiry : new Date(now + 10 * 60 * 1000).toISOString();

  // ── Pre-write re-fetch: verify listing is still active before reserving ──
  const [listingFreshBeforeReserve] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  if (!listingFreshBeforeReserve || listingFreshBeforeReserve.status !== 'active') {
    return Response.json({ error: 'Listing is no longer available' }, { status: 409 });
  }

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
  try {
    await upsertListingPrivate(base44, listing.id, {
      reservation_token: reservationToken,
      reservation_expires_at: reservationExpiresAt,
      reserved_by_email: buyerEmail,
    });
  } catch (err) {
    // ListingPrivate write failure — token-safe reconciliation (no blind restore)
    const reconResult = await reconcileReservationTokenSafe(base44, listing.id, reservationToken, prevListingStatus);
    await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
    if (!reconResult.reconciled) {
      try {
        await base44.asServiceRole.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `Reservation reconciliation failed for listing ${listing.id}`,
          description: `ListingPrivate write failed and token-safe reconciliation could not complete. Token: ${reservationToken}. Error: ${reconResult.error?.message || 'unknown'} on ${reconResult.entity}.`,
          reference_type: 'listing',
          reference_id: listing.id,
        });
      } catch (_) {}
      return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
    }
    return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
  }

  // ── Initial verification: re-fetch to verify we own the reservation ──────
  const [reservedListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  const reservedLP = await getListingPrivate(base44, listing.id);
  if (!reservedListing || reservedListing.status !== 'pending_transfer' ||
      reservedLP?.reservation_token !== reservationToken) {
    // Initial verification failure — reconcile only our token, preserve other state
    const reconResult = await reconcileReservationTokenSafe(base44, listing.id, reservationToken,
      reservedListing?.status || prevListingStatus);
    if (!reconResult.reconciled) {
      try {
        await base44.asServiceRole.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `Reservation reconciliation failed for listing ${listing.id}`,
          description: `Checkout verification failed and token-safe reconciliation could not complete. Token: ${reservationToken}. Error: ${reconResult.error?.message || 'unknown'} on ${reconResult.entity}.`,
          reference_type: 'listing',
          reference_id: listing.id,
        });
      } catch (_) {}
      return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
    }
    return Response.json({ error: 'This listing was just reserved by another buyer. Please try another listing.' }, { status: 409 });
  }

  // ── Fetch seller UserSecurityProfile (authoritative for stripe_account_id) ──
  const sellerSec = await getUserSecurityProfile(base44, { user_email: authoritativeSellerEmail });
  if (!sellerSec) {
    const reconResult = await reconcileReservationTokenSafe(base44, listing.id, reservationToken, 'active');
    if (!reconResult.reconciled) {
      try {
        await base44.asServiceRole.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `Reservation reconciliation failed for listing ${listing.id}`,
          description: `Seller profile missing and token-safe reconciliation could not complete. Token: ${reservationToken}.`,
          reference_type: 'listing',
          reference_id: listing.id,
        });
      } catch (_) {}
      return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
    }
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
    const reconResult = await reconcileReservationTokenSafe(base44, listing.id, reservationToken, 'active');
    if (!reconResult.reconciled) {
      try {
        await base44.asServiceRole.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `Reservation reconciliation failed for listing ${listing.id}`,
          description: `Seller onboarding incomplete and token-safe reconciliation could not complete. Token: ${reservationToken}.`,
          reference_type: 'listing',
          reference_id: listing.id,
        });
      } catch (_) {}
      return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
    }
    return Response.json({ error: 'Seller has not completed payout onboarding. Purchase blocked.' }, { status: 402 });
  }

  // ── Fee math + financial validation (server-side, authoritative) ─────────
  const askingPriceNum = Number(listing.asking_price);
  if (!Number.isFinite(askingPriceNum) || askingPriceNum <= 0) {
    const reconResult = await reconcileReservationTokenSafe(base44, listing.id, reservationToken, 'active');
    return Response.json({ error: 'Invalid listing price' }, { status: 400 });
  }
  const quantityNum = Number(listing.quantity) || 1;
  if (!Number.isInteger(quantityNum) || quantityNum <= 0 || quantityNum > 100) {
    const reconResult = await reconcileReservationTokenSafe(base44, listing.id, reservationToken, 'active');
    return Response.json({ error: 'Invalid quantity' }, { status: 400 });
  }
  const subtotal = Math.round(askingPriceNum * quantityNum * 100) / 100;
  const platformFee = calcPlatformFee(subtotal);
  const buyerTotal = Math.round((subtotal + platformFee) * 100) / 100;
  const sellerPayout = subtotal;
  const amountCents = Math.round(buyerTotal * 100);
  const applicationFeeCents = Math.round(platformFee * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0 || !Number.isInteger(amountCents)) {
    const reconResult = await reconcileReservationTokenSafe(base44, listing.id, reservationToken, 'active');
    return Response.json({ error: 'Invalid calculated amount' }, { status: 500 });
  }
  if (!Number.isFinite(applicationFeeCents) || applicationFeeCents <= 0 || !Number.isInteger(applicationFeeCents)) {
    const reconResult = await reconcileReservationTokenSafe(base44, listing.id, reservationToken, 'active');
    return Response.json({ error: 'Invalid calculated fee' }, { status: 500 });
  }

  // ── Checkout idempotency: check for existing Purchase with this token ─────
  let existingPPWithToken;
  try {
    existingPPWithToken = await base44.asServiceRole.entities.PurchasePrivate.filter({
      listing_id: listing.id,
      buyer_email: buyerEmail,
      reservation_token: reservationToken,
    });
  } catch (err) {
    return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
  }
  if (existingPPWithToken.length > 0) {
    const existingPurchaseIds = existingPPWithToken.map(pp => pp.purchase_id);
    let existingPurchasesWithToken;
    try {
      existingPurchasesWithToken = await base44.asServiceRole.entities.Purchase.filter({
        id: { $in: existingPurchaseIds },
      });
    } catch (err) {
      return Response.json({ error: 'Checkout unavailable. Please try again.' }, { status: 500 });
    }
    const pendingPurchase = existingPurchasesWithToken.find(p => p.transfer_status === 'pending_transfer');
    if (pendingPurchase) {
      // Idempotent reuse — retrieve existing PI and return its client_secret
      try {
        const existingPI = await stripe.paymentIntents.retrieve(existingPPWithToken[0].payment_intent_id);
        if (existingPI.client_secret && (existingPI.status === 'requires_payment_method' || existingPI.status === 'requires_action')) {
          return Response.json({
            purchase_id: pendingPurchase.id,
            clientSecret: existingPI.client_secret,
            subtotal,
            platformFee,
            buyerTotal,
            sellerPayout,
          });
        }
      } catch (_) {}
    }
  }

  // ── Create Stripe PaymentIntent (manual capture) with idempotency key ────
  const idempotencyKey = `checkout_${listing.id}_${reservationToken}`;
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
    paymentIntent = await stripe.paymentIntents.create(piParams, { idempotencyKey });
  } catch (err) {
    const reconResult = await reconcileReservationTokenSafe(base44, listing.id, reservationToken, 'active');
    if (!reconResult.reconciled) {
      try {
        await base44.asServiceRole.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: `Reservation reconciliation failed for listing ${listing.id}`,
          description: `Stripe PI creation failed and token-safe reconciliation could not complete. Token: ${reservationToken}. Error: ${reconResult.error?.message || 'unknown'} on ${reconResult.entity}.`,
          reference_type: 'listing',
          reference_id: listing.id,
        });
      } catch (_) {}
      return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
    }
    return Response.json({ error: err.message }, { status: 500 });
  }

  // ── Create the Purchase record (service role) ────────────────────────────
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
    const result = await cancelPIAndReconcile(base44, stripe, paymentIntent.id, listing.id, null, reservationToken, 'active');
    if (result.cancelOk) {
      return Response.json({ error: 'Checkout failed during purchase creation. Your payment was not charged.' }, { status: 500 });
    }
    return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
  }

  // ── Post-Purchase verification: verify listing status + token ─────────────
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
    const result = await cancelPIAndReconcile(base44, stripe, paymentIntent.id, listing.id, purchase.id, reservationToken, 'active');
    await alertPrivateWriteFailure(base44, { entity: ppError ? 'PurchasePrivate' : 'ListingPrivate', reference_id: purchase.id, reference_type: 'purchase', error: ppError || lpError });
    if (result.cancelOk) {
      return Response.json({ error: 'Checkout failed during private record creation. Your payment was not charged.' }, { status: 500 });
    }
    return Response.json({ error: 'Checkout failed. Please contact support.' }, { status: 500 });
  }

  // ── Set Stripe metadata.purchase_id (REQUIRED) ────────────────────────────
  try {
    await stripe.paymentIntents.update(paymentIntent.id, { metadata: { purchase_id: purchase.id } });
  } catch (err) {
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