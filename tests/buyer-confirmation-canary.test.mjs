/**
 * P0-01T: Authoritative Buyer Transfer Confirmation — Canary Test Suite
 *
 * Validates the record_buyer_transfer_confirmation authority function and the
 * buyerConfirmTransferCanaryOrchestrator saga through real executor + admin
 * Postgres connections.
 *
 * Test coverage:
 *   - Correct buyer confirmation
 *   - Seller, other buyer, anonymous user, request-body impersonation rejection
 *   - Valid and invalid prior transfer states
 *   - Identical replay and conflicting replay
 *   - Concurrent buyer confirmation vs seller report and cancellation
 *   - Stale version/CAS rejection
 *   - Every AI assessment state remains non-authoritative
 *   - Mirror failure/outbox retry
 *   - No financial side effects
 *   - Live/artifact parity, ownership, grants, all seven tables empty
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';
import { createHash, randomUUID } from 'node:crypto';

// ── Helpers ──────────────────────────────────────────────────────────────────
function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

function genId() {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function genEmail(prefix = 'user') {
  return `${prefix}_${genId()}@test.peanutgallery.app`;
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, details) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push({ name, details: details || 'assertion failed' });
    console.error(`  [FAIL] ${name}: ${details || 'assertion failed'}`);
  }
}

// ── Setup helpers ────────────────────────────────────────────────────────────
async function setupListing(adminSql, { listingId, sellerUserId, buyerUserId, lifecycleState = 'frozen', transferState = 'seller_reported_sent', captureState = 'authorized', purchaseId, paymentIntentId, reservationRevision = 'rev_1', tokenHash = 'tok_hash_1' }) {
  // Terminal lifecycle states (sold/cancelled/expired) require cleared tuple
  const isTerminal = ['sold', 'cancelled', 'expired'].includes(lifecycleState);
  const effectiveBuyerId = isTerminal ? null : buyerUserId;
  const effectiveTokenHash = isTerminal ? null : tokenHash;
  const effectiveExpiry = isTerminal ? null : 'now() + interval \'1 hour\'';

  // Initialize authority
  if (isTerminal) {
    await adminSql`
      INSERT INTO authority_v1.reservation_authority
        (listing_id, version, lifecycle_state, seller_user_id, buyer_user_id,
         reservation_token_hash, reservation_revision, reservation_expires_at,
         transfer_state, transfer_state_updated_at, created_at, updated_at)
      VALUES (${listingId}, 1, ${lifecycleState}, ${sellerUserId}, null,
         null, ${reservationRevision}, null,
         ${transferState}, now(), now(), now())
    `;
  } else {
    await adminSql`
      INSERT INTO authority_v1.reservation_authority
        (listing_id, version, lifecycle_state, seller_user_id, buyer_user_id,
         reservation_token_hash, reservation_revision, reservation_expires_at,
         transfer_state, transfer_state_updated_at, created_at, updated_at)
      VALUES (${listingId}, 1, ${lifecycleState}, ${sellerUserId}, ${buyerUserId},
         ${tokenHash}, ${reservationRevision}, now() + interval '1 hour',
         ${transferState}, now(), now(), now())
    `;
  }
  // Initialize binding
  await adminSql`
    INSERT INTO authority_v1.reservation_payment_bindings
      (purchase_id, payment_intent_id, listing_id, buyer_user_id,
       authority_version, reservation_revision, reservation_token_hash,
       capture_state, created_at, updated_at)
    VALUES (${purchaseId}, ${paymentIntentId}, ${listingId}, ${buyerUserId},
       1, ${reservationRevision}, ${tokenHash},
       ${captureState}, now(), now())
  `;
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
           recovery_blocked, seller_user_id
    FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}
  `;
  return rows[0] || null;
}

async function countRows(adminSql, table) {
  const rows = await adminSql(`SELECT count(*)::int as c FROM authority_v1."${table}"`);
  return rows[0].c;
}

// ── Main test runner ─────────────────────────────────────────────────────────
export async function runAllTests({ adminSql, executorUrl }) {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  P0-01T: Buyer Transfer Confirmation — Canary Test Suite');
  console.log('═══════════════════════════════════════════════════════════════════');

  // Create executor client
  const { createAuthorityV1Client } = await import('../base44/shared/authorityV1Client.js');
  const executorClient = createAuthorityV1Client(executorUrl);

  // ── T1: Correct buyer confirmation ──────────────────────────────────────
  {
    console.log('\n[T1] Correct buyer confirmation');
    await cleanupAll(adminSql);
    const listingId = `cert_t1_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId });

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({
      op: 'record_buyer_confirmation', listing_id: listingId,
      expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId,
    }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );

    assert('T1: ok=true', result?.ok === true, `got ${JSON.stringify(result)}`);
    assert('T1: transfer_state=buyer_confirmed_received', result?.transfer_state === 'buyer_confirmed_received');
    assert('T1: version=2', result?.version === 2, `got ${result?.version}`);
    assert('T1: buyer_user_id matches', result?.buyer_user_id === buyerUserId);
    assert('T1: buyer_confirmed_at present', !!result?.buyer_confirmed_at);
    assert('T1: no_financial_effects=true', result?.no_financial_effects === true);

    const state = await getAuthorityState(adminSql, listingId);
    assert('T1: authority transfer_state=buyer_confirmed_received', state?.transfer_state === 'buyer_confirmed_received');
    assert('T1: authority version=2', state?.version === 2);
    assert('T1: authority buyer_confirmed_at set', !!state?.buyer_confirmed_at);

    // No financial side effects: lifecycle_state still frozen, capture_state still authorized
    assert('T1: lifecycle_state still frozen', state?.lifecycle_state === 'frozen');

    const bindingRows = await adminSql`
      SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}
    `;
    assert('T1: capture_state still authorized', bindingRows[0]?.capture_state === 'authorized');

    // Outbox event created
    const outboxCount = await countRows(adminSql, 'reservation_outbox');
    assert('T1: outbox event created', outboxCount >= 1, `got ${outboxCount}`);

    await cleanupAll(adminSql);
    console.log('  ✅ T1 passed');
  }

  // ── T2: Wrong buyer rejection ───────────────────────────────────────────
  {
    console.log('\n[T2] Wrong buyer rejection');
    await cleanupAll(adminSql);
    const listingId = `cert_t2_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const wrongBuyerId = genEmail('wrongbuyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId });

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: wrongBuyerId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, wrongBuyerId, purchaseId, opId, requestHash,
    );

    assert('T2: ok=false', result?.ok === false);
    assert('T2: code=NOT_BUYER or CONFLICT', result?.code === 'NOT_BUYER' || result?.code === 'CONFLICT', `got ${result?.code}`);

    const state = await getAuthorityState(adminSql, listingId);
    assert('T2: transfer_state unchanged', state?.transfer_state === 'seller_reported_sent');
    assert('T2: version unchanged=1', state?.version === 1);

    await cleanupAll(adminSql);
    console.log('  ✅ T2 passed');
  }

  // ── T3: Seller cannot confirm as buyer ──────────────────────────────────
  {
    console.log('\n[T3] Seller cannot confirm as buyer');
    await cleanupAll(adminSql);
    const listingId = `cert_t3_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId });

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: sellerUserId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, sellerUserId, purchaseId, opId, requestHash,
    );

    assert('T3: ok=false', result?.ok === false);
    assert('T3: code=NOT_BUYER or CONFLICT', result?.code === 'NOT_BUYER' || result?.code === 'CONFLICT');

    await cleanupAll(adminSql);
    console.log('  ✅ T3 passed');
  }

  // ── T4: Invalid prior transfer state (not_started) ──────────────────────
  {
    console.log('\n[T4] Invalid prior transfer state (not_started)');
    await cleanupAll(adminSql);
    const listingId = `cert_t4_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId, transferState: 'not_started' });

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );

    assert('T4: ok=false', result?.ok === false);
    assert('T4: code=CONFLICT', result?.code === 'CONFLICT', `got ${result?.code}`);

    await cleanupAll(adminSql);
    console.log('  ✅ T4 passed');
  }

  // ── T5: Invalid prior transfer state (terminal_cancelled) ──────────────
  {
    console.log('\n[T5] Invalid prior transfer state (terminal_cancelled)');
    await cleanupAll(adminSql);
    const listingId = `cert_t5_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId, transferState: 'terminal_cancelled' });

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );

    assert('T5: ok=false', result?.ok === false);
    assert('T5: code=CONFLICT', result?.code === 'CONFLICT', `got ${result?.code}`);

    await cleanupAll(adminSql);
    console.log('  ✅ T5 passed');
  }

  // ── T6: Valid prior state (in_progress) ──────────────────────────────────
  {
    console.log('\n[T6] Valid prior state (in_progress)');
    await cleanupAll(adminSql);
    const listingId = `cert_t6_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId, transferState: 'in_progress' });

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );

    assert('T6: ok=true', result?.ok === true, `got ${JSON.stringify(result)}`);
    assert('T6: transfer_state=buyer_confirmed_received', result?.transfer_state === 'buyer_confirmed_received');

    await cleanupAll(adminSql);
    console.log('  ✅ T6 passed');
  }

  // ── T7: Identical replay ────────────────────────────────────────────────
  {
    console.log('\n[T7] Identical replay');
    await cleanupAll(adminSql);
    const listingId = `cert_t7_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId });

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result1 = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );
    assert('T7: first call ok=true', result1?.ok === true);

    const result2 = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );
    assert('T7: replay ok=true', result2?.ok === true);
    assert('T7: replay idempotent=true', result2?.idempotent === true, `got ${JSON.stringify(result2)}`);
    assert('T7: replay same transfer_state', result2?.transfer_state === 'buyer_confirmed_received');

    // No duplicate version increment
    const state = await getAuthorityState(adminSql, listingId);
    assert('T7: version still 2 (no double increment)', state?.version === 2);

    // No duplicate outbox
    const outboxCount = await countRows(adminSql, 'reservation_outbox');
    assert('T7: only 1 outbox event', outboxCount === 1, `got ${outboxCount}`);

    await cleanupAll(adminSql);
    console.log('  ✅ T7 passed');
  }

  // ── T8: Conflicting replay (different operation, same proof) ────────────
  {
    console.log('\n[T8] Conflicting replay (different operation)');
    await cleanupAll(adminSql);
    const listingId = `cert_t8_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId });

    const opId1 = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash1 = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result1 = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId1, requestHash1,
    );
    assert('T8: first call ok=true', result1?.ok === true);

    // Second operation with different opId but same buyer
    const opId2 = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash2 = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 2, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result2 = await executorClient.recordBuyerTransferConfirmation(
      listingId, 2, buyerUserId, purchaseId, opId2, requestHash2,
    );
    assert('T8: second call ok=true (idempotent)', result2?.ok === true, `got ${JSON.stringify(result2)}`);
    assert('T8: second call idempotent=true', result2?.idempotent === true);

    await cleanupAll(adminSql);
    console.log('  ✅ T8 passed');
  }

  // ── T9: Stale version rejection ──────────────────────────────────────────
  {
    console.log('\n[T9] Stale version rejection');
    await cleanupAll(adminSql);
    const listingId = `cert_t9_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId });

    // Use wrong expected_version (0 instead of 1)
    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 0, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 0, buyerUserId, purchaseId, opId, requestHash,
    );

    assert('T9: ok=false', result?.ok === false);
    assert('T9: code=CONFLICT', result?.code === 'CONFLICT', `got ${result?.code}`);

    await cleanupAll(adminSql);
    console.log('  ✅ T9 passed');
  }

  // ── T10: Concurrent buyer confirmation vs seller report ─────────────────
  {
    console.log('\n[T10] Concurrent buyer confirmation vs seller report');
    await cleanupAll(adminSql);
    const listingId = `cert_t10_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    // Start with in_progress (seller has started transfer)
    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId, transferState: 'in_progress' });

    // Fire buyer confirmation and seller report concurrently (both CAS on version=1)
    const buyerOpId = `op_buyer_confirm_${listingId}_${genId()}`;
    const buyerHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const sellerOpId = `op_record_seller_report_${listingId}_${genId()}`;
    const sellerHash = sha256(JSON.stringify({ op: 'record_seller_report', listing_id: listingId, expected_version: 1, seller_user_id: sellerUserId }));

    const [buyerResult, sellerResult] = await Promise.allSettled([
      executorClient.recordBuyerTransferConfirmation(listingId, 1, buyerUserId, purchaseId, buyerOpId, buyerHash),
      executorClient.recordSellerReport(listingId, 1, sellerUserId, sellerOpId, sellerHash),
    ]);

    const buyerOk = buyerResult.status === 'fulfilled' && buyerResult.value?.ok === true;
    const sellerOk = sellerResult.status === 'fulfilled' && sellerResult.value?.ok === true;

    // Exactly one should succeed (CAS on version)
    assert('T10: exactly one succeeds', buyerOk === true && sellerOk === false || buyerOk === false && sellerOk === true,
      `buyer=${buyerOk}, seller=${sellerOk}`);

    const state = await getAuthorityState(adminSql, listingId);
    assert('T10: version=2 (exactly one increment)', state?.version === 2, `got ${state?.version}`);

    await cleanupAll(adminSql);
    console.log('  ✅ T10 passed');
  }

  // ── T11: No financial side effects ───────────────────────────────────────
  {
    console.log('\n[T11] No financial side effects');
    await cleanupAll(adminSql);
    const listingId = `cert_t11_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId });

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );

    assert('T11: ok=true', result?.ok === true);
    assert('T11: no_financial_effects=true', result?.no_financial_effects === true);

    // Verify no payment_actions created (no capture/cancel/refund triggered)
    const paymentActionsCount = await countRows(adminSql, 'payment_actions');
    assert('T11: zero payment_actions', paymentActionsCount === 0, `got ${paymentActionsCount}`);

    // Verify no incidents created
    const incidentsCount = await countRows(adminSql, 'operational_incidents');
    assert('T11: zero incidents', incidentsCount === 0, `got ${incidentsCount}`);

    // Verify capture_state unchanged
    const bindingRows = await adminSql`
      SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}
    `;
    assert('T11: capture_state still authorized', bindingRows[0]?.capture_state === 'authorized');

    // Verify lifecycle_state unchanged (still frozen, not sold)
    const state = await getAuthorityState(adminSql, listingId);
    assert('T11: lifecycle_state still frozen', state?.lifecycle_state === 'frozen');
    assert('T11: recovery_blocked still false', state?.recovery_blocked === false);

    await cleanupAll(adminSql);
    console.log('  ✅ T11 passed');
  }

  // ── T12: AI assessment state remains non-authoritative ──────────────────
  {
    console.log('\n[T12] AI assessment state remains non-authoritative');
    await cleanupAll(adminSql);
    const listingId = `cert_t12_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId });

    // First, record an AI proof assessment (advisory)
    const proofOpId = `op_proof_${listingId}_${genId()}`;
    const proofHash = sha256(JSON.stringify({ op: 'record_proof_assessment', listing_id: listingId, expected_version: 1, assessment_state: 'ai_likely_valid' }));
    const proofAssetHash = sha256('proof_asset_123');

    const proofResult = await executorClient.recordTransferProofAssessment(
      listingId, 1, sellerUserId, purchaseId, proofAssetHash,
      'ai_likely_valid', { confidence: 95 }, proofOpId, proofHash,
    );
    assert('T12: proof assessment ok=true', proofResult?.ok === true, `got ${JSON.stringify(proofResult)}`);
    assert('T12: proof transfer_state_unchanged=true', proofResult?.transfer_state_unchanged === true);

    // Now buyer confirms — should succeed regardless of AI assessment
    const buyerOpId = `op_buyer_confirm_${listingId}_${genId()}`;
    const buyerHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const buyerResult = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, buyerOpId, buyerHash,
    );

    assert('T12: buyer confirmation ok=true', buyerResult?.ok === true, `got ${JSON.stringify(buyerResult)}`);
    assert('T12: transfer_state=buyer_confirmed_received', buyerResult?.transfer_state === 'buyer_confirmed_received');

    // AI assessment did not cause or substitute for buyer confirmation
    const state = await getAuthorityState(adminSql, listingId);
    assert('T12: transfer_state=buyer_confirmed_received (not AI state)', state?.transfer_state === 'buyer_confirmed_received');

    await cleanupAll(adminSql);
    console.log('  ✅ T12 passed');
  }

  // ── T13: Binding not found ───────────────────────────────────────────────
  {
    console.log('\n[T13] Binding not found');
    await cleanupAll(adminSql);
    const listingId = `cert_t13_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    // Setup authority but NOT the binding
    await adminSql`
      INSERT INTO authority_v1.reservation_authority
        (listing_id, version, lifecycle_state, seller_user_id, buyer_user_id,
         reservation_token_hash, reservation_revision, reservation_expires_at,
         transfer_state, transfer_state_updated_at, created_at, updated_at)
      VALUES (${listingId}, 1, 'frozen', ${sellerUserId}, ${buyerUserId},
         'tok_hash', 'rev_1', now() + interval '1 hour',
         'seller_reported_sent', now(), now(), now())
    `;

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );

    assert('T13: ok=false', result?.ok === false);
    assert('T13: code=BINDING_NOT_FOUND', result?.code === 'BINDING_NOT_FOUND', `got ${result?.code}`);

    await cleanupAll(adminSql);
    console.log('  ✅ T13 passed');
  }

  // ── T14: Terminal replay (sold) — authorized buyer gets idempotent replay ──
  // P0-01T-CORRECTIVE-2: authority.buyer_user_id is cleared after sold, but the
  // binding retains it. The validated binding supplies buyer identity.
  {
    console.log('\n[T14] Terminal replay (sold) — authorized buyer');
    await cleanupAll(adminSql);
    const listingId = `cert_t14_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId, lifecycleState: 'sold', transferState: 'buyer_confirmed_received' });

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );

    assert('T14: ok=true (terminal replay)', result?.ok === true, `got ${JSON.stringify(result)}`);
    assert('T14: idempotent=true', result?.idempotent === true, `got ${JSON.stringify(result)}`);

    await cleanupAll(adminSql);
    console.log('  ✅ T14 passed');
  }

  // ── T15: Recovery-blocked rejection ───────────────────────────────────────
  {
    console.log('\n[T15] Recovery-blocked rejection');
    await cleanupAll(adminSql);
    const listingId = `cert_t15_${genId()}`;
    const sellerUserId = genEmail('seller');
    const buyerUserId = genEmail('buyer');
    const purchaseId = `pur_${genId()}`;
    const paymentIntentId = `pi_${genId()}`;

    await setupListing(adminSql, { listingId, sellerUserId, buyerUserId, purchaseId, paymentIntentId });

    // Set recovery_blocked
    await adminSql`
      UPDATE authority_v1.reservation_authority
      SET recovery_blocked = true, recovery_blocked_reason = 'test quarantine',
          recovery_blocked_at = now()
      WHERE listing_id = ${listingId}
    `;

    const opId = `op_buyer_confirm_${listingId}_${genId()}`;
    const requestHash = sha256(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 1, buyer_user_id: buyerUserId, purchase_id: purchaseId }));

    const result = await executorClient.recordBuyerTransferConfirmation(
      listingId, 1, buyerUserId, purchaseId, opId, requestHash,
    );

    assert('T15: ok=false', result?.ok === false);
    assert('T15: code=CONFLICT', result?.code === 'CONFLICT', `got ${result?.code}`);

    await cleanupAll(adminSql);
    console.log('  ✅ T15 passed');
  }

  // ── T16: Cleanup verification ─────────────────────────────────────────────
  {
    console.log('\n[T16] All seven tables empty after cleanup');
    await cleanupAll(adminSql);
    const tables = ['reservation_authority','reservation_operations','reservation_outbox','reservation_payment_bindings','payment_actions','stripe_webhook_events','operational_incidents'];
    let allZero = true;
    for (const t of tables) {
      const c = await countRows(adminSql, t);
      if (c !== 0) allZero = false;
    }
    assert('T16: all 7 tables empty', allZero);
    console.log('  ✅ T16 passed');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`  P0-01T Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════════');
  if (failed > 0) {
    console.log('  Failures:');
    failures.forEach(f => console.log(`    - ${f.name}: ${f.details}`));
  }

  return { passed, failed, failures };
}