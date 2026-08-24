/**
 * confirmCanaryOrchestrator.js — P0-01H Canary checkout-confirmation saga.
 *
 * Owns the canary payment-binding transition for synthetic [AUTH_CANARY]
 * records only. Postgres is authoritative; Base44 is mirror-only. No fallback
 * to legacy reservation mutation.
 *
 * CANONICAL BOUNDARY:
 *   confirmCheckoutAuthorized is the correct entry point for the authoritative
 *   `bind_payment_intent` transition. It already verifies PI authorization
 *   from Stripe and validates all metadata (purchase, listing, buyer, seller,
 *   reservation_token, amount). The missing authoritative transition is
 *   `bind_payment_intent`, which creates the payment binding with
 *   capture_state='authorized' — the prerequisite for begin_capture.
 *
 * FLOW (canary-eligible only — flag ON, admin, canary action, synthetic listing):
 *   1. Read authority state → verify reserved, matching buyer
 *   2. Verify PI from Stripe adapter → requires_capture or succeeded
 *   3. Verify PI metadata (purchase_id, listing_id, buyer_email, seller_email,
 *      reservation_token, amount)
 *   4. Hash reservation_token → token_hash
 *   5. Call bind_payment_intent (atomically creates binding with
 *      capture_state='authorized')
 *   6. Mirror authorization_confirmed_at to Purchase + PurchasePrivate
 *      (durable outbox on failure, never rolls back Postgres)
 *
 * GUARANTEES:
 *   - Deterministic operation ID (canary_bind_{purchase_id}_{pi_id}) for
 *     natural idempotent replay.
 *   - Exact replay returns the original result.
 *   - Changed-payload replay is rejected (OPERATION_ID_CONFLICT).
 *   - Stale version or mismatched buyer/token/PI fails closed (no binding).
 *   - Concurrent confirmations produce one transition (CAS + FOR UPDATE).
 *   - Provider verification timeout/unknown never becomes authorized.
 *   - Base44 is mirror-only.
 *   - Mirror failure uses the durable outbox (CanaryMirrorOutbox).
 *   - No legacy authority mutation fallback for canary records.
 *   - Never imports admin client.
 *
 * Dependency-injected for testability. Tests inject mock clients + fake Stripe.
 */
import { sha256Hex, canonicalEnvelope } from './canaryMirror.js';
import { isCanaryEnabled, isCanaryListing } from './authCanary.js';

// ── Mirror helper: apply authorization_confirmed_at to Purchase + PurchasePrivate ─
// Postgres transition (bind_payment_intent) has already committed. If the mirror
// write fails (or is simulated to fail), a CanaryMirrorOutbox record is created
// so a retry can repair the mirror exactly once. Postgres is never rolled back.
async function applyConfirmMirrorWithOutbox(entities, purchaseId, listingId, confirmedAt, simulateFailure) {
  const mirror = { attempted: true, purchase: null, purchase_private: null, outbox_id: null };
  const mirrorPayload = {
    purchase: { authorization_confirmed_at: confirmedAt },
    purchase_private: { authorization_confirmed_at: confirmedAt },
  };

  if (simulateFailure) {
    try {
      const outbox = await entities.CanaryMirrorOutbox.create({
        listing_id: listingId,
        operation_type: 'confirm',
        authority_version: 0,
        authority_revision: null,
        mirror_payload: mirrorPayload,
        status: 'pending',
      });
      mirror.outbox_id = outbox.id;
      mirror.purchase = 'simulated_failure';
    } catch (e) {
      mirror.purchase = 'outbox_create_failed:' + (e.message || String(e)).slice(0, 80);
    }
    return mirror;
  }

  // Write to PurchasePrivate (authoritative buyer identity)
  try {
    const ppRows = await entities.PurchasePrivate.filter({ purchase_id: purchaseId });
    const pp = ppRows[0];
    if (pp) {
      await entities.PurchasePrivate.update(pp.id, { authorization_confirmed_at: confirmedAt });
      mirror.purchase_private = 'ok';
    } else {
      mirror.purchase_private = 'no_record';
    }
  } catch (e) {
    mirror.purchase_private = 'failed:' + (e.message || String(e)).slice(0, 80);
    try {
      const outbox = await entities.CanaryMirrorOutbox.create({
        listing_id: listingId,
        operation_type: 'confirm',
        authority_version: 0,
        authority_revision: null,
        mirror_payload: mirrorPayload,
        status: 'pending',
      });
      mirror.outbox_id = outbox.id;
    } catch (oe) {
      mirror.outbox_create_failed = (oe.message || String(oe)).slice(0, 80);
    }
  }

  // Write to Purchase (mirror)
  try {
    await entities.Purchase.update(purchaseId, { authorization_confirmed_at: confirmedAt });
    mirror.purchase = 'ok';
  } catch (e) {
    mirror.purchase = 'failed:' + (e.message || String(e)).slice(0, 80);
    if (!mirror.outbox_id) {
      try {
        const outbox = await entities.CanaryMirrorOutbox.create({
          listing_id: listingId,
          operation_type: 'confirm',
          authority_version: 0,
          authority_revision: null,
          mirror_payload: mirrorPayload,
          status: 'pending',
        });
        mirror.outbox_id = outbox.id;
      } catch (oe) {
        mirror.outbox_create_failed = (oe.message || String(oe)).slice(0, 80);
      }
    }
  }

  return mirror;
}

/**
 * Run the canary confirm saga.
 * @param {object} deps
 * @param {object} deps.entities - base44.asServiceRole.entities
 * @param {object} deps.user - authenticated user
 * @param {object} deps.executorClient - createAuthorityV1Client result
 * @param {object} deps.stripeAdapter - { retrievePaymentIntent(piId) → PI }
 * @param {object} deps.params - saga parameters
 * @returns {Promise<{status: number, body: object}>}
 */
export async function runCanaryConfirmSaga(deps) {
  const { entities, user, executorClient, stripeAdapter, params } = deps;

  // ── Validate params ──────────────────────────────────────────────────────
  const listingId = params?.listing_id;
  const purchaseId = params?.purchase_id;
  const paymentIntentId = params?.payment_intent_id;
  const buyerUserId = params?.buyer_user_id;
  const buyerEmail = params?.buyer_email;
  const sellerEmail = params?.seller_email;
  const reservationToken = params?.reservation_token;
  const amount = params?.amount;

  if (!listingId) return { status: 400, body: { error: 'listing_id required' } };
  if (!purchaseId) return { status: 400, body: { error: 'purchase_id required' } };
  if (!paymentIntentId) return { status: 400, body: { error: 'payment_intent_id required' } };
  if (!buyerUserId) return { status: 400, body: { error: 'buyer_user_id required' } };
  if (!reservationToken) return { status: 400, body: { error: 'reservation_token required' } };

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (!executorClient) return { status: 500, body: { error: 'Executor client required' } };
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
  if (state.lifecycle_state !== 'reserved') {
    return { status: 409, body: { error: 'Not in reserved state', code: 'NOT_RESERVED', authority_state: state } };
  }
  if (state.buyer_user_id !== buyerUserId) {
    return { status: 409, body: { error: 'Buyer mismatch', code: 'BUYER_MISMATCH' } };
  }

  // ── 2. Verify PI from Stripe (injected adapter — never real in canary) ───
  let pi;
  try {
    pi = await stripeAdapter.retrievePaymentIntent(paymentIntentId);
  } catch (e) {
    // Timeout/unknown → never becomes authorized
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_RETRIEVE_FAILED' } };
  }

  // ── 3. Check PI status — must be requires_capture or succeeded ───────────
  if (!['requires_capture', 'succeeded'].includes(pi.status)) {
    return { status: 402, body: { error: 'Payment not authorized', code: 'PI_NOT_AUTHORIZED', pi_status: pi.status } };
  }

  // ── 4. Verify PI metadata (exact match, no bypass) ───────────────────────
  const md = pi.metadata || {};
  if (!md.purchase_id || md.purchase_id !== purchaseId) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH', field: 'purchase_id' } };
  }
  if (!md.listing_id || md.listing_id !== listingId) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH', field: 'listing_id' } };
  }
  if (!md.buyer_email || md.buyer_email !== buyerEmail) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH', field: 'buyer_email' } };
  }
  if (!md.seller_email || md.seller_email !== sellerEmail) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH', field: 'seller_email' } };
  }
  if (!md.reservation_token || md.reservation_token !== reservationToken) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'PI_METADATA_MISMATCH', field: 'reservation_token' } };
  }
  if (Math.round((amount || 0) * 100) !== pi.amount) {
    return { status: 500, body: { error: 'Payment verification failed', code: 'AMOUNT_MISMATCH' } };
  }

  // ── 5. Hash reservation token ───────────────────────────────────────────
  const tokenHash = await sha256Hex(reservationToken);

  // ── 6. Call bind_payment_intent (deterministic operation ID) ─────────────
  // Deterministic ID: canary_bind_{purchase_id}_{payment_intent_id}
  // Natural retries get the same operation_id → idempotent replay.
  const operationId = `canary_bind_${purchaseId}_${paymentIntentId}`;
  const requestHash = await sha256Hex(canonicalEnvelope({
    op: 'bind_pi', listing_id: listingId, purchase_id: purchaseId,
    payment_intent_id: paymentIntentId, buyer_user_id: buyerUserId,
    authority_version: state.version, reservation_revision: state.reservation_revision,
    token_hash: tokenHash,
  }));

  let bindResult;
  try {
    bindResult = await executorClient.bindPaymentIntent(
      listingId, purchaseId, paymentIntentId, buyerUserId,
      state.version, state.reservation_revision, tokenHash,
      operationId, requestHash,
    );
  } catch (e) {
    return { status: 500, body: { error: 'bind_payment_intent failed', code: 'BIND_ERROR' } };
  }

  if (!bindResult?.ok) {
    // Structured conflict (OPERATION_ID_CONFLICT, AUTHORITY_MISMATCH, PAYMENT_BINDING_CONFLICT)
    return {
      status: 409,
      body: { error: 'Bind conflict', code: bindResult?.code || 'CONFLICT', authority: bindResult },
    };
  }

  // ── 7. Mirror authorization_confirmed_at to Purchase + PurchasePrivate ───
  const confirmedAt = new Date().toISOString();
  const simulateFailure = params.simulate_mirror_failure === true;
  const mirror = await applyConfirmMirrorWithOutbox(entities, purchaseId, listingId, confirmedAt, simulateFailure);

  return {
    status: 200,
    body: {
      ok: true,
      bound: true,
      idempotent: bindResult.idempotent === true,
      authorization_confirmed_at: confirmedAt,
      authority: bindResult,
      mirror,
    },
  };
}

/**
 * maybeRouteCanaryConfirm — Canary eligibility guard + routing for
 * confirmCheckoutAuthorized.
 *
 * Returns null when the request is NOT canary-eligible (caller falls through
 * to the legacy confirm path), or { status, body } when canary-handled/rejected.
 *
 * Isolation rules (identical to canaryGuard.maybeRouteCanary):
 *   - Synthetic [AUTH_CANARY] listing WITHOUT body.canary → 403
 *   - body.canary=true on NON-canary listing → 400
 *   - Canary request from non-admin → 403
 *   - Flag OFF → 503 CANARY_DISABLED
 *   - No executor URL → 500
 *
 * @param {object} deps
 * @param {object} deps.base44 - SDK client
 * @param {object} deps.user - authenticated user
 * @param {object} deps.body - request body
 * @param {object} deps.listing - the purchase's listing
 * @param {object} deps.purchase - the purchase being confirmed
 * @param {string} deps.executorUrl - AUTHORITY_V1_DB_URL_DEV_EXECUTOR
 * @param {object} deps.stripeAdapter - { retrievePaymentIntent(piId) }
 * @param {object} [deps.executorClient] - injected for tests
 * @returns {Promise<{status:number,body:object}|null>}
 */
export async function maybeRouteCanaryConfirm(deps) {
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
  if (!isCanaryEnabled()) {
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
    return { status: 400, body: { error: 'Payment intent ID required for canary confirm', code: 'NO_PI_ID' } };
  }

  const buyerEmail = purchasePrivate?.buyer_email ?? purchase.buyer_email;
  const sellerEmail = purchasePrivate?.seller_email ?? purchase.seller_email;
  const reservationToken = purchasePrivate?.reservation_token ?? purchase.reservation_token;
  const amount = purchase.amount;
  const buyerUserId = user.id || user.email;

  // ── Create executor client (or use injected for tests) ───────────────────
  let executorClient = deps.executorClient;
  if (!executorClient) {
    const { createAuthorityV1Client } = await import('./authorityV1Client.js');
    executorClient = createAuthorityV1Client(deps.executorUrl);
  }

  return runCanaryConfirmSaga({
    entities: deps.base44.asServiceRole.entities,
    user,
    executorClient,
    stripeAdapter: deps.stripeAdapter,
    params: {
      listing_id: listing.id,
      purchase_id: purchase.id,
      payment_intent_id: paymentIntentId,
      buyer_user_id: buyerUserId,
      buyer_email: buyerEmail,
      seller_email: sellerEmail,
      reservation_token: reservationToken,
      amount,
      simulate_mirror_failure: body?.simulate_mirror_failure === true,
    },
  });
}