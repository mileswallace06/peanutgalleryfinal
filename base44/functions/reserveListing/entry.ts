import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { createMission1Runtime } from '../../shared/mission1Runtime.js';
import { runMission1Reserve } from '../../shared/mission1Reserve.js';
import { maybeRouteCanary } from '../../shared/canaryGuard.js';


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { listing_id } = body;
    if (!listing_id) return Response.json({ error: 'listing_id required' }, { status: 400 });

    const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
    const listing = listings[0];
    if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });

    // ── Canary guard (admin + synthetic [AUTH_CANARY] listing only) ─────────
    // Returns null for normal listings/requests → fall through to the
    // maintenance-gated path. Returns {status, body} for any canary-eligible or
    // canary-rejected request — synthetic listings never reach the normal path.
    const canaryResult = await maybeRouteCanary({
      base44, user, body, listing,
      executorUrl: secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR'),
      action: 'reserve',
    });
    if (canaryResult) return Response.json(canaryResult.body, { status: canaryResult.status });

    // Phase 0 maintenance gate — fail-closed for all callers
    if (isMaintenanceActive()) return maintenance503('Reservations are temporarily unavailable for scheduled maintenance.');

    const runtime = await createMission1Runtime({ entities: base44.asServiceRole.entities, user, secrets });
    const result = await runMission1Reserve(runtime, listing_id);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return Response.json({ code: error.message, error: 'Reservation requires reconciliation.' }, { status: 409 });
  }
});
