import { neon } from 'npm:@neondatabase/serverless@0.10.4';
import { createHash, randomUUID } from 'node:crypto';

const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;
const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;

if (!executorUrl || !recorderUrl || !adminUrl) {
  console.log('Missing credentials');
  process.exit(1);
}

const adminSql = neon(adminUrl);

function sha256Hex(text) { return createHash('sha-256').update(text).digest('hex'); }
function genId() { return randomUUID().replace(/-/g, '').slice(0, 16); }
function genEmail(prefix) { return `${prefix}_${genId()}@test.peanutgallery.app`; }

const { createAuthorityV1Client } = await import('../base44/shared/authorityV1Client.js');
const { createAuthorityV1StripeRecorderClient } = await import('../base44/shared/authorityV1StripeRecorderClient.js');
const { runCanaryBuyerConfirmSaga } = await import('../base44/shared/buyerConfirmTransferCanaryOrchestrator.js');

const executorClient = createAuthorityV1Client(executorUrl);
const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

// Cleanup
await adminSql`DELETE FROM authority_v1.reservation_outbox`;
await adminSql`DELETE FROM authority_v1.stripe_webhook_events`;
await adminSql`DELETE FROM authority_v1.payment_actions`;
await adminSql`DELETE FROM authority_v1.operational_incidents`;
await adminSql`DELETE FROM authority_v1.reservation_payment_bindings`;
await adminSql`DELETE FROM authority_v1.reservation_operations`;
await adminSql`DELETE FROM authority_v1.reservation_authority`;

// Setup
const listingId = `debug_c2_${genId()}`;
const sellerId = genEmail('seller');
const buyerId = genEmail('buyer');
const tokenHash = sha256Hex(`token_c2_${genId()}`);
const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const purchaseId = `pur_c2_${genId()}`;
const paymentIntentId = `pi_c2_${genId()}`;
const actionId = `act_capture_c2_${genId()}`;
const stripeIdemKey = `idem_capture_${actionId}`;

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

const transferOpId = `op_transfer_${listingId}_${genId()}`;
const transferHash = sha256Hex(JSON.stringify({ op: 'begin_transfer', listing_id: listingId, expected_version: 2, seller_user_id: sellerId }));
await executorClient.beginTransfer(listingId, 2, sellerId, transferOpId, transferHash);

const reportOpId = `op_report_${listingId}_${genId()}`;
const reportHash = sha256Hex(JSON.stringify({ op: 'record_seller_report', listing_id: listingId, expected_version: 3, seller_user_id: sellerId }));
await executorClient.recordSellerReport(listingId, 3, sellerId, reportOpId, reportHash);

const stateBefore = await executorClient.getState(listingId);
console.log('State before first call:', JSON.stringify({ lifecycle: stateBefore?.lifecycle_state, transfer: stateBefore?.transfer_state, version: stateBefore?.version }));

const entities = {
  Listing: { update: async () => {} },
  ListingPrivate: { filter: async () => [], update: async () => {} },
  Purchase: { update: async () => {} },
  CanaryMirrorOutbox: { create: async () => {} },
  PurchasePrivate: { filter: async () => [] },
};

const stripeAdapter = {
  calls: [],
  async capturePaymentIntent(piId, idemKey) {
    this.calls.push({ piId, idemKey });
    return { derived: 'succeeded', raw: { id: paymentIntentId, status: 'succeeded' } };
  },
};

const result1 = await runCanaryBuyerConfirmSaga({
  entities, user: { email: buyerId, role: 'admin' },
  executorClient, recorderClient, stripeAdapter,
  params: {
    listing_id: listingId, purchase_id: purchaseId,
    payment_intent_id: paymentIntentId, expected_revision: revision,
  },
});

console.log('First call result:', JSON.stringify({ status: result1?.status, ok: result1?.body?.ok, captured: result1?.body?.captured, error: result1?.body?.error, code: result1?.body?.code, keys: Object.keys(result1?.body || {}) }));

const stateAfter = await executorClient.getState(listingId);
console.log('State after first call:', JSON.stringify({ lifecycle: stateAfter?.lifecycle_state, transfer: stateAfter?.transfer_state, version: stateAfter?.version }));

// Second call (replay)
const stripeAdapter2 = {
  calls: [],
  async capturePaymentIntent() { return { derived: 'succeeded', raw: {} }; },
};

const result2 = await runCanaryBuyerConfirmSaga({
  entities, user: { email: buyerId, role: 'admin' },
  executorClient, recorderClient, stripeAdapter: stripeAdapter2,
  params: {
    listing_id: listingId, purchase_id: purchaseId,
    payment_intent_id: paymentIntentId, expected_revision: revision,
  },
});

console.log('Second call result:', JSON.stringify({ status: result2?.status, ok: result2?.body?.ok, replay: result2?.body?.replay, error: result2?.body?.error, code: result2?.body?.code, keys: Object.keys(result2?.body || {}) }));

// Cleanup
await adminSql`DELETE FROM authority_v1.reservation_outbox`;
await adminSql`DELETE FROM authority_v1.stripe_webhook_events`;
await adminSql`DELETE FROM authority_v1.payment_actions`;
await adminSql`DELETE FROM authority_v1.operational_incidents`;
await adminSql`DELETE FROM authority_v1.reservation_payment_bindings`;
await adminSql`DELETE FROM authority_v1.reservation_operations`;
await adminSql`DELETE FROM authority_v1.reservation_authority`;

console.log('Done');