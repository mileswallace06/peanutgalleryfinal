import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const PLATFORM_FEE_PCT = 0.05; // 5% — seller keeps 95%

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

  // Fetch seller to get stripe_account_id
  const sellerUsers = await base44.asServiceRole.entities.User.filter({ email: listing.seller_email });
  const seller = sellerUsers[0];
  const rawStripeAccountId = seller?.stripe_account_id || null;
  const isLiveMode = secretKey.startsWith('sk_live_');

  // A connected account created in test mode starts with acct_ but won't exist in live mode.
  // Stripe live mode requires the account to have been created via the live key.
  // We detect a stale test-mode account by checking if we're in live mode — if the account
  // was never verified against live Stripe, skip the Connect split to avoid "No such destination".
  let sellerStripeAccountId = rawStripeAccountId;
  if (rawStripeAccountId && isLiveMode) {
    try {
      await stripe.accounts.retrieve(rawStripeAccountId);
    } catch (err) {
      console.warn('[createPaymentIntent] Seller account invalid in live mode, skipping Connect split:', rawStripeAccountId, err?.message);
      sellerStripeAccountId = null;
      // Clear the stale account ID from the user record
      await base44.asServiceRole.entities.User.update(seller.id, { stripe_account_id: null, stripe_onboarding_complete: false });
    }
  }

  const isTestOrAdminListing = listing.notes?.includes('[TEST]') || seller?.role === 'admin';

  // Safety: block real seller purchases if no connected Stripe account
  if (!sellerStripeAccountId && !isTestOrAdminListing) {
    console.error('[createPaymentIntent] BLOCKED: seller has no valid live stripe_account_id', listing.seller_email);
    return Response.json(
      { error: 'Seller has not completed payout onboarding. Purchase blocked.' },
      { status: 402 }
    );
  }

  if (!sellerStripeAccountId && isTestOrAdminListing) {
    console.warn('[createPaymentIntent] WARNING: No connected seller account — admin/test listing, proceeding without split payout.');
  }

  // Fee math
  // buyer pays: subtotal + platform fee
  // seller receives: subtotal (sent via transfer_data)
  // Peanut Gallery keeps: platform fee (application_fee_amount)
  const subtotal = listing.asking_price * (listing.quantity || 1);
  const platformFee = Math.round(subtotal * PLATFORM_FEE_PCT * 100) / 100;
  const buyerTotal = subtotal + platformFee;
  const sellerPayout = subtotal;

  const amountCents = Math.round(buyerTotal * 100);
  const applicationFeeCents = Math.round(platformFee * 100);
  const sellerPayoutCents = Math.round(sellerPayout * 100);

  console.log('[createPaymentIntent] fee math:', {
    subtotal, platformFee, buyerTotal, sellerPayout,
    amountCents, applicationFeeCents,
    sellerStripeAccountId: sellerStripeAccountId || 'NONE (test/admin)',
  });

  // Reserve the listing
  await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'pending_transfer' });

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
        seller_stripe_account_id: sellerStripeAccountId || 'none',
        subtotal: subtotal.toString(),
        platform_fee: platformFee.toString(),
        seller_payout: sellerPayout.toString(),
      },
      description: `Peanut Gallery: Section ${listing.section} Row ${listing.row}`,
    };

    // Add Connect split only when seller has a connected account
    if (sellerStripeAccountId) {
      piParams.application_fee_amount = applicationFeeCents;
      piParams.transfer_data = {
        destination: sellerStripeAccountId,
      };
      console.log('[createPaymentIntent] Connect split configured:', {
        application_fee_amount: applicationFeeCents,
        transfer_data_destination: sellerStripeAccountId,
      });
    }

    paymentIntent = await stripe.paymentIntents.create(piParams);
  } catch (err) {
    // Rollback listing reservation
    await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'active' });
    return Response.json({ error: err.message }, { status: 500 });
  }

  // ── Notify seller: ticket sold ────────────────────────────────────────────
  // Fire-and-forget — never block the payment response
  base44.asServiceRole.functions.invoke('sendUserNotification', {
    user_email: listing.seller_email,
    title: 'Your ticket sold 🎟️',
    body: 'Transfer the tickets now to complete the sale.',
    type: 'sale_created',
    purchase_id: null, // purchase record created by frontend after this returns
  }).catch(err => console.error('[createPaymentIntent] notify seller failed:', err?.message));

  return Response.json({
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    subtotal,
    platformFee,
    buyerTotal,
    sellerPayout,
  });
});