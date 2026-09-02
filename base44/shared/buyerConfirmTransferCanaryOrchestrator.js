/**
 * buyerConfirmTransferCanaryOrchestrator.js — P0-01T Canary buyer-confirmation saga.
 *
 * Wires the existing capturePayment entry point (buyer's "I Received My Tickets"
 * button, confirming_role='buyer') through a guarded canary route. Postgres is
 * authoritative for buyer confirmation state; Base44 is mirror-only.
 *
 * TRANSFER LIFECYCLE (authority_v1):
 *   not_started → in_progress → seller_reported_sent → buyer_confirmed_received
 *
 * 'buyer_confirmed_received' means ONLY that the authenticated buyer confirmed
 * receipt — it is NOT provider verification.
 *
 * INVARIANTS:
 *   - Buyer identity is derived from the authenticated session and verified
 *     against reservation_authority.buyer_user_id AND
 *     reservation_payment_bindings.buyer_user_id. Never trusts request-supplied
 *     identity.
 *   - Confirmation permitted only from 'in_progress' or 'seller_reported_sent'
 *     transfer states with lifecycle_state='frozen'. Rejects canceled, refunded,
 *     mismatched, stale, or otherwise ineligible purchases.
 *   - CAS on reservation_authority.version ensures exactly-one-wins against
 *     seller report and cancellation.
 *   - NO FINANCIAL SIDE EFFECTS: does not trigger payout, capture, refund,
 *     release, relist, or recovery-unblock.
 *   - AI proof state may be recorded alongside confirmation but never causes
 *     or substitutes for buyer confirmation.
 *   - Authority committed before Base44 mirror. Mirror failure creates
 *     retryable outbox work (CanaryMirrorOutbox, operation_type='buyer_confirmation').
 *
 * Dependency-injected for testability. Tests inject mock clients.
 */
import { sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox } from './canaryMirror.js';
import { isCanaryListing } from './authCanary.js';

/**
 * Run the canary buyer-confirmation saga.
 * @param {object} deps
 * @param {object} deps.entities - base44.asServiceRole.entities
 * @param {object} deps.user - authenticated user
 * @param {object} deps.executorClient - createAuthorityV1Client result
 * @param {function} [deps.sendNotification] - optional notification callback
 * @param {object} deps.params - saga parameters
 * @param {string} deps.params.listing_id
 * @param {string} deps.params.purchase_id
 * @param {boolean} [deps.params.simulate_mirror_failure] - test-only
 * @returns {Promise<{status: number, body: object}>}
 */
export async function runCanaryBuyerConfirmSaga(deps) {
  const { entities, user, executorClient, params } = deps;

  // ── Validate params ──────────────────────────────────────────────────────
  const listingId = params?.listing_id;
  const purchaseId = params?.purchase_id;

  if (!listingId) return { status: 400, body: { error: 'listing_id required' } };
  if (!purchaseId) return { status: 400, body: { error: 'purchase_id required' } };
  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (!executorClient) return { status: 500, body: { error: 'Executor client required' } };

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

  // ── 2. Buyer authorization via AUTHORITATIVE buyer_user_id ───────────────
  // Buyer identity is derived from the authenticated session (user.email) and
  // verified against the authority's buyer_user_id. Never trusts request body.
  const authoritativeBuyerUserId = state.buyer_user_id;
  const isAdmin = user.role === 'admin';

  if (!authoritativeBuyerUserId) {
    return { status: 409, body: { error: 'No buyer associated with this listing', code: 'NO_BUYER' } };
  }

  // The buyer_user_id in the authority is the buyer's email (set at reserve time).
  // Admin override preserves existing admin policy.
  if (authoritativeBuyerUserId !== user.email && !isAdmin) {
    return { status: 403, body: { error: 'Not authorized as buyer', code: 'NOT_BUYER' } };
  }

  // ── 3. State checks ──────────────────────────────────────────────────────
  // Only frozen listings (payment authorized, not yet captured) can have
  // buyer confirmation.
  if (state.lifecycle_state !== 'frozen') {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Purchase is not in a confirmable state',
        code: 'NOT_CONFIRMABLE',
        authority_state: state.lifecycle_state,
      },
    };
  }

  // If recovery_blocked, the listing is quarantined — no buyer confirmation.
  if (state.recovery_blocked === true) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Listing is quarantined — buyer confirmation not available',
        code: 'QUARANTINED',
        recovery_blocked: true,
      },
    };
  }

  // ── 4. Transfer state transition ────────────────────────────────────────
  const currentVersion = state.version;
  const transferState = state.transfer_state;

  // 4a. Already buyer_confirmed_received — idempotent replay
  if (transferState === 'buyer_confirmed_received') {
    return {
      status: 200,
      body: {
        ok: true,
        replay: true,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        authority: state,
        no_financial_effects: true,
      },
    };
  }

  // 4b. Valid preceding states: in_progress, seller_reported_sent
  if (transferState !== 'in_progress' && transferState !== 'seller_reported_sent') {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Transfer not in a confirmable state',
        code: 'INVALID_TRANSFER_STATE',
        transfer_state: transferState,
        valid_preceding: ['in_progress', 'seller_reported_sent'],
      },
    };
  }

  // ── 5. Record buyer confirmation (authority-first) ───────────────────────
  const opId = `op_buyer_confirm_${listingId}_${genId()}`;
  const requestHash = await sha256Hex(canonicalEnvelope({
    op: 'record_buyer_confirmation', listing_id: listingId,
    expected_version: currentVersion, buyer_user_id: authoritativeBuyerUserId,
    purchase_id: purchaseId,
  }));

  let confirmResult;
  try {
    confirmResult = await executorClient.recordBuyerTransferConfirmation(
      listingId, currentVersion, authoritativeBuyerUserId, purchaseId, opId, requestHash,
    );
  } catch (e) {
    return { status: 500, body: { error: 'record_buyer_transfer_confirmation failed', code: 'CONFIRM_ERROR' } };
  }

  if (!confirmResult?.ok) {
    // CONFLICT means stale version (seller report or cancellation committed first)
    // STALE_VERSION means retry needed
    // NOT_BUYER means wrong buyer
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Buyer confirmation conflict',
        code: confirmResult?.code || 'CONFLICT',
        authority: confirmResult,
      },
    };
  }

  // Idempotent replay (same operation_id + request_hash)
  if (confirmResult.idempotent === true) {
    return {
      status: 200,
      body: {
        ok: true,
        replay: true,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        authority: confirmResult,
        no_financial_effects: true,
      },
    };
  }

  const newVersion = confirmResult.version;

  // ── 6. Mirror to Base44 (after authority commit) ────────────────────────
  // Base44 Purchase.buyer_confirmed is a MIRROR projection — not authoritative.
  // The authoritative transfer state is in authority_v1.transfer_state.
  const now = new Date().toISOString();
  const purchaseUpdate = {
    buyer_confirmed: true,
  };

  const simulateFailure = params.simulate_mirror_failure === true;

  // Use the outbox pattern for mirror failure recovery
  const mirrorPayload = {
    listing: {
      reservation_mirror_state: state.lifecycle_state,
    },
    listing_private: {},
  };

  const mirror = await applyMirrorWithOutbox(
    entities, listingId, mirrorPayload, simulateFailure,
    newVersion, null, 'buyer_confirmation',
  );

  // Write the Purchase mirror (buyer_confirmed=true) — best-effort, after
  // authority commit. Failure does not roll back the authority transition.
  try {
    await entities.Purchase.update(purchaseId, purchaseUpdate);
  } catch (e) {
    // Mirror failure — authority already committed. Return success with mirror warning.
    return {
      status: 200,
      body: {
        ok: true,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        mirror_warning: 'Purchase mirror write failed — authority committed',
        authority: { version: newVersion, transfer_state: 'buyer_confirmed_received' },
        no_financial_effects: true,
      },
    };
  }

  // ── 7. Notification (after authority commit) ─────────────────────────────
  if (deps.sendNotification) {
    try {
      await deps.sendNotification({
        type: 'buyer_confirmed_received',
        listing_id: listingId,
        purchase_id: purchaseId,
        transfer_state: 'buyer_confirmed_received',
      });
    } catch (_) { /* notification failure does not roll back */ }
  }

  return {
    status: 200,
    body: {
      ok: true,
      status: 'confirmed',
      buyer_confirmed: true,
      transfer_state: 'buyer_confirmed_received',
      authority: { version: newVersion, transfer_state: 'buyer_confirmed_received' },
      no_financial_effects: true,
      mirror,
    },
  };
}

/**
 * maybeRouteCanaryBuyerConfirm — Canary eligibility guard + routing for
 * capturePayment (buyer confirmation only, confirming_role='buyer').
 *
 * Returns null when the request is NOT canary-eligible (caller falls through
 * to the legacy capture path), or { status, body } when canary-handled.
 *
 * Canary eligibility for buyer confirmation:
 *   - The listing is a synthetic [AUTH_CANARY] listing → must go through the
 *     canary path (never legacy).
 *   - Non-canary listing → legacy path (null).
 *
 * Flag OFF → 503 CANARY_DISABLED (synthetic listings never reach legacy).
 */
export async function maybeRouteCanaryBuyerConfirm(deps) {
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

  return runCanaryBuyerConfirmSaga({
    entities: deps.base44.asServiceRole.entities,
    user: deps.user,
    executorClient,
    sendNotification: deps.sendNotification,
    params: {
      listing_id: listing.id,
      purchase_id: deps.purchase.id,
      simulate_mirror_failure: deps.body?.simulate_mirror_failure === true,
    },
  });
}