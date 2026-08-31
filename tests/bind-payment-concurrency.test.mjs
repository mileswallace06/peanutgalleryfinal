/**
 * bind-payment-concurrency.test.mjs — P0-01R Concurrency Safety Proof
 *
 * Proves bind_payment_intent is concurrency-safe when two different synthetic
 * PaymentIntent IDs race to bind the same purchase. Every iteration must
 * produce:
 *   - One successful binding (200)
 *   - One structured PAYMENT_BINDING_CONFLICT (409)
 *   - Zero thrown database exceptions
 *   - Exactly one binding row
 *   - The winning binding unchanged
 *
 * Uses the EXECUTOR runtime client (not admin) to prove the production path.
 * Runs N iterations to be meaningful (default 25).
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';
import { createAuthorityV1Client } from '../base44/shared/authorityV1Client.js';
import { sha256Hex, canonicalEnvelope } from '../base44/shared/canaryMirror.js';

function genId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

async function setupReservedListing(executorClient, adminSql, listingId, sellerId, buyerId, token, expiresAt) {
  const initOpId = `conc_init_${listingId}_${genId()}`;
  const initHash = await sha256Hex(canonicalEnvelope({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
  await adminSql`SELECT authority_v1.initialize_listing(${listingId}, ${sellerId}, ${initOpId}, ${initHash})`;

  const tokenHash = await sha256Hex(token);
  const reserveOpId = `conc_reserve_${listingId}_${genId()}`;
  const reserveHash = await sha256Hex(canonicalEnvelope({
    op: 'reserve', listing_id: listingId, expected_version: 0,
    buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt,
  }));
  const reserveResult = await adminSql`SELECT authority_v1.reserve_listing(${listingId}, 0, ${buyerId}, ${tokenHash}, ${expiresAt}, ${reserveOpId}, ${reserveHash})`;
  return reserveResult[0]?.result;
}

async function cleanupListing(adminSql, listingId) {
  await adminSql`DELETE FROM authority_v1.reservation_outbox WHERE listing_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.reservation_payment_bindings WHERE listing_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.payment_actions WHERE listing_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.operational_incidents WHERE reference_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.reservation_operations WHERE listing_id = ${listingId}`;
  await adminSql`DELETE FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}`;
}

async function getBindingCount(adminSql, purchaseId) {
  const rows = await adminSql`SELECT count(*)::int as c FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}`;
  return rows[0]?.c || 0;
}

async function getBinding(adminSql, purchaseId) {
  const rows = await adminSql`SELECT payment_intent_id, capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}`;
  return rows[0] || null;
}

async function truncateAll(adminSql) {
  await adminSql`TRUNCATE authority_v1.reservation_outbox, authority_v1.reservation_payment_bindings, authority_v1.payment_actions, authority_v1.stripe_webhook_events, authority_v1.operational_incidents, authority_v1.reservation_operations, authority_v1.reservation_authority RESTART IDENTITY CASCADE`;
}

async function getAllCounts(adminSql) {
  const tables = ['reservation_authority', 'reservation_operations', 'reservation_outbox', 'reservation_payment_bindings', 'payment_actions', 'stripe_webhook_events', 'operational_incidents'];
  const counts = {};
  for (const t of tables) {
    // Table names are hardcoded constants — safe to interpolate (not user input)
    const rows = await adminSql(`SELECT count(*)::int as c FROM authority_v1.${t}`);
    counts[t] = rows[0]?.c || 0;
  }
  return counts;
}

/**
 * Run the concurrency test.
 * @param {object} deps
 * @param {string} deps.adminUrl - AUTHORITY_DB_URL_DEV_ADMIN
 * @param {string} deps.executorUrl - AUTHORITY_V1_DB_URL_DEV_EXECUTOR
 * @param {number} [deps.iterations=25]
 * @returns {Promise<object>}
 */
export async function runAllTests(deps) {
  const { adminUrl, executorUrl, iterations = 25 } = deps;
  const adminSql = neon(adminUrl);
  const executorClient = createAuthorityV1Client(executorUrl);

  const results = [];
  let passed = 0;
  let failed = 0;
  const failures = [];

  function record(name, ok, details = {}) {
    results.push({ name, passed: ok, ...details });
    if (ok) passed++;
    else { failed++; failures.push(name); }
  }

  // ── Pre-clean ──
  await truncateAll(adminSql);

  let thrownExceptions = 0;
  let allIterationsOneSuccess = true;
  let allIterationsOneConflict = true;
  let allIterationsOneRow = true;
  let allIterationsWinnerUnchanged = true;

  for (let i = 0; i < iterations; i++) {
    const listingId = `conc_${String(i).padStart(3, '0')}_${genId()}`;
    const purchaseId = `pur_${listingId}`;
    const piId1 = `pi1_${listingId}`;
    const piId2 = `pi2_${listingId}`;
    const buyerId = `buyer_${listingId}`;
    const sellerId = `seller_${listingId}`;
    const token = `tok_${listingId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Setup reserved listing via admin (setup only — not the path under test)
    await setupReservedListing(executorClient, adminSql, listingId, sellerId, buyerId, token, expiresAt);

    // Read authority state for the bind params
    const state = await executorClient.getState(listingId);
    const tokenHash = await sha256Hex(token);

    // Derive deterministic operation IDs + request hashes for BOTH PIs
    const opId1 = `canary_bind_${purchaseId}_${piId1}`;
    const opId2 = `canary_bind_${purchaseId}_${piId2}`;
    const reqHash1 = await sha256Hex(canonicalEnvelope({
      op: 'bind_pi', listing_id: listingId, purchase_id: purchaseId,
      payment_intent_id: piId1, buyer_user_id: buyerId,
      authority_version: state.version, reservation_revision: state.reservation_revision,
      token_hash: tokenHash, amount_minor: 10000, currency: 'usd',
    }));
    const reqHash2 = await sha256Hex(canonicalEnvelope({
      op: 'bind_pi', listing_id: listingId, purchase_id: purchaseId,
      payment_intent_id: piId2, buyer_user_id: buyerId,
      authority_version: state.version, reservation_revision: state.reservation_revision,
      token_hash: tokenHash, amount_minor: 10000, currency: 'usd',
    }));

    // ── Fire both binds concurrently (true race) ──
    const [res1, res2] = await Promise.allSettled([
      executorClient.bindPaymentIntent(
        listingId, purchaseId, piId1, buyerId,
        state.version, state.reservation_revision, tokenHash,
        opId1, reqHash1,
      ),
      executorClient.bindPaymentIntent(
        listingId, purchaseId, piId2, buyerId,
        state.version, state.reservation_revision, tokenHash,
        opId2, reqHash2,
      ),
    ]);

    // Check for thrown exceptions
    let iterThrown = 0;
    const r1 = res1.status === 'fulfilled' ? res1.value : null;
    const r2 = res2.status === 'fulfilled' ? res2.value : null;
    if (res1.status === 'rejected') { thrownExceptions++; iterThrown++; }
    if (res2.status === 'rejected') { thrownExceptions++; iterThrown++; }

    // Determine outcomes
    const r1Ok = r1?.ok === true && r1?.bound === true;
    const r2Ok = r2?.ok === true && r2?.bound === true;
    const r1Conflict = r1?.ok === false && r1?.code === 'PAYMENT_BINDING_CONFLICT';
    const r2Conflict = r2?.ok === false && r2?.code === 'PAYMENT_BINDING_CONFLICT';

    const oneSuccess = (r1Ok && r2Conflict) || (r2Ok && r1Conflict);
    const oneConflict = (r1Ok && r2Conflict) || (r2Ok && r1Conflict);

    if (!oneSuccess) allIterationsOneSuccess = false;
    if (!oneConflict) allIterationsOneConflict = false;

    // Check binding count + winner unchanged
    const bindingCount = await getBindingCount(adminSql, purchaseId);
    if (bindingCount !== 1) allIterationsOneRow = false;

    const binding = await getBinding(adminSql, purchaseId);
    const winnerPi = r1Ok ? piId1 : (r2Ok ? piId2 : null);
    const winnerUnchanged = binding?.payment_intent_id === winnerPi && binding?.capture_state === 'authorized';
    if (!winnerUnchanged) allIterationsWinnerUnchanged = false;

    record(`Iteration ${i + 1}/${iterations}: one-success=${oneSuccess}, one-conflict=${oneConflict}, thrown=${iterThrown}, rows=${bindingCount}, winner-ok=${winnerUnchanged}`,
      oneSuccess && oneConflict && iterThrown === 0 && bindingCount === 1 && winnerUnchanged,
      { r1, r2, bindingCount, winnerPi, binding });

    await cleanupListing(adminSql, listingId);
  }

  // ── Aggregate checks ──
  record('ALL iterations: exactly one successful binding',
    allIterationsOneSuccess, { iterations });
  record('ALL iterations: exactly one structured PAYMENT_BINDING_CONFLICT',
    allIterationsOneConflict, { iterations });
  record('ALL iterations: zero thrown database exceptions',
    thrownExceptions === 0, { thrownExceptions });
  record('ALL iterations: exactly one binding row per iteration',
    allIterationsOneRow, { iterations });
  record('ALL iterations: winning binding unchanged',
    allIterationsWinnerUnchanged, { iterations });

  // ── Post-clean verification ──
  await truncateAll(adminSql);
  const finalCounts = await getAllCounts(adminSql);
  const allClean = Object.values(finalCounts).every(c => c === 0);
  record('Post-test: all seven authority tables empty', allClean, { finalCounts });

  return {
    passed,
    failed,
    failures,
    iterations,
    thrownExceptions,
    allIterationsOneSuccess,
    allIterationsOneConflict,
    allIterationsOneRow,
    allIterationsWinnerUnchanged,
    allClean,
    finalCounts,
    results,
  };
}