import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

// ── Fee engine (mirrors feeEngine.js ACTIVE_FEE_MODEL_ID = 'pct5_min1') ──────
function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}

// ── Per-user rate limit: track last PI attempt via a simple in-memory approach
// We use the User entity's last_pi_attempt_at field for persistence across instances
const PI_COOLDOWN_MS = 15 * 1000; // 15 seconds between attempts per user

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const { listing_id, buyer_name, buyer_email, buyer_phone } = await req.json();

  if (!listing_id) {
    return Response.json({ error: 'listing_id is required' }, { status: 400 });
  }

  // ── HIGH-3: Per-user PI rate limiting ────────────────────────────────────
  const [freshRequester] = await base44.asServiceRole.entities.User.filter({ email: user.email });
  if (freshRequester?.last_pi_attempt_at) {
    const msSinceLast = Date.now() - new Date(freshRequester.last_pi_attempt_at).getTime();
    if (msSinceLast < PI_COOLDOWN_MS) {
      const waitSecs = Math.ceil((PI_COOLDOWN_MS - msSinceLast) / 1000);
      console.warn('[createPaymentIntent] Rate limit hit for user:', user.email);
      return Response.json({ error: `Please wait ${waitSecs}s before trying again.` }, { status: 429 });
    }
  }
  // Stamp attempt time immediately (fire-and-forget)
  base44.asServiceRole.entities.User.update(freshRequester.id, {
    last_pi_attempt_at: new Date().toISOString(),
    pi_attempt_count: (freshRequester.pi_attempt_count || 0) + 1,
  }).catch(() => {});

  // Fetch listing
  const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }
  if (listing.status !== 'active') {
    return Response.json({ error: 'Listing is no longer available' }, { status: 409 });
  }
  if (listing.proof_status !== 'approved') {
    return Response.json({ error: 'Listing is not yet approved' }, { status: 409 });
  }
  if (listing.seller_email === (buyer_email || user.email)) {
    return Response.json({ error: 'You cannot purchase your own listing' }, { status: 400 });
  }

  // ── CRITICAL-A: Reservation token locking ────────────────────────────────
  // Check if a valid (non-expired) reservation exists from a different user
  const now = Date.now();
  if (
    listing.reservation_token &&
    listing.reservation_expires_at &&
    new Date(listing.reservation_expires_at).getTime() > now
  ) {
    // Allow the same user to re-attempt their own reservation
    if (listing.reserved_by_email !== user.email) {
      console.warn('[createPaymentIntent] Listing already reserved:', {
        listing_id,
        reserved_by: listing.reserved_by_email,
        attempted_by: user.email,
      });
      return Response.json({ error: 'This listing is currently being purchased by another buyer. Try again in a few minutes.' }, { status: 409 });
    }
  }

  // Also block if user already has an active pending purchase for this listing
  const existingUserPurchase = await base44.asServiceRole.entities.Purchase.filter({
    listing_id: listing.id,
    buyer_email: user.email,
    transfer_status: 'pending_transfer',
  }).catch(() => []);
  if (existingUserPurchase.length > 0) {
    return Response.json({ error: 'You already have a pending purchase for this listing.' }, { status: 409 });
  }

  // Set reservation token (10-minute expiry)
  const reservationToken = crypto.randomUUID();
  const reservationExpiresAt = new Date(now + 10 * 60 * 1000).toISOString();
  await base44.asServiceRole.entities.Listing.update(listing.id, {
    status: 'pending_transfer',
    reservation_token: reservationToken,
    reservation_expires_at: reservationExpiresAt,
    reserved_by_email: user.email,
  });

  // Re-fetch to verify we own the reservation (last-write-wins check)
  const [reservedListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
  if (!reservedListing || reservedListing.reserved_by_email !== user.email || reservedListing.reservation_token !== reservationToken) {
    console.warn('[createPaymentIntent] Reservation race detected — another buyer won:', {
      listing_id,
      our_token: reservationToken,
      actual_token: reservedListing?.reservation_token,
      actual_reserved_by: reservedListing?.reserved_by_email,
    });
    return Response.json({ error: 'This listing was just reserved by another buyer. Please try another listing.' }, { status: 409 });
  }

  // Fetch seller
  const sellerUsers = await base44.asServiceRole.entities.User.filter({ email: listing.seller_email });
  const seller = sellerUsers[0];
  const rawStripeAccountId = seller?.stripe_account_id || null;
  const isLiveMode = secretKey.startsWith('sk_live_');

  let sellerStripeAccountId = rawStripeAccountId;
  if (rawStripeAccountId && isLiveMode) {
    try {
      await stripe.accounts.retrieve(rawStripeAccountId);
    } catch (err) {
      console.warn('[createPaymentIntent] Seller account invalid in live mode:', rawStripeAccountId, err?.message);
      sellerStripeAccountId = null;
      await base44.asServiceRole.entities.User.update(seller.id, { stripe_account_id: null, stripe_onboarding_complete: false });
    }
  }

  const isTestOrAdminListing = listing.notes?.includes('[TEST]') || seller?.role === 'admin';

  if (!sellerStripeAccountId && !isTestOrAdminListing) {
    // Release reservation before blocking
    await base44.asServiceRole.entities.Listing.update(listing.id, {
      status: 'active',
      reservation_token: null,
      reservation_expires_at: null,
      reserved_by_email: null,
    }).catch(() => {});
    return Response.json({ error: 'Seller has not completed payout onboarding. Purchase blocked.' }, { status: 402 });
  }

  // Fee math
  const subtotal = listing.asking_price * (listing.quantity || 1);
  const platformFee = calcPlatformFee(subtotal);
  const buyerTotal = Math.round((subtotal + platformFee) * 100) / 100;
  const sellerPayout = subtotal;

  const amountCents = Math.round(buyerTotal * 100);
  const applicationFeeCents = Math.round(platformFee * 100);

  console.log('[createPaymentIntent] fee math:', { subtotal, platformFee, buyerTotal, sellerPayout, amountCents, applicationFeeCents });

  let paymentIntent;
  try {
    const piParams = {
      amount: amountCents,
      currency: 'usd',
      capture_method: 'manual',
      metadata: {
        listing_id: listing.id,
        event_id: listing.event_id,
        buyer_email: buyer_email || user.email,
        seller_email: listing.seller_email,
        reservation_token: reservationToken,
        subtotal: subtotal.toString(),
        platform_fee: platformFee.toString(),
        seller_payout: sellerPayout.toString(),
      },
      description: `Peanut Gallery: Section ${listing.section} Row ${listing.row}`,
    };

    if (sellerStripeAccountId) {
      piParams.application_fee_amount = applicationFeeCents;
      piParams.transfer_data = { destination: sellerStripeAccountId };
    }

    paymentIntent = await stripe.paymentIntents.create(piParams);
  } catch (err) {
    // Release reservation on PI creation failure
    await base44.asServiceRole.entities.Listing.update(listing.id, {
      status: 'active',
      reservation_token: null,
      reservation_expires_at: null,
      reserved_by_email: null,
    }).catch(() => {});
    return Response.json({ error: err.message }, { status: 500 });
  }

  // Notify seller (fire-and-forget)
  base44.asServiceRole.functions.invoke('sendUserNotification', {
    user_email: listing.seller_email,
    title: 'Your ticket sold 🎟️',
    body: 'Transfer the tickets now to complete the sale.',
    type: 'sale_created',
    purchase_id: null,
  }).catch(err => console.error('[createPaymentIntent] notify seller failed:', err?.message));

  return Response.json({
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    reservationToken,
    subtotal,
    platformFee,
    buyerTotal,
    sellerPayout,
  });
});