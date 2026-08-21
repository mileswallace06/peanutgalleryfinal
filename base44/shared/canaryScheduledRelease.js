/**
 * canaryScheduledRelease.js — System-initiated canary release for expired
 * reservations in scheduled workers.
 *
 * Used by processTransferReminders to release expired canary reservations
 * through authority_v1 (Postgres authoritative, Base44 mirror-only).
 *
 * Unlike runCanaryRelease (user-initiated, requires admin), this is called by
 * trusted scheduled infrastructure — no user session required. The caller
 * (processTransferReminders) already enforces its own authorization model.
 *
 * Safety:
 *   - Only operates on synthetic [AUTH_CANARY] listings
 *   - Requires CANARY_ENABLED flag
 *   - Treats failed/unknown active-purchase lookups as UNSAFE: does not release
 *   - Uses deterministic operation IDs and authoritative versions
 *   - Never falls back to Base44 reservation mutation
 *   - Queues mirror failures in the proven CanaryMirrorOutbox
 *
 * @param {object} deps
 * @param {object} deps.entities - base44.asServiceRole.entities
 * @param {string} deps.executorUrl - AUTHORITY_V1_DB_URL_DEV_EXECUTOR
 * @param {string} deps.listing_id - Listing to release
 * @returns {Promise<{status: number, body: object}>}
 */
import { createAuthorityV1Client } from './authorityV1Client.js';
import { isCanaryEnabled, isCanaryListing } from './authCanary.js';
import { sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox } from './canaryMirror.js';

export async function runCanaryScheduledRelease(deps) {
  const { entities, executorUrl, listing_id } = deps;
  // Testability injection points — defaults preserve deployed behavior.
  const isCanaryEnabledFn = deps.isCanaryEnabledFn || isCanaryEnabled;
  const createClientFn = deps.createClientFn || createAuthorityV1Client;
  const applyMirrorFn = deps.applyMirrorFn || applyMirrorWithOutbox;

  if (!listing_id) return { status: 400, body: { error: 'listing_id required' } };
  if (!isCanaryEnabledFn()) return { status: 503, body: { error: 'Canary disabled', code: 'CANARY_DISABLED' } };
  if (!executorUrl) return { status: 500, body: { error: 'No executor URL', code: 'NO_EXECUTOR_URL' } };

  // Read listing
  const listings = await entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) return { status: 404, body: { error: 'Listing not found' } };
  if (!isCanaryListing(listing)) {
    return { status: 400, body: { error: 'Not a canary listing', code: 'NOT_CANARY' } };
  }

  // ── Active-purchase safety: fail CLOSED on uncertainty ──────────────────
  // A failed/unknown active-purchase lookup is UNSAFE — do not release.
  let activePurchases;
  try {
    activePurchases = await entities.Purchase.filter({
      listing_id: listing_id,
      transfer_status: 'pending_transfer',
    });
  } catch {
    return {
      status: 409,
      body: { error: 'Active-purchase lookup failed — unsafe to release', code: 'LOOKUP_UNSAFE' },
    };
  }
  if (!Array.isArray(activePurchases)) {
    return {
      status: 409,
      body: { error: 'Active-purchase lookup returned malformed data — unsafe to release', code: 'LOOKUP_MALFORMED' },
    };
  }
  if (activePurchases.length > 0) {
    return {
      status: 409,
      body: { error: 'Active purchase exists — unsafe to release', code: 'ACTIVE_PURCHASE' },
    };
  }

  // ── Authority_v1 release (Postgres authoritative) ───────────────────────
  const client = createClientFn(executorUrl);
  await client.verifyEnvironment();

  const state = await client.getState(listing_id);
  if (!state?.ok) {
    return { status: 409, body: { error: 'Not initialized in authority', code: state?.code || 'NOT_FOUND' } };
  }
  if (state.lifecycle_state !== 'reserved') {
    return { status: 409, body: { error: 'Not reserved', code: 'NOT_RESERVED', authority_state: state } };
  }

  const expectedVersion = state.version;
  const operationId = `canary_scheduled_release_${listing_id}_${genId()}`;
  const requestHash = await sha256Hex(canonicalEnvelope({
    op: 'scheduled_release', listing_id, expected_version: expectedVersion,
  }));

  const result = await client.releaseListing(listing_id, expectedVersion, operationId, requestHash);
  if (!result?.ok) {
    return { status: 409, body: { error: 'Release conflict', code: result?.code || 'CONFLICT', authority: result } };
  }

  // ── Base44 mirror-only (durable outbox on failure, never rolls back Postgres)
  const mirrorPayload = {
    listing: {
      reserved_by_email: null,
      reservation_token: null,
      reservation_expires_at: null,
      reservation_revision: null,
      status: 'active',
    },
    listing_private: {
      reserved_by_email: null,
      reservation_token: null,
      reservation_expires_at: null,
      reservation_revision: null,
    },
  };
  const mirror = await applyMirrorFn(
    entities, listing_id, mirrorPayload, false,
    result.version, result.revision, 'release',
  );

  return {
    status: 200,
    body: { ok: true, authority: result, operation_id: operationId, mirror },
  };
}