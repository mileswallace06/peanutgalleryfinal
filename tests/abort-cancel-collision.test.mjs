/**
 * P0-01T-CORRECTIVE-4: Abort/Cancel No-Relist Collision Tests
 *
 * Validates that the no-relist invariant covers abort_binding, begin_cancel,
 * and record_cancel_result — not only capture failure. When the buyer has
 * confirmed receipt (transfer_state = 'buyer_confirmed_received'), these
 * operations must NEVER release the listing back to available.
 *
 * Test scenarios:
 *   AC1: abort_binding after buyer confirmation → frozen, recovery_blocked, NO release
 *   AC2: begin_cancel after buyer confirmation → CANCEL_REJECTED_BUYER_CONFIRMED
 *   AC3: record_cancel_result succeeded after buyer confirmation → frozen, recovery_blocked, NO release
 *   AC4: Direct frozen-retry proof — capture retry on frozen listing preserves frozen state
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';
import { createHash, randomUUID } from 'node:crypto';

function sha256Hex(text) {
  return createHash('sha-256').update(text).digest('hex');
}
function genId() {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}
function genEmail(prefix = 'user') {
  return `${prefix}_${genId()}@test.peanutgallery.app`;
}

async function cleanupAll(adminSql) {
  await adminSql`DELETE FROM authority_v1.reservation_outbox`;
  await adminSql`DELETE FROM authority_v1.stripe_webhook_events`;
  await adminSql`DELETE FROM authority_v1.payment_actions`;
  await adminSql`DELETE FROM authority_v1.operational_incidents`;
  await adminSql`DELETE FROM authority_v1.reservation_payment_bindings`;
  await adminSql`DELETE FROM authority_v1.reservation_operations`;
  await adminSql`DELETE FROM authority_v1.reservation_authority`;
}

async function getAuthorityState(adminSql, listingId) {
  const rows = await adminSql`
    SELECT version, lifecycle_state, transfer_state, buyer_user_id, buyer_confirmed_at,
           recovery_blocked, recovery_blocked_reason, seller_user_id
    FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}
  `;
  return rows[0] || null;
}

async function getBindingState(adminSql, purchaseId) {
  const rows = await adminSql`
    SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}
  `;
  return rows[0] || null;
}

export async function runAllTests({ adminSql, executorUrl }) {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  P0-01T-CORRECTIVE-4: Abort/Cancel No-Relist Collision Tests');
  console.log('═══════════════════════════════════════════════════════════════════');

  let passed = 0, failed = 0;
  const failures = [];

  function assert(name, cond, details) {
    if (cond) { passed++; }
    else { failed++; failures.push(`${name}: ${details || 'assertion failed'}`); console.error(`  [FAIL] ${name}: ${details}`); }
  }

  const { createAuthorityV1Client } = await import('../base44/shared/authorityV1Client.js');
  const executorClient = createAuthorityV1Client(executorUrl);

  // ── Setup helper: create a frozen listing with buyer_confirmed_received ──
  async function setupFrozenWithBuyerConfirmed(prefix) {
    const listingId = `ac_${prefix}_${genId()}`;
    const sellerId = genEmail('seller');
    const buyerId = genEmail('buyer');
    const tokenHash = sha256Hex(`token_${prefix}_${genId()}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const purchaseId = `pur_${prefix}_${genId()}`;
    const paymentIntentId = `pi_${prefix}_${genId()}`;

    // 1. Initialize listing
    const initOpId = `op_init_${listingId}_${genId()}`;
    const initHash = sha256Hex(JSON.stringify({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
    await executorClient.initializeListing(listingId, sellerId, initOpId, initHash);

    // 2. Reserve listing
    const reserveOpId = `op_reserve_${listingId}_${genId()}`;
    const reserveHash = sha256Hex(JSON.stringify({ op: 'reserve', listing_id: listingId, expected_version: 0, buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt }));
    const reserveResult = await executorClient.reserveListing(listingId, 0, buyerId, tokenHash, expiresAt, reserveOpId, reserveHash);
    const revision = reserveResult?.revision;

    // 3. Bind payment intent
    const bindOpId = `op_bind_${listingId}_${genId()}`;
    const bindHash = sha256Hex(JSON.stringify({ op: 'bind', listing_id: listingId, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, authority_version: 1, reservation_revision: revision, token_hash: tokenHash }));
    await executorClient.bindPaymentIntent(listingId, purchaseId, paymentIntentId, buyerId, 1, revision, tokenHash, bindOpId, bindHash);

    // 4. Begin capture (reserved → frozen)
    const actionId = `act_capture_${prefix}_${genId()}`;
    const stripeIdemKey = `idem_capture_${actionId}`;
    const beginOpId = `op_begin_${listingId}_${genId()}`;
    const beginHash = sha256Hex(JSON.stringify({ op: 'begin_capture', listing_id: listingId, expected_version: 1, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, action_id: actionId, idem_key: stripeIdemKey }));
    await executorClient.beginCapture(listingId, 1, purchaseId, paymentIntentId, buyerId, revision, actionId, stripeIdemKey, beginOpId, beginHash);

    // 5. Begin transfer + record seller report
    const transferOpId = `op_transfer_${listingId}_${genId()}`;
    const transferHash = sha256Hex(JSON.stringify({ op: 'begin_transfer', listing_id: listingId, expected_version: 2, seller_user_id: sellerId }));
    await executorClient.beginTransfer(listingId, 2, sellerId, transferOpId, transferHash);

    const reportOpId = `op_report_${listingId}_${genId()}`;
    const reportHash = sha256Hex(JSON.stringify({ op: 'record_seller_report', listing_id: listingId, expected_version: 3, seller_user_id: sellerId }));
    await executorClient.recordSellerReport(listingId, 3, sellerId, reportOpId, reportHash);

    // 6. Record buyer confirmation (seller_reported_sent → buyer_confirmed_received)
    const confirmOpId = `op_buyer_confirm_${listingId}_${genId()}`;
    const confirmHash = sha256Hex(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 4, buyer_user_id: buyerId, purchase_id: purchaseId }));
    await executorClient.recordBuyerTransferConfirmation(listingId, 4, buyerId, purchaseId, confirmOpId, confirmHash);

    return { listingId, sellerId, buyerId, purchaseId, paymentIntentId, actionId, stripeIdemKey, revision };
  }

  // ── AC1: abort_binding after buyer confirmation → NO release ──────────
  {
    console.log('\n[AC1] abort_binding after buyer confirmation → frozen, NO release');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithBuyerConfirmed('ac1');
    const stateBefore = await getAuthorityState(adminSql, setup.listingId);
    assert('AC1: before: lifecycle=frozen', stateBefore?.lifecycle_state === 'frozen');
    assert('AC1: before: transfer_state=buyer_confirmed_received', stateBefore?.transfer_state === 'buyer_confirmed_received');

    const abortOpId = `op_abort_${setup.listingId}_${genId()}`;
    const abortHash = sha256Hex(JSON.stringify({ op: 'abort', listing_id: setup.listingId, expected_version: stateBefore.version, purchase_id: setup.purchaseId }));
    const abortResult = await executorClient.abortBinding(setup.listingId, stateBefore.version, setup.purchaseId, abortOpId, abortHash);

    assert('AC1: abort ok=true', abortResult?.ok === true, `got ${JSON.stringify(abortResult)}`);
    assert('AC1: abort released=false', abortResult?.released === false, `got ${abortResult?.released}`);
    assert('AC1: abort recovery_blocked=true', abortResult?.recovery_blocked === true, `got ${abortResult?.recovery_blocked}`);
    assert('AC1: abort recovery_blocked_reason=abort_after_buyer_confirmation', abortResult?.recovery_blocked_reason === 'abort_after_buyer_confirmation');

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('AC1: lifecycle still frozen (NOT available)', state?.lifecycle_state === 'frozen', `got ${state?.lifecycle_state}`);
    assert('AC1: recovery_blocked=true', state?.recovery_blocked === true);
    assert('AC1: recovery_blocked_reason=abort_after_buyer_confirmation', state?.recovery_blocked_reason === 'abort_after_buyer_confirmation');

    await cleanupAll(adminSql);
    console.log('  ✅ AC1 passed');
  }

  // ── AC2: begin_cancel after buyer confirmation → rejected ─────────────
  {
    console.log('\n[AC2] begin_cancel after buyer confirmation → CANCEL_REJECTED_BUYER_CONFIRMED');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithBuyerConfirmed('ac2');
    const stateBefore = await getAuthorityState(adminSql, setup.listingId);

    const cancelActionId = `act_cancel_${setup.listingId}_${genId()}`;
    const cancelIdemKey = `idem_cancel_${cancelActionId}`;
    const cancelOpId = `op_begin_cancel_${setup.listingId}_${genId()}`;
    const cancelHash = sha256Hex(JSON.stringify({ op: 'begin_cancel', listing_id: setup.listingId, expected_version: stateBefore.version, purchase_id: setup.purchaseId, payment_intent_id: setup.paymentIntentId, buyer_user_id: setup.buyerId, action_id: cancelActionId, idem_key: cancelIdemKey }));

    const cancelResult = await executorClient.beginCancel(
      setup.listingId, stateBefore.version, setup.purchaseId, setup.paymentIntentId,
      setup.buyerId, stateBefore.reservation_revision, cancelActionId, cancelIdemKey,
      cancelOpId, cancelHash,
    );

    assert('AC2: begin_cancel ok=false', cancelResult?.ok === false, `got ${JSON.stringify(cancelResult)}`);
    assert('AC2: code=CANCEL_REJECTED_BUYER_CONFIRMED', cancelResult?.code === 'CANCEL_REJECTED_BUYER_CONFIRMED', `got ${cancelResult?.code}`);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('AC2: lifecycle still frozen (NOT available)', state?.lifecycle_state === 'frozen');
    assert('AC2: recovery_blocked still false (not blocked by rejection)', state?.recovery_blocked === false);

    await cleanupAll(adminSql);
    console.log('  ✅ AC2 passed');
  }

  // ── AC3: record_cancel_result succeeded after buyer confirmation → NO release ──
  {
    console.log('\n[AC3] record_cancel_result succeeded after buyer confirmation → NO release');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithBuyerConfirmed('ac3');

    // Manually insert a cancel action (bypass begin_cancel which is now blocked)
    const cancelActionId = `act_cancel_${setup.listingId}_${genId()}`;
    const cancelIdemKey = `idem_cancel_${cancelActionId}`;
    await adminSql`
      INSERT INTO authority_v1.payment_actions (action_id, listing_id, purchase_id, payment_intent_id,
        action_type, stripe_idempotency_key, status)
      VALUES (${cancelActionId}, ${setup.listingId}, ${setup.purchaseId}, ${setup.paymentIntentId},
        'cancel', ${cancelIdemKey}, 'pending')
    `;
    // Set binding to cancel_requested
    await adminSql`
      UPDATE authority_v1.reservation_payment_bindings
      SET capture_state = 'cancel_requested', updated_at = now()
      WHERE purchase_id = ${setup.purchaseId}
    `;

    const stateBefore = await getAuthorityState(adminSql, setup.listingId);
    assert('AC3: before: transfer_state=buyer_confirmed_received', stateBefore?.transfer_state === 'buyer_confirmed_received');

    // Record cancel result as succeeded
    const recordOpId = `op_record_cancel_${setup.listingId}_${genId()}`;
    const recordHash = sha256Hex(JSON.stringify({ op: 'record_cancel', action_id: cancelActionId, result: 'succeeded' }));

    // Use recorder client to record cancel result
    const { createAuthorityV1StripeRecorderClient } = await import('../base44/shared/authorityV1StripeRecorderClient.js');
    const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;
    const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);
    const recordResult = await recorderClient.recordCancelResult(
      cancelActionId, 'succeeded', {}, null, recordOpId, recordHash,
    );

    assert('AC3: record_cancel ok=true', recordResult?.ok === true, `got ${JSON.stringify(recordResult)}`);
    assert('AC3: released=false', recordResult?.released === false, `got ${recordResult?.released}`);
    assert('AC3: recovery_blocked=true', recordResult?.recovery_blocked === true, `got ${recordResult?.recovery_blocked}`);
    assert('AC3: recovery_blocked_reason=cancel_succeeded_after_buyer_confirmation', recordResult?.recovery_blocked_reason === 'cancel_succeeded_after_buyer_confirmation', `got ${recordResult?.recovery_blocked_reason}`);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('AC3: lifecycle still frozen (NOT available)', state?.lifecycle_state === 'frozen', `got ${state?.lifecycle_state}`);
    assert('AC3: recovery_blocked=true', state?.recovery_blocked === true);

    const binding = await getBindingState(adminSql, setup.purchaseId);
    assert('AC3: binding capture_state=canceled', binding?.capture_state === 'canceled', `got ${binding?.capture_state}`);

    await cleanupAll(adminSql);
    console.log('  ✅ AC3 passed');
  }

  // ── AC4: Direct frozen-retry proof — capture retry on frozen listing ──
  {
    console.log('\n[AC4] Direct frozen-retry proof — capture retry preserves frozen state');
    await cleanupAll(adminSql);

    const listingId = `ac4_${genId()}`;
    const sellerId = genEmail('seller');
    const buyerId = genEmail('buyer');
    const tokenHash = sha256Hex(`token_ac4_${genId()}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const purchaseId = `pur_ac4_${genId()}`;
    const paymentIntentId = `pi_ac4_${genId()}`;
    const actionId = `act_capture_ac4_${genId()}`;
    const stripeIdemKey = `idem_capture_${actionId}`;

    // Setup: initialize, reserve, bind, begin_capture
    const initOpId = `op_init_${listingId}_${genId()}`;
    const initHash = sha256Hex(JSON.stringify({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
    await executorClient.initializeListing(listingId, sellerId, initOpId, initHash);

    const reserveOpId = `op_reserve_${listingId}_${genId()}`;
    const reserveHash = sha256Hex(JSON.stringify({ op: 'reserve', listing_id: listingId, expected_version: 0, buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt }));
    const reserveResult = await executorClient.reserveListing(listingId, 0, buyerId, tokenHash, expiresAt, reserveOpId, reserveHash);
    const revision = reserveResult?.revision;

    const bindOpId = `op_bind_${listingId}_${genId()}`;
    const bindHash = sha256Hex(JSON.stringify({ op: 'bind', listing_id: listingId, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, authority_version: 1, reservation_revision: revision, token_hash: tokenHash }));
    await executorClient.bindPaymentIntent(listingId, purchaseId, paymentIntentId, buyerId, 1, revision, tokenHash, bindOpId, bindHash);

    const beginOpId = `op_begin_${listingId}_${genId()}`;
    const beginHash = sha256Hex(JSON.stringify({ op: 'begin_capture', listing_id: listingId, expected_version: 1, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, action_id: actionId, idem_key: stripeIdemKey }));
    await executorClient.beginCapture(listingId, 1, purchaseId, paymentIntentId, buyerId, revision, actionId, stripeIdemKey, beginOpId, beginHash);

    const stateAfterBegin = await getAuthorityState(adminSql, listingId);
    assert('AC4: after begin_capture: lifecycle=frozen', stateAfterBegin?.lifecycle_state === 'frozen');
    assert('AC4: after begin_capture: version=2', stateAfterBegin?.version === 2);

    // Now retry begin_capture with the SAME action_id — should be idempotent replay
    const retryOpId = `op_begin_retry_${listingId}_${genId()}`;
    const retryHash = sha256Hex(JSON.stringify({ op: 'begin_capture', listing_id: listingId, expected_version: 1, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, action_id: actionId, idem_key: stripeIdemKey }));
    const retryResult = await executorClient.beginCapture(listingId, 1, purchaseId, paymentIntentId, buyerId, revision, actionId, stripeIdemKey, retryOpId, retryHash);

    // The retry should either succeed (idempotent) or conflict (version mismatch)
    // In either case, the listing must stay frozen
    assert('AC4: retry result is ok or conflict', retryResult?.ok === true || retryResult?.code === 'CONFLICT', `got ${JSON.stringify(retryResult)}`);

    const stateAfterRetry = await getAuthorityState(adminSql, listingId);
    assert('AC4: after retry: lifecycle still frozen', stateAfterRetry?.lifecycle_state === 'frozen', `got ${stateAfterRetry?.lifecycle_state}`);
    assert('AC4: after retry: version still 2 (no double increment)', stateAfterRetry?.version === 2, `got ${stateAfterRetry?.version}`);

    await cleanupAll(adminSql);
    console.log('  ✅ AC4 passed');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`  Abort/Cancel Collision Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════════');
  if (failed > 0) {
    console.log('  Failures:');
    failures.forEach(f => console.log(`    - ${f}`));
  }

  return { passed, failed, failures };
}