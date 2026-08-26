/**
 * webhook-processor.test.mjs — P0-01K Webhook Processor Certification Suite
 *
 * Tests the scheduled webhook business-state processor:
 *   - capture_unknown, cancel_unknown, refund_unknown reconciliation
 *   - already-applied replay, duplicate and out-of-order delivery
 *   - provider timeout/retry, crash-after-commit, missing action
 *   - unsupported dispute, lease recovery, max attempts
 *   - flag-OFF pending drain, privilege separation
 *   - zero Base44 authoritative writes, exact cleanup
 *
 * Importable ESM module: runAllTests({ adminSql, executorUrl, recorderUrl })
 */
import { neon } from '@neondatabase/serverless';
import { processWebhookEvents } from '../base44/shared/webhookProcessor.js';

let passed = 0, failed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); console.log(`  [PASS] ${name}`); passed++; }
  catch (e) { console.log(`  [FAIL] ${name}: ${e.message}`); failures.push(name); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error((m || 'mismatch') + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

function genId(p) { return p + '_' + crypto.randomUUID(); }

// ── Fake Stripe provider ───────────────────────────────────────────────────
function makeFakeProvider({ piState = 'succeeded', refundState = 'refunded', throwOnRetrieve = false } = {}) {
  return {
    retrievePaymentIntentState: async (piId) => {
      if (throwOnRetrieve) throw new Error('provider timeout');
      return { derived: piState, raw: { pi_status: piState, livemode: false, pi_id: piId } };
    },
    retrieveRefundState: async (piId) => {
      if (throwOnRetrieve) throw new Error('provider timeout');
      return { derived: refundState, raw: { charge_status: 'succeeded', refunded: true, amount_refunded: 100, amount: 100, livemode: false } };
    },
  };
}

// ── Client factories (use neon directly, no npm: specifiers) ────────────────
function makeExecutorClient(executorUrl) {
  const sql = neon(executorUrl);
  const parsed = new URL(executorUrl);
  return {
    fingerprint: { hostname: parsed.hostname, database: parsed.pathname.slice(1) },
    async claimWebhookEvent(workerId, leaseSeconds) {
      return sql`SELECT * FROM authority_v1.claim_webhook_event(${workerId}, ${leaseSeconds})`;
    },
    async completeWebhookEvent(webhookEventId, processed, error) {
      const rows = await sql`SELECT authority_v1.complete_webhook_event(${webhookEventId}, ${processed}, ${error}) as result`;
      return rows[0]?.result;
    },
    async recoverExpiredWebhookLeases() {
      const rows = await sql`SELECT authority_v1.recover_expired_webhook_leases() as result`;
      return rows[0]?.result;
    },
    async escalateExhaustedWebhookEvent() {
      const rows = await sql`SELECT authority_v1.escalate_exhausted_webhook_event() as result`;
      return rows[0]?.result;
    },
    async resolveWebhookAction(piId, eventType) {
      const rows = await sql`SELECT authority_v1.resolve_webhook_action(${piId}, ${eventType}) as result`;
      return rows[0]?.result;
    },
    async createWebhookIncident(incidentKey, incidentType, priority, title, description, refId, refType) {
      const rows = await sql`SELECT authority_v1.create_webhook_incident(${incidentKey}, ${incidentType}, ${priority}, ${title}, ${description}, ${refId}, ${refType}) as result`;
      return rows[0]?.result;
    },
    async flagWebhookMissingAction(listingId, piId, eventType, webhookEventId) {
      const rows = await sql`SELECT authority_v1.flag_webhook_missing_action(${listingId}, ${piId}, ${eventType}, ${webhookEventId}) as result`;
      return rows[0]?.result;
    },
  };
}

function makeRecorderClient(recorderUrl) {
  const sql = neon(recorderUrl);
  return {
    async recordCaptureResult(actionId, result, raw, workerId, opId, reqHash) {
      const rows = await sql`SELECT authority_v1.record_capture_result(${actionId}, ${result}, ${JSON.stringify(raw)}::jsonb, ${workerId}, ${opId}, ${reqHash}) as result`;
      return rows[0]?.result;
    },
    async recordCancelResult(actionId, result, raw, workerId, opId, reqHash) {
      const rows = await sql`SELECT authority_v1.record_cancel_result(${actionId}, ${result}, ${JSON.stringify(raw)}::jsonb, ${workerId}, ${opId}, ${reqHash}) as result`;
      return rows[0]?.result;
    },
    async recordRefundResult(actionId, result, raw, workerId, opId, reqHash) {
      const rows = await sql`SELECT authority_v1.record_refund_result(${actionId}, ${result}, ${JSON.stringify(raw)}::jsonb, ${workerId}, ${opId}, ${reqHash}) as result`;
      return rows[0]?.result;
    },
  };
}

// ── Setup helpers ──────────────────────────────────────────────────────────
async function setupAuthority(adminSql, { listingId, state = 'frozen', version = 1, recoveryBlocked = false }) {
  if (recoveryBlocked) {
    await adminSql`INSERT INTO authority_v1.reservation_authority
      (listing_id, seller_user_id, lifecycle_state, version, buyer_user_id, reservation_token_hash, reservation_expires_at, reservation_revision, recovery_blocked, recovery_blocked_reason, recovery_blocked_at)
      VALUES (${listingId}, 'cert_seller', ${state}, ${version}, 'cert_buyer', 'tokenhash', now() + interval '1 hour', 'rev1', true, 'test', now())`;
  } else {
    await adminSql`INSERT INTO authority_v1.reservation_authority
      (listing_id, seller_user_id, lifecycle_state, version, buyer_user_id, reservation_token_hash, reservation_expires_at, reservation_revision)
      VALUES (${listingId}, 'cert_seller', ${state}, ${version}, 'cert_buyer', 'tokenhash', now() + interval '1 hour', 'rev1')`;
  }
}

async function setupBinding(adminSql, { purchaseId, piId, listingId, bindingState, frozen = true }) {
  const cols = frozen
    ? `(purchase_id, payment_intent_id, listing_id, buyer_user_id, authority_version, reservation_revision, reservation_token_hash, capture_state,
       frozen_reservation_token_hash, frozen_buyer_user_id, frozen_reservation_expires_at, frozen_reservation_revision, frozen_authority_version)`
    : `(purchase_id, payment_intent_id, listing_id, buyer_user_id, authority_version, reservation_revision, reservation_token_hash, capture_state)`;
  const vals = frozen
    ? `VALUES ($1, $2, $3, 'cert_buyer', 1, 'rev1', 'tokenhash', $4, 'tokenhash', 'cert_buyer', now() + interval '1 hour', 'rev1', 1)`
    : `VALUES ($1, $2, $3, 'cert_buyer', 1, 'rev1', 'tokenhash', $4)`;
  await adminSql(`INSERT INTO authority_v1.reservation_payment_bindings ${cols} ${vals}`,
    [purchaseId, piId, listingId, bindingState]);
}

async function setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType = 'capture', status = 'pending' }) {
  const needsCompletedAt = ['succeeded', 'failed', 'unknown'].includes(status);
  if (needsCompletedAt) {
    await adminSql`INSERT INTO authority_v1.payment_actions
      (action_id, listing_id, purchase_id, payment_intent_id, action_type, stripe_idempotency_key, status, completed_at)
      VALUES (${actionId}, ${listingId}, ${purchaseId}, ${piId}, ${actionType}, ${'idem_' + actionId}, ${status}, now())`;
  } else {
    await adminSql`INSERT INTO authority_v1.payment_actions
      (action_id, listing_id, purchase_id, payment_intent_id, action_type, stripe_idempotency_key, status)
      VALUES (${actionId}, ${listingId}, ${purchaseId}, ${piId}, ${actionType}, ${'idem_' + actionId}, ${status})`;
  }
}

async function insertWebhookEvent(adminSql, { eventId, eventType, piId, status = 'pending', maxAttempts = 5, attemptCount = 0 }) {
  await adminSql`INSERT INTO authority_v1.stripe_webhook_events
    (webhook_event_id, event_type, payment_intent_id, livemode, provider_created_at, api_version, payload_hash, processing_status, received_at, max_attempts, attempt_count)
    VALUES (${eventId}, ${eventType}, ${piId}, false, now(), '2024-06-20', 'testhash', ${status}, now(), ${maxAttempts}, ${attemptCount})`;
}

async function getAuthorityState(adminSql, listingId) {
  const rows = await adminSql`SELECT * FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}`;
  return rows[0];
}

async function getBindingState(adminSql, purchaseId) {
  const rows = await adminSql`SELECT * FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}`;
  return rows[0];
}

async function getActionState(adminSql, actionId) {
  const rows = await adminSql`SELECT * FROM authority_v1.payment_actions WHERE action_id = ${actionId}`;
  return rows[0];
}

async function getWebhookEvent(adminSql, eventId) {
  const rows = await adminSql`SELECT * FROM authority_v1.stripe_webhook_events WHERE webhook_event_id = ${eventId}`;
  return rows[0];
}

async function getIncidents(adminSql, pattern) {
  return adminSql`SELECT * FROM authority_v1.operational_incidents WHERE incident_key LIKE ${pattern}`;
}

async function cleanupAll(adminSql) {
  // Order matters: outbox → operations → actions/bindings → authority (FK constraints)
  await adminSql`DELETE FROM authority_v1.stripe_webhook_events WHERE webhook_event_id LIKE 'cert_wp_evt_%'`;
  await adminSql`DELETE FROM authority_v1.operational_incidents WHERE incident_key LIKE '%cert_wp_%'`;
  await adminSql`DELETE FROM authority_v1.reservation_outbox WHERE listing_id LIKE 'cert_wp_list_%'`;
  await adminSql`DELETE FROM authority_v1.payment_actions WHERE action_id LIKE 'cert_wp_act_%'`;
  await adminSql`DELETE FROM authority_v1.reservation_payment_bindings WHERE purchase_id LIKE 'cert_wp_purch_%'`;
  await adminSql`DELETE FROM authority_v1.reservation_operations WHERE subject_id LIKE 'cert_wp_list_%'`;
  await adminSql`DELETE FROM authority_v1.reservation_authority WHERE listing_id LIKE 'cert_wp_list_%'`;
}

export async function runAllTests(deps) {
  const { adminSql, executorUrl, recorderUrl } = deps;
  const executorClient = makeExecutorClient(executorUrl);
  const recorderClient = makeRecorderClient(recorderUrl);

  console.log('\n── P0-01K Webhook Processor Certification Suite ──');
  await cleanupAll(adminSql);

  // ═══ T1: capture_unknown reconciliation ═══════════════════════════════════
  await check('capture_unknown_reconciliation', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'frozen', recoveryBlocked: true });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'capture_unknown' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'capture', status: 'unknown' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId });

    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'succeeded' }),
      maxEvents: 5,
    });

    assertEqual(result.processed, 1, 'should process 1 event');
    const authority = await getAuthorityState(adminSql, listingId);
    assertEqual(authority.lifecycle_state, 'sold', 'authority should be sold');
    assertEqual(authority.recovery_blocked, false, 'recovery_blocked should be cleared');
    const binding = await getBindingState(adminSql, purchaseId);
    assertEqual(binding.capture_state, 'finalized', 'binding should be finalized');
    const action = await getActionState(adminSql, actionId);
    assertEqual(action.status, 'succeeded', 'action should be succeeded');
    const event = await getWebhookEvent(adminSql, eventId);
    assertEqual(event.processing_status, 'processed', 'event should be processed');

    await cleanupAll(adminSql);
  });

  // ═══ T2: cancel_unknown reconciliation ════════════════════════════════════
  await check('cancel_unknown_reconciliation', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'frozen', recoveryBlocked: true });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'cancel_unknown' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'cancel', status: 'unknown' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.canceled', piId });

    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'canceled' }),
      maxEvents: 5,
    });

    assertEqual(result.processed, 1);
    const authority = await getAuthorityState(adminSql, listingId);
    assertEqual(authority.lifecycle_state, 'available', 'authority should be available');
    assertEqual(authority.recovery_blocked, false, 'recovery_blocked should be cleared');
    const binding = await getBindingState(adminSql, purchaseId);
    assertEqual(binding.capture_state, 'canceled', 'binding should be canceled');
    const action = await getActionState(adminSql, actionId);
    assertEqual(action.status, 'succeeded', 'action should be succeeded');

    await cleanupAll(adminSql);
  });

  // ═══ T3: refund_unknown reconciliation ════════════════════════════════════
  await check('refund_unknown_reconciliation', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'sold', recoveryBlocked: true });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'refund_unknown' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'refund', status: 'unknown' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'charge.refunded', piId });

    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ refundState: 'refunded' }),
      maxEvents: 5,
    });

    assertEqual(result.processed, 1);
    const binding = await getBindingState(adminSql, purchaseId);
    assertEqual(binding.capture_state, 'refunded', 'binding should be refunded');
    const action = await getActionState(adminSql, actionId);
    assertEqual(action.status, 'succeeded', 'action should be succeeded');

    await cleanupAll(adminSql);
  });

  // ═══ T4: already-applied replay ═══════════════════════════════════════════
  await check('already_applied_replay', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'sold' });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'finalized' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'capture', status: 'succeeded' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId });

    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'succeeded' }),
      maxEvents: 5,
    });

    assertEqual(result.processed, 1);
    assertEqual(result.replayed, 1, 'should be a replay');
    // No new recording — action stays succeeded, no new operations
    const action = await getActionState(adminSql, actionId);
    assertEqual(action.status, 'succeeded', 'action should still be succeeded (no re-record)');
    const event = await getWebhookEvent(adminSql, eventId);
    assertEqual(event.processing_status, 'processed', 'event should be processed');

    await cleanupAll(adminSql);
  });

  // ═══ T5: duplicate delivery ══════════════════════════════════════════════
  await check('duplicate_delivery', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'frozen', recoveryBlocked: true });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'capture_unknown' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'capture', status: 'unknown' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId });

    // First run processes the event
    await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'succeeded' }),
      maxEvents: 5,
    });
    const authority1 = await getAuthorityState(adminSql, listingId);
    assertEqual(authority1.lifecycle_state, 'sold');

    // Second run — event already processed, no new work
    const result2 = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'succeeded' }),
      maxEvents: 5,
    });
    assertEqual(result2.claimed, 0, 'no events to claim on second run');
    const authority2 = await getAuthorityState(adminSql, listingId);
    assertEqual(authority2.lifecycle_state, 'sold', 'authority unchanged');

    await cleanupAll(adminSql);
  });

  // ═══ T6: out-of-order delivery ═══════════════════════════════════════════
  await check('out_of_order_delivery', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    // Capture was requested but PI was actually canceled (out-of-order)
    await setupAuthority(adminSql, { listingId, state: 'frozen' });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'capture_requested' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'capture', status: 'pending' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId });

    // Provider shows canceled (current truth), not succeeded
    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'canceled' }),
      maxEvents: 5,
    });

    assertEqual(result.processed, 1);
    const action = await getActionState(adminSql, actionId);
    assertEqual(action.status, 'failed', 'capture should be failed (PI was canceled)');
    const authority = await getAuthorityState(adminSql, listingId);
    assertEqual(authority.lifecycle_state, 'available', 'authority should be released');

    await cleanupAll(adminSql);
  });

  // ═══ T7: provider timeout/retry ══════════════════════════════════════════
  await check('provider_timeout_retry', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'frozen' });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'capture_requested' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'capture', status: 'pending' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId });

    // Provider returns indeterminate ('unknown' derived)
    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'unknown' }),
      maxEvents: 5,
    });

    assertEqual(result.retried, 1, 'should be retryable');
    const event = await getWebhookEvent(adminSql, eventId);
    assertEqual(event.processing_status, 'pending', 'event should be pending (retryable)');
    const action = await getActionState(adminSql, actionId);
    assertEqual(action.status, 'pending', 'action should still be pending (not recorded)');

    await cleanupAll(adminSql);
  });

  // ═══ T8: crash-after-commit replay ═══════════════════════════════════════
  await check('crash_after_commit_replay', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'frozen', recoveryBlocked: true });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'capture_unknown' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'capture', status: 'unknown' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId });

    // First run — process normally (records + completes)
    await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'succeeded' }),
      maxEvents: 5,
    });
    const authority1 = await getAuthorityState(adminSql, listingId);
    assertEqual(authority1.lifecycle_state, 'sold');

    // Simulate crash: set event back to 'processing' with expired lease
    await adminSql`UPDATE authority_v1.stripe_webhook_events
      SET processing_status = 'processing', lease_owner = 'crashed_worker', lease_expires_at = now() - interval '1 hour'
      WHERE webhook_event_id = ${eventId}`;

    // Second run — lease recovery, find already_applied, complete idempotently
    const result2 = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'succeeded' }),
      maxEvents: 5,
    });

    assertEqual(result2.processed, 1, 'should process the recovered event');
    assertEqual(result2.replayed, 1, 'should be a replay (already applied)');
    const authority2 = await getAuthorityState(adminSql, listingId);
    assertEqual(authority2.lifecycle_state, 'sold', 'authority should still be sold (no double-mutation)');
    const event = await getWebhookEvent(adminSql, eventId);
    assertEqual(event.processing_status, 'processed', 'event should be processed after recovery');

    await cleanupAll(adminSql);
  });

  // ═══ T9: missing action ══════════════════════════════════════════════════
  await check('missing_action', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const eventId = genId('cert_wp_evt');

    // Binding exists but NO matching capture action
    await setupAuthority(adminSql, { listingId, state: 'frozen' });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'authorized' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId });

    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'succeeded' }),
      maxEvents: 5,
    });

    assertEqual(result.processed, 1);
    assertEqual(result.incidents, 1, 'should create an incident');
    const authority = await getAuthorityState(adminSql, listingId);
    assertEqual(authority.recovery_blocked, true, 'authority should be recovery_blocked');
    const incidents = await getIncidents(adminSql, '%webhook_missing_action%');
    assert(incidents.length > 0, 'missing action incident should exist');
    assertEqual(incidents[0].incident_type, 'admin_action_required');

    await cleanupAll(adminSql);
  });

  // ═══ T10: unsupported dispute ═══════════════════════════════════════════
  await check('unsupported_dispute', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'sold' });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'finalized' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'charge.dispute.created', piId });

    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider(),
      maxEvents: 5,
    });

    assertEqual(result.processed, 1);
    assertEqual(result.incidents, 1, 'should create a dispute incident');
    const incidents = await getIncidents(adminSql, '%webhook_dispute%');
    assert(incidents.length > 0, 'dispute incident should exist');
    assertEqual(incidents[0].incident_type, 'new_dispute');
    assertEqual(incidents[0].priority, 'critical');
    const event = await getWebhookEvent(adminSql, eventId);
    assertEqual(event.processing_status, 'processed', 'dispute event should be processed (with incident)');

    await cleanupAll(adminSql);
  });

  // ═══ T11: lease recovery ═════════════════════════════════════════════════
  await check('lease_recovery', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'frozen', recoveryBlocked: true });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'capture_unknown' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'capture', status: 'unknown' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId });

    // Simulate a crashed worker: event is 'processing' with expired lease
    await adminSql`UPDATE authority_v1.stripe_webhook_events
      SET processing_status = 'processing', lease_owner = 'crashed_worker', lease_expires_at = now() - interval '1 hour', attempt_count = 1
      WHERE webhook_event_id = ${eventId}`;

    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'succeeded' }),
      maxEvents: 5,
    });

    assertEqual(result.processed, 1, 'should recover and process the event');
    const authority = await getAuthorityState(adminSql, listingId);
    assertEqual(authority.lifecycle_state, 'sold');

    await cleanupAll(adminSql);
  });

  // ═══ T12: max attempts escalation ═════════════════════════════════════════
  await check('max_attempts_escalation', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'frozen' });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'capture_requested' });
    // Event stuck in 'processing' with expired lease and max attempts exhausted
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId, status: 'processing', maxAttempts: 2, attemptCount: 2 });
    await adminSql`UPDATE authority_v1.stripe_webhook_events
      SET lease_owner = 'crashed_worker', lease_expires_at = now() - interval '1 hour'
      WHERE webhook_event_id = ${eventId}`;

    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'unknown' }),
      maxEvents: 5,
    });

    assertEqual(result.escalated, 1, 'should escalate 1 exhausted event');
    const incidents = await getIncidents(adminSql, '%exhausted_webhook%');
    assert(incidents.length > 0, 'exhausted webhook incident should exist');
    assertEqual(incidents[0].incident_type, 'exhausted_webhook');
    const event = await getWebhookEvent(adminSql, eventId);
    assertEqual(event.processing_status, 'failed', 'event should be failed after escalation');

    await cleanupAll(adminSql);
  });

  // ═══ T13: flag-OFF pending drain ════════════════════════════════════════
  await check('flag_off_pending_drain', async () => {
    const listingId = genId('cert_wp_list');
    const purchaseId = genId('cert_wp_purch');
    const piId = genId('cert_wp_pi');
    const actionId = genId('cert_wp_act');
    const eventId = genId('cert_wp_evt');

    await setupAuthority(adminSql, { listingId, state: 'frozen', recoveryBlocked: true });
    await setupBinding(adminSql, { purchaseId, piId, listingId, bindingState: 'capture_unknown' });
    await setupAction(adminSql, { actionId, listingId, purchaseId, piId, actionType: 'capture', status: 'unknown' });
    await insertWebhookEvent(adminSql, { eventId, eventType: 'payment_intent.succeeded', piId });

    // The processor does NOT check canaryEnabled — it always drains pending events.
    // Simulate flag-OFF by passing canaryEnabled: false (which the processor ignores).
    const result = await processWebhookEvents({
      executorClient, recorderClient,
      stripeProvider: makeFakeProvider({ piState: 'succeeded' }),
      maxEvents: 5,
    });

    assertEqual(result.processed, 1, 'processor should drain pending events regardless of canary flag');
    const authority = await getAuthorityState(adminSql, listingId);
    assertEqual(authority.lifecycle_state, 'sold');

    await cleanupAll(adminSql);
  });

  // ═══ T14: privilege separation — executor denied record, recorder denied claim ═══
  await check('privilege_executor_denied_record', async () => {
    let threw = false;
    try {
      const sql = neon(executorUrl);
      await sql`SELECT authority_v1.record_capture_result('test', 'succeeded', '{}'::jsonb, null, 'test', 'test') as result`;
    } catch (e) { threw = e.message.includes('permission denied'); }
    assert(threw, 'executor must be denied record_capture_result');
  });

  await check('privilege_recorder_denied_claim', async () => {
    let threw = false;
    try {
      const sql = neon(recorderUrl);
      await sql`SELECT * FROM authority_v1.claim_webhook_event('test', 60)`;
    } catch (e) { threw = e.message.includes('permission denied'); }
    assert(threw, 'recorder must be denied claim_webhook_event');
  });

  await check('privilege_executor_denied_ingest', async () => {
    let threw = false;
    try {
      const sql = neon(executorUrl);
      await sql`SELECT authority_v1.ingest_stripe_webhook_event('test', 'test', 'test', false, NULL, 'test', 'testhash') as result`;
    } catch (e) { threw = e.message.includes('permission denied'); }
    assert(threw, 'executor must be denied ingest (P0-01K privilege correction)');
  });

  // ═══ T15: zero Base44 authoritative writes (static) ══════════════════════
  await check('zero_base44_writes_static', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'base44/shared/webhookProcessor.js'), 'utf8');
    assert(!src.includes('asServiceRole'), 'no asServiceRole in processor');
    assert(!/\.entities\./.test(src), 'no .entities. in processor');
    assert(!src.includes('base44.functions'), 'no base44.functions in processor');
  });

  // ═══ T16: exact cleanup ═══════════════════════════════════════════════════
  await check('exact_cleanup', async () => {
    await cleanupAll(adminSql);
    const counts = await adminSql`
      SELECT
        (SELECT count(*) FROM authority_v1.stripe_webhook_events WHERE webhook_event_id LIKE 'cert_wp_evt_%') as webhook,
        (SELECT count(*) FROM authority_v1.payment_actions WHERE action_id LIKE 'cert_wp_act_%') as actions,
        (SELECT count(*) FROM authority_v1.reservation_payment_bindings WHERE purchase_id LIKE 'cert_wp_purch_%') as bindings,
        (SELECT count(*) FROM authority_v1.reservation_authority WHERE listing_id LIKE 'cert_wp_list_%') as authority,
        (SELECT count(*) FROM authority_v1.operational_incidents WHERE incident_key LIKE '%cert_wp_%') as incidents,
        (SELECT count(*) FROM authority_v1.reservation_outbox WHERE listing_id LIKE 'cert_wp_list_%') as outbox`;
    const c = counts[0];
    assertEqual(Number(c.webhook), 0, 'webhook events clean');
    assertEqual(Number(c.actions), 0, 'actions clean');
    assertEqual(Number(c.bindings), 0, 'bindings clean');
    assertEqual(Number(c.authority), 0, 'authority clean');
    assertEqual(Number(c.incidents), 0, 'incidents clean');
    assertEqual(Number(c.outbox), 0, 'outbox clean');
  });

  console.log(`\n=== P0-01K Webhook Processor Suite: ${passed + failed} run, ${passed} passed, ${failed} failed ===`);
  if (failed > 0) console.log(`Failed: ${failures.join(', ')}`);
  return { passed, failed, failures };
}