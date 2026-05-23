import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  const report = {
    user_email: user.email,
    user_role: user.role,
    stripe_account_id: user.stripe_account_id || null,
    stripe_onboarding_complete: user.stripe_onboarding_complete ?? null,
    stripe_account_retrieved: false,
    stripe_charges_enabled: null,
    stripe_payouts_enabled: null,
    stripe_details_submitted: null,
    stripe_error: null,
    gate_thinks_onboarded: false,
    gate_render_reason: '',
  };

  // Simulate the gate logic from Sell page
  const isAdmin = user.role === 'admin';
  const flagComplete = user.stripe_onboarding_complete === true || user.stripe_onboarding_complete === 'true';

  if (isAdmin) {
    report.gate_thinks_onboarded = true;
    report.gate_render_reason = 'Admin bypass — gate hidden';
  } else if (flagComplete) {
    report.gate_thinks_onboarded = true;
    report.gate_render_reason = 'stripe_onboarding_complete=true — gate hidden';
  } else if (!user.stripe_account_id) {
    report.gate_thinks_onboarded = false;
    report.gate_render_reason = 'No stripe_account_id — showing "Set Up Payouts"';
  } else {
    report.gate_thinks_onboarded = false;
    report.gate_render_reason = `Has stripe_account_id (${user.stripe_account_id}) but stripe_onboarding_complete is falsy — gate visible`;
  }

  // Now check Stripe live state
  if (!secretKey) {
    report.stripe_error = 'STRIPELIVESECRETKEY not set';
    return Response.json(report);
  }

  if (!user.stripe_account_id) {
    return Response.json(report);
  }

  const stripe = new Stripe(secretKey);
  try {
    const account = await stripe.accounts.retrieve(user.stripe_account_id);
    report.stripe_account_retrieved = true;
    report.stripe_charges_enabled = account.charges_enabled;
    report.stripe_payouts_enabled = account.payouts_enabled;
    report.stripe_details_submitted = account.details_submitted;

    // What SHOULD the gate do given real Stripe state?
    if (account.charges_enabled) {
      report.gate_render_reason += ` | STRIPE SAYS COMPLETE (charges_enabled=true) — stripe_onboarding_complete should be true but is: ${user.stripe_onboarding_complete}`;
    } else {
      report.gate_render_reason += ` | Stripe charges_enabled=false — onboarding genuinely incomplete`;
    }
  } catch (err) {
    report.stripe_account_retrieved = false;
    report.stripe_error = `${err?.type}: ${err?.message}`;
  }

  return Response.json(report);
});