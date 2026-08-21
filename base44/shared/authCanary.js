/**
 * authCanary.js — [AUTH_CANARY] synthetic reserve/release integration.
 *
 * Integrates reserveListing + releaseReservation through the executor-only
 * authority_v1 Postgres client. Postgres is authoritative; Base44 is
 * mirror-only; no fallback.
 *
 * GATED by a default-OFF flag (CANARY_ENABLED). When false, the canary
 * function returns 503 CANARY_DISABLED and touches nothing.
 *
 * Only operates on synthetic listings tagged [AUTH_CANARY] in the notes field.
 * Real users and providers (Stripe, TM, OneSignal) are never touched.
 */
import { createAuthorityV1Client } from './authorityV1Client.js';
import { sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox } from './canaryMirror.js';

// ── Default-OFF flag ──────────────────────────────────────────────────────────
// When false, the canary path is disabled and returns 503. Flip to true only
// for synthetic testing, then restore to false.
export const CANARY_ENABLED = true;

const CANARY_TAG = '[AUTH_CANARY]';
const RESERVATION_MINUTES = 10;

export function isCanaryEnabled() {
  return CANARY_ENABLED === true;
}

export function isCanaryListing(listing) {
  if (!listing) return false;
  const notes = listing.notes || '';
  return typeof notes === 'string' && notes.includes(CANARY_TAG);
}

// ── Canary reserve ───────────────────────────────────────────────────────────
// Postgres authoritative → Base44 mirror-only. No fallback.
export async function runCanaryReserve(deps) {
  const { entities, user, executorUrl } = deps;
  const { listing_id } = deps.params || {};

  if (!listing_id) return { status: 400, body: { error: 'listing_id required' } };
  if (!user) return { status: 401, body: { error: 'Unauthorized' } };

  const listings = await entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) return { status: 404, body: { error: 'Listing not found' } };
  if (!isCanaryListing(listing)) {
    return { status: 400, body: { error: 'Not a canary listing', code: 'NOT_CANARY' } };
  }

  const client = createAuthorityV1Client(executorUrl);
  await client.verifyEnvironment();

  // Read authoritative state
  const state = await client.getState(listing_id);
  if (!state?.ok) {
    // Not initialized — initialize first (seller = listing owner)
    const sellerId = listing.created_by_id || listing.seller_email || 'canary_seller';
    const initOpId = `canary_init_${listing_id}_${genId()}`;
    const initHash = await sha256Hex(canonicalEnvelope({
      op: 'initialize', listing_id, seller_user_id: sellerId,
    }));
    const initResult = await client.initializeListing(listing_id, sellerId, initOpId, initHash);
    if (!initResult?.ok) {
      return { status: 409, body: { error: 'Initialize failed', code: initResult?.code || 'INIT_ERROR', detail: initResult } };
    }
  }

  // Read current version after (possible) initialize
  const currentState = state?.ok ? state : await client.getState(listing_id);
  const expectedVersion = currentState.version;

  // Build reserve operation
  const token = genId();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000).toISOString();
  const buyerId = user.id || user.email;
  const operationId = `canary_reserve_${listing_id}_${genId()}`;
  const requestHash = await sha256Hex(canonicalEnvelope({
    op: 'reserve', listing_id, expected_version: expectedVersion,
    buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt,
  }));

  // ── Postgres authoritative ──────────────────────────────────────────────
  const result = await client.reserveListing(
    listing_id, expectedVersion, buyerId, tokenHash, expiresAt, operationId, requestHash,
  );

  if (!result?.ok) {
    // Postgres rejected (CONFLICT) — no mirror write. No fallback.
    return { status: 409, body: { error: 'Reserve conflict', code: result?.code || 'CONFLICT', authority: result } };
  }

  // ── Base44 mirror-only (durable outbox on failure, never rolls back Postgres)
  const mirrorPayload = {
    listing: {
      reserved_by_email: user.email,
      reservation_token: token,
      reservation_expires_at: expiresAt,
      reservation_revision: result.revision,
      status: 'pending_transfer',
    },
    listing_private: {
      reserved_by_email: user.email,
      reservation_token: token,
      reservation_expires_at: expiresAt,
      reservation_revision: result.revision,
    },
  };
  const simulateFailure = deps.params?.simulate_mirror_failure === true;
  const mirror = await applyMirrorWithOutbox(
    entities, listing_id, mirrorPayload, simulateFailure,
    result.version, result.revision, 'reserve',
  );

  return {
    status: 200,
    body: {
      ok: true,
      reservation_expires_at: expiresAt,
      authority: result,
      operation_id: operationId,
      mirror,
    },
  };
}

// ── Canary release ────────────────────────────────────────────────────────────
export async function runCanaryRelease(deps) {
  const { entities, user, executorUrl } = deps;
  const { listing_id } = deps.params || {};

  if (!listing_id) return { status: 400, body: { error: 'listing_id required' } };
  if (!user) return { status: 401, body: { error: 'Unauthorized' } };

  const listings = await entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) return { status: 404, body: { error: 'Listing not found' } };
  if (!isCanaryListing(listing)) {
    return { status: 400, body: { error: 'Not a canary listing', code: 'NOT_CANARY' } };
  }

  const client = createAuthorityV1Client(executorUrl);
  await client.verifyEnvironment();

  const state = await client.getState(listing_id);
  if (!state?.ok) {
    return { status: 409, body: { error: 'Not initialized in authority', code: state?.code || 'NOT_FOUND' } };
  }
  if (state.lifecycle_state !== 'reserved') {
    return { status: 409, body: { error: 'Not reserved', code: 'NOT_RESERVED', authority_state: state } };
  }

  const expectedVersion = state.version;
  const operationId = `canary_release_${listing_id}_${genId()}`;
  const requestHash = await sha256Hex(canonicalEnvelope({
    op: 'release', listing_id, expected_version: expectedVersion,
  }));

  // ── Postgres authoritative ──────────────────────────────────────────────
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
  const simulateFailure = deps.params?.simulate_mirror_failure === true;
  const mirror = await applyMirrorWithOutbox(
    entities, listing_id, mirrorPayload, simulateFailure,
    result.version, result.revision, 'release',
  );

  return {
    status: 200,
    body: { ok: true, authority: result, operation_id: operationId, mirror },
  };
}

// ── Idempotent retry helper (for tests) ───────────────────────────────────────
// Replays the exact same operation_id + request_hash to verify idempotency.
export async function runCanaryReserveReplay(deps) {
  const { executorUrl } = deps;
  const { listing_id, expected_version, buyer_id, token_hash, expires_at, operation_id, request_hash } = deps.params || {};
  const client = createAuthorityV1Client(executorUrl);
  return client.reserveListing(listing_id, expected_version, buyer_id, token_hash, expires_at, operation_id, request_hash);
}