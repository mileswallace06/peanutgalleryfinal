/**
 * abortCanaryOrchestrator.js — P0-01G Canary abort-checkout saga orchestrator.
 *
 * Owns the canary abort-checkout saga for synthetic [AUTH_CANARY] records only.
 * Postgres is authoritative; Base44 is mirror-only. No fallback to legacy
 * reservation mutation.
 *
 * FLOW (canary-eligible only — flag ON, admin, canary action, synthetic listing):
 *   1. Executor client calls begin_cancel (supplies stable Stripe idempotency key)
 *   2. Injected Stripe adapter performs cancellation OUTSIDE Postgres
 *   3. Recorder client records the result (record_cancel_result)
 *   4. Confirmed success → authority released → Base44 mirror release
 *   5. Definitive failure → fail-closed (recovery_blocked, incident)
 *   6. Timeout/unknown → fail-closed (recovery_blocked, incident)
 *   7. Mirror failure → durable outbox (CanaryMirrorOutbox)
 *
 * GUARANTEES:
 *   - Provider invoked at most once per execution attempt.
 *   - Stable Stripe idempotency key reused on retry (same operation_id).
 *   - Never falls back to legacy reservation mutation.
 *   - Never imports admin client.
 *
 * Dependency-injected for testability. Tests inject mock clients + fake Stripe.
 */
import { sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox } from './canaryMirror.js';
import { isCanaryListing } from './authCanary.js';

/**
 * Run the canary abort saga.
 * @param {object} deps
 * @param {object} deps.entities - base44.asServiceRole.entities
 * @param {object} deps.user - authenticated user
 * @param {object} deps.executorClient - createAuthorityV1Client result
 * @param {object} deps.recorderClient - createAuthorityV1StripeRecorderClient result
 * @param {object} deps.stripeAdapter - { cancelPaymentIntent(piId, idemKey) → { derived, raw } }
 * @param {object} deps.params - saga parameters
 * @param {string} deps.params.listing_id
 * @param {string} deps.params.purchase_id
 * @param {string} deps.params.payment_intent_id
 * @param {string} deps.params.buyer_user_id
 * @param {string} deps.params.expected_revision
 * @param {string} [deps.params.action_id] - optional (generated if absent)
 * @param {string} [deps.params.stripe_idempotency_key] - optional (generated if absent)
 * @param {boolean} [deps.params.simulate_mirror_failure] - test-only
 * @returns {Promise<{status: number, body: object}>}
 */
export async function runCanaryAbortSaga(deps) {
  const { entities, user, executorClient, recorderClient, stripeAdapter, params } = deps;

  // ── Validate params ──────────────────────────────────────────────────────
  const listingId = params?.listing_id;
  const purchaseId = params?.purchase_id;
  const paymentIntentId = params?.payment_intent_id;
  const buyerUserId = params?.buyer_user_id;
  const expectedRevision = params?.expected_revision;

  if (!listingId) return { status: 400, body: { error: 'listing_id required' } };
  if (!purchaseId) return { status: 400, body: { error: 'purchase_id required' } };
  if (!paymentIntentId) return { status: 400, body: { error: 'payment_intent_id required' } };
  if (!buyerUserId) return { status: 400, body: { error: 'buyer_user_id required' } };
  if (!expectedRevision) return { status: 400, body: { error: 'expected_revision required' } };

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (!executorClient) return { status: 500, body: { error: 'Executor client required' } };
  if (!recorderClient) return { status: 500, body: { error: 'Recorder client required' } };
  if (!stripeAdapter) return { status: 500, body: { error: 'Stripe adapter required' } };

  // ── Generate stable IDs (or reuse provided ones for retry) ───────────────
  let actionId = params.action_id || `act_abort_${purchaseId}_${genId()}`;
  let stripeIdemKey = params.stripe_idempotency_key || `idem_abort_${actionId}`;

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

  // Must be in a cancellable state (reserved or frozen)
  if (state.lifecycle_state !== 'reserved' && state.lifecycle_state !== 'frozen') {
    return { status: 409, body: { error: 'Not in cancellable state', code: 'NOT_CANCELLABLE', authority_state: state } };
  }

  const expectedVersion = state.version;

  // ── Reconciliation: recovery_blocked (cancel_unknown) → find existing action ──
  // P0-01P: When recovery_blocked is true (from a prior cancel_unknown), the
  // binding is in 'cancel_unknown' state and begin_cancel would reject it.
  // Resolve the existing action via resolve_webhook_action and skip
  // begin_cancel — the provider retrieves Stripe's actual state and the
  // recorder reconciles the result. This mirrors the cancel-purchase saga.
  let skipBeginCancel = false;
  if (state.recovery_blocked === true) {
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
      return { status: 200, body: { ok: true, replay: true, action_id: resolved.action_id, authority: resolved } };
    }
    if (resolved.action_found === true && resolved.action_id) {
      actionId = resolved.action_id;
      stripeIdemKey = resolved.stripe_idempotency_key || `idem_abort_${actionId}`;
      skipBeginCancel = true;
    } else {
      return { status: 409, body: { error: 'Authority is recovery_blocked but no existing cancel action found', code: 'NO_ACTION_TO_RECONCILE' } };
    }
  }

  if (!skipBeginCancel) {
    // ── 2. begin_cancel via executor (supplies stable Stripe idempotency key) ─
    const operationId = `op_abort_${actionId}_${genId()}`;
    const beginRequestHash = await sha256Hex(canonicalEnvelope({
      op: 'begin_cancel', listing_id: listingId, expected_version: expectedVersion,
      purchase_id: purchaseId, payment_intent_id: paymentIntentId,
      buyer_user_id: buyerUserId, action_id: actionId, idem_key: stripeIdemKey,
    }));

    let beginResult;
    try {
      beginResult = await executorClient.beginCancel(
        listingId, expectedVersion, purchaseId, paymentIntentId,
        buyerUserId, expectedRevision, actionId, stripeIdemKey, operationId, beginRequestHash,
      );
    } catch (e) {
      return { status: 500, body: { error: 'begin_cancel failed', code: 'BEGIN_CANCEL_ERROR' } };
    }

    if (!beginResult?.ok) {
      // Structured conflict (OPERATION_ID_CONFLICT or ACTION_STATUS_INVALID)
      return {
        status: 409,
        body: { error: 'begin_cancel conflict', code: beginResult?.code || 'CONFLICT', authority: beginResult },
      };
    }

    // If this was an idempotent replay (cancel already requested), skip Stripe + record
    // begin_cancel returns { ok: true, cancel_requested: true, replay: true/false }
    if (beginResult.replay === true) {
      return {
        status: 200,
        body: {
          ok: true,
          replay: true,
          action_id: actionId,
          authority: beginResult,
        },
      };
    }
  }

  // ── 3. Stripe cancellation OUTSIDE Postgres ──────────────────────────────
  // Provider invoked at most once per execution attempt.
  let stripeResult;
  try {
    stripeResult = await stripeAdapter.cancelPaymentIntent(paymentIntentId, stripeIdemKey);
  } catch (e) {
    // Network error / timeout → treat as unknown
    stripeResult = { derived: 'unknown', raw: { error: (e.message || String(e)).slice(0, 200) } };
  }

  const derived = stripeResult.derived; // 'succeeded' | 'failed' | 'unknown'

  // ── 4. Record result via recorder client ──────────────────────────────────
  const recordOpId = `op_record_${actionId}_${genId()}`;
  const recordRequestHash = await sha256Hex(canonicalEnvelope({
    op: 'record_cancel', action_id: actionId, result: derived,
  }));

  let recordResult;
  let recorderFailed = false;
  try {
    recordResult = await recorderClient.recordCancelResult(
      actionId, derived, stripeResult.raw || {}, null, recordOpId, recordRequestHash,
    );
  } catch (e) {
    recorderFailed = true;
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

  // ── 5. Branch on result ──────────────────────────────────────────────────
  if (derived === 'succeeded' && recordResult?.canceled === true) {
    // Confirmed success → authority released → Base44 mirror release
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
      recordResult.authority_version || expectedVersion + 1,
      recordResult.reservation_revision || null,
      'abort_release',
    );

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
 * maybeRouteCanaryAbort — Canary eligibility guard + routing for abortCheckout.
 *
 * Returns null when the request is NOT canary-eligible (caller falls through
 * to the legacy abort path), or { status, body } when canary-handled/rejected.
 *
 * Isolation rules (identical to canaryGuard.maybeRouteCanary):
 *   - Synthetic [AUTH_CANARY] listing WITHOUT body.canary → 403
 *   - body.canary=true on NON-canary listing → 400
 *   - Canary request from non-admin → 403
 *   - Flag OFF → 503 CANARY_DISABLED
 *   - No executor/recorder URL → 500
 *
 * @param {object} deps
 * @param {object} deps.base44 - SDK client
 * @param {object} deps.user - authenticated user
 * @param {object} deps.body - request body
 * @param {object} deps.listing - the purchase's listing
 * @param {object} deps.purchase - the purchase being aborted
 * @param {object} deps.purchasePrivate - purchase private sidecar
 * @param {string} deps.executorUrl - AUTHORITY_V1_DB_URL_DEV_EXECUTOR
 * @param {string} deps.recorderUrl - AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER
 * @param {object} deps.stripeAdapter - { cancelPaymentIntent(piId, idemKey) }
 * @param {object} [deps.executorClient] - injected for tests
 * @param {object} [deps.recorderClient] - injected for tests
 * @returns {Promise<{status:number,body:object}|null>}
 */
export async function maybeRouteCanaryAbort(deps) {
  const { listing, body, user } = deps;
  const isCanary = isCanaryListing(listing);
  const wantsCanary = body?.canary === true;

  // Neither canary listing nor canary request → normal path
  if (!isCanary && !wantsCanary) return null;

  // Synthetic canary listing without explicit canary action → block
  if (isCanary && !wantsCanary) {
    return {
      status: 403,
      body: { error: 'Synthetic canary listing requires explicit canary action', code: 'CANARY_ACTION_REQUIRED' },
    };
  }
  // Canary action on a non-canary listing → block
  if (wantsCanary && !isCanary) {
    return {
      status: 400,
      body: { error: 'Canary action on non-canary listing', code: 'NOT_CANARY' },
    };
  }
  // Both true — require admin
  if (user?.role !== 'admin') {
    return {
      status: 403,
      body: { error: 'Canary requires admin', code: 'CANARY_ADMIN_REQUIRED' },
    };
  }
  if (deps.canaryEnabled !== true) {
    return {
      status: 503,
      body: { error: 'Canary integration is disabled.', code: 'CANARY_DISABLED' },
    };
  }
  if (!deps.executorUrl) {
    return {
      status: 500,
      body: { error: 'Authority executor URL not configured', code: 'NO_EXECUTOR_URL' },
    };
  }
  if (!deps.recorderUrl) {
    return {
      status: 500,
      body: { error: 'Authority recorder URL not configured', code: 'NO_RECORDER_URL' },
    };
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
    return { status: 400, body: { error: 'Payment intent ID required for canary abort', code: 'NO_PI_ID' } };
  }

  const buyerUserId = purchasePrivate?.buyer_email ?? purchase.buyer_email;
  const expectedRevision = purchasePrivate?.reservation_revision ?? purchase.reservation_token;

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

  return runCanaryAbortSaga({
    entities: deps.base44.asServiceRole.entities,
    user,
    executorClient,
    recorderClient,
    stripeAdapter: deps.stripeAdapter,
    params: {
      listing_id: listing.id,
      purchase_id: purchase.id,
      payment_intent_id: paymentIntentId,
      buyer_user_id: buyerUserId,
      expected_revision: expectedRevision,
      action_id: body?.action_id,
      stripe_idempotency_key: body?.stripe_idempotency_key,
      simulate_mirror_failure: body?.simulate_mirror_failure === true,
    },
  });
}