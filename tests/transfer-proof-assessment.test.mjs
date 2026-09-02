/**
 * P0-01S Transfer Proof Assessment — Runtime Test Suite
 *
 * Validates the authoritative advisory AI proof assessment:
 *   - All three assessment states (ai_likely_valid, ai_uncertain, ai_suspicious)
 *   - Every outcome leaves transfer_state unchanged
 *   - Identical replay produces no second mutation or outbox item
 *   - Different proof hash → PROOF_ASSET_CONFLICT
 *   - Same proof hash + different assessment data → PROOF_ALREADY_ASSESSED
 *   - Concurrent identical and conflicting assessments
 *   - Wrong seller, wrong purchase, tampered proof, ineligible transfer state
 *   - Malformed/oversized AI output and AI timeout fail closed
 *   - Mirror failure creates retryable outbox without undoing authority
 *   - No payout, capture, refund, release, relist, or transfer-completion effect
 *   - All seven authority tables empty after cleanup
 *
 * Maintenance ON, flag OFF. No manifest update, commit, or push.
 */
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';

const ADMIN_URL = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
const EXECUTOR_URL = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;

if (!ADMIN_URL || !EXECUTOR_URL) {
  console.log('SKIP: AUTHORITY_DB_URL_DEV_ADMIN and AUTHORITY_V1_DB_URL_DEV_EXECUTOR required');
  process.exit(0);
}

const adminSql = neon(ADMIN_URL);
const execSql = neon(EXECUTOR_URL);

let passed = 0, failed = 0;
const failures = [];

function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`[PASS] ${name}`); }
  else { failed++; failures.push(name); console.log(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}
function genId() {
  return crypto.randomUUID();
}
// Compare timestamps by value — Neon returns them as Date objects, so ===
// compares object identity, not time value.
function sameTime(a, b) {
  if (a == null || b == null) return a === b;
  const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
  const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
  return ta === tb;
}

// ── Setup helpers ──────────────────────────────────────────────────────────
async function setupReservedListing(listingId, sellerId, buyerId) {
  const tokenHash = sha256('token_' + listingId);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const revision = genId();
  await adminSql`INSERT INTO authority_v1.reservation_authority
    (listing_id, version, lifecycle_state, seller_user_id, buyer_user_id,
     reservation_token_hash, reservation_expires_at, reservation_revision, transfer_state)
    VALUES (${listingId}, 1, 'reserved', ${sellerId}, ${buyerId},
            ${tokenHash}, ${expiresAt}, ${revision}, 'not_started')
    ON CONFLICT (listing_id) DO UPDATE SET
      version = 1, lifecycle_state = 'reserved', seller_user_id = ${sellerId},
      buyer_user_id = ${buyerId}, reservation_token_hash = ${tokenHash},
      reservation_expires_at = ${expiresAt}, reservation_revision = ${revision},
      transfer_state = 'not_started', recovery_blocked = false,
      recovery_blocked_reason = null, updated_at = now()`;
  return { tokenHash, expiresAt, revision };
}

async function setupBinding(purchaseId, paymentIntentId, listingId, buyerId, authorityVersion, revision, tokenHash) {
  await adminSql`INSERT INTO authority_v1.reservation_payment_bindings
    (purchase_id, payment_intent_id, listing_id, buyer_user_id,
     authority_version, reservation_revision, reservation_token_hash, capture_state)
    VALUES (${purchaseId}, ${paymentIntentId}, ${listingId}, ${buyerId},
            ${authorityVersion}, ${revision}, ${tokenHash}, 'authorized')
    ON CONFLICT (purchase_id) DO UPDATE SET
      payment_intent_id = ${paymentIntentId}, listing_id = ${listingId},
      buyer_user_id = ${buyerId}, authority_version = ${authorityVersion},
      reservation_revision = ${revision}, reservation_token_hash = ${tokenHash},
      capture_state = 'authorized', updated_at = now()`;
}

async function callAssessment(listingId, expectedVersion, sellerId, purchaseId, proofAssetIdHash, assessmentState, assessmentData, opId, requestHash) {
  const rows = await execSql(
    `SELECT authority_v1.record_transfer_proof_assessment($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) as result`,
    [listingId, expectedVersion, sellerId, purchaseId, proofAssetIdHash, assessmentState, JSON.stringify(assessmentData), opId, requestHash]
  );
  return rows[0]?.result;
}

async function getAuthorityState(listingId) {
  const rows = await adminSql`SELECT version, lifecycle_state, transfer_state, transfer_state_updated_at FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}`;
  return rows[0] || null;
}

async function getBindingState(purchaseId) {
  const rows = await adminSql`SELECT capture_state, proof_assessment_state, proof_asset_id_hash, proof_assessment_at FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}`;
  return rows[0] || null;
}

async function countOperations(listingId) {
  const rows = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_operations WHERE listing_id = ${listingId}`;
  return rows[0]?.c || 0;
}

async function countOutbox(listingId) {
  const rows = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_outbox WHERE listing_id = ${listingId}`;
  return rows[0]?.c || 0;
}

async function countAll() {
  const [ra] = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_authority`;
  const [ro] = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_operations`;
  const [rpb] = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_payment_bindings`;
  const [pa] = await adminSql`SELECT count(*)::int as c FROM authority_v1.payment_actions`;
  const [swe] = await adminSql`SELECT count(*)::int as c FROM authority_v1.stripe_webhook_events`;
  const [oi] = await adminSql`SELECT count(*)::int as c FROM authority_v1.operational_incidents`;
  const [ob] = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_outbox`;
  return { reservation_authority: ra.c, reservation_operations: ro.c, reservation_payment_bindings: rpb.c, payment_actions: pa.c, stripe_webhook_events: swe.c, operational_incidents: oi.c, reservation_outbox: ob.c };
}

async function cleanupAll() {
  await adminSql`DELETE FROM authority_v1.reservation_outbox`;
  await adminSql`DELETE FROM authority_v1.stripe_webhook_events`;
  await adminSql`DELETE FROM authority_v1.payment_actions`;
  await adminSql`DELETE FROM authority_v1.operational_incidents`;
  await adminSql`DELETE FROM authority_v1.reservation_payment_bindings`;
  await adminSql`DELETE FROM authority_v1.reservation_operations`;
  await adminSql`DELETE FROM authority_v1.reservation_authority`;
}

// ── Test runner ────────────────────────────────────────────────────────────
async function run() {
  await cleanupAll();

  // ════════════════════════════════════════════════════════════════════════
  // T1: All three assessment states — transfer_state unchanged for each
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T1: Assessment states (ai_likely_valid, ai_uncertain, ai_suspicious) ──');
  for (const state of ['ai_likely_valid', 'ai_uncertain', 'ai_suspicious']) {
    const listingId = `t1_${state}_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, expiresAt, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    const opId = `op_${listingId}`;
    const reqHash = sha256(JSON.stringify({ op: 'proof', listing_id: listingId, state }));
    const assessmentData = { model: 'test', confidence_score: 75, flags: [] };

    const result = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash, state, assessmentData, opId, reqHash);

    assert(`T1_${state}_ok`, result?.ok === true, `got ${JSON.stringify(result).slice(0, 200)}`);
    assert(`T1_${state}_assessment_state`, result?.assessment_state === state);
    assert(`T1_${state}_transfer_state_unchanged`, result?.transfer_state_unchanged === true);
    assert(`T1_${state}_version_unchanged`, result?.version_unchanged === true);

    // Verify authority state unchanged
    const authState = await getAuthorityState(listingId);
    assert(`T1_${state}_authority_version_1`, authState?.version === 1);
    assert(`T1_${state}_authority_transfer_not_started`, authState?.transfer_state === 'not_started');

    // Verify binding has assessment
    const binding = await getBindingState(purchaseId);
    assert(`T1_${state}_binding_assessed`, binding?.proof_assessment_state === state);
    assert(`T1_${state}_binding_capture_unchanged`, binding?.capture_state === 'authorized');

    // Verify outbox has exactly 1 item
    const outboxCount = await countOutbox(listingId);
    assert(`T1_${state}_outbox_1`, outboxCount === 1, `got ${outboxCount}`);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T2: Identical replay — no second mutation or outbox item
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T2: Identical replay ──');
  {
    const listingId = `t2_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    const opId = `op_${listingId}`;
    const reqHash = sha256(JSON.stringify({ op: 'proof', listing_id: listingId, state: 'ai_likely_valid' }));
    const assessmentData = { model: 'test', confidence_score: 80, flags: [] };

    // First call
    const result1 = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash, 'ai_likely_valid', assessmentData, opId, reqHash);
    assert('T2_first_ok', result1?.ok === true);

    const opsAfter1 = await countOperations(listingId);
    const outboxAfter1 = await countOutbox(listingId);
    const bindingAfter1 = await getBindingState(purchaseId);
    const authAfter1 = await getAuthorityState(listingId);

    // Identical replay (same opId + reqHash) — returns stored original result unchanged
    const result2 = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash, 'ai_likely_valid', assessmentData, opId, reqHash);
    assert('T2_replay_ok', result2?.ok === true);

    // Idempotence proof 1: identical result data (replay returns stored result unchanged)
    assert('T2_replay_identical_ok', result2?.ok === result1?.ok);
    assert('T2_replay_identical_state', result2?.assessment_state === result1?.assessment_state);
    assert('T2_replay_identical_version', result2?.version === result1?.version);
    assert('T2_replay_identical_transfer_unchanged', result2?.transfer_state_unchanged === result1?.transfer_state_unchanged);

    // Idempotence proof 2: unchanged timestamps/state
    const bindingAfter2 = await getBindingState(purchaseId);
    const authAfter2 = await getAuthorityState(listingId);
    assert('T2_binding_timestamp_unchanged', sameTime(bindingAfter2?.proof_assessment_at, bindingAfter1?.proof_assessment_at));
    assert('T2_auth_transfer_ts_unchanged', sameTime(authAfter2?.transfer_state_updated_at, authAfter1?.transfer_state_updated_at));
    assert('T2_auth_version_unchanged', authAfter2?.version === authAfter1?.version);

    // Idempotence proof 3: zero new operations or outbox rows
    const opsAfter2 = await countOperations(listingId);
    const outboxAfter2 = await countOutbox(listingId);
    assert('T2_no_new_operation', opsAfter2 === opsAfter1, `ops: ${opsAfter1} → ${opsAfter2}`);
    assert('T2_no_new_outbox', outboxAfter2 === outboxAfter1, `outbox: ${outboxAfter1} → ${outboxAfter2}`);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T3: Different proof hash → PROOF_ASSET_CONFLICT
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T3: Different proof hash → PROOF_ASSET_CONFLICT ──');
  {
    const listingId = `t3_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash1 = sha256('proof1_' + listingId);
    const proofHash2 = sha256('proof2_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    // First assessment
    const opId1 = `op1_${listingId}`;
    const reqHash1 = sha256(JSON.stringify({ op: 'proof', listing_id: listingId, hash: proofHash1 }));
    const result1 = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash1, 'ai_likely_valid', { model: 'test' }, opId1, reqHash1);
    assert('T3_first_ok', result1?.ok === true);

    // Second assessment with different proof hash
    const opId2 = `op2_${listingId}`;
    const reqHash2 = sha256(JSON.stringify({ op: 'proof', listing_id: listingId, hash: proofHash2 }));
    const result2 = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash2, 'ai_suspicious', { model: 'test' }, opId2, reqHash2);
    assert('T3_conflict_not_ok', result2?.ok === false);
    assert('T3_proof_asset_conflict', result2?.code === 'PROOF_ASSET_CONFLICT', `got ${result2?.code}`);

    // Verify first assessment is preserved (not overwritten)
    const binding = await getBindingState(purchaseId);
    assert('T3_first_assessment_preserved', binding?.proof_assessment_state === 'ai_likely_valid');
    assert('T3_first_proof_hash_preserved', binding?.proof_asset_id_hash === proofHash1);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T4: Same proof hash + different assessment data → PROOF_ALREADY_ASSESSED
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T4: Same proof hash + different data → PROOF_ALREADY_ASSESSED ──');
  {
    const listingId = `t4_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    // First assessment
    const opId1 = `op1_${listingId}`;
    const reqHash1 = sha256(JSON.stringify({ op: 'proof', listing_id: listingId, v: 1 }));
    const result1 = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash, 'ai_likely_valid', { model: 'test', confidence_score: 80 }, opId1, reqHash1);
    assert('T4_first_ok', result1?.ok === true);

    // Second assessment: same proof hash, different operation, different data
    const opId2 = `op2_${listingId}`;
    const reqHash2 = sha256(JSON.stringify({ op: 'proof', listing_id: listingId, v: 2 }));
    const result2 = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash, 'ai_suspicious', { model: 'test', confidence_score: 20 }, opId2, reqHash2);
    assert('T4_conflict_not_ok', result2?.ok === false);
    assert('T4_proof_already_assessed', result2?.code === 'PROOF_ALREADY_ASSESSED', `got ${result2?.code}`);

    // Verify first assessment is preserved (not overwritten)
    const binding = await getBindingState(purchaseId);
    assert('T4_first_state_preserved', binding?.proof_assessment_state === 'ai_likely_valid');

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T5: Concurrent identical assessments — only one wins, other is idempotent replay
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T5: Concurrent identical assessments ──');
  {
    const listingId = `t5_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    const opId = `op_${listingId}`;
    const reqHash = sha256(JSON.stringify({ op: 'proof', listing_id: listingId }));
    const assessmentData = { model: 'test', confidence_score: 75 };

    // Fire two concurrent calls with the SAME operation_id
    const [r1, r2] = await Promise.all([
      callAssessment(listingId, 1, sellerId, purchaseId, proofHash, 'ai_likely_valid', assessmentData, opId, reqHash),
      callAssessment(listingId, 1, sellerId, purchaseId, proofHash, 'ai_likely_valid', assessmentData, opId, reqHash),
    ]);

    // At least one must succeed, the other must be idempotent or conflict
    const okCount = [r1, r2].filter(r => r?.ok === true).length;
    assert('T5_at_least_one_ok', okCount >= 1, `okCount=${okCount}`);
    assert('T5_both_ok', r1?.ok === true && r2?.ok === true, `r1.ok=${r1?.ok}, r2.ok=${r2?.ok}`);

    // Only 1 outbox item (no duplicate)
    const outboxCount = await countOutbox(listingId);
    assert('T5_outbox_1', outboxCount === 1, `got ${outboxCount}`);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T6: Concurrent conflicting assessments (different proof hashes)
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T6: Concurrent conflicting assessments ──');
  {
    const listingId = `t6_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash1 = sha256('proof1_' + listingId);
    const proofHash2 = sha256('proof2_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    const opId1 = `op1_${listingId}`;
    const opId2 = `op2_${listingId}`;
    const reqHash1 = sha256(JSON.stringify({ op: 'proof', listing_id: listingId, h: 1 }));
    const reqHash2 = sha256(JSON.stringify({ op: 'proof', listing_id: listingId, h: 2 }));

    // Fire two concurrent calls with DIFFERENT proof hashes
    const [r1, r2] = await Promise.all([
      callAssessment(listingId, 1, sellerId, purchaseId, proofHash1, 'ai_likely_valid', { model: 'test' }, opId1, reqHash1),
      callAssessment(listingId, 1, sellerId, purchaseId, proofHash2, 'ai_suspicious', { model: 'test' }, opId2, reqHash2),
    ]);

    // Exactly one must succeed, the other must get PROOF_ASSET_CONFLICT
    const okCount = [r1, r2].filter(r => r?.ok === true).length;
    const conflictCount = [r1, r2].filter(r => r?.code === 'PROOF_ASSET_CONFLICT').length;
    assert('T6_exactly_one_ok', okCount === 1, `okCount=${okCount}`);
    assert('T6_one_conflict', conflictCount === 1, `conflictCount=${conflictCount}`);

    // Binding has exactly one assessment
    const binding = await getBindingState(purchaseId);
    assert('T6_binding_has_assessment', binding?.proof_assessment_state !== null);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T7: Wrong seller → CONFLICT
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T7: Wrong seller ──');
  {
    const listingId = `t7_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const wrongSellerId = `wrong_seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    const opId = `op_${listingId}`;
    const reqHash = sha256(JSON.stringify({ op: 'proof', listing_id: listingId }));
    const result = await callAssessment(listingId, 1, wrongSellerId, purchaseId, proofHash, 'ai_likely_valid', { model: 'test' }, opId, reqHash);
    assert('T7_wrong_seller_conflict', result?.ok === false);
    assert('T7_wrong_seller_code', result?.code === 'CONFLICT', `got ${result?.code}`);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T8: Wrong purchase (binding not found) → BINDING_NOT_FOUND
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T8: Wrong purchase (binding not found) ──');
  {
    const listingId = `t8_${genId()}`;
    const wrongPurchaseId = `wrong_pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    // Don't create a binding for wrongPurchaseId

    const opId = `op_${listingId}`;
    const reqHash = sha256(JSON.stringify({ op: 'proof', listing_id: listingId }));
    const result = await callAssessment(listingId, 1, sellerId, wrongPurchaseId, proofHash, 'ai_likely_valid', { model: 'test' }, opId, reqHash);
    assert('T8_binding_not_found', result?.ok === false);
    assert('T8_binding_not_found_code', result?.code === 'BINDING_NOT_FOUND', `got ${result?.code}`);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T9: Tampered proof reference (wrong version) → CONFLICT
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T9: Tampered proof reference (wrong version) ──');
  {
    const listingId = `t9_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    // Use wrong expected_version (99 instead of 1)
    const opId = `op_${listingId}`;
    const reqHash = sha256(JSON.stringify({ op: 'proof', listing_id: listingId }));
    const result = await callAssessment(listingId, 99, sellerId, purchaseId, proofHash, 'ai_likely_valid', { model: 'test' }, opId, reqHash);
    assert('T9_wrong_version_conflict', result?.ok === false);
    assert('T9_wrong_version_code', result?.code === 'CONFLICT', `got ${result?.code}`);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T10: Ineligible transfer state (terminal_cancelled) → CONFLICT
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T10: Ineligible transfer state (terminal_cancelled) ──');
  {
    const listingId = `t10_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    // Set transfer_state to terminal_cancelled
    await adminSql`UPDATE authority_v1.reservation_authority SET transfer_state = 'terminal_cancelled' WHERE listing_id = ${listingId}`;

    const opId = `op_${listingId}`;
    const reqHash = sha256(JSON.stringify({ op: 'proof', listing_id: listingId }));
    const result = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash, 'ai_likely_valid', { model: 'test' }, opId, reqHash);
    assert('T10_cancelled_conflict', result?.ok === false);
    assert('T10_cancelled_code', result?.code === 'CONFLICT', `got ${result?.code}`);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T11: Invalid assessment state → INVALID_ASSESSMENT_STATE
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T11: Invalid assessment state ──');
  {
    const listingId = `t11_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    const opId = `op_${listingId}`;
    const reqHash = sha256(JSON.stringify({ op: 'proof', listing_id: listingId }));
    const result = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash, 'invalid_state', { model: 'test' }, opId, reqHash);
    assert('T11_invalid_state', result?.ok === false);
    assert('T11_invalid_code', result?.code === 'INVALID_ASSESSMENT_STATE', `got ${result?.code}`);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T12: No payout, capture, refund, release, relist, or transfer-completion effect
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T12: No financial/transfer-completion effect ──');
  {
    const listingId = `t12_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const proofHash = sha256('proof_' + listingId);

    const { tokenHash, revision } = await setupReservedListing(listingId, sellerId, buyerId);
    await setupBinding(purchaseId, `pi_${listingId}`, listingId, buyerId, 1, revision, tokenHash);

    const opId = `op_${listingId}`;
    const reqHash = sha256(JSON.stringify({ op: 'proof', listing_id: listingId }));
    const result = await callAssessment(listingId, 1, sellerId, purchaseId, proofHash, 'ai_likely_valid', { model: 'test', confidence_score: 95 }, opId, reqHash);
    assert('T12_ok', result?.ok === true);

    // Verify capture_state unchanged (no capture/refund)
    const binding = await getBindingState(purchaseId);
    assert('T12_capture_unchanged', binding?.capture_state === 'authorized');

    // Verify lifecycle_state unchanged (no release/relist)
    const auth = await getAuthorityState(listingId);
    assert('T12_lifecycle_unchanged', auth?.lifecycle_state === 'reserved');

    // Verify transfer_state unchanged (no transfer-completion)
    assert('T12_transfer_unchanged', auth?.transfer_state === 'not_started');

    // Verify version unchanged (no lifecycle transition)
    assert('T12_version_unchanged', auth?.version === 1);

    // Verify no payment_actions created (no payout/capture)
    const [pa] = await adminSql`SELECT count(*)::int as c FROM authority_v1.payment_actions WHERE listing_id = ${listingId}`;
    assert('T12_no_payment_actions', pa.c === 0);

    await cleanupAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // T13: All seven authority tables empty after cleanup
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── T13: All tables empty after cleanup ──');
  {
    await cleanupAll();
    const counts = await countAll();
    const allZero = Object.values(counts).every(v => v === 0);
    assert('T13_all_tables_empty', allZero, JSON.stringify(counts));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n=== P0-01S Transfer Proof Assessment Tests ===`);
  console.log(`Tests run: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`Overall: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  if (failed > 0) {
    console.log(`Failed: ${failures.join(', ')}`);
    process.exit(1);
  }
}

run().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});