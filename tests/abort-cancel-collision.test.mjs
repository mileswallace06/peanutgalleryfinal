/**
 * P0-01T-CORRECTIVE-4B: Abort/Cancel No-Relist Collision Tests
 *
 * AC1: abort_binding after buyer confirmation → BUYER_CONFIRMED_NO_ABORT, frozen, NO release
 * AC2: begin_cancel after buyer confirmation → CANCEL_REJECTED_BUYER_CONFIRMED (real revision)
 * AC3: record_cancel_result succeeded after buyer confirmation → NO release (injected recorderUrl)
 * AC4: Real frozen routing/saga retry — same action/key reused, exactly one Stripe call
 * AC5: 10-iteration race — buyer confirmation vs succeeded cancellation
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
           recovery_blocked, recovery_blocked_reason, seller_user_id, reservation_revision
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

// Callbacks for credential accumulation
let _recordActionId, _recordIdemKey, _recordBuyerId, _responseBodies;
export function setCredentialCallbacks(callbacks) {
  _recordActionId = callbacks.recordActionId;
  _recordIdemKey = callbacks.recordIdemKey;
  _recordBuyerId = callbacks.recordBuyerId;
  _responseBodies = callbacks.responseBodies;
}

export async function runAllTests({ adminSql, executorUrl, recorderUrl }) {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  P0-01T-CORRECTIVE-4B: Abort/Cancel No-Relist Collision Tests');
  console.log('═══════════════════════════════════════════════════════════════════');

  let passed = 0, failed = 0;
  const failures = [];
  const responseBodies = [];

  function assert(name, cond, details) {
    if (cond) { passed++; }
    else { failed++; failures.push(`${name}: ${details || 'assertion failed'}`); console.error(`  [FAIL] ${name}: ${details}`); }
  }

  const { createAuthorityV1Client } = await import('../base44/shared/authorityV1Client.js');
  const { createAuthorityV1StripeRecorderClient } = await import('../base44/shared/authorityV1StripeRecorderClient.js');
  const executorClient = createAuthorityV1Client(executorUrl);
  // P0-01T-CORRECTIVE-4B: Use injected recorderUrl, never process.env inside the harness
  const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

  // ── Setup helper: create a frozen listing with buyer_confirmed_received ──
  async function setupFrozenWithBuyerConfirmed(prefix) {
    const listingId = `ac_${prefix}_${genId()}`;
    const sellerId = genEmail('seller');
    const buyerId = genEmail('buyer');
    const tokenHash = sha256Hex(`token_${prefix}_${genId()}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const purchaseId = `pur_${prefix}_${genId()}`;
    const paymentIntentId = `pi_${prefix}_${genId()}`;

    if (_recordBuyerId) _recordBuyerId(buyerId);

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
    if (_recordActionId) _recordActionId(actionId);
    if (_recordIdemKey) _recordIdemKey(stripeIdemKey);

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
    responseBodies.push({ test: 'AC1', body: abortResult });

    assert('AC1: abort ok=true', abortResult?.ok === true, `got ${JSON.stringify(abortResult)}`);
    assert('AC1: abort released=false', abortResult?.released === false, `got ${abortResult?.released}`);
    assert('AC1: abort recovery_blocked=true', abortResult?.recovery_blocked === true);
    assert('AC1: abort recovery_blocked_reason=abort_after_buyer_confirmation', abortResult?.recovery_blocked_reason === 'abort_after_buyer_confirmation');

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('AC1: lifecycle still frozen (NOT available)', state?.lifecycle_state === 'frozen', `got ${state?.lifecycle_state}`);
    assert('AC1: recovery_blocked=true', state?.recovery_blocked === true);

    // P0-01T-CORRECTIVE-4B: Verify binding was NOT marked aborted
    const binding = await getBindingState(adminSql, setup.purchaseId);
    // The binding should still be in its pre-abort state (not aborted)
    // abort_binding after buyer_confirmation does NOT mark the binding aborted
    assert('AC1: binding NOT marked aborted', binding?.capture_state !== 'aborted', `got ${binding?.capture_state}`);

    await cleanupAll(adminSql);
    console.log('  ✅ AC1 passed');
  }

  // ── AC2: begin_cancel after buyer confirmation → rejected (real revision) ──
  {
    console.log('\n[AC2] begin_cancel after buyer confirmation → CANCEL_REJECTED_BUYER_CONFIRMED');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithBuyerConfirmed('ac2');
    const stateBefore = await getAuthorityState(adminSql, setup.listingId);

    // P0-01T-CORRECTIVE-4B: Select and pass a real reservation_revision
    const realRevision = stateBefore?.reservation_revision;
    assert('AC2: real reservation_revision exists', !!realRevision, 'reservation_revision is null');

    const cancelActionId = `act_cancel_${setup.listingId}_${genId()}`;
    const cancelIdemKey = `idem_cancel_${cancelActionId}`;
    const cancelOpId = `op_begin_cancel_${setup.listingId}_${genId()}`;
    const cancelHash = sha256Hex(JSON.stringify({ op: 'begin_cancel', listing_id: setup.listingId, expected_version: stateBefore.version, purchase_id: setup.purchaseId, payment_intent_id: setup.paymentIntentId, buyer_user_id: setup.buyerId, action_id: cancelActionId, idem_key: cancelIdemKey }));

    const cancelResult = await executorClient.beginCancel(
      setup.listingId, stateBefore.version, setup.purchaseId, setup.paymentIntentId,
      setup.buyerId, realRevision, cancelActionId, cancelIdemKey,
      cancelOpId, cancelHash,
    );
    responseBodies.push({ test: 'AC2', body: cancelResult });

    assert('AC2: begin_cancel ok=false', cancelResult?.ok === false, `got ${JSON.stringify(cancelResult)}`);
    assert('AC2: code=CANCEL_REJECTED_BUYER_CONFIRMED', cancelResult?.code === 'CANCEL_REJECTED_BUYER_CONFIRMED', `got ${cancelResult?.code}`);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('AC2: lifecycle still frozen (NOT available)', state?.lifecycle_state === 'frozen');
    assert('AC2: recovery_blocked still false (rejection does not block)', state?.recovery_blocked === false);

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
    await adminSql`
      UPDATE authority_v1.reservation_payment_bindings
      SET capture_state = 'cancel_requested', updated_at = now()
      WHERE purchase_id = ${setup.purchaseId}
    `;

    const stateBefore = await getAuthorityState(adminSql, setup.listingId);
    assert('AC3: before: transfer_state=buyer_confirmed_received', stateBefore?.transfer_state === 'buyer_confirmed_received');

    const recordOpId = `op_record_cancel_${setup.listingId}_${genId()}`;
    const recordHash = sha256Hex(JSON.stringify({ op: 'record_cancel', action_id: cancelActionId, result: 'succeeded' }));

    // P0-01T-CORRECTIVE-4B: Use injected recorderClient (never process.env inside harness)
    const recordResult = await recorderClient.recordCancelResult(
      cancelActionId, 'succeeded', {}, null, recordOpId, recordHash,
    );
    responseBodies.push({ test: 'AC3', body: recordResult });

    assert('AC3: record_cancel ok=true', recordResult?.ok === true, `got ${JSON.stringify(recordResult)}`);
    assert('AC3: released=false', recordResult?.released === false, `got ${recordResult?.released}`);
    assert('AC3: recovery_blocked=true', recordResult?.recovery_blocked === true);
    assert('AC3: recovery_blocked_reason=cancel_succeeded_after_buyer_confirmation', recordResult?.recovery_blocked_reason === 'cancel_succeeded_after_buyer_confirmation');

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('AC3: lifecycle still frozen (NOT available)', state?.lifecycle_state === 'frozen', `got ${state?.lifecycle_state}`);
    assert('AC3: recovery_blocked=true', state?.recovery_blocked === true);

    const binding = await getBindingState(adminSql, setup.purchaseId);
    assert('AC3: binding capture_state=canceled', binding?.capture_state === 'canceled');

    await cleanupAll(adminSql);
    console.log('  ✅ AC3 passed');
  }

  // ── AC4: Real frozen routing/saga retry — same action/key reused, one Stripe call ──
  {
    console.log('\n[AC4] Real frozen routing/saga retry — same action/key reused');
    await cleanupAll(adminSql);

    const listingId = `ac4_${genId()}`;
    const sellerId = genEmail('seller');
    const buyerId = genEmail('buyer');
    const tokenHash = sha256Hex(`token_ac4_${genId()}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const purchaseId = `pur_ac4_${genId()}`;
    const paymentIntentId = `pi_ac4_${genId()}`;

    if (_recordBuyerId) _recordBuyerId(buyerId);

    // Setup: initialize, reserve, bind, begin_capture (reserved → frozen)
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

    // Begin capture — this creates the action with authoritative action_id + idem_key
    const beginActionId = `act_capture_ac4_${genId()}`;
    const beginIdemKey = `idem_capture_${beginActionId}`;
    if (_recordActionId) _recordActionId(beginActionId);
    if (_recordIdemKey) _recordIdemKey(beginIdemKey);

    const beginOpId = `op_begin_${listingId}_${genId()}`;
    const beginHash = sha256Hex(JSON.stringify({ op: 'begin_capture', listing_id: listingId, expected_version: 1, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, action_id: beginActionId, idem_key: beginIdemKey }));
    await executorClient.beginCapture(listingId, 1, purchaseId, paymentIntentId, buyerId, revision, beginActionId, beginIdemKey, beginOpId, beginHash);

    const stateAfterBegin = await getAuthorityState(adminSql, listingId);
    assert('AC4: after begin_capture: lifecycle=frozen', stateAfterBegin?.lifecycle_state === 'frozen');

    // Now retry capture via the real saga path — the saga should call
    // getActiveCaptureContext and reuse the SAME authoritative action/key pair.
    // We use a fake Stripe adapter that records the idempotency key used.
    const stripeCalls = [];
    const fakeStripe = {
      async capturePaymentIntent(piId, idemKey) {
        stripeCalls.push({ idemKey });
        return { derived: 'succeeded', raw: { id: piId, status: 'succeeded' } };
      },
    };

    // Create mock entities
    const mockEntities = {
      Listing: { update: async () => {} },
      ListingPrivate: { filter: async () => [], update: async () => {} },
      Purchase: { update: async () => {} },
      CanaryMirrorOutbox: { create: async () => ({}) },
      PurchasePrivate: { filter: async () => [] },
    };

    const { runCanaryCaptureSaga } = await import('../base44/shared/captureCanaryOrchestrator.js');
    const sagaResult = await runCanaryCaptureSaga({
      entities: mockEntities,
      user: { email: buyerId, role: 'admin' },
      executorClient,
      recorderClient,
      stripeAdapter: fakeStripe,
      params: {
        listing_id: listingId,
        purchase_id: purchaseId,
        payment_intent_id: paymentIntentId,
        buyer_user_id: buyerId,
        expected_revision: revision,
      },
    });
    responseBodies.push({ test: 'AC4', body: sagaResult });

    assert('AC4: saga status=200', sagaResult.status === 200, `got ${sagaResult.status}`);
    assert('AC4: saga ok=true', sagaResult.body?.ok === true);
    assert('AC4: saga captured=true', sagaResult.body?.captured === true, `got ${sagaResult.body?.captured}`);
    assert('AC4: saga finalized=true', sagaResult.body?.finalized === true);

    // Exactly one Stripe capture call
    assert('AC4: exactly one Stripe capture call', stripeCalls.length === 1, `got ${stripeCalls.length}`);

    // The idempotency key used by Stripe matches the authoritative key from begin_capture
    // (prove reuse without displaying the key value)
    assert('AC4: Stripe idem key matches authoritative key', stripeCalls[0]?.idemKey === beginIdemKey, 'idem key mismatch');

    // No credential (action_id or idem_key) in the response body
    assert('AC4: no action_id in response', sagaResult.body?.action_id === undefined, `leaked: ${sagaResult.body?.action_id}`);
    assert('AC4: no stripe_idempotency_key in response', sagaResult.body?.stripe_idempotency_key === undefined, `leaked: ${sagaResult.body?.stripe_idempotency_key}`);

    const state = await getAuthorityState(adminSql, listingId);
    assert('AC4: authority lifecycle=sold', state?.lifecycle_state === 'sold', `got ${state?.lifecycle_state}`);

    await cleanupAll(adminSql);
    console.log('  ✅ AC4 passed');
  }

  // ── AC5: 10-iteration race — buyer confirmation vs succeeded cancellation ──
  {
    console.log('\n[AC5] 10-iteration race — buyer confirmation vs succeeded cancellation');
    await cleanupAll(adminSql);

    let raceErrors = 0;
    let buyerConfirmedAvailable = 0; // BAD: buyer_confirmed + available
    let buyerConfirmedFrozen = 0;
    let cancelSucceeded = 0;
    let bothFailed = 0;

    for (let i = 0; i < 10; i++) {
      const listingId = `ac5_${i}_${genId()}`;
      const sellerId = genEmail('seller');
      const buyerId = genEmail('buyer');
      const tokenHash = sha256Hex(`token_ac5_${i}_${genId()}`);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const purchaseId = `pur_ac5_${i}_${genId()}`;
      const paymentIntentId = `pi_ac5_${i}_${genId()}`;

      // Setup: initialize, reserve, bind, begin_capture, begin_transfer, record_seller_report
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

      const actionId = `act_capture_ac5_${i}_${genId()}`;
      const stripeIdemKey = `idem_capture_${actionId}`;
      const beginOpId = `op_begin_${listingId}_${genId()}`;
      const beginHash = sha256Hex(JSON.stringify({ op: 'begin_capture', listing_id: listingId, expected_version: 1, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, action_id: actionId, idem_key: stripeIdemKey }));
      await executorClient.beginCapture(listingId, 1, purchaseId, paymentIntentId, buyerId, revision, actionId, stripeIdemKey, beginOpId, beginHash);

      const transferOpId = `op_transfer_${listingId}_${genId()}`;
      const transferHash = sha256Hex(JSON.stringify({ op: 'begin_transfer', listing_id: listingId, expected_version: 2, seller_user_id: sellerId }));
      await executorClient.beginTransfer(listingId, 2, sellerId, transferOpId, transferHash);

      const reportOpId = `op_report_${listingId}_${genId()}`;
      const reportHash = sha256Hex(JSON.stringify({ op: 'record_seller_report', listing_id: listingId, expected_version: 3, seller_user_id: sellerId }));
      await executorClient.recordSellerReport(listingId, 3, sellerId, reportOpId, reportHash);

      const stateBefore = await getAuthorityState(adminSql, listingId);
      const currentVersion = stateBefore?.version;
      const currentRevision = stateBefore?.reservation_revision;

      // Race: buyer confirmation vs succeeded cancellation
      // For cancellation, we need a cancel action. Manually insert one (begin_cancel would be blocked
      // if buyer confirmation wins first, but we race them concurrently).
      const cancelActionId = `act_cancel_ac5_${i}_${genId()}`;
      const cancelIdemKey = `idem_cancel_${cancelActionId}`;

      // Insert cancel action + set binding to cancel_requested BEFORE the race
      await adminSql`
        INSERT INTO authority_v1.payment_actions (action_id, listing_id, purchase_id, payment_intent_id,
          action_type, stripe_idempotency_key, status)
        VALUES (${cancelActionId}, ${listingId}, ${purchaseId}, ${paymentIntentId},
          'cancel', ${cancelIdemKey}, 'pending')
      `;
      await adminSql`
        UPDATE authority_v1.reservation_payment_bindings
        SET capture_state = 'cancel_requested', updated_at = now()
        WHERE purchase_id = ${purchaseId}
      `;

      const buyerOpId = `op_buyer_confirm_${listingId}_${genId()}`;
      const buyerHash = sha256Hex(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: currentVersion, buyer_user_id: buyerId, purchase_id: purchaseId }));

      const cancelRecordOpId = `op_record_cancel_${listingId}_${genId()}`;
      const cancelRecordHash = sha256Hex(JSON.stringify({ op: 'record_cancel', action_id: cancelActionId, result: 'succeeded' }));

      const [buyerSettled, cancelSettled] = await Promise.allSettled([
        executorClient.recordBuyerTransferConfirmation(listingId, currentVersion, buyerId, purchaseId, buyerOpId, buyerHash),
        recorderClient.recordCancelResult(cancelActionId, 'succeeded', {}, null, cancelRecordOpId, cancelRecordHash),
      ]);

      // Count thrown database errors
      if (buyerSettled.status === 'rejected') raceErrors++;
      if (cancelSettled.status === 'rejected') raceErrors++;

      const finalState = await getAuthorityState(adminSql, listingId);

      // Check for the BAD state: buyer_confirmed + available
      if (finalState?.transfer_state === 'buyer_confirmed_received' && finalState?.lifecycle_state === 'available') {
        buyerConfirmedAvailable++;
      }
      if (finalState?.transfer_state === 'buyer_confirmed_received' && finalState?.lifecycle_state === 'frozen') {
        buyerConfirmedFrozen++;
      }
      if (finalState?.lifecycle_state === 'available' && finalState?.transfer_state !== 'buyer_confirmed_received') {
        cancelSucceeded++;
      }
      if (finalState?.lifecycle_state === 'frozen' && finalState?.transfer_state !== 'buyer_confirmed_received') {
        bothFailed++;
      }
    }

    assert('AC5: zero thrown database errors', raceErrors === 0, `got ${raceErrors} errors`);
    assert('AC5: no buyer-confirmed + available state', buyerConfirmedAvailable === 0, `got ${buyerConfirmedAvailable} bad states`);
    assert('AC5: every iteration reached a definitive state',
      buyerConfirmedFrozen + cancelSucceeded + bothFailed === 10,
      `buyerFrozen=${buyerConfirmedFrozen}, cancelSucceeded=${cancelSucceeded}, bothFailed=${bothFailed}`);

    await cleanupAll(adminSql);
    console.log('  ✅ AC5 passed');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`  Abort/Cancel Collision Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════════');
  if (failed > 0) {
    console.log('  Failures:');
    failures.forEach(f => console.log(`    - ${f}`));
  }

  return { passed, failed, failures, responseBodies };
}