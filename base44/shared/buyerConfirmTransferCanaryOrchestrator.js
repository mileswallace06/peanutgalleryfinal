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
  // P0-01T-CORRECTIVE-4: Successful terminal confirmation replay must prove
  // the exact sold transaction. The authority function validates ALL six
  // conditions: lifecycle=sold, transfer_state=buyer_confirmed_received,
  // buyer_confirmed_at present, user matches binding buyer, binding is
  // finalized, and matching capture action succeeded. Never authorize
  // generic available inventory.
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

    if (replayResult?.ok === true && replayResult?.buyer_confirmed === true) {
      // Authorized terminal replay — the authority proved ALL six conditions:
      // lifecycle=sold, transfer_state=buyer_confirmed_received,
      // buyer_confirmed_at present, user matches binding buyer,
      // binding is finalized, matching capture action succeeded.
      // No capture, no Stripe call.
      return {
        status: 200,
        body: {
          ok: true,
          replay: true,
          capture_replay: true,
          transfer_state: replayResult.transfer_state,
          lifecycle_state: state.lifecycle_state,
          buyer_confirmed: true,
          captured: true,
          finalized: true,
        },
      };
    }

    if (replayResult?.code === 'NOT_BUYER') {
      return { status: 403, body: { ok: false, code: 'NOT_BUYER' } };
    }

    // Terminal state without prior authoritative buyer confirmation, or
    // available inventory (never authorized as buyer-confirmed)
    if (replayResult?.code === 'TERMINAL_NOT_BUYER_CONFIRMED') {
      return { status: 403, body: { ok: false, code: 'TERMINAL_NOT_BUYER_CONFIRMED' } };
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
  // P0-01T-CORRECTIVE-3: All seven conditions must be true:
  //   1. lifecycle_state = frozen (checked above)
  //   2. transfer_state = buyer_confirmed_received
  //   3. recovery_blocked = true
  //   4. recovery_blocked_reason = capture_unknown
  //   5. binding_capture_state = capture_unknown
  //   6. action_status = unknown
  //   7. complete listing/purchase/PI/buyer tuple matches
  if (state.recovery_blocked === true) {
    // Condition 4: recovery_blocked_reason must be 'capture_unknown'
    if (state.recovery_blocked_reason !== 'capture_unknown') {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true, reason: state.recovery_blocked_reason } };
    }

    // Condition 2: transfer_state must be buyer_confirmed_received
    if (state.transfer_state !== 'buyer_confirmed_received') {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true } };
    }

    // Conditions 5-7: need paymentIntentId + expectedRevision to check binding/action
    if (!paymentIntentId || !expectedRevision) {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true } };
    }

    // Get exact capture context (validates complete tuple + state pair)
    let captureContext;
    try {
      captureContext = await executorClient.getActiveCaptureContext(
        listingId, purchaseId, paymentIntentId, claimedBuyer,
      );
    } catch (e) {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true } };
    }

    // Condition 7: binding must be found (complete tuple matches)
    if (!captureContext?.binding_found) {
      return { status: 403, body: { ok: false, code: 'NOT_BUYER' } };
    }

    // Conditions 5+6: binding_capture_state = capture_unknown AND action_status = unknown
    if (captureContext?.binding_capture_state !== 'capture_unknown' || captureContext?.action_status !== 'unknown') {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true } };
    }

    // has_active_capture validates the complete state pair
    if (!captureContext?.has_active_capture) {
      return { status: 409, body: { ok: false, code: 'QUARANTINED', recovery_blocked: true } };
    }

    // All conditions met — reuse same action + Stripe idempotency key.
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
    // Binding found but no valid active capture state pair → no confirmation mutation
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
  // P0-01T-CORRECTIVE-4: Read canary secrets lazily — ONLY after canary
  // eligibility is confirmed. Normal non-canary traffic never reads canary
  // secrets or constructs the Stripe adapter.
  let executorUrl = deps.executorUrl;
  let recorderUrl = deps.recorderUrl;
  let stripeAdapter = deps.stripeAdapter;

  if (!executorUrl && deps.secrets) {
    executorUrl = await deps.secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR');
  }
  if (!recorderUrl && deps.secrets) {
    recorderUrl = await deps.secrets.get('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER');
  }
  if (!stripeAdapter && deps.secrets) {
    const secretKey = await deps.secrets.get('STRIPE_SECRET_KEY');
    if (secretKey) {
      const { createStripeCaptureProvider } = await import('./stripeCaptureProvider.js');
      stripeAdapter = createStripeCaptureProvider(secretKey);
    }
  }

  if (!executorUrl && !deps.executorClient) {
    return { status: 500, body: { error: 'Authority executor URL not configured', code: 'NO_EXECUTOR_URL' } };
  }

  // ── Create clients (or use injected for tests) ───────────────────────────
  let executorClient = deps.executorClient;
  if (!executorClient) {
    const { createAuthorityV1Client } = await import('./authorityV1Client.js');
    executorClient = createAuthorityV1Client(executorUrl);
  }

  let recorderClient = deps.recorderClient;
  if (!recorderClient && recorderUrl) {
    const { createAuthorityV1StripeRecorderClient } = await import('./authorityV1StripeRecorderClient.js');
    recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);
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

  // P0-01T-CORRECTIVE-4: simulate_mirror_failure must NEVER come from the HTTP
  // request body. It is a trusted test dependency supplied directly to the
  // orchestrator/harness, not a request field.
  return runCanaryBuyerConfirmSaga({
    entities: deps.base44.asServiceRole.entities,
    user: deps.user,
    executorClient,
    recorderClient,
    stripeAdapter,
    sendNotification: deps.sendNotification,
    params: {
      listing_id: listing.id,
      purchase_id: deps.purchase.id,
      payment_intent_id: paymentIntentId,
      expected_revision: expectedRevision,
    },
  });
}