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

  if (!user.stripe_account_id) {
    return Response.json({ complete: false, charges_enabled: false, details_submitted: false });
  }

  const stripe = new Stripe(secretKey);
  const account = await stripe.accounts.retrieve(user.stripe_account_id);

  const complete = account.charges_enabled === true;

  // Update user record if newly complete
  if (complete && !user.stripe_onboarding_complete) {
    await base44.auth.updateMe({ stripe_onboarding_complete: true });
  }

  return Response.json({
    complete,
    charges_enabled: account.charges_enabled,
    details_submitted: account.details_submitted,
  });
});