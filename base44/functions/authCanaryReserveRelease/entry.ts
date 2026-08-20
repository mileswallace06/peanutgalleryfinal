/**
 * authCanaryReserveRelease — [AUTH_CANARY] synthetic reserve/release through
 * the executor-only authority_v1 Postgres client.
 *
 * Postgres is authoritative; Base44 is mirror-only; no fallback.
 * Gated by CANARY_ENABLED (default OFF). Only operates on [AUTH_CANARY]
 * synthetic listings. Never touches real users or providers.
 *
 * Body: { action: 'reserve' | 'release', listing_id: string }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isCanaryEnabled, runCanaryReserve, runCanaryRelease } from '../../shared/authCanary.js';

Deno.serve(async (req) => {
  try {
    // ── Default-OFF flag ──────────────────────────────────────────────────
    if (!isCanaryEnabled()) {
      return Response.json(
        { error: 'Canary integration is disabled.', code: 'CANARY_DISABLED' },
        { status: 503 },
      );
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, listing_id } = body;
    if (!listing_id) return Response.json({ error: 'listing_id required' }, { status: 400 });
    if (action !== 'reserve' && action !== 'release') {
      return Response.json({ error: 'action must be reserve or release' }, { status: 400 });
    }

    const executorUrl = Deno.env.get('AUTHORITY_DB_URL_DEV_EXECUTOR');
    if (!executorUrl) {
      return Response.json({ error: 'Authority executor URL not configured', code: 'NO_EXECUTOR_URL' }, { status: 500 });
    }

    const deps = {
      entities: base44.asServiceRole.entities,
      user,
      executorUrl,
      params: { listing_id },
    };

    const result = action === 'reserve'
      ? await runCanaryReserve(deps)
      : await runCanaryRelease(deps);

    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return Response.json({ error: error?.message || 'Internal server error', code: 'CANARY_ERROR' }, { status: 500 });
  }
});