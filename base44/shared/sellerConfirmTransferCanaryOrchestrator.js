/**
 * sellerConfirmTransferCanaryOrchestrator.js — P0-01M Canary seller-confirmation saga.
 *
 * Wires the existing sellerConfirmTransfer entry point through a guarded canary
 * route. Postgres is authoritative for transfer lifecycle state; Base44 is
 * mirror-only. No fallback to legacy confirmation logic for canary listings.
 *
 * TRANSFER LIFECYCLE (authority_v1):
 *   not_started → in_progress → seller_reported_sent
 *
 * The seller's self-report is NEVER labeled or treated as provider-verified
 * delivery. The state 'seller_reported_sent' is the seller's attestation only.
 *
 * INVARIANTS:
 *   - Cancellation and transfer-start cannot both commit from the same
 *     not-started version (CAS on version in begin_transfer).
 *   - If cancellation commits first, a later transfer-start is rejected
 *     (version conflict).
 *   - If transfer-start commits first, cancellation may still proceed but
 *     inventory remains quarantined.
 *   - No transfer state permits automatic relisting.
 *
 * AUTHORIZATION: Seller identity is derived from the authority's
 * seller_user_id (from get_state), NOT from Base44 purchase fields or
 * client-supplied data. Admin override preserves the existing admin policy.
 *
 * GUARANTEES:
 *   - Authority state committed before any Base44 mirror update.
 *   - Seller identity derived server-side; never trusts request-supplied
 *     seller, buyer, listing, or transfer status.
 *   - Base44 is mirror-only with no fallback and no direct authoritative
 *     seller_confirmed write.
 *   - Mirror/notification failure cannot roll back the authority transition.
 *
 * Dependency-injected for testability. Tests inject mock clients.
 */
import { sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox } from './canaryMirror.js';
import { isCanaryListing } from './authCanary.js';

/**
 * Run the canary seller-confirmation saga.
 * @param {object} deps
 * @param {object} deps.entities - base44.asServiceRole.entities
 * @param {object} deps.user - authenticated user
 * @param {object} deps.executorClient - createAuthorityV1Client result
 * @param {function} [deps.sendNotification] - optional notification callback
 * @param {object} deps.params - saga parameters
 * @param {string} deps.params.listing_id
 * @param {string} deps.params.purchase_id
 * @param {string} [deps.params.proof_url]
 * @param {string} [deps.params.proof_note]
 * @param {boolean} [deps.params.simulate_mirror_failure] - test-only
 * @returns {Promise<{status: number, body: object}>}
 */
export async function runCanarySellerConfirmSaga(deps) {
  const { entities, user, executorClient, params } = deps;

  // ── Validate params ──────────────────────────────────────────────────────
  const listingId = params?.listing_id;
  const purchaseId = params?.purchase_id;

  if (!listingId) return { status: 400, body: { error: 'listing_id required' } };
  if (!purchaseId) return { status: 400, body: { error: 'purchase_id required' } };
  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (!executorClient) return { status: 500, body: { error: 'Executor client required' } };

  // Seller must provide proof (a screenshot or a transfer note).
  const hasProof = (params.proof_url && params.proof_url.trim()) ||
                   (params.proof_note && params.proof_note.trim());
  if (!hasProof) {
    return { status: 400, body: { error: 'Please upload a screenshot or add a transfer note before confirming.' } };
  }

  // ── 1. Read authority state ──────────────────────────────────────────────
  let state;
  try {
    state = await executorClient.getState(listingId);
  } catch (e) {
    return { status: 500, body: { error: 'Authority state read failed', code: 'STATE_READ_FAILED' } };
  }
  if (!state?.ok) {
    return { status: 409, body: { error: 'Not initialized in authority', code: state?.code || 'NOT_FOUND' } };
  }

  // ── 2. Seller authorization via AUTHORITATIVE seller_user_id ─────────────
  const authoritativeSellerUserId = state.seller_user_id;
  const isAdmin = user.role === 'admin';
  if (authoritativeSellerUserId && authoritativeSellerUserId !== user.email && !isAdmin) {
    return { status: 403, body: { error: 'Not authorized as seller', code: 'NOT_SELLER' } };
  }

  // ── 3. State checks ──────────────────────────────────────────────────────
  // Only reserved/frozen listings can have transfer confirmation.
  if (state.lifecycle_state !== 'reserved' && state.lifecycle_state !== 'frozen') {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Purchase is not in a transferable state',
        code: 'NOT_TRANSFERABLE',
        authority_state: state.lifecycle_state,
      },
    };
  }

  // If recovery_blocked, the listing is quarantined — no transfer confirmation.
  if (state.recovery_blocked === true) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Listing is quarantined — transfer confirmation not available',
        code: 'QUARANTINED',
        recovery_blocked: true,
      },
    };
  }

  // ── 4. Transfer state transitions ─────────────────────────────────────────
  let currentVersion = state.version;
  let transferState = state.transfer_state;

  // 4a. If already seller_reported_sent, return early (idempotent replay
  // of a prior confirmation — authority already committed).
  if (transferState === 'seller_reported_sent') {
    return {
      status: 200,
      body: {
        ok: true,
        replay: true,
        transfer_state: 'seller_reported_sent',
        provider_verified: false,
        authority: state,
      },
    };
  }

  // 4b. If not_started → in_progress (begin_transfer)
  if (transferState === 'not_started') {
    const beginOpId = `op_begin_transfer_${listingId}_${genId()}`;
    const beginHash = await sha256Hex(canonicalEnvelope({
      op: 'begin_transfer', listing_id: listingId,
      expected_version: currentVersion, seller_user_id: authoritativeSellerUserId,
    }));

    let beginResult;
    try {
      beginResult = await executorClient.beginTransfer(
        listingId, currentVersion, authoritativeSellerUserId, beginOpId, beginHash,
      );
    } catch (e) {
      return { status: 500, body: { error: 'begin_transfer failed', code: 'BEGIN_TRANSFER_ERROR' } };
    }

    if (!beginResult?.ok) {
      // CONFLICT means cancellation or another transfer-start committed first
      return {
        status: 409,
        body: {
          ok: false,
          error: 'Transfer-start conflict — cancellation may have committed first',
          code: beginResult?.code || 'CONFLICT',
          authority: beginResult,
        },
      };
    }

    // Idempotent replay of begin_transfer
    if (beginResult.idempotent === true) {
      return {
        status: 200,
        body: {
          ok: true,
          replay: true,
          transfer_state: 'in_progress',
          provider_verified: false,
          authority: beginResult,
        },
      };
    }

    currentVersion = beginResult.version;
    transferState = 'in_progress';
  }

  // 4b. in_progress → seller_reported_sent (record_seller_report)
  if (transferState === 'in_progress') {
    const reportOpId = `op_record_seller_report_${listingId}_${genId()}`;
    const reportHash = await sha256Hex(canonicalEnvelope({
      op: 'record_seller_report', listing_id: listingId,
      expected_version: currentVersion, seller_user_id: authoritativeSellerUserId,
    }));

    let reportResult;
    try {
      reportResult = await executorClient.recordSellerReport(
        listingId, currentVersion, authoritativeSellerUserId, reportOpId, reportHash,
      );
    } catch (e) {
      return { status: 500, body: { error: 'record_seller_report failed', code: 'RECORD_REPORT_ERROR' } };
    }

    if (!reportResult?.ok) {
      return {
        status: 409,
        body: {
          ok: false,
          error: 'Seller-report conflict',
          code: reportResult?.code || 'CONFLICT',
          authority: reportResult,
        },
      };
    }

    // Idempotent replay of record_seller_report
    if (reportResult.idempotent === true) {
      return {
        status: 200,
        body: {
          ok: true,
          replay: true,
          transfer_state: 'seller_reported_sent',
          provider_verified: false,
          authority: reportResult,
        },
      };
    }

    currentVersion = reportResult.version;
    transferState = 'seller_reported_sent';
  }

  // ── 5. Mirror to Base44 (after authority commit) ─────────────────────────
  // Base44 Purchase.seller_confirmed is a MIRROR projection — not authoritative.
  // The authoritative transfer state is in authority_v1.transfer_state.
  const now = new Date().toISOString();
  const purchaseUpdate = {
    seller_confirmed: true,
    seller_confirmed_at: now,
  };
  if (params.proof_url && params.proof_url.trim()) {
    purchaseUpdate.transfer_proof_url = params.proof_url.trim();
    purchaseUpdate.ai_proof_status = 'pending';
  }
  if (params.proof_note && params.proof_note.trim()) {
    purchaseUpdate.transfer_notes = params.proof_note.trim();
  }

  const simulateFailure = params.simulate_mirror_failure === true;
  const mirrorPayload = {
    listing: {
      reservation_mirror_state: state.lifecycle_state,
    },
    listing_private: {},
  };

  const mirror = await applyMirrorWithOutbox(
    entities, listingId, mirrorPayload, simulateFailure,
    currentVersion, null, 'record_seller_report',
  );

  // Write the Purchase mirror (seller_confirmed=true) — best-effort, after
  // authority commit. Failure does not roll back the authority transition.
  try {
    await entities.Purchase.update(purchaseId, purchaseUpdate);
  } catch (e) {
    // Mirror failure — authority already committed. Return success with mirror warning.
    return {
      status: 200,
      body: {
        ok: true,
        transfer_state: 'seller_reported_sent',
        provider_verified: false,
        mirror_warning: 'Purchase mirror write failed — authority committed',
        authority: { version: currentVersion, transfer_state: 'seller_reported_sent' },
      },
    };
  }

  // ── 6. Notification (after authority commit) ─────────────────────────────
  if (deps.sendNotification) {
    try {
      await deps.sendNotification({
        type: 'seller_reported_sent',
        listing_id: listingId,
        purchase_id: purchaseId,
        transfer_state: 'seller_reported_sent',
        provider_verified: false,
      });
    } catch (_) { /* notification failure does not roll back */ }
  }

  return {
    status: 200,
    body: {
      ok: true,
      status: 'confirmed',
      seller_confirmed: true,
      transfer_state: 'seller_reported_sent',
      provider_verified: false,
      authority: { version: currentVersion, transfer_state: 'seller_reported_sent' },
      mirror,
    },
  };
}

/**
 * maybeRouteCanarySellerConfirm — Canary eligibility guard + routing for
 * sellerConfirmTransfer.
 *
 * Returns null when the request is NOT canary-eligible (caller falls through
 * to the legacy confirmation path), or { status, body } when canary-handled.
 *
 * Canary eligibility for sellerConfirmTransfer:
 *   - The listing is a synthetic [AUTH_CANARY] listing → must go through the
 *     canary path (never legacy).
 *   - Non-canary listing → legacy path (null).
 *
 * Flag OFF → 503 CANARY_DISABLED (synthetic listings never reach legacy).
 */
export async function maybeRouteCanarySellerConfirm(deps) {
  const { listing, canaryEnabled } = deps;

  // Non-canary listing → legacy path
  if (!isCanaryListing(listing)) return null;

  // Canary listing — must go through canary path (never legacy)
  if (canaryEnabled !== true) {
    return {
      status: 503,
      body: { error: 'Canary integration is disabled.', code: 'CANARY_DISABLED' },
    };
  }
  if (!deps.executorUrl) {
    return { status: 500, body: { error: 'Authority executor URL not configured', code: 'NO_EXECUTOR_URL' } };
  }

  // ── Create client (or use injected for tests) ───────────────────────────
  let executorClient = deps.executorClient;
  if (!executorClient) {
    const { createAuthorityV1Client } = await import('./authorityV1Client.js');
    executorClient = createAuthorityV1Client(deps.executorUrl);
  }

  return runCanarySellerConfirmSaga({
    entities: deps.base44.asServiceRole.entities,
    user: deps.user,
    executorClient,
    sendNotification: deps.sendNotification,
    params: {
      listing_id: listing.id,
      purchase_id: deps.purchase.id,
      proof_url: deps.body?.proof_url,
      proof_note: deps.body?.proof_note,
      simulate_mirror_failure: deps.body?.simulate_mirror_failure === true,
    },
  });
}