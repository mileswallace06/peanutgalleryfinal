/**
 * Returns Stripe mode info for admin diagnostics.
 * Admin-only — returns key prefixes (never full keys) and mode consistency check.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const secretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY') || '';

    const secretMode = secretKey.startsWith('sk_live_') ? 'live'
      : secretKey.startsWith('sk_test_') ? 'test'
      : 'unknown';

    const publishableMode = publishableKey.startsWith('pk_live_') ? 'live'
      : publishableKey.startsWith('pk_test_') ? 'test'
      : 'unknown';

    const consistent = secretMode === publishableMode && secretMode !== 'unknown';
    const secretPrefix = secretKey ? secretKey.substring(0, 12) + '...' : 'NOT SET';
    const publishablePrefix = publishableKey ? publishableKey.substring(0, 12) + '...' : 'NOT SET';

    return Response.json({
      secretMode,
      publishableMode,
      secretPrefix,
      publishablePrefix,
      consistent,
      overallMode: consistent ? secretMode : 'mismatch',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});