import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive } from '../../shared/maintenance.ts';
import { getUserSecurityProfile, upsertUserSecurityProfile, ensureUserRecords, alertPrivateWriteFailure } from '../../shared/privateData.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Phase 1B: ensure UserSecurityProfile exists
  await ensureUserRecords(base44, user);

  // Phase 1B: read authoritative stripe_account_id from UserSecurityProfile.
  // Never trust frontend-supplied account IDs — the request body is ignored.
  const sec = await getUserSecurityProfile(base44, { user_id: user.id, user_email: user.email });
  const accountId = sec?.stripe_account_id ?? user.stripe_account_id;

  if (!accountId) {
    return Response.json({ complete: false, charges_enabled: false, details_submitted: false });
  }

  // Maintenance gate — do not contact live Stripe during maintenance/testing
  if (isMaintenanceActive()) {
    return Response.json({
      complete: sec?.stripe_onboarding_complete ?? false,
      charges_enabled: sec?.stripe_onboarding_complete ?? false,
      details_submitted: sec?.stripe_onboarding_complete ?? false,
      cached: true,
    });
  }

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey) {
    return Response.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);

  let account;
  try {
    account = await stripe.accounts.retrieve(accountId);
  } catch (err) {
    console.error('[checkSellerOnboarding] Failed to retrieve Stripe account for', user.email);
    // Stale/invalid account — clear it so user can re-onboard
    try {
      await upsertUserSecurityProfile(base44, { user_id: user.id, user_email: user.email }, {
        stripe_account_id: null, stripe_onboarding_complete: false,
      });
    } catch (e) {
      await alertPrivateWriteFailure(base44, { entity: 'UserSecurityProfile', reference_id: user.id, reference_type: 'user', error: e });
    }
    await base44.auth.updateMe({ stripe_account_id: null, stripe_onboarding_complete: false }).catch(() => {});
    return Response.json({ complete: false, charges_enabled: false, details_submitted: false, stale_account_cleared: true });
  }

  const complete = account.charges_enabled === true;
  console.log('[checkSellerOnboarding]', user.email, '| complete:', complete);

  // Phase 1B: synchronize verified onboarding status to UserSecurityProfile + User mirror
  if (complete && !(sec?.stripe_onboarding_complete)) {
    try {
      await upsertUserSecurityProfile(base44, { user_id: user.id, user_email: user.email }, {
        stripe_onboarding_complete: true,
      });
    } catch (e) {
      await alertPrivateWriteFailure(base44, { entity: 'UserSecurityProfile', reference_id: user.id, reference_type: 'user', error: e });
    }
    await base44.auth.updateMe({ stripe_onboarding_complete: true }).catch(() => {});
  }

  return Response.json({
    complete,
    charges_enabled: account.charges_enabled,
    details_submitted: account.details_submitted,
  });
});