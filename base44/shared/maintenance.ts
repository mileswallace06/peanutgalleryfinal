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

/**
 * PROOF_SCANNING_ENABLED — feature flag for the proof scanning pipeline.
 *
 * false (default): no scanning mechanism exists. ProofAssets are created with
 *   scan_status='pending' and nothing transitions them to 'clean'. While false,
 *   proof review (approve/reject), AI verification (verifyTransferProof), and
 *   signed-URL issuance (getAuthorizedProofUrl) must return 503
 *   PROOF_SCANNER_UNAVAILABLE. Pending private uploads are preserved securely
 *   but clearly labeled unavailable for processing.
 *
 * Set to true ONLY when a real scanning mechanism (antivirus, content
 * moderation, or admin manual approval) is implemented that transitions
 * scan_status pending→clean. Never automatically mark an asset clean.
 */
export const PROOF_SCANNING_ENABLED = false;

export function isProofScanningEnabled() {
  return PROOF_SCANNING_ENABLED;
}

export function proofScannerUnavailable503() {
  return Response.json(
    { error: 'Proof scanning is not yet available. Uploaded proofs are securely preserved but cannot be processed until scanning is enabled.', code: 'PROOF_SCANNER_UNAVAILABLE' },
    { status: 503 },
  );
}