import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
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

  const amount = Math.round(listing.asking_price * (listing.quantity || 1) * 100); // cents

  // Reserve the listing
  await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'pending_transfer' });

  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      capture_method: 'manual',
      metadata: {
        listing_id: listing.id,
        event_id: listing.event_id,
        buyer_email: buyer_email || user.email,
        seller_email: listing.seller_email
      },
      description: `Peanut Gallery: Section ${listing.section} Row ${listing.row}`
    });
  } catch (err) {
    // Rollback listing
    await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'active' });
    return Response.json({ error: err.message }, { status: 500 });
  }

  return Response.json({
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: listing.asking_price * (listing.quantity || 1)
  });
});