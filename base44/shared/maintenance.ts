/**
 * maintenanceBlock — shared fail-closed maintenance gate (Phase 0).
 *
 * Returns a 503 Response when the app is in maintenance (MAINTENANCE_MODE is
 * NOT exactly "false"), otherwise null. Callers MUST return immediately on a
 * non-null result so that zero entity writes and zero provider (Stripe /
 * OneSignal / email) calls occur while maintenance is active.
 *
 *   const blocked = maintenanceBlock(user, { allowAdmin: true });
 *   if (blocked) return blocked;
 *
 * allowAdmin:
 *   - false -> block everyone, including admins. Used for real-money checkout
 *     (createCheckout), which has no dry-run path; admins must not transact
 *     real money during maintenance.
 *   - true  -> block non-admins only; admins may still exercise demo/dry-run
 *     paths (listing creation, flash drops, donations — none are real money).
 *
 * Fail-closed: if MAINTENANCE_MODE is unset, empty, or any value other than
 * exactly "false", the app is treated as in maintenance and non-exempt callers
 * receive 503.
 */
export function maintenanceBlock(user, { allowAdmin = true } = {}) {
  if (Deno.env.get('MAINTENANCE_MODE') !== 'false') {
    if (!(allowAdmin && user?.role === 'admin')) {
      return Response.json(
        { error: 'This action is temporarily unavailable for scheduled maintenance.', code: 'MAINTENANCE' },
        { status: 503 },
      );
    }
  }
  return null;
}