/**
 * cancelPurchaseCanaryOrchestrator.js — P0-01L Canary cancel-purchase saga.
 *
 * Buyer-initiated PRE-CAPTURE cancellation for authority-bound canary purchases.
 * Postgres is authoritative; Base44 is mirror-only. No fallback to legacy
 * cancellation logic.
 *
 * SCOPE: Pre-capture cancellation only (authority 'reserved', binding 'authorized').
 *   - Captured/finalized (authority 'sold') → structured conflict + incident
 *     (CAPTURED_OUT_OF_SCOPE). No silent refund, no inventory restore.
 *   - Capture-in-flight/unknown (authority 'frozen') → fail closed
 *     (CAPTURE_IN_FLIGHT). Cancellation must not race capture.
 *   - Transfer uncertain/seller-confirmed → cancel money safely but
 *     quarantine/recovery-block the listing for manual resolution.
 *
 * REUSES CERTIFIED PRIMITIVES (no parallel cancellation implementation):
 *   - begin_cancel (executor) — same function as abortCheckout canary
 *   - record_cancel_result (recorder) — same function as abortCheckout canary
 *   - quarantine_listing (executor) — existing certified function
 *   - create_webhook_incident (executor) — existing certified function
 *   - stripeCancelProvider (shared) — shared production Stripe cancel adapter
 *
 * AUTHORIZATION: The buyer is authorized using the AUTHORITATIVE buyer_user_id
 * from the authority state (get_state), NOT from Base44 purchase fields or
 * client-supplied data. Admin override preserves the existing admin policy
 * without widening it.
 *
 * TRANSFER GUARD: The authority state (reserved + authorized) is the
 * authoritative guard proving capture has not started. Base44
 * purchase.seller_confirmed is a RISK SIGNAL (not proof) — if true, the
 * transfer may have started, so money is canceled but the listing is
 * quarantined (not relisted).
 *
 * GUARANTEES:
 *   - Provider invoked at most once per execution attempt.
 *   - Stable Stripe idempotency key reused on retry (same action_id).
 *   - Never falls back to legacy cancellation/reservation mutation.
 *   - Never imports admin client.
 *   - Notifications occur only after authoritative commitment (record_cancel_result).
 *   - Mirror/notification failure cannot roll back the cancellation.
 *
 * Dependency-injected for testability. Tests inject mock clients + fake Stripe.
 */
import { sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox } from './canaryMirror.js';
import { isCanaryListing } from './authCanary.js';

/**
 * Run the canary cancel-purchase saga.
 * @param {object} deps
 * @param {object} deps.entities - base44.asServiceRole.entities
 * @param {object} deps.user - authenticated user
 * @param {object} deps.executorClient - createAuthorityV1Client result
 * @param {object} deps.recorderClient - createAuthorityV1StripeRecorderClient result
 * @param {object} deps.stripeAdapter - { cancelPaymentIntent(piId, idemKey) → { derived, raw } }
 * @param {function} [deps.sendNotification] - optional idempotent notification callback
 * @param {object} deps.params - saga parameters
 * @param {string} deps.params.listing_id
 * @param {string} deps.params.purchase_id
 * @param {string} deps.params.payment_intent_id
 * @param {boolean} [deps.params.seller_confirmed] - Base44 risk signal (NOT proof)
 * @param {string} [deps.params.action_id] - optional (generated if absent)
 * @param {string} [deps.params.stripe_idempotency_key] - optional (generated if absent)
 * @param {boolean} [deps.params.simulate_mirror_failure] - test-only
 * @returns {Promise<{status: number, body: object}>}
 */
export async function runCanaryCancelPurchaseSaga(deps) {
  const { entities, user, executorClient, recorderClient, stripeAdapter, params } = deps;

  // ── Validate params ──────────────────────────────────────────────────────
  const listingId = params?.listing_id;
  const purchaseId = params?.purchase_id;
  const paymentIntentId = params?.payment_intent_id;

  if (!listingId) return { status: 400, body: { error: 'listing_id required' } };
  if (!purchaseId) return { status: 400, body: { error: 'purchase_id required' } };
  if (!paymentIntentId) return { status: 400, body: { error: 'payment_intent_id required' } };

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (!executorClient) return { status: 500, body: { error: 'Executor client required' } };
  if (!recorderClient) return { status: 500, body: { error: 'Recorder client required' } };
  if (!stripeAdapter) return { status: 500, body: { error: 'Stripe adapter required' } };

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
  // NOT from Base44 purchase fields or client-supplied data. The buyer_user_id
  // is only present for non-terminal states (reserved/frozen). Terminal states
  // (sold/available) have the tuple cleared by constraint, so buyer auth is
  // skipped — the rejection/replay response does not leak sensitive data.
  const authoritativeBuyerUserId = state.buyer_user_id;
  const isAdmin = user.role === 'admin';
  if (authoritativeBuyerUserId && authoritativeBuyerUserId !== user.email && !isAdmin) {
    return { status: 403, body: { error: 'Only the buyer can cancel this purchase', code: 'NOT_BUYER' } };
  }

  // ── 3. State checks — scope enforcement ──────────────────────────────────
  // 'sold' → captured/finalized → OUT OF SCOPE (no silent refund)
  if (state.lifecycle_state === 'sold') {
    const incidentOpId = `op_incident_${genId()}`;
    const incidentHash = await sha256Hex(canonicalEnvelope({
      op: 'captured_out_of_scope', listing_id: listingId, purchase_id: purchaseId,
    }));
    try {
      await executorClient.createWebhookIncident(
        `cancel_captured_out_of_scope:${listingId}`,
        'admin_action_required', 'high',
        'Cancel Attempted on Captured Sale',
        `Buyer attempted to cancel purchase ${purchaseId} but the sale is captured/finalized (authority: sold). ` +
          'Refund is out of scope for P0-01L. Manual review required.',
        listingId, 'listing',
      );
    } catch (e) { /* best-effort incident */ }
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Cannot cancel a captured sale',
        code: 'CAPTURED_OUT_OF_SCOPE',
        authority_state: state.lifecycle_state,
      },
    };
  }

  // 'frozen' → capture in-flight or capture-unknown → FAIL CLOSED
  if (state.lifecycle_state === 'frozen') {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Capture is in-flight or unknown — cancellation must not race capture',
        code: 'CAPTURE_IN_FLIGHT',
        authority_state: state.lifecycle_state,
        recovery_blocked: state.recovery_blocked,
      },
    };
  }

  // 'available' → already released → idempotent replay
  if (state.lifecycle_state === 'available') {
    return {
      status: 200,
      body: {
        ok: true,
        canceled: true,
        released: true,
        replay: true,
        authority: state,
      },
    };
  }

  // Only 'reserved' is in scope for pre-capture cancellation
  if (state.lifecycle_state !== 'reserved') {
    return { status: 409, body: { error: 'Not in cancellable state', code: 'NOT_CANCELLABLE', authority_state: state } };
  }

  // ── 4. Transfer guard — seller_confirmed is a Base44 RISK SIGNAL (not proof) ──
  // The authority state (reserved + authorized) is the authoritative guard
  // proving capture has not started. If seller_confirmed is true, the transfer
  // MAY have started → cancel money but quarantine (don't relist).
  const sellerConfirmed = params.seller_confirmed === true;
  const shouldQuarantine = sellerConfirmed;

  // ── 5. Find existing action or begin_cancel ───────────────────────────────
  // For reconciliation (recovery_blocked from cancel_unknown), the existing
  // action is in 'unknown' status. begin_cancel does NOT accept the
  // 'cancel_unknown' binding state, so we find the existing action via
  // resolve_webhook_action and call record_cancel_result directly.
  // For first attempt (not recovery_blocked), call begin_cancel to create a
  // new action and transition the binding to 'cancel_requested'.
  let actionId, stripeIdemKey;
  let skipBeginCancel = false;

  if (state.recovery_blocked === true) {
    // Reconciliation — find the existing cancel action
    let resolved;
    try {
      resolved = await executorClient.resolveWebhookAction(paymentIntentId, 'payment_intent.canceled');
    } catch (e) {
      return { status: 500, body: { error: 'resolve_webhook_action failed', code: 'RESOLVE_FAILED' } };
    }
    if (!resolved?.ok) {
      return { status: 409, body: { error: 'Reconciliation lookup failed', code: 'RECONCILE_LOOKUP_FAILED' } };
    }
    if (resolved.already_applied === true) {
      // Action already succeeded/failed — idempotent replay
      return {
        status: 200,
        body: { ok: true, replay: true, action_id: resolved.action_id, authority: resolved },
      };
    }
    if (resolved.action_found === true && resolved.action_id) {
      actionId = resolved.action_id;
      stripeIdemKey = resolved.stripe_idempotency_key || `idem_cancel_${actionId}`;
      skipBeginCancel = true;
    } else {
      // recovery_blocked but no existing action — manual resolution required
      return {
        status: 409,
        body: { error: 'Authority is recovery_blocked but no existing cancel action found', code: 'NO_ACTION_TO_RECONCILE' },
      };
    }
  } else {
    // First attempt — generate stable IDs
    actionId = params.action_id || `act_cancel_${purchaseId}_${genId()}`;
    stripeIdemKey = params.stripe_idempotency_key || `idem_cancel_${actionId}`;
  }

  if (!skipBeginCancel) {
    // ── 5a. begin_cancel via executor ─────────────────────────────────────
    const expectedVersion = state.version;
    const expectedRevision = state.reservation_revision;
    const operationId = `op_begin_${actionId}_${genId()}`;

    const beginRequestHash = await sha256Hex(canonicalEnvelope({
      op: 'begin_cancel', listing_id: listingId, expected_version: expectedVersion,
      purchase_id: purchaseId, payment_intent_id: paymentIntentId,
      buyer_user_id: authoritativeBuyerUserId, action_id: actionId, idem_key: stripeIdemKey,
    }));

    let beginResult;
    try {
      beginResult = await executorClient.beginCancel(
        listingId, expectedVersion, purchaseId, paymentIntentId,
        authoritativeBuyerUserId, expectedRevision, actionId, stripeIdemKey, operationId, beginRequestHash,
      );
    } catch (e) {
      return { status: 500, body: { error: 'begin_cancel failed', code: 'BEGIN_CANCEL_ERROR' } };
    }

    if (!beginResult?.ok) {
      return {
        status: 409,
        body: { error: 'begin_cancel conflict', code: beginResult?.code || 'CONFLICT', authority: beginResult },
      };
    }

    // Idempotent replay of begin_cancel
    if (beginResult.replay === true) {
      return {
        status: 200,
        body: { ok: true, replay: true, action_id: actionId, authority: beginResult },
      };
    }
  }

  // ── 6. Stripe cancellation OUTSIDE Postgres (shared provider) ────────────
  // Provider invoked at most once per execution attempt.
  let stripeResult;
  try {
    stripeResult = await stripeAdapter.cancelPaymentIntent(paymentIntentId, stripeIdemKey);
  } catch (e) {
    stripeResult = { derived: 'unknown', raw: { error: (e.message || String(e)).slice(0, 200) } };
  }

  const derived = stripeResult.derived; // 'succeeded' | 'failed' | 'unknown'

  // ── 7. Record result via recorder client ──────────────────────────────────
  const recordOpId = `op_record_${actionId}_${genId()}`;
  const recordRequestHash = await sha256Hex(canonicalEnvelope({
    op: 'record_cancel', action_id: actionId, result: derived,
  }));

  let recordResult;
  try {
    recordResult = await recorderClient.recordCancelResult(
      actionId, derived, stripeResult.raw || {}, null, recordOpId, recordRequestHash,
    );
  } catch (e) {
    // Recorder failure after provider response — action stays in-flight.
    // A later retry (same operation_id) can record the result.
    return {
      status: 500,
      body: {
        ok: false,
        error: 'Recorder failed after provider response',
        code: 'RECORDER_FAILED',
        action_id: actionId,
        stripe_idempotency_key: stripeIdemKey,
        provider_called: true,
        provider_result: derived,
      },
    };
  }

  // ── 8. Branch on result ──────────────────────────────────────────────────
  if (derived === 'succeeded' && recordResult?.canceled === true) {
    // Cancel succeeded — authority released to 'available'

    if (shouldQuarantine) {
      // ── Transfer guard failed — quarantine the listing ─────────────────
      // Money is canceled but the listing is NOT relisted. It is quarantined
      // (recovery_blocked + checkout_quarantined) for manual resolution.
      const quarantineOpId = `op_quarantine_${listingId}_${genId()}`;
      const quarantineHash = await sha256Hex(canonicalEnvelope({
        op: 'quarantine', listing_id: listingId, reason: 'transfer_uncertain_cancel',
      }));
      let quarantineOk = true;
      try {
        await executorClient.quarantineListing(
          listingId, 'transfer_uncertain_cancel', quarantineOpId, quarantineHash,
        );
      } catch (e) {
        quarantineOk = false;
        // Quarantine failed — authority is released but listing not blocked.
        // Create an incident for manual resolution.
        try {
          await executorClient.createWebhookIncident(
            `quarantine_failed:${listingId}`,
            'admin_action_required', 'critical',
            'Quarantine Failed After Cancel',
            `Cancel succeeded for purchase ${purchaseId} but quarantine_listing failed. ` +
              'Authority is released but listing is not blocked. Manual resolution required.',
            listingId, 'listing',
          );
        } catch (e2) { /* best-effort */ }
      }

      // Mirror: hidden (NOT active) — listing is quarantined
      const mirrorPayload = {
        listing: {
          reserved_by_email: null,
          reservation_token: null,
          reservation_expires_at: null,
          reservation_revision: null,
          status: 'hidden',
          hidden_reason: 'transfer_uncertain_cancel',
        },
        listing_private: {
          reserved_by_email: null,
          reservation_token: null,
          reservation_expires_at: null,
          reservation_revision: null,
        },
      };
      const simulateFailure = params.simulate_mirror_failure === true;
      const mirror = await applyMirrorWithOutbox(
        entities, listingId, mirrorPayload, simulateFailure,
        recordResult.version || state.version + 1,
        recordResult.reservation_revision || null,
        'cancel',
      );

      // Idempotent notification — only after authoritative commitment
      if (deps.sendNotification) {
        try {
          await deps.sendNotification({
            type: 'dispute',
            listing_id: listingId,
            purchase_id: purchaseId,
            quarantined: true,
            quarantine_ok: quarantineOk,
          });
        } catch (_) { /* notification failure does not roll back */ }
      }

      return {
        status: 200,
        body: {
          ok: true,
          canceled: true,
          released: true,
          quarantined: true,
          quarantine_ok: quarantineOk,
          action_id: actionId,
          stripe_idempotency_key: stripeIdemKey,
          provider_called: true,
          provider_result: 'succeeded',
          authority: recordResult,
          mirror,
        },
      };
    }

    // ── Transfer guard passed — relist the listing ────────────────────────
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
    const simulateFailure = params.simulate_mirror_failure === true;
    const mirror = await applyMirrorWithOutbox(
      entities, listingId, mirrorPayload, simulateFailure,
      recordResult.version || state.version + 1,
      recordResult.reservation_revision || null,
      'cancel',
    );

    // Idempotent notification — only after authoritative commitment
    if (deps.sendNotification) {
      try {
        await deps.sendNotification({
          type: 'cancelled',
          listing_id: listingId,
          purchase_id: purchaseId,
        });
      } catch (_) { /* notification failure does not roll back */ }
    }

    return {
      status: 200,
      body: {
        ok: true,
        canceled: true,
        released: true,
        action_id: actionId,
        stripe_idempotency_key: stripeIdemKey,
        provider_called: true,
        provider_result: 'succeeded',
        authority: recordResult,
        mirror,
      },
    };
  }

  if (derived === 'failed') {
    // Definitive failure → fail-closed (recovery_blocked, incident)
    return {
      status: 200,
      body: {
        ok: true,
        canceled: false,
        cancel_failed: true,
        recovery_blocked: true,
        action_id: actionId,
        stripe_idempotency_key: stripeIdemKey,
        provider_called: true,
        provider_result: 'failed',
        authority: recordResult,
      },
    };
  }

  // unknown → fail-closed (recovery_blocked, incident)
  return {
    status: 200,
    body: {
      ok: true,
      canceled: false,
      cancel_unknown: true,
      recovery_blocked: true,
      action_id: actionId,
      stripe_idempotency_key: stripeIdemKey,
      provider_called: true,
      provider_result: 'unknown',
      authority: recordResult,
    },
  };
}

/**
 * maybeRouteCanaryCancelPurchase — Canary eligibility guard + routing for cancelPurchase.
 *
 * Returns null when the request is NOT canary-eligible (caller falls through
 * to the legacy cancel path), or { status, body } when canary-handled/rejected.
 *
 * Canary eligibility for cancelPurchase:
 *   - The listing is a synthetic [AUTH_CANARY] listing → must go through the
 *     canary path (never legacy). No body.canary flag required — the buyer
 *     simply cancels their purchase.
 *   - Non-canary listing → legacy path (null).
 *
 * Flag OFF → 503 CANARY_DISABLED (synthetic listings never reach legacy).
 *
 * @param {object} deps
 * @param {object} deps.base44 - SDK client
 * @param {object} deps.user - authenticated user
 * @param {object} deps.listing - the purchase's listing
 * @param {object} deps.purchase - the purchase being canceled
 * @param {object} [deps.purchasePrivate] - purchase private sidecar (fetched if absent)
 * @param {string} deps.executorUrl - AUTHORITY_V1_DB_URL_DEV_EXECUTOR
 * @param {string} deps.recorderUrl - AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER
 * @param {object} deps.stripeAdapter - { cancelPaymentIntent(piId, idemKey) }
 * @param {boolean} deps.canaryEnabled - Trusted enabled state supplied by the
 *   caller. The production handler supplies isCanaryEnabled() (the committed
 *   default-OFF flag); a trusted certification harness may supply true. This
 *   value must NEVER be derived from user input or runtime environment
 *   overrides — only from the caller's trusted configuration.
 * @param {function} [deps.sendNotification] - optional idempotent notification callback
 * @param {object} [deps.executorClient] - injected for tests
 * @param {object} [deps.recorderClient] - injected for tests
 * @param {object} [deps.body] - request body (for action_id/idem_key/simulate)
 * @returns {Promise<{status:number,body:object}|null>}
 */
export async function maybeRouteCanaryCancelPurchase(deps) {
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
  if (!deps.recorderUrl) {
    return { status: 500, body: { error: 'Authority recorder URL not configured', code: 'NO_RECORDER_URL' } };
  }

  // ── Gather saga params from purchase + purchasePrivate ───────────────────
  const { purchase } = deps;
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  // Fetch purchasePrivate only when canary-eligible (not for normal traffic)
  let purchasePrivate = deps.purchasePrivate;
  if (!purchasePrivate) {
    try {
      const ppRows = await deps.base44.asServiceRole.entities.PurchasePrivate.filter({ purchase_id: purchase.id });
      purchasePrivate = ppRows[0] || null;
    } catch (e) {
      purchasePrivate = null;
    }
  }

  const paymentIntentId = purchasePrivate?.payment_intent_id ?? purchase.payment_intent_id;
  if (!paymentIntentId) {
    return { status: 400, body: { error: 'Payment intent ID required for canary cancel', code: 'NO_PI_ID' } };
  }

  // ── Create clients (or use injected for tests) ───────────────────────────
  let executorClient = deps.executorClient;
  let recorderClient = deps.recorderClient;
  if (!executorClient) {
    const { createAuthorityV1Client } = await import('./authorityV1Client.js');
    executorClient = createAuthorityV1Client(deps.executorUrl);
  }
  if (!recorderClient) {
    const { createAuthorityV1StripeRecorderClient } = await import('./authorityV1StripeRecorderClient.js');
    recorderClient = createAuthorityV1StripeRecorderClient(deps.recorderUrl, executorClient.fingerprint);
  }

  return runCanaryCancelPurchaseSaga({
    entities: deps.base44.asServiceRole.entities,
    user: deps.user,
    executorClient,
    recorderClient,
    stripeAdapter: deps.stripeAdapter,
    sendNotification: deps.sendNotification,
    params: {
      listing_id: listing.id,
      purchase_id: purchase.id,
      payment_intent_id: paymentIntentId,
      seller_confirmed: purchase.seller_confirmed === true,
      action_id: deps.body?.action_id,
      stripe_idempotency_key: deps.body?.stripe_idempotency_key,
      simulate_mirror_failure: deps.body?.simulate_mirror_failure === true,
    },
  });
}