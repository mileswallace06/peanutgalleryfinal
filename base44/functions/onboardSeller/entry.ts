import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive } from '../../shared/maintenance.ts';
import { getUserSecurityProfile, upsertUserSecurityProfile, ensureUserRecords, alertPrivateWriteFailure } from '../../shared/privateData.ts';

// ── URL allowlist ───────────────────────────────────────────────────────────
const ALLOWED_DOMAINS = ['app.peanutgallery.store'];
function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return ALLOWED_DOMAINS.includes(u.hostname);
  } catch (_) {
    return false;
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Phase 1B: ensure UserSecurityProfile + UserPrivate + PublicProfile exist
  await ensureUserRecords(base44, user);

  // Phase 1B: read authoritative stripe_account_id from UserSecurityProfile.
  // Never trust frontend-supplied account IDs — the request body is ignored.
  // If UserSecurityProfile cannot be loaded, fail with INTEGRITY_ERROR.
  const sec = await getUserSecurityProfile(base44, { user_id: user.id, user_email: user.email }).catch(() => null);
  if (!sec) {
    return Response.json({ error: 'User security profile unavailable', code: 'INTEGRITY_ERROR' }, { status: 500 });
  }

  // Maintenance gate — before any Stripe call
  if (isMaintenanceActive()) {
    return Response.json({ error: 'Seller onboarding is temporarily unavailable for scheduled maintenance.' }, { status: 503 });
  }

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey) {
    console.error('[onboardSeller] STRIPE_SECRET_KEY not set');
    return Response.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);

  // Hardcode production domain — never rely on Origin header (can be missing/spoofed)
  const APP_DOMAIN = 'https://app.peanutgallery.store';
  const returnUrl  = `${APP_DOMAIN}/sell?onboarding=complete`;
  const refreshUrl = `${APP_DOMAIN}/sell?onboarding=refresh`;

  // Validate URLs against allowlist
  if (!isAllowedUrl(returnUrl) || !isAllowedUrl(refreshUrl)) {
    console.error('[onboardSeller] URL allowlist validation failed');
    return Response.json({ error: 'Onboarding URL validation failed' }, { status: 500 });
  }

  try {
    let accountId = sec.stripe_account_id ?? null;

    // Validate existing account against current Stripe mode — clear stale test/sandbox accounts
    if (accountId) {
      try {
        await stripe.accounts.retrieve(accountId);
        console.log('[onboardSeller] Reusing existing Stripe account for', user.email);
      } catch (err) {
        console.warn('[onboardSeller] Stale/invalid account — clearing and re-creating. Reason:', err?.message);
        accountId = null;
        // Phase 1B: write to UserSecurityProfile (authoritative) + User (legacy mirror)
        try {
          await upsertUserSecurityProfile(base44, { user_id: user.id, user_email: user.email }, {
            stripe_account_id: null, stripe_onboarding_complete: false,
          });
        } catch (e) {
          await alertPrivateWriteFailure(base44, { entity: 'UserSecurityProfile', reference_id: user.id, reference_type: 'user', error: e });
        }
        await base44.auth.updateMe({ stripe_account_id: null, stripe_onboarding_complete: false }).catch(() => {});
      }
    }

    if (!accountId) {
      console.log('[onboardSeller] Creating new Stripe Express account for', user.email);
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: {
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      console.log('[onboardSeller] Created Stripe account for', user.email);
      // Phase 1B: write to UserSecurityProfile (authoritative) + User (legacy mirror)
      try {
        await upsertUserSecurityProfile(base44, { user_id: user.id, user_email: user.email }, {
          stripe_account_id: accountId,
        });
      } catch (e) {
        await alertPrivateWriteFailure(base44, { entity: 'UserSecurityProfile', reference_id: user.id, reference_type: 'user', error: e });
      }
      await base44.auth.updateMe({ stripe_account_id: accountId }).catch(() => {});
    }

    // Create a fresh onboarding link each time
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    // Never expose the connected-account ID in the response
    return Response.json({ url: accountLink.url });
  } catch (err) {
    console.error('[onboardSeller] Stripe error for', user.email, '—', err?.type, err?.message, err?.code);
    return Response.json({ error: err?.message || 'Stripe onboarding failed' }, { status: 500 });
  }
});