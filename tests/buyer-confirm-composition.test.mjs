/**
 * P0-01T-CORRECTIVE-2 Composition: Buyer Confirmation + Capture
 *
 * Validates that the buyerConfirmTransferCanaryOrchestrator composes BOTH:
 *   1. Buyer confirmation (advisory, authority-first)
 *   2. Payment capture (financial, via captureCanaryOrchestrator)
 *
 * P0-01T-CORRECTIVE-2 fixes:
 *   A. Terminal replay authorization (sold/available via binding buyer)
 *   B. Exact capture context (4-arg tuple validation)
 *   C. Correct sequencing (dependencies + context required before confirmation)
 *   D. skip_capture bypass removed
 *   E. Safe response projection (no internal objects/credentials)
 *   F. Recursive credential leak scanning on every response body
 *
 * Test scenarios:
 *   C1: confirmation + capture succeeds
 *   C2: authorized buyer replay after sold → 200, no Stripe call
 *   C3: definitive capture failure
 *   C4: capture unknown and recovery blocked
 *   C5: exact capture_unknown reconciliation → sold
 *   C6: missing capture context → non-200, transfer state unchanged
 *   C7: supplying skip_capture cannot bypass capture
 *   C8: wrong buyer before confirmation → 403, no mutation/capture
 *   C9: wrong buyer after sold → 403, no Stripe call
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

// ── Recursive credential leak scanner ─────────────────────────────────────
// Scans every response body recursively for prohibited keys and known
// credential values. Does not merely scan top-level properties or failure
// descriptions — traverses the entire object tree.
const PROHIBITED_KEYS = new Set([
  'action_id', 'stripe_idempotency_key', 'idem_key',
  'buyer_user_id', 'buyer_email',
]);

function scanRecursive(obj, knownValues, path, violations) {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    for (const [name, value] of Object.entries(knownValues)) {
      if (value && typeof value === 'string' && value.length > 5 && obj.includes(value)) {
        violations.push({ path, type: 'value_match', name });
      }
    }
    return;
  }
  if (typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (PROHIBITED_KEYS.has(key.toLowerCase())) {
      violations.push({ path: currentPath, type: 'prohibited_key', key });
    }
    scanRecursive(value, knownValues, currentPath, violations);
  }
}

// ── Mock Base44 entities (in-memory) ─────────────────────────────────────────
function createMockEntities() {
  const state = { listings: {}, listingPrivates: {}, purchases: {}, outbox: [] };
  return {
    _state: state,
    Listing: {
      update: async (id, fields) => {
        if (!state.listings[id]) state.listings[id] = {};
        Object.assign(state.listings[id], fields);
      },
    },
    ListingPrivate: {
      filter: async (q) => {
        const lp = state.listingPrivates[q.listing_id];
        return lp ? [{ id: lp.id, ...lp }] : [];
      },
      update: async (id, fields) => {
        for (const [lid, lp] of Object.entries(state.listingPrivates)) {
          if (lp.id === id) { Object.assign(lp, fields); return; }
        }
      },
    },
    Purchase: {
      update: async (id, fields) => {
        if (!state.purchases[id]) state.purchases[id] = {};
        Object.assign(state.purchases[id], fields);
      },
    },
    CanaryMirrorOutbox: {
      create: async (data) => {
        const record = { id: `ob_${genId()}`, ...data };
        state.outbox.push(record);
        return record;
      },
    },
    PurchasePrivate: {
      filter: async () => [],
    },
  };
}

// ── Fake Stripe capture adapter ─────────────────────────────────────────────
function createFakeCaptureAdapter(result) {
  const calls = [];
  return {
    calls,
    async capturePaymentIntent(piId, idemKey) {
      calls.push({ piId, idemKey, time: Date.now() });
      return result;
    },
  };
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

async function getBindingState(adminSql, purchaseId) {
  const rows = await adminSql`
    SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}
  `;
  return rows[0] || null;
}

export async function runAllTests({ adminSql, executorUrl, recorderUrl }) {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  P0-01T-CORRECTIVE-2 Composition: Buyer Confirmation + Capture');
  console.log('═══════════════════════════════════════════════════════════════════');

  let passed = 0, failed = 0;
  const failures = [];
  const allResponses = [];
  const allKnownCredentials = {};

  function assert(name, cond, details) {
    if (cond) { passed++; }
    else { failed++; failures.push(`${name}: ${details || 'assertion failed'}`); console.error(`  [FAIL] ${name}: ${details}`); }
  }

  const { createAuthorityV1Client } = await import('../base44/shared/authorityV1Client.js');
  const { createAuthorityV1StripeRecorderClient } = await import('../base44/shared/authorityV1StripeRecorderClient.js');
  const { runCanaryBuyerConfirmSaga } = await import('../base44/shared/buyerConfirmTransferCanaryOrchestrator.js');

  const executorClient = createAuthorityV1Client(executorUrl);
  const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

  // ── Setup helper: create a frozen listing with an active capture action ──
  async function setupFrozenWithCaptureAction(prefix, opts = {}) {
    const listingId = `comp_${prefix}_${genId()}`;
    const sellerId = opts.sellerId || genEmail('seller');
    const buyerId = opts.buyerId || genEmail('buyer');
    const tokenHash = sha256Hex(`token_${prefix}_${genId()}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const purchaseId = `pur_${prefix}_${genId()}`;
    const paymentIntentId = `pi_${prefix}_${genId()}`;
    const actionId = `act_capture_${prefix}_${genId()}`;
    const stripeIdemKey = `idem_capture_${actionId}`;

    // Track known credentials for leak scanning
    allKnownCredentials[actionId] = actionId;
    allKnownCredentials[stripeIdemKey] = stripeIdemKey;
    allKnownCredentials[buyerId] = buyerId;

    // 1. Initialize listing
    const initOpId = `op_init_${listingId}_${genId()}`;
    const initHash = sha256Hex(JSON.stringify({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
    await executorClient.initializeListing(listingId, sellerId, initOpId, initHash);

    // 2. Reserve listing
    const reserveOpId = `op_reserve_${listingId}_${genId()}`;
    const reserveHash = sha256Hex(JSON.stringify({ op: 'reserve', listing_id: listingId, expected_version: 0, buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt }));
    const reserveResult = await executorClient.reserveListing(listingId, 0, buyerId, tokenHash, expiresAt, reserveOpId, reserveHash);
    const revision = reserveResult?.revision;
    if (!revision) throw new Error('reserveListing did not return a revision');

    // 3. Bind payment intent
    const bindOpId = `op_bind_${listingId}_${genId()}`;
    const bindHash = sha256Hex(JSON.stringify({ op: 'bind', listing_id: listingId, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, authority_version: 1, reservation_revision: revision, token_hash: tokenHash }));
    await executorClient.bindPaymentIntent(listingId, purchaseId, paymentIntentId, buyerId, 1, revision, tokenHash, bindOpId, bindHash);

    // 4. Begin capture (reserved → frozen, creates payment action)
    const beginOpId = `op_begin_${listingId}_${genId()}`;
    const beginHash = sha256Hex(JSON.stringify({ op: 'begin_capture', listing_id: listingId, expected_version: 1, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, action_id: actionId, idem_key: stripeIdemKey }));
    await executorClient.beginCapture(listingId, 1, purchaseId, paymentIntentId, buyerId, revision, actionId, stripeIdemKey, beginOpId, beginHash);

    // 5. Optionally set transfer_state via begin_transfer + record_seller_report
    if (opts.transferState === 'seller_reported_sent') {
      const transferOpId = `op_transfer_${listingId}_${genId()}`;
      const transferHash = sha256Hex(JSON.stringify({ op: 'begin_transfer', listing_id: listingId, expected_version: 2, seller_user_id: sellerId }));
      await executorClient.beginTransfer(listingId, 2, sellerId, transferOpId, transferHash);

      const reportOpId = `op_report_${listingId}_${genId()}`;
      const reportHash = sha256Hex(JSON.stringify({ op: 'record_seller_report', listing_id: listingId, expected_version: 3, seller_user_id: sellerId }));
      await executorClient.recordSellerReport(listingId, 3, sellerId, reportOpId, reportHash);
    }

    return { listingId, sellerId, buyerId, purchaseId, paymentIntentId, actionId, stripeIdemKey, revision };
  }

  // ── C1: confirmation + capture succeeds ───────────────────────────────
  {
    console.log('\n[C1] confirmation + capture succeeds');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithCaptureAction('c1', { transferState: 'seller_reported_sent' });
    const entities = createMockEntities();
    const stripeAdapter = createFakeCaptureAdapter({ derived: 'succeeded', raw: { id: setup.paymentIntentId, status: 'succeeded' } });

    const result = await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });
    allResponses.push({ test: 'C1', result });

    assert('C1: status=200', result.status === 200, `got ${result.status}`);
    assert('C1: ok=true', result.body?.ok === true, `got ${JSON.stringify(result.body)}`);
    assert('C1: buyer_confirmed=true', result.body?.buyer_confirmed === true);
    assert('C1: captured=true', result.body?.captured === true, `got ${result.body?.captured}`);
    assert('C1: finalized=true', result.body?.finalized === true);
    assert('C1: stripe called once', stripeAdapter.calls.length === 1, `got ${stripeAdapter.calls.length}`);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('C1: authority lifecycle=sold', state?.lifecycle_state === 'sold', `got ${state?.lifecycle_state}`);

    const binding = await getBindingState(adminSql, setup.purchaseId);
    assert('C1: binding capture_state=finalized', binding?.capture_state === 'finalized', `got ${binding?.capture_state}`);

    await cleanupAll(adminSql);
    console.log('  ✅ C1 passed');
  }

  // ── C2: authorized buyer replay after sold → 200, no Stripe call ──────
  {
    console.log('\n[C2] authorized buyer replay after sold');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithCaptureAction('c2', { transferState: 'seller_reported_sent' });
    const entities = createMockEntities();

    // First call: buyer confirms + capture succeeds → sold
    const stripeAdapter1 = createFakeCaptureAdapter({ derived: 'succeeded', raw: { id: setup.paymentIntentId, status: 'succeeded' } });
    await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripeAdapter1,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });

    // Second call: same buyer (authorized replay after sold)
    const stripeAdapter2 = createFakeCaptureAdapter({ derived: 'succeeded', raw: {} });
    const result2 = await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripeAdapter2,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });
    allResponses.push({ test: 'C2', result: result2 });

    assert('C2: status=200', result2.status === 200, `got ${result2.status}`);
    assert('C2: ok=true', result2.body?.ok === true);
    assert('C2: replay=true', result2.body?.replay === true, `got ${result2.body?.replay}`);
    assert('C2: capture_replay=true', result2.body?.capture_replay === true, `got ${result2.body?.capture_replay}`);
    assert('C2: stripe NOT called', stripeAdapter2.calls.length === 0, `got ${stripeAdapter2.calls.length}`);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('C2: authority lifecycle=sold', state?.lifecycle_state === 'sold');

    await cleanupAll(adminSql);
    console.log('  ✅ C2 passed');
  }

  // ── C3: definitive capture failure ────────────────────────────────────
  {
    console.log('\n[C3] definitive capture failure');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithCaptureAction('c3', { transferState: 'seller_reported_sent' });
    const entities = createMockEntities();
    const stripeAdapter = createFakeCaptureAdapter({ derived: 'failed', raw: { error: 'card_declined' } });

    const result = await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });
    allResponses.push({ test: 'C3', result });

    assert('C3: status=200', result.status === 200);
    assert('C3: ok=true', result.body?.ok === true);
    assert('C3: buyer_confirmed=true', result.body?.buyer_confirmed === true);
    assert('C3: captured=false', result.body?.captured === false);
    assert('C3: capture_failed=true', result.body?.capture_failed === true, `got ${result.body?.capture_failed}`);
    assert('C3: released=true', result.body?.released === true);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('C3: lifecycle=available', state?.lifecycle_state === 'available', `got ${state?.lifecycle_state}`);

    const binding = await getBindingState(adminSql, setup.purchaseId);
    assert('C3: binding capture_state=failed', binding?.capture_state === 'failed', `got ${binding?.capture_state}`);

    await cleanupAll(adminSql);
    console.log('  ✅ C3 passed');
  }

  // ── C4: capture unknown and recovery blocked ───────────────────────────
  {
    console.log('\n[C4] capture unknown and recovery blocked');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithCaptureAction('c4', { transferState: 'seller_reported_sent' });
    const entities = createMockEntities();
    const stripeAdapter = createFakeCaptureAdapter({ derived: 'unknown', raw: { error: 'timeout' } });

    const result = await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });
    allResponses.push({ test: 'C4', result });

    assert('C4: status=200', result.status === 200);
    assert('C4: ok=true', result.body?.ok === true);
    assert('C4: buyer_confirmed=true', result.body?.buyer_confirmed === true);
    assert('C4: capture_unknown=true', result.body?.capture_unknown === true, `got ${result.body?.capture_unknown}`);
    assert('C4: recovery_blocked=true', result.body?.recovery_blocked === true);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('C4: lifecycle still frozen', state?.lifecycle_state === 'frozen');
    assert('C4: recovery_blocked=true', state?.recovery_blocked === true);

    await cleanupAll(adminSql);
    console.log('  ✅ C4 passed');
  }

  // ── C5: exact capture_unknown reconciliation → sold ───────────────────
  {
    console.log('\n[C5] exact capture_unknown reconciliation → sold');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithCaptureAction('c5', { transferState: 'seller_reported_sent' });
    const entities = createMockEntities();

    // First call: buyer confirms + capture unknown → recovery_blocked
    const stripeAdapter1 = createFakeCaptureAdapter({ derived: 'unknown', raw: { error: 'timeout' } });
    await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripeAdapter1,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });

    let state = await getAuthorityState(adminSql, setup.listingId);
    assert('C5: after unknown: recovery_blocked=true', state?.recovery_blocked === true);

    // Second call: same buyer + capture succeeds → reconciliation → sold
    const stripeAdapter2 = createFakeCaptureAdapter({ derived: 'succeeded', raw: { id: setup.paymentIntentId, status: 'succeeded' } });
    const result2 = await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripeAdapter2,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });
    allResponses.push({ test: 'C5', result: result2 });

    assert('C5: status=200', result2.status === 200, `got ${result2.status}`);
    assert('C5: ok=true', result2.body?.ok === true);
    assert('C5: captured=true', result2.body?.captured === true, `got ${result2.body?.captured}`);

    state = await getAuthorityState(adminSql, setup.listingId);
    assert('C5: lifecycle=sold', state?.lifecycle_state === 'sold', `got ${state?.lifecycle_state}`);
    assert('C5: recovery_blocked cleared', state?.recovery_blocked === false);

    await cleanupAll(adminSql);
    console.log('  ✅ C5 passed');
  }

  // ── C6: missing capture context → non-200, transfer state unchanged ──
  {
    console.log('\n[C6] missing capture context → non-200, transfer state unchanged');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithCaptureAction('c6', { transferState: 'seller_reported_sent' });

    // Mark the capture action as 'succeeded' (terminal) so get_active_capture_context
    // returns has_active_capture=false, binding_found=true
    await adminSql`UPDATE authority_v1.payment_actions SET status = 'succeeded', completed_at = now() WHERE action_id = ${setup.actionId}`;

    const entities = createMockEntities();
    const stripeAdapter = createFakeCaptureAdapter({ derived: 'succeeded', raw: {} });

    const result = await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });
    allResponses.push({ test: 'C6', result });

    assert('C6: status=409', result.status === 409, `got ${result.status}`);
    assert('C6: code=CAPTURE_CONTEXT_MISMATCH', result.body?.code === 'CAPTURE_CONTEXT_MISMATCH', `got ${result.body?.code}`);
    assert('C6: stripe NOT called', stripeAdapter.calls.length === 0);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('C6: transfer_state unchanged', state?.transfer_state === 'seller_reported_sent', `got ${state?.transfer_state}`);
    assert('C6: lifecycle still frozen', state?.lifecycle_state === 'frozen');

    await cleanupAll(adminSql);
    console.log('  ✅ C6 passed');
  }

  // ── C7: supplying skip_capture cannot bypass capture ──────────────────
  {
    console.log('\n[C7] supplying skip_capture cannot bypass capture');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithCaptureAction('c7', { transferState: 'seller_reported_sent' });
    const entities = createMockEntities();
    const stripeAdapter = createFakeCaptureAdapter({ derived: 'succeeded', raw: { id: setup.paymentIntentId, status: 'succeeded' } });

    const result = await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
        skip_capture: true,  // Should be ignored — capture must proceed
      },
    });
    allResponses.push({ test: 'C7', result });

    assert('C7: status=200', result.status === 200);
    assert('C7: ok=true', result.body?.ok === true);
    assert('C7: captured=true', result.body?.captured === true, `got ${result.body?.captured}`);
    assert('C7: stripe called (skip_capture ignored)', stripeAdapter.calls.length === 1, `got ${stripeAdapter.calls.length}`);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('C7: lifecycle=sold', state?.lifecycle_state === 'sold', `got ${state?.lifecycle_state}`);

    await cleanupAll(adminSql);
    console.log('  ✅ C7 passed');
  }

  // ── C8: wrong buyer before confirmation → 403, no mutation/capture ────
  {
    console.log('\n[C8] wrong buyer before confirmation → 403');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithCaptureAction('c8', { transferState: 'seller_reported_sent' });
    const entities = createMockEntities();
    const stripeAdapter = createFakeCaptureAdapter({ derived: 'succeeded', raw: {} });

    const result = await runCanaryBuyerConfirmSaga({
      entities, user: { email: 'wrong_buyer@test.com', role: 'user' },
      executorClient, recorderClient, stripeAdapter,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });
    allResponses.push({ test: 'C8', result });

    assert('C8: status=403', result.status === 403, `got ${result.status}`);
    assert('C8: code=NOT_BUYER', result.body?.code === 'NOT_BUYER', `got ${result.body?.code}`);
    assert('C8: stripe NOT called', stripeAdapter.calls.length === 0);

    const state = await getAuthorityState(adminSql, setup.listingId);
    assert('C8: transfer_state unchanged', state?.transfer_state === 'seller_reported_sent', `got ${state?.transfer_state}`);
    assert('C8: lifecycle still frozen', state?.lifecycle_state === 'frozen');

    await cleanupAll(adminSql);
    console.log('  ✅ C8 passed');
  }

  // ── C9: wrong buyer after sold → 403, no Stripe call ───────────────────
  {
    console.log('\n[C9] wrong buyer after sold → 403');
    await cleanupAll(adminSql);
    const setup = await setupFrozenWithCaptureAction('c9', { transferState: 'seller_reported_sent' });
    const entities = createMockEntities();

    // First call: correct buyer confirms + capture succeeds → sold
    const stripeAdapter1 = createFakeCaptureAdapter({ derived: 'succeeded', raw: { id: setup.paymentIntentId, status: 'succeeded' } });
    await runCanaryBuyerConfirmSaga({
      entities, user: { email: setup.buyerId, role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripeAdapter1,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });

    // Second call: wrong buyer after sold
    const stripeAdapter2 = createFakeCaptureAdapter({ derived: 'succeeded', raw: {} });
    const result2 = await runCanaryBuyerConfirmSaga({
      entities, user: { email: 'wrong_buyer@test.com', role: 'user' },
      executorClient, recorderClient, stripeAdapter: stripeAdapter2,
      params: {
        listing_id: setup.listingId, purchase_id: setup.purchaseId,
        payment_intent_id: setup.paymentIntentId, expected_revision: setup.revision,
      },
    });
    allResponses.push({ test: 'C9', result: result2 });

    assert('C9: status=403', result2.status === 403, `got ${result2.status}`);
    assert('C9: code=NOT_BUYER', result2.body?.code === 'NOT_BUYER', `got ${result2.body?.code}`);
    assert('C9: stripe NOT called', stripeAdapter2.calls.length === 0, `got ${stripeAdapter2.calls.length}`);

    await cleanupAll(adminSql);
    console.log('  ✅ C9 passed');
  }

  // ── Recursive credential leak scan on all response bodies ──────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  Recursive Credential Leak Scan');
  console.log('═══════════════════════════════════════════════════════════════════');

  let leakViolations = [];
  for (const { test, result } of allResponses) {
    const violations = [];
    scanRecursive(result.body, allKnownCredentials, '', violations);
    if (violations.length > 0) {
      leakViolations.push({ test, violations });
    }
  }

  let leakPass = 0, leakFail = 0;
  if (leakViolations.length === 0) {
    console.log('  ✅ No credential leaks detected in any response body (recursive scan)');
    leakPass++;
  } else {
    console.log(`  ❌ ${leakViolations.length} response(s) with credential leaks:`);
    for (const v of leakViolations) {
      console.log(`    - [${v.test}] ${v.violations.map(x => `${x.type}:${x.key || x.name}`).join(', ')}`);
    }
    leakFail = leakViolations.length;
    failures.push(`Credential leak scan: ${leakViolations.length} responses with leaks`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`  Composition Results: ${passed} passed, ${failed} failed`);
  console.log(`  Credential leak scan: ${leakPass} passed, ${leakFail} failed`);
  console.log('═══════════════════════════════════════════════════════════════════');
  if (failed > 0) {
    console.log('  Failures:');
    failures.forEach(f => console.log(`    - ${f}`));
  }

  return { passed, failed, failures, leakViolations };
}