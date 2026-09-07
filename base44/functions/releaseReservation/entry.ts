import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { getListingPrivate } from '../../shared/privateData.ts';
import { maybeRouteCanary } from '../../shared/canaryGuard.js';
import { createMission1Runtime } from '../../shared/mission1Runtime.js';
import { runReleaseReservation } from '../../shared/releaseOrchestrator.js';

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
    const canaryResult = await maybeRouteCanary({
      base44, user, body, listing,
      executorUrl: secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR'),
      action: 'release',
    });
    if (canaryResult) return Response.json(canaryResult.body, { status: canaryResult.status });

    // Phase 0 maintenance gate — fail-closed for all callers
    if (isMaintenanceActive()) return maintenance503('Reservation release is temporarily unavailable for scheduled maintenance.');

    // Phase 1B: read reservation ownership from ListingPrivate first (legacy fallback)
    const lp = await getListingPrivate(base44, listing.id);
    const reservedBy = lp?.reserved_by_email ?? listing.reserved_by_email;

  // Only the reserver or admin can release
  if (reservedBy !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Never release a sold listing
  if (listing.status === 'sold') {
    return Response.json({ error: 'Cannot release a sold listing' }, { status: 409 });
  }

  // Capture previous token to distinguish old vs new during verify


  const runtime = await createMission1Runtime({ entities: base44.asServiceRole.entities, user, secrets });
  const result = await runReleaseReservation({
    ...runtime,
    entities: base44.asServiceRole.entities, user, now: () => Date.now(),
    isMaintenanceActive,
  }, body);
  return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error('[releaseReservation] error:', error?.message);
    return Response.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
});
