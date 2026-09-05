/**
 * captureCanaryOrchestrator.js — P0-01I Canary capture-payment saga orchestrator.
 *
 * Owns the canary capture saga for synthetic [AUTH_CANARY] records only.
 * Postgres is authoritative; Base44 is mirror-only. No fallback to legacy
 * capture logic.
 *
 * FLOW (canary-eligible only — flag ON, admin, canary action, synthetic listing):
 *   1. Executor client calls begin_capture (reserved → frozen, creates action)
 *   2. Injected Stripe adapter performs capture OUTSIDE Postgres
 *   3. Recorder client records the result (record_capture_result)
 *   4. Confirmed success → authority sold → Base44 mirror sold
 *   5. Definitive failure → authority available → Base44 mirror active (release)
 *   6. Timeout/unknown → fail-closed (recovery_blocked, incident)
 *   7. Mirror failure → durable outbox (CanaryMirrorOutbox)
 *
 * RECONCILIATION: A later record_capture_result with a definitive result
 * (succeeded/failed) resolves a capture_unknown state:
 *   succeeded → binding finalized, authority sold, recovery_blocked cleared
 *   failed    → binding failed, authority available, recovery_blocked cleared
 *   unknown   → no-op (stays frozen + blocked)
 *
 * GUARANTEES:
 *   - Provider invoked at most once per execution attempt.
 *   - Stable Stripe idempotency key reused on retry (same action_id).
 *   - Never falls back to legacy capture/reservation mutation.
 *   - Never imports admin client.
 *
 * Dependency-injected for testability. Tests inject mock clients + fake Stripe.
 */
import { sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox } from './canaryMirror.js';
import { isCanaryListing } from './authCanary.js';

/**
 * Run the canary capture saga.
 * @param {object} deps
 * @param {object} deps.entities - base44.asServiceRole.entities
 * @param {object} deps.user - authenticated user
 * @param {object} deps.executorClient - createAuthorityV1Client result
 * @param {object} deps.recorderClient - createAuthorityV1StripeRecorderClient result
 * @param {object} deps.stripeAdapter - { capturePaymentIntent(piId, idemKey) → { derived, raw } }
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
export async function runCanaryCaptureSaga(deps) {
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
  const actionId = params.action_id || `act_capture_${purchaseId}_${genId()}`;
  const stripeIdemKey = params.stripe_idempotency_key || `idem_capture_${actionId}`;

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

  // ── Branch on authority state ────────────────────────────────────────────
  //   reserved → first attempt: call begin_capture (reserved → frozen)
  //   frozen   → retry/reconciliation: skip begin_capture, go to Stripe + record
  //   sold     → already finalized (succeeded): idempotent replay
  //   available→ already released (failed): idempotent replay
  //   other    → conflict
  let skipBeginCapture = false;

  if (state.lifecycle_state === 'reserved') {
    // First attempt — call begin_capture
  } else if (state.lifecycle_state === 'frozen') {
    // Retry or reconciliation — action already exists, skip begin_capture
    skipBeginCapture = true;
  } else if (state.lifecycle_state === 'sold') {
    // Already finalized — idempotent replay (safe projection, no internal state)
    return {
      status: 200,
      body: {
        ok: true,
        captured: true,
        finalized: true,
        replay: true,
      },
    };
  } else if (state.lifecycle_state === 'available') {
    // Already released (failed capture) — idempotent replay (safe projection)
    return {
      status: 200,
      body: {
        ok: true,
        captured: false,
        capture_failed: true,
        released: true,
        replay: true,
      },
    };
  } else {
    return { status: 409, body: { error: 'Not in capturable state', code: 'NOT_CAPTURABLE' } };
  }

  let beginResult = null;
  const expectedVersion = state.version;

  if (!skipBeginCapture) {
    const operationId = `op_begin_${actionId}_${genId()}`;

    // ── 2. begin_capture via executor (supplies stable Stripe idempotency key) ─
    const beginRequestHash = await sha256Hex(canonicalEnvelope({
      op: 'begin_capture', listing_id: listingId, expected_version: expectedVersion,
      purchase_id: purchaseId, payment_intent_id: paymentIntentId,
      buyer_user_id: buyerUserId, action_id: actionId, idem_key: stripeIdemKey,
    }));

    try {
      beginResult = await executorClient.beginCapture(
        listingId, expectedVersion, purchaseId, paymentIntentId,
        buyerUserId, expectedRevision, actionId, stripeIdemKey, operationId, beginRequestHash,
      );
    } catch (e) {
      return { status: 500, body: { error: 'begin_capture failed', code: 'BEGIN_CAPTURE_ERROR' } };
    }

    if (!beginResult?.ok) {
      // Structured conflict (OPERATION_ID_CONFLICT, BINDING_NOT_AUTHORIZED, CONFLICT)
      return {
        status: 409,
        body: { error: 'begin_capture conflict', code: beginResult?.code || 'CONFLICT' },
      };
    }

    // If this was an idempotent replay (already frozen), skip Stripe + record
    if (beginResult.replay === true) {
      return {
        status: 200,
        body: {
          ok: true,
          replay: true,
        },
      };
    }
  }

  // ── 3. Stripe capture OUTSIDE Postgres ──────────────────────────────────
  // Provider invoked at most once per execution attempt.
  let stripeResult;
  try {
    stripeResult = await stripeAdapter.capturePaymentIntent(paymentIntentId, stripeIdemKey);
  } catch (e) {
    // Network error / timeout → treat as unknown
    stripeResult = { derived: 'unknown', raw: { error: (e.message || String(e)).slice(0, 200) } };
  }

  const derived = stripeResult.derived; // 'succeeded' | 'failed' | 'unknown'

  // ── 4. Record result via recorder client ──────────────────────────────────
  const recordOpId = `op_record_${actionId}_${genId()}`;
  const recordRequestHash = await sha256Hex(canonicalEnvelope({
    op: 'record_capture', action_id: actionId, result: derived,
  }));

  let recordResult;
  let recorderFailed = false;
  try {
    recordResult = await recorderClient.recordCaptureResult(
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
        provider_called: true,
        provider_result: derived,
      },
    };
  }

  // ── 5. Check if record_capture_result returned a structured error ─────────
  // The recorder may return { ok: false, code: '...' } without throwing.
  // We must not pretend recovery_blocked/finalized is true if the recorder
  // rejected the result — the authority DB was NOT updated in that case.
  if (recordResult?.ok === false) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'record_capture_result rejected the result',
        code: recordResult?.code || 'RECORD_FAILED',
        provider_called: true,
        provider_result: derived,
      },
    };
  }

  // P0-01T-CORRECTIVE-4: Reject unexpected recorder result shape.
  // Must not infer capture_unknown, recovery_blocked, finalized, or released
  // state unless the authoritative recorder result explicitly proves that state.
  if (!recordResult || typeof recordResult !== 'object' || recordResult.ok !== true) {
    return {
      status: 500,
      body: {
        ok: false,
        error: 'Recorder returned an invalid result shape',
        code: 'RECORDER_RESULT_INVALID',
        provider_called: true,
        provider_result: derived,
      },
    };
  }

  // ── 6. Branch on result ──────────────────────────────────────────────────
  if (derived === 'succeeded' && recordResult?.finalized === true) {
    // Confirmed success → authority sold → Base44 mirror sold
    const mirrorPayload = {
      listing: {
        reserved_by_email: null,
        reservation_token: null,
        reservation_expires_at: null,
        reservation_revision: null,
        status: 'sold',
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
      recordResult.authority_version || recordResult.version || expectedVersion + 2,
      recordResult.reservation_revision || null,
      'capture',
    );

    return {
      status: 200,
      body: {
        ok: true,
        captured: true,
        finalized: true,
        provider_called: true,
        provider_result: 'succeeded',
      },
    };
  }

  if (derived === 'failed') {
    // P0-01T-CORRECTIVE-3: Only mirror active when the authoritative recorder
    // result explicitly reports released === true. Never infer release merely
    // from Stripe's derived 'failed' result. A post-buyer-confirmation failure
    // keeps the authority frozen and recovery-blocked (no relist).
    if (recordResult?.released === true) {
      // Ordinary pre-delivery capture failure → authority available → mirror active
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
        recordResult.authority_version || recordResult.version || expectedVersion + 2,
        recordResult.reservation_revision || null,
        'capture',
      );

      return {
        status: 200,
        body: {
          ok: true,
          captured: false,
          capture_failed: true,
          released: true,
          provider_called: true,
          provider_result: 'failed',
        },
      };
    }

    // Post-buyer-confirmation capture failure (or other non-release failure):
    // authority stays frozen + recovery_blocked. Do NOT mirror active.
    return {
      status: 200,
      body: {
        ok: true,
        captured: false,
        capture_failed: true,
        released: false,
        recovery_blocked: true,
        recovery_blocked_reason: recordResult?.recovery_blocked_reason || 'capture_failed',
        code: recordResult?.code || 'CAPTURE_FAILED',
        provider_called: true,
        provider_result: 'failed',
      },
    };
  }

  // P0-01T-CORRECTIVE-4: unknown → fail-closed ONLY when the authoritative
  // recorder result explicitly proves capture_unknown and recovery_blocked.
  if (recordResult?.capture_unknown === true && recordResult?.recovery_blocked === true) {
    return {
      status: 200,
      body: {
        ok: true,
        captured: false,
        capture_unknown: true,
        recovery_blocked: true,
        provider_called: true,
        provider_result: 'unknown',
      },
    };
  }

  // Recorder result does not explicitly prove capture_unknown + recovery_blocked
  return {
    status: 500,
    body: {
      ok: false,
      error: 'Recorder result does not prove capture_unknown state',
      code: 'RECORDER_RESULT_INVALID',
      provider_called: true,
      provider_result: 'unknown',
    },
  };
}

/**
 * maybeRouteCanaryCapture — Canary eligibility guard + routing for capturePayment.
 *
 * Returns null when the request is NOT canary-eligible (caller falls through
 * to the legacy capture path), or { status, body } when canary-handled/rejected.
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
 * @param {object} deps.purchase - the purchase being captured
 * @param {object} deps.purchasePrivate - purchase private sidecar
 * @param {string} deps.executorUrl - AUTHORITY_V1_DB_URL_DEV_EXECUTOR
 * @param {string} deps.recorderUrl - AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER
 * @param {object} deps.stripeAdapter - { capturePaymentIntent(piId, idemKey) }
 * @param {boolean} deps.canaryEnabled - Trusted enabled state supplied by the
 *   caller. The production handler supplies isCanaryEnabled() (the committed
 *   default-OFF flag); a trusted certification harness may supply true. This
 *   value must NEVER be derived from user input or runtime environment
 *   overrides — only from the caller's trusted configuration.
 * @param {object} [deps.executorClient] - injected for tests
 * @param {object} [deps.recorderClient] - injected for tests
 * @returns {Promise<{status:number,body:object}|null>}
 */
export async function maybeRouteCanaryCapture(deps) {
  const { listing, body, user, canaryEnabled } = deps;
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
  // Trusted dependency-injected enabled state. When the caller supplies the
  // real committed config (flag OFF), the canary path is disabled and returns
  // 503. No environment/global/header/secret can override this.
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
    executorUrl = deps.secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR');
  }
  if (!recorderUrl && deps.secrets) {
    recorderUrl = deps.secrets.get('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER');
  }
  if (!stripeAdapter && deps.secrets) {
    const secretKey = await deps.secrets.get('STRIPE_SECRET_KEY');
    if (secretKey) {
      const { createStripeCaptureProvider } = await import('./stripeCaptureProvider.js');
      stripeAdapter = createStripeCaptureProvider(secretKey);
    }
  }

  if (!executorUrl) {
    return {
      status: 500,
      body: { error: 'Authority executor URL not configured', code: 'NO_EXECUTOR_URL' },
    };
  }
  if (!recorderUrl) {
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
    return { status: 400, body: { error: 'Payment intent ID required for canary capture', code: 'NO_PI_ID' } };
  }

  const buyerUserId = purchasePrivate?.buyer_email ?? purchase.buyer_email;
  const expectedRevision = purchasePrivate?.reservation_revision ?? purchase.reservation_token;

  // ── Create clients (or use injected for tests) ───────────────────────────
  let executorClient = deps.executorClient;
  let recorderClient = deps.recorderClient;
  if (!executorClient) {
    const { createAuthorityV1Client } = await import('./authorityV1Client.js');
    executorClient = createAuthorityV1Client(executorUrl);
  }
  if (!recorderClient) {
    const { createAuthorityV1StripeRecorderClient } = await import('./authorityV1StripeRecorderClient.js');
    recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);
  }

  // P0-01T-CORRECTIVE-4: simulate_mirror_failure must NEVER come from the HTTP
  // request body. It is a trusted test dependency supplied directly to the
  // orchestrator/harness, not a request field.
  return runCanaryCaptureSaga({
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
    },
  });
}