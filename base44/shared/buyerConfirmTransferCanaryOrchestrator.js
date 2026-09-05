/**
 * buyerConfirmTransferCanaryOrchestrator.js — P0-01T-CORRECTIVE-2 Canary buyer-confirmation saga.
 *
 * Wires the existing capturePayment entry point (buyer's "I Received My Tickets"
 * button, confirming_role='buyer') through a guarded canary route. Postgres is
 * authoritative for buyer confirmation state; Base44 is mirror-only.
 *
 * COMPOSITION (P0-01T): The buyer's "I Received My Tickets" button triggers
 * BOTH operations:
 *   1. Record buyer confirmation in the authority (advisory, no financial effects)
 *   2. Trigger the capture saga to capture the Stripe payment (financial)
 *
 * P0-01T-CORRECTIVE-2 fixes:
 *   A. Terminal replay authorization: Uses authenticated user.email as the
 *      claimed buyer. No admin bypass. For sold/available states, calls the
 *      authoritative replay check (record_buyer_transfer_confirmation) which
 *      validates buyer identity via the binding (retains buyer_user_id after
 *      terminal transitions). Authorized binding buyer → 200 replay;
 *      different user → 403 NOT_BUYER. Never authorizes from request IDs or
 *      the Base44 Purchase mirror. Does not return buyer email.
 *   B. Exact capture context: Uses the 4-argument get_active_capture_context
 *      (listing_id, purchase_id, payment_intent_id, buyer_user_id) which
 *      validates the complete authoritative tuple.
 *   C. Correct sequencing: Before committing a NEW buyer confirmation, requires
 *      recorder client, Stripe adapter, PaymentIntent ID, reservation revision,
 *      and exact active capture context. Missing dependency → 503
 *      CAPTURE_DEPENDENCY_UNAVAILABLE. Missing/mismatched context → 409
 *      CAPTURE_CONTEXT_MISMATCH. No advisory-only success in production.
 *   D. Removed the capture-bypass flag entirely. No request field, header, or
 *      dependency may bypass capture.
 *
 * TRANSFER LIFECYCLE (authority_v1):
 *   not_started → in_progress → seller_reported_sent → buyer_confirmed_received
 *
 * INVARIANTS:
 *   - Buyer identity is derived from the authenticated session (user.email).
 *     No admin bypass — a different user may never confirm receipt.
 *   - Confirmation permitted only from 'in_progress' or 'seller_reported_sent'
 *     transfer states with lifecycle_state='frozen'. Rejects canceled, refunded,
 *     mismatched, stale, or otherwise ineligible purchases.
 *   - CAS on reservation_authority.version ensures exactly-one-wins.
 *   - Buyer confirmation has NO FINANCIAL SIDE EFFECTS (advisory only). The
 *     composed capture operation handles the financial transition.
 *   - Authority committed before Base44 mirror. Mirror failure creates
 *     retryable outbox work (CanaryMirrorOutbox, operation_type='buyer_confirmation').
 *   - Operational credentials (action_id, stripe_idempotency_key) are never
 *     returned in any response. Safe projection only.
 */
import { sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox } from './canaryMirror.js';
import { isCanaryListing } from './authCanary.js';
import { runCanaryCaptureSaga } from './captureCanaryOrchestrator.js';

/**
 * Run the canary buyer-confirmation saga (composes buyer confirmation + capture).
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

  // ── Claimed buyer from authenticated session (NO admin bypass) ───────────
  const claimedBuyer = user.email;
  if (!claimedBuyer) return { status: 401, body: { error: 'Authenticated user email required' } };

  const paymentIntentId = params.payment_intent_id;
  const expectedRevision = params.expected_revision;

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

  // ── 2. Terminal replay: sold or available ────────────────────────────────
  // record_capture_result clears authority.buyer_user_id on terminal transitions.
  // The binding retains buyer_user_id. Call the authoritative replay check
  // which validates buyer identity via the binding.
  if (state.lifecycle_state === 'sold' || state.lifecycle_state === 'available') {
    const opId = `op_buyer_confirm_replay_${listingId}_${genId()}`;
    const requestHash = await sha256Hex(canonicalEnvelope({
      op: 'record_buyer_confirmation', listing_id: listingId,
      expected_version: state.version, buyer_user_id: claimedBuyer,
      purchase_id: purchaseId,
    }));

    let replayResult;
    try {
      replayResult = await executorClient.recordBuyerTransferConfirmation(
        listingId, state.version, claimedBuyer, purchaseId, opId, requestHash,
      );
    } catch (e) {
      return { status: 500, body: { error: 'Replay check failed', code: 'REPLAY_ERROR' } };
    }

    if (replayResult?.ok === true) {
      // Authorized replay — no capture, no Stripe call
      return {
        status: 200,
        body: {
          ok: true,
          replay: true,
          capture_replay: true,
          transfer_state: replayResult.transfer_state,
          lifecycle_state: state.lifecycle_state,
          buyer_confirmed: true,
          captured: state.lifecycle_state === 'sold',
          finalized: state.lifecycle_state === 'sold',
          capture_failed: state.lifecycle_state === 'available',
          released: state.lifecycle_state === 'available',
        },
      };
    }

    if (replayResult?.code === 'NOT_BUYER') {
      return { status: 403, body: { ok: false, code: 'NOT_BUYER' } };
    }

    return { status: 409, body: { ok: false, code: replayResult?.code || 'REPLAY_CONFLICT' } };
  }

  // ── 3. Not frozen → not confirmable ──────────────────────────────────────
  if (state.lifecycle_state !== 'frozen') {
    return {
      status: 409,
      body: { ok: false, error: 'Purchase is not in a confirmable state', code: 'NOT_CONFIRMABLE' },
    };
  }

  // ── 4. Recovery-blocked: continue only for capture_unknown reconciliation ─
  if (state.recovery_blocked === true) {
    // Condition 1: lifecycle is frozen ✓ (checked above)
    // Condition 2: transfer_state must be buyer_confirmed_received
    if (state.transfer_state !== 'buyer_confirmed_received') {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true } };
    }

    // Conditions 3-5: need paymentIntentId + expectedRevision to check binding/action
    if (!paymentIntentId || !expectedRevision) {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true } };
    }

    // Get exact capture context (validates complete tuple)
    let captureContext;
    try {
      captureContext = await executorClient.getActiveCaptureContext(
        listingId, purchaseId, paymentIntentId, claimedBuyer,
      );
    } catch (e) {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true } };
    }

    // Condition 3+4: binding exists (has_active_capture=true) AND capture_state='unknown'
    if (!captureContext?.has_active_capture || captureContext?.capture_state !== 'unknown') {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true } };
    }

    // Condition 5: complete authoritative tuple matches ✓ (getActiveCaptureContext validated)

    // All 5 conditions met — reuse same action + Stripe idempotency key.
    // Do not clear recovery_blocked manually or create another action.
    if (!recorderClient || !stripeAdapter) {
      return { status: 503, body: { ok: false, code: 'CAPTURE_DEPENDENCY_UNAVAILABLE' } };
    }

    let captureResult;
    try {
      captureResult = await runCanaryCaptureSaga({
        entities, user,
        executorClient, recorderClient, stripeAdapter,
        params: {
          listing_id: listingId,
          purchase_id: purchaseId,
          payment_intent_id: paymentIntentId,
          buyer_user_id: claimedBuyer,
          expected_revision: expectedRevision,
          action_id: captureContext.action_id,
          stripe_idempotency_key: captureContext.stripe_idempotency_key,
        },
      });
    } catch (e) {
      return { status: 500, body: { ok: false, code: 'CAPTURE_SAGA_ERROR', buyer_confirmed: true, buyer_confirm_replay: true } };
    }

    if (!captureResult || typeof captureResult.status !== 'number') {
      return { status: 500, body: { ok: false, code: 'CAPTURE_SAGA_INVALID', buyer_confirmed: true, buyer_confirm_replay: true } };
    }

    return {
      status: captureResult.status,
      body: {
        ...captureResult.body,
        buyer_confirmed: true,
        buyer_confirm_replay: true,
        transfer_state: 'buyer_confirmed_received',
      },
    };
  }

  // ── 5. Frozen, not recovery-blocked: check transfer state ────────────────
  const currentVersion = state.version;
  const transferState = state.transfer_state;
  let buyerConfirmReplay = false;

  if (transferState === 'buyer_confirmed_received') {
    // Replay — buyer already confirmed, proceed to capture
    buyerConfirmReplay = true;
  } else if (transferState !== 'in_progress' && transferState !== 'seller_reported_sent') {
    return {
      status: 409,
      body: {
        ok: false,
        code: 'INVALID_TRANSFER_STATE',
        transfer_state: transferState,
        valid_preceding: ['in_progress', 'seller_reported_sent'],
      },
    };
  }

  // ── 6. For NEW confirmation, require all capture dependencies ────────────
  if (!buyerConfirmReplay) {
    if (!recorderClient || !stripeAdapter) {
      return { status: 503, body: { ok: false, code: 'CAPTURE_DEPENDENCY_UNAVAILABLE', reason: 'Recorder client or Stripe adapter not configured' } };
    }
    if (!paymentIntentId || !expectedRevision) {
      return { status: 503, body: { ok: false, code: 'CAPTURE_DEPENDENCY_UNAVAILABLE', reason: 'PaymentIntent ID or reservation revision missing' } };
    }
  }

  // ── 7. Get exact active capture context (required for both new and replay) ─
  if (!paymentIntentId || !expectedRevision) {
    return { status: 503, body: { ok: false, code: 'CAPTURE_DEPENDENCY_UNAVAILABLE', reason: 'PaymentIntent ID or reservation revision missing' } };
  }

  let captureContext;
  try {
    captureContext = await executorClient.getActiveCaptureContext(
      listingId, purchaseId, paymentIntentId, claimedBuyer,
    );
  } catch (e) {
    return { status: 409, body: { ok: false, code: 'CAPTURE_CONTEXT_MISMATCH' } };
  }

  if (!captureContext?.binding_found) {
    // Binding not found: wrong buyer, wrong purchase, or wrong payment_intent
    return { status: 403, body: { ok: false, code: 'NOT_BUYER' } };
  }
  if (!captureContext?.has_active_capture) {
    // Binding found but no active capture action → no confirmation mutation
    return { status: 409, body: { ok: false, code: 'CAPTURE_CONTEXT_MISMATCH' } };
  }

  const actionId = captureContext.action_id;
  const stripeIdemKey = captureContext.stripe_idempotency_key;

  // ── 8. Record buyer confirmation (if not replay) ────────────────────────
  let newVersion = currentVersion;

  if (!buyerConfirmReplay) {
    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = await sha256Hex(canonicalEnvelope({
      op: 'record_buyer_confirmation', listing_id: listingId,
      expected_version: currentVersion, buyer_user_id: claimedBuyer,
      purchase_id: purchaseId,
    }));

    let confirmResult;
    try {
      confirmResult = await executorClient.recordBuyerTransferConfirmation(
        listingId, currentVersion, claimedBuyer, purchaseId, opId, requestHash,
      );
    } catch (e) {
      return { status: 500, body: { error: 'record_buyer_transfer_confirmation failed', code: 'CONFIRM_ERROR' } };
    }

    if (!confirmResult?.ok) {
      return {
        status: 409,
        body: { ok: false, code: confirmResult?.code || 'CONFLICT' },
      };
    }

    if (confirmResult.idempotent === true) {
      buyerConfirmReplay = true;
    }
    newVersion = confirmResult.version;

    // Mirror buyer confirmation to Base44 (after authority commit)
    const simulateFailure = params.simulate_mirror_failure === true;
    const mirrorPayload = {
      listing: { reservation_mirror_state: state.lifecycle_state },
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

  // ── 9. Compose capture (financial) ────────────────────────────────────────
  // Capture MUST proceed for production requests. No bypass allowed.
  if (!recorderClient || !stripeAdapter) {
    return { status: 503, body: { ok: false, code: 'CAPTURE_DEPENDENCY_UNAVAILABLE', buyer_confirmed: true, buyer_confirm_replay: buyerConfirmReplay } };
  }

  let captureResult;
  try {
    captureResult = await runCanaryCaptureSaga({
      entities, user,
      executorClient, recorderClient, stripeAdapter,
      params: {
        listing_id: listingId,
        purchase_id: purchaseId,
        payment_intent_id: paymentIntentId,
        buyer_user_id: claimedBuyer,
        expected_revision: expectedRevision,
        action_id: actionId,
        stripe_idempotency_key: stripeIdemKey,
        simulate_mirror_failure: params.simulate_mirror_failure === true,
      },
    });
  } catch (e) {
    return { status: 500, body: { ok: false, code: 'CAPTURE_SAGA_ERROR', buyer_confirmed: true, buyer_confirm_replay: buyerConfirmReplay } };
  }

  if (!captureResult || typeof captureResult.status !== 'number') {
    return { status: 500, body: { ok: false, code: 'CAPTURE_SAGA_INVALID', buyer_confirmed: true, buyer_confirm_replay: buyerConfirmReplay } };
  }

  // ── 10. Return combined result (safe projection) ────────────────────────
  // captureResult.body is already safely projected by runCanaryCaptureSaga.
  // No action_id or stripe_idempotency_key reaches this wrapper.
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
 * P0-01T-CORRECTIVE-2: The capture-bypass flag is NOT forwarded from the
 * request body. No request field may bypass capture.
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
    },
  });
}