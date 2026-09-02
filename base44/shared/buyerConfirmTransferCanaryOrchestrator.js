/**
 * buyerConfirmTransferCanaryOrchestrator.js — P0-01T Canary buyer-confirmation saga.
 *
 * Wires the existing capturePayment entry point (buyer's "I Received My Tickets"
 * button, confirming_role='buyer') through a guarded canary route. Postgres is
 * authoritative for buyer confirmation state; Base44 is mirror-only.
 *
 * COMPOSITION (P0-01T correction): In the legacy flow, the buyer's "I Received
 * My Tickets" button triggers payment capture — that's how the seller gets paid.
 * The canary route MUST NOT return early and skip capture. This orchestrator
 * composes BOTH operations:
 *   1. Record buyer confirmation in the authority (advisory, no financial effects)
 *   2. Trigger the capture saga to capture the Stripe payment (financial)
 *
 * If buyer confirmation fails (NOT_BUYER, INVALID_TRANSFER_STATE, etc.), the
 * orchestrator returns the error and does NOT attempt capture.
 * If buyer confirmation succeeds or is a replay, the orchestrator proceeds to
 * capture. The capture result is returned to the caller.
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
 *   - Buyer confirmation has NO FINANCIAL SIDE EFFECTS (advisory only). The
 *     composed capture operation handles the financial transition.
 *   - Authority committed before Base44 mirror. Mirror failure creates
 *     retryable outbox work (CanaryMirrorOutbox, operation_type='buyer_confirmation').
 *
 * Dependency-injected for testability. Tests inject mock clients.
 */
import { sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox } from './canaryMirror.js';
import { isCanaryListing } from './authCanary.js';
import { runCanaryCaptureSaga } from './captureCanaryOrchestrator.js';

/**
 * Run the canary buyer-confirmation saga (composes buyer confirmation + capture).
 * @param {object} deps
 * @param {object} deps.entities - base44.asServiceRole.entities
 * @param {object} deps.user - authenticated user
 * @param {object} deps.executorClient - createAuthorityV1Client result
 * @param {object} deps.recorderClient - createAuthorityV1StripeRecorderClient result
 * @param {object} deps.stripeAdapter - { capturePaymentIntent(piId, idemKey) → { derived, raw } }
 * @param {function} [deps.sendNotification] - optional notification callback
 * @param {object} deps.params - saga parameters
 * @param {string} deps.params.listing_id
 * @param {string} deps.params.purchase_id
 * @param {string} [deps.params.payment_intent_id] - from PurchasePrivate (required for capture)
 * @param {string} [deps.params.expected_revision] - from PurchasePrivate (required for capture)
 * @param {boolean} [deps.params.simulate_mirror_failure] - test-only
 * @param {boolean} [deps.params.simulate_capture_failure] - test-only
 * @param {boolean} [deps.params.simulate_capture_unknown] - test-only
 * @param {boolean} [deps.params.skip_capture] - test-only: skip capture composition
 * @returns {Promise<{status: number, body: object}>}
 */
export async function runCanaryBuyerConfirmSaga(deps) {
  const { entities, user, executorClient, recorderClient, stripeAdapter, params } = deps;

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
  const authoritativeBuyerUserId = state.buyer_user_id;
  const isAdmin = user.role === 'admin';

  if (!authoritativeBuyerUserId) {
    return { status: 409, body: { error: 'No buyer associated with this listing', code: 'NO_BUYER' } };
  }

  if (authoritativeBuyerUserId !== user.email && !isAdmin) {
    return { status: 403, body: { error: 'Not authorized as buyer', code: 'NOT_BUYER' } };
  }

  // ── 3. State checks ──────────────────────────────────────────────────────
  // Already sold — idempotent replay (buyer already confirmed + capture finalized)
  if (state.lifecycle_state === 'sold') {
    return {
      status: 200,
      body: {
        ok: true,
        replay: true,
        captured: true,
        finalized: true,
        capture_replay: true,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        authority: state,
      },
    };
  }

  // Already available (capture failed/released) — idempotent replay
  if (state.lifecycle_state === 'available') {
    return {
      status: 200,
      body: {
        ok: true,
        replay: true,
        captured: false,
        capture_failed: true,
        released: true,
        capture_replay: true,
        transfer_state: state.transfer_state,
        buyer_confirmed: state.transfer_state === 'buyer_confirmed_received',
        authority: state,
      },
    };
  }

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

  // 4a. Already buyer_confirmed_received — idempotent replay (skip to capture)
  let buyerConfirmReplay = false;
  if (transferState === 'buyer_confirmed_received') {
    buyerConfirmReplay = true;
  } else if (transferState !== 'in_progress' && transferState !== 'seller_reported_sent') {
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

  // ── 5. Record buyer confirmation (authority-first) — unless replay ──────
  let confirmResult = null;
  let newVersion = currentVersion;

  if (!buyerConfirmReplay) {
    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = await sha256Hex(canonicalEnvelope({
      op: 'record_buyer_confirmation', listing_id: listingId,
      expected_version: currentVersion, buyer_user_id: authoritativeBuyerUserId,
      purchase_id: purchaseId,
    }));

    try {
      confirmResult = await executorClient.recordBuyerTransferConfirmation(
        listingId, currentVersion, authoritativeBuyerUserId, purchaseId, opId, requestHash,
      );
    } catch (e) {
      return { status: 500, body: { error: 'record_buyer_transfer_confirmation failed', code: 'CONFIRM_ERROR' } };
    }

    if (!confirmResult?.ok) {
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

    if (confirmResult.idempotent === true) {
      buyerConfirmReplay = true;
    }
    newVersion = confirmResult.version;
  }

  // ── 6. Mirror buyer confirmation to Base44 (after authority commit) ──────
  if (!buyerConfirmReplay) {
    const simulateFailure = params.simulate_mirror_failure === true;
    const mirrorPayload = {
      listing: {
        reservation_mirror_state: state.lifecycle_state,
      },
      listing_private: {},
    };

    await applyMirrorWithOutbox(
      entities, listingId, mirrorPayload, simulateFailure,
      newVersion, null, 'buyer_confirmation',
    );

    try {
      await entities.Purchase.update(purchaseId, { buyer_confirmed: true });
    } catch (e) {
      // Mirror failure — authority already committed. Continue to capture.
    }
  }

  // ── 7. Compose capture (financial) ────────────────────────────────────────
  // In the legacy flow, buyer confirmation triggers payment capture. The
  // canary route MUST NOT skip capture. Compose the capture saga here.
  //
  // Skip capture only when:
  //   - params.skip_capture is true (test-only)
  //   - The listing is already sold (capture saga returns replay)
  //   - No active capture action exists (no payment was authorized)
  if (params.skip_capture === true) {
    return {
      status: 200,
      body: {
        ok: true,
        replay: buyerConfirmReplay,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        authority: { version: newVersion, transfer_state: 'buyer_confirmed_received' },
        no_financial_effects: true,
        capture_skipped: true,
      },
    };
  }

  // Re-read state to check if already sold (capture is a replay in that case)
  let postConfirmState;
  try {
    postConfirmState = await executorClient.getState(listingId);
  } catch (e) {
    return {
      status: 200,
      body: {
        ok: true,
        replay: buyerConfirmReplay,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        capture_warning: 'State re-read failed after buyer confirmation',
        no_financial_effects: true,
      },
    };
  }

  // If already sold, capture is a replay
  if (postConfirmState.lifecycle_state === 'sold') {
    return {
      status: 200,
      body: {
        ok: true,
        replay: true,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        captured: true,
        finalized: true,
        capture_replay: true,
        authority: postConfirmState,
      },
    };
  }

  // Fetch the active capture context via the DEDICATED executor-only function.
  // This retrieves the action_id + stripe_idempotency_key without exposing
  // them through the general get_state function (which is projected to mirrors).
  let captureContext;
  try {
    captureContext = await executorClient.getActiveCaptureContext(listingId);
  } catch (e) {
    return {
      status: 200,
      body: {
        ok: true,
        replay: buyerConfirmReplay,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        capture_warning: 'Active capture context read failed',
        no_financial_effects: true,
      },
    };
  }

  // If no active capture action, buyer confirmation is advisory-only
  // (payment was never authorized via begin_capture, or the action is terminal)
  const actionId = captureContext?.action_id;
  const stripeIdemKey = captureContext?.stripe_idempotency_key;

  if (!actionId) {
    return {
      status: 200,
      body: {
        ok: true,
        replay: buyerConfirmReplay,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        authority: { version: newVersion, transfer_state: 'buyer_confirmed_received' },
        no_financial_effects: true,
        capture_skipped: 'no active capture action',
      },
    };
  }

  // Capture requires recorder client + stripe adapter
  if (!recorderClient || !stripeAdapter) {
    return {
      status: 200,
      body: {
        ok: true,
        replay: buyerConfirmReplay,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        authority: { version: newVersion, transfer_state: 'buyer_confirmed_received' },
        capture_warning: 'Recorder client or Stripe adapter not configured — buyer confirmation recorded, capture deferred',
        no_financial_effects: true,
      },
    };
  }

  const paymentIntentId = params.payment_intent_id;
  const expectedRevision = params.expected_revision;

  if (!paymentIntentId || !expectedRevision) {
    return {
      status: 200,
      body: {
        ok: true,
        replay: buyerConfirmReplay,
        transfer_state: 'buyer_confirmed_received',
        buyer_confirmed: true,
        authority: { version: newVersion, transfer_state: 'buyer_confirmed_received' },
        capture_warning: 'Payment intent ID or expected revision missing — capture deferred',
        no_financial_effects: true,
      },
    };
  }

  // ── 8. Run capture saga ──────────────────────────────────────────────────
  const captureResult = await runCanaryCaptureSaga({
    entities,
    user,
    executorClient,
    recorderClient,
    stripeAdapter,
    params: {
      listing_id: listingId,
      purchase_id: purchaseId,
      payment_intent_id: paymentIntentId,
      buyer_user_id: authoritativeBuyerUserId,
      expected_revision: expectedRevision,
      action_id: actionId,
      stripe_idempotency_key: stripeIdemKey,
      simulate_mirror_failure: params.simulate_mirror_failure === true,
    },
  });

  // ── 9. Return combined result ───────────────────────────────────────────
  // Buyer confirmation is already committed in the authority. The capture
  // result is returned to the caller. If capture failed or is unknown, the
  // buyer confirmation is still recorded — the authority is the source of truth.
  //
  // SECURITY: action_id and stripe_idempotency_key are stripped at the
  // capture saga's public response boundary (runCanaryCaptureSaga) — they
  // never reach this wrapper. No redundant strip needed here.
  return {
    status: captureResult.status,
    body: {
      ...captureResult.body,
      buyer_confirmed: true,
      buyer_confirm_replay: buyerConfirmReplay,
      transfer_state: 'buyer_confirmed_received',
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

  // ── Create clients (or use injected for tests) ───────────────────────────
  let executorClient = deps.executorClient;
  if (!executorClient) {
    const { createAuthorityV1Client } = await import('./authorityV1Client.js');
    executorClient = createAuthorityV1Client(deps.executorUrl);
  }

  let recorderClient = deps.recorderClient;
  if (!recorderClient && deps.recorderUrl) {
    const { createAuthorityV1StripeRecorderClient } = await import('./authorityV1StripeRecorderClient.js');
    recorderClient = createAuthorityV1StripeRecorderClient(deps.recorderUrl, executorClient.fingerprint);
  }

  // ── Fetch PurchasePrivate for capture params ────────────────────────────
  let purchasePrivate = deps.purchasePrivate;
  if (!purchasePrivate && deps.purchase) {
    try {
      const ppRows = await deps.base44.asServiceRole.entities.PurchasePrivate.filter({ purchase_id: deps.purchase.id });
      purchasePrivate = ppRows[0] || null;
    } catch (e) {
      purchasePrivate = null;
    }
  }

  const paymentIntentId = purchasePrivate?.payment_intent_id ?? deps.purchase?.payment_intent_id;
  const expectedRevision = purchasePrivate?.reservation_revision ?? deps.purchase?.reservation_token;

  return runCanaryBuyerConfirmSaga({
    entities: deps.base44.asServiceRole.entities,
    user: deps.user,
    executorClient,
    recorderClient,
    stripeAdapter: deps.stripeAdapter,
    sendNotification: deps.sendNotification,
    params: {
      listing_id: listing.id,
      purchase_id: deps.purchase.id,
      payment_intent_id: paymentIntentId,
      expected_revision: expectedRevision,
      simulate_mirror_failure: deps.body?.simulate_mirror_failure === true,
      skip_capture: deps.body?.skip_capture === true,
    },
  });
}