import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) {
    return Response.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);

  // Determine base URL from request origin for redirect URLs
  const origin = req.headers.get('origin') || 'https://app.base44.com';
  const returnUrl  = `${origin}/sell?onboarding=complete`;
  const refreshUrl = `${origin}/sell?onboarding=refresh`;

  // Reuse existing account or create a new Express account
  let accountId = user.stripe_account_id;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      email: user.email,
      capabilities: {
        transfers: { requested: true },
      },
    });
    accountId = account.id;
    // Persist to user record immediately
    await base44.auth.updateMe({ stripe_account_id: accountId });
  }

  // Create a fresh onboarding link each time
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });

  return Response.json({ url: accountLink.url });
});