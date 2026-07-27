/**
 * maintenance.ts — shared fail-closed maintenance helpers (Phase 0).
 *
 * isMaintenanceActive(): true when MAINTENANCE_MODE is NOT exactly "false"
 *   (fail-closed — missing / empty / any other value is treated as maintenance).
 *   A 503 from a gated function proves maintenance is ACTIVE, NOT that the
 *   stored secret equals "true". The secret value is never exposed by these
 *   helpers; use the admin-only getMaintenanceStatus function to report the
 *   boolean.
 *
 * maintenance503(msg): a 503 Response callers return immediately so that zero
 *   entity writes and zero provider (Stripe / OneSignal / email) calls occur.
 *
 * Action-level enforcement is implemented per function (not here): the admin
 *   exemption differs per surface — real-money checkout blocks everyone;
 *   listing / flash / donation surfaces allow only specific dry-run /
 *   read-only actions for admins, and never a real-money or mutating one.
 */
export function isMaintenanceActive() {
  return Deno.env.get('MAINTENANCE_MODE') !== 'false';
}

export function maintenance503(msg) {
  return Response.json(
    { error: msg || 'This action is temporarily unavailable for scheduled maintenance.', code: 'MAINTENANCE' },
    { status: 503 },
  );
}