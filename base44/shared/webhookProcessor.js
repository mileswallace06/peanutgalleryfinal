/**
 * webhookProcessor.js — P0-01K Scheduled webhook business-state processor.
 *
 * Drains durable pending Stripe webhook events from the authority_v1 Postgres
 * boundary. PostgreSQL is authoritative; Base44 receives mirror/outbox effects
 * only — no fallback, no direct authoritative Purchase/Listing writes.
 *
 * PRIVILEGE BOUNDARY:
 *   - Executor client: claim/complete/recover/escalate webhook events,
 *     resolve matching actions, create incidents, flag missing actions.
 *   - Recorder client: record verified Stripe outcomes (record_*_result).
 *   - Never uses admin credentials at runtime.
 *
 * PROCESSING RULES (per P0-01K spec):
 *   1. Fetch current Stripe state via shared provider — never trust the event envelope.
 *   2. Support: payment_intent.succeeded (capture), payment_intent.canceled (cancel),
 *      charge.refunded (refund) — for pending/unknown reconciliation.
 *   3. Resolve the exact matching action through resolve_webhook_action (secured).
 *   4. Already-applied terminal action → complete idempotently (no mutation).
 *   5. Terminal Stripe result but no action → flag_webhook_missing_action + incident.
 *   6. Unsupported high-risk events (disputes) → durable manual-action incident.
 *   7. Provider timeout/indeterminate → retryable with bounded backoff. Max attempts → incident.
 *   8. Crash after recorder commit but before completion → replay safely (already_applied).
 *   9. Conflicting events for same PI serialized by claim (one at a time); out-of-order
 *      handled by always fetching current Stripe state.
 *   10. Ingress kill switch (canary flag) stops new admissions but worker drains pending.
 *   11. PostgreSQL authoritative; Base44 mirror/outbox only.
 *
 * Dependency-injected for testability. Tests inject mock clients + fake providers.
 */
import { sha256Hex, canonicalEnvelope, genId } from './canaryMirror.js';

function genOpId(webhookEventId, actionId) {
  return `op_webhook_${webhookEventId}_${actionId}_${genId()}`;
}

function genReqHash(actionType, actionId, result) {
  return sha256Hex(canonicalEnvelope({
    op: 'record_' + actionType, action_id: actionId, result,
  }));
}

/**
 * Process a single webhook event.
 * @returns {{ processed: boolean, replay?: boolean, incident?: boolean, retryable?: boolean, error?: string }}
 */
async function processOneEvent({ executorClient, recorderClient, stripeProvider, event, workerId }) {
  const { webhook_event_id, event_type, payment_intent_id } = event;

  // ── Resolve the matching action through a secured function ──────────────
  const resolved = await executorClient.resolveWebhookAction(payment_intent_id, event_type);

  // Non-canary event — shouldn't be ingested, but handle gracefully
  if (!resolved?.canary_owned) {
    return { processed: true, incident: false };
  }

  // ── Unsupported event ────────────────────────────────────────────────────
  if (!resolved.supported) {
    if (resolved.high_risk) {
      // Rule 6: disputes and other high-risk events → durable manual-action incident
      await executorClient.createWebhookIncident(
        `webhook_dispute:${webhook_event_id}`, 'new_dispute', 'critical',
        'Stripe Dispute Requires Manual Action',
        `Dispute event ${event_type} for PI ${payment_intent_id} requires manual review. Webhook event: ${webhook_event_id}`,
        payment_intent_id, 'webhook'
      );
      return { processed: true, incident: true };
    }
    // Unknown but not high-risk — complete as processed (no incident needed)
    return { processed: true, incident: false };
  }

  // ── Already applied (terminal action) — idempotent complete (rule 4, rule 8) ──
  if (resolved.already_applied) {
    return { processed: true, replay: true, incident: false };
  }

  // ── No matching action — Stripe shows terminal but no authority action (rule 5) ──
  if (!resolved.action_found) {
    await executorClient.flagWebhookMissingAction(
      resolved.listing_id, payment_intent_id, event_type, webhook_event_id
    );
    return { processed: true, incident: true };
  }

  // ── Action found — fetch current Stripe state (rule 1) ──────────────────
  const actionType = resolved.action_type;
  let stripeResult;

  if (actionType === 'capture') {
    stripeResult = await stripeProvider.retrievePaymentIntentState(payment_intent_id);
    if (stripeResult.derived === 'succeeded') {
      await recorderClient.recordCaptureResult(
        resolved.action_id, 'succeeded', stripeResult.raw,
        null, genOpId(webhook_event_id, resolved.action_id),
        await genReqHash('capture', resolved.action_id, 'succeeded')
      );
      return { processed: true, incident: false };
    }
    if (stripeResult.derived === 'canceled') {
      // PI was canceled, not captured — record capture as failed
      await recorderClient.recordCaptureResult(
        resolved.action_id, 'failed', stripeResult.raw,
        null, genOpId(webhook_event_id, resolved.action_id),
        await genReqHash('capture', resolved.action_id, 'failed')
      );
      return { processed: true, incident: false };
    }
    // Rule 7: indeterminate — retryable
    return { processed: false, retryable: true, error: 'stripe state indeterminate: ' + (stripeResult.raw?.pi_status || 'unknown') };
  }

  if (actionType === 'cancel') {
    stripeResult = await stripeProvider.retrievePaymentIntentState(payment_intent_id);
    if (stripeResult.derived === 'canceled') {
      await recorderClient.recordCancelResult(
        resolved.action_id, 'succeeded', stripeResult.raw,
        null, genOpId(webhook_event_id, resolved.action_id),
        await genReqHash('cancel', resolved.action_id, 'succeeded')
      );
      return { processed: true, incident: false };
    }
    if (stripeResult.derived === 'succeeded') {
      // PI was captured, not canceled — record cancel as failed
      await recorderClient.recordCancelResult(
        resolved.action_id, 'failed', stripeResult.raw,
        null, genOpId(webhook_event_id, resolved.action_id),
        await genReqHash('cancel', resolved.action_id, 'failed')
      );
      return { processed: true, incident: false };
    }
    return { processed: false, retryable: true, error: 'stripe state indeterminate: ' + (stripeResult.raw?.pi_status || 'unknown') };
  }

  if (actionType === 'refund') {
    stripeResult = await stripeProvider.retrieveRefundState(payment_intent_id);
    if (stripeResult.derived === 'refunded') {
      await recorderClient.recordRefundResult(
        resolved.action_id, 'succeeded', stripeResult.raw,
        null, genOpId(webhook_event_id, resolved.action_id),
        await genReqHash('refund', resolved.action_id, 'succeeded')
      );
      return { processed: true, incident: false };
    }
    return { processed: false, retryable: true, error: 'stripe state indeterminate: ' + (stripeResult.raw?.charge_status || 'unknown') };
  }

  return { processed: false, retryable: true, error: 'unknown action type: ' + actionType };
}

/**
 * Main processor loop — drains durable pending webhook events.
 * @param {object} deps
 * @param {object} deps.executorClient - createAuthorityV1Client result
 * @param {object} deps.recorderClient - createAuthorityV1StripeRecorderClient result
 * @param {object} deps.stripeProvider - createStripeWebhookProvider result (or fake)
 * @param {string} [deps.workerId] - worker identifier for lease claiming
 * @param {number} [deps.maxEvents] - max events to process per run (default 10)
 * @param {number} [deps.leaseSeconds] - lease duration (default 60)
 * @returns {Promise<{claimed, processed, replayed, incidents, retried, escalated}>}
 */
export async function processWebhookEvents(deps) {
  const {
    executorClient, recorderClient, stripeProvider,
    workerId = 'pg-webhook-processor', maxEvents = 10, leaseSeconds = 60,
  } = deps;

  const results = { claimed: 0, processed: 0, replayed: 0, incidents: 0, retried: 0, escalated: 0 };

  // ── Recover expired leases (crash recovery) ──────────────────────────────
  try { await executorClient.recoverExpiredWebhookLeases(); } catch (_) {}

  // ── Escalate exhausted events (max attempts → incident) ──────────────────
  try {
    const escalated = await executorClient.escalateExhaustedWebhookEvent();
    results.escalated = Number(escalated) || 0;
  } catch (_) {}

  for (let i = 0; i < maxEvents; i++) {
    // ── Claim one event (serialized by FOR UPDATE SKIP LOCKED) ─────────────
    let claimed;
    try {
      claimed = await executorClient.claimWebhookEvent(workerId, leaseSeconds);
    } catch (_) { break; }
    if (!claimed || claimed.length === 0) break; // no more pending events
    const event = claimed[0];
    results.claimed++;

    let outcome;
    try {
      outcome = await processOneEvent({ executorClient, recorderClient, stripeProvider, event, workerId });
    } catch (e) {
      // Crash during processing — event stays 'processing' for lease recovery.
      // Rule 8: a crash after recorder commit but before completion replays
      // safely — the next run finds already_applied and completes once.
      results.retried++;
      continue;
    }

    if (outcome.processed) {
      try {
        await executorClient.completeWebhookEvent(event.webhook_event_id, true, null);
      } catch (_) {}
      results.processed++;
      if (outcome.replay) results.replayed++;
      if (outcome.incident) results.incidents++;
    } else if (outcome.retryable) {
      try {
        await executorClient.completeWebhookEvent(event.webhook_event_id, false, outcome.error || 'retryable');
      } catch (_) {}
      results.retried++;
    }
  }

  return results;
}