/**
 * canaryGuard.js — canary eligibility guard for reserveListing/releaseReservation.
 *
 * Returns null when the request is NOT canary-eligible (caller falls through
 * to the normal maintenance-gated path), or { status, body } when canary-handled
 * or rejected for failing canary rules.
 *
 * Canary eligibility requires ALL of:
 *   1. CANARY_ENABLED flag is true (default OFF)
 *   2. Authenticated admin
 *   3. Explicit canary action (body.canary === true)
 *   4. Synthetic listing marked [AUTH_CANARY]
 *
 * Isolation guarantees:
 *   - Synthetic [AUTH_CANARY] listing WITHOUT body.canary → 403 (never reaches
 *     the normal reservation path).
 *   - body.canary=true on a NON-canary listing → 400 (canary never touches real
 *     listings).
 *   - Canary request from a non-admin → 403.
 *   - Flag OFF → 503 CANARY_DISABLED (touches nothing).
 *
 * Postgres is authoritative; Base44 is mirror-only; no fallback.
 */
import { isCanaryEnabled, isCanaryListing, runCanaryReserve, runCanaryRelease } from './authCanary.js';

export async function maybeRouteCanary({ base44, user, body, listing, executorUrl, action }) {
  const isCanary = isCanaryListing(listing);
  const wantsCanary = body?.canary === true;

  // Neither canary listing nor canary request → normal path
  if (!isCanary && !wantsCanary) return null;

  // Synthetic canary listing without explicit canary action → block
  if (isCanary && !wantsCanary) {
    return {
      status: 403,
      body: { error: 'Synthetic canary listing requires explicit canary action', code: 'CANARY_ACTION_REQUIRED' },
    };
  }
  // Canary action on a non-canary listing → block
  if (wantsCanary && !isCanary) {
    return {
      status: 400,
      body: { error: 'Canary action on non-canary listing', code: 'NOT_CANARY' },
    };
  }
  // Both true — require admin
  if (user?.role !== 'admin') {
    return {
      status: 403,
      body: { error: 'Canary requires admin', code: 'CANARY_ADMIN_REQUIRED' },
    };
  }
  if (!isCanaryEnabled()) {
    return {
      status: 503,
      body: { error: 'Canary integration is disabled.', code: 'CANARY_DISABLED' },
    };
  }
  if (!executorUrl) {
    return {
      status: 500,
      body: { error: 'Authority executor URL not configured', code: 'NO_EXECUTOR_URL' },
    };
  }
  const deps = {
    entities: base44.asServiceRole.entities,
    user,
    executorUrl,
    params: {
      listing_id: listing.id,
      simulate_mirror_failure: body?.simulate_mirror_failure === true,
    },
  };
  return action === 'release' ? runCanaryRelease(deps) : runCanaryReserve(deps);
}