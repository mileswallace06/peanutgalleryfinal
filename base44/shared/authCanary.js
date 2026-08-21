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

// ── SHA-256 helpers (Deno + Node compatible) ─────────────────────────────────
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function canonicalEnvelope(envelope) {
  return JSON.stringify(envelope, Object.keys(envelope).sort());
}

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

  // ── Base44 mirror-only (failure alerts, never rolls back Postgres) ───────
  const mirror = { attempted: true, listing: null, listing_private: null };
  try {
    await entities.Listing.update(listing_id, {
      reserved_by_email: user.email,
      reservation_token: token,
      reservation_expires_at: expiresAt,
      reservation_revision: result.revision,
      status: 'pending_transfer',
    });
    mirror.listing = 'ok';
  } catch (e) {
    mirror.listing = 'failed:' + (e.message || String(e)).slice(0, 80);
  }
  if (entities.ListingPrivate) {
    try {
      const lpRows = await entities.ListingPrivate.filter({ listing_id });
      const lp = lpRows[0];
      if (lp) {
        await entities.ListingPrivate.update(lp.id, {
          reserved_by_email: user.email,
          reservation_token: token,
          reservation_expires_at: expiresAt,
          reservation_revision: result.revision,
        });
        mirror.listing_private = 'ok';
      } else {
        mirror.listing_private = 'no_record';
      }
    } catch (e) {
      mirror.listing_private = 'failed:' + (e.message || String(e)).slice(0, 80);
    }
  }

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

  // ── Base44 mirror-only ──────────────────────────────────────────────────
  const mirror = { attempted: true, listing: null, listing_private: null };
  try {
    await entities.Listing.update(listing_id, {
      reserved_by_email: null,
      reservation_token: null,
      reservation_expires_at: null,
      reservation_revision: null,
      status: 'active',
    });
    mirror.listing = 'ok';
  } catch (e) {
    mirror.listing = 'failed:' + (e.message || String(e)).slice(0, 80);
  }
  if (entities.ListingPrivate) {
    try {
      const lpRows = await entities.ListingPrivate.filter({ listing_id });
      const lp = lpRows[0];
      if (lp) {
        await entities.ListingPrivate.update(lp.id, {
          reserved_by_email: null,
          reservation_token: null,
          reservation_expires_at: null,
          reservation_revision: null,
        });
        mirror.listing_private = 'ok';
      } else {
        mirror.listing_private = 'no_record';
      }
    } catch (e) {
      mirror.listing_private = 'failed:' + (e.message || String(e)).slice(0, 80);
    }
  }

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