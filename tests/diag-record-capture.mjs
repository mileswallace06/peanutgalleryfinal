/**
 * Diagnostic: call record_capture_result directly and print the sanitized return.
 * Does NOT print any credential-bearing values.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

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

const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;
const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
const adminSql = neon(adminUrl);

const { createAuthorityV1Client } = await import('../base44/shared/authorityV1Client.js');
const { createAuthorityV1StripeRecorderClient } = await import('../base44/shared/authorityV1StripeRecorderClient.js');

const executorClient = createAuthorityV1Client(executorUrl);
const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

// ── Cleanup ─────────────────────────────────────────────────────────────────
async function cleanupAll(sql) {
  await sql`DELETE FROM authority_v1.reservation_outbox`;
  await sql`DELETE FROM authority_v1.stripe_webhook_events`;
  await sql`DELETE FROM authority_v1.payment_actions`;
  await sql`DELETE FROM authority_v1.operational_incidents`;
  await sql`DELETE FROM authority_v1.reservation_payment_bindings`;
  await sql`DELETE FROM authority_v1.reservation_operations`;
  await sql`DELETE FROM authority_v1.reservation_authority`;
}

await cleanupAll(adminSql);

// ── Setup: frozen listing with capture action ──────────────────────────────
const listingId = `diag_${genId()}`;
const sellerId = genEmail('seller');
const buyerId = genEmail('buyer');
const tokenHash = sha256Hex(`token_diag_${genId()}`);
const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const purchaseId = `pur_diag_${genId()}`;
const paymentIntentId = `pi_diag_${genId()}`;
const actionId = `act_capture_diag_${genId()}`;
const stripeIdemKey = `idem_capture_${actionId}`;

// 1. Initialize
const initOpId = `op_init_${listingId}_${genId()}`;
const initHash = sha256Hex(JSON.stringify({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
await executorClient.initializeListing(listingId, sellerId, initOpId, initHash);

// 2. Reserve — capture revision
const reserveOpId = `op_reserve_${listingId}_${genId()}`;
const reserveHash = sha256Hex(JSON.stringify({ op: 'reserve', listing_id: listingId, expected_version: 0, buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt }));
const reserveResult = await executorClient.reserveListing(listingId, 0, buyerId, tokenHash, expiresAt, reserveOpId, reserveHash);
const revision = reserveResult?.revision;

// 3. Bind payment intent
const bindOpId = `op_bind_${listingId}_${genId()}`;
const bindHash = sha256Hex(JSON.stringify({ op: 'bind', listing_id: listingId, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, authority_version: 1, reservation_revision: revision, token_hash: tokenHash }));
await executorClient.bindPaymentIntent(listingId, purchaseId, paymentIntentId, buyerId, 1, revision, tokenHash, bindOpId, bindHash);

// 4. Begin capture (reserved → frozen)
const beginOpId = `op_begin_${listingId}_${genId()}`;
const beginHash = sha256Hex(JSON.stringify({ op: 'begin_capture', listing_id: listingId, expected_version: 1, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, action_id: actionId, idem_key: stripeIdemKey }));
const beginResult = await executorClient.beginCapture(listingId, 1, purchaseId, paymentIntentId, buyerId, revision, actionId, stripeIdemKey, beginOpId, beginHash);

console.log('=== begin_capture result (sanitized) ===');
console.log(JSON.stringify({ ok: beginResult?.ok, lifecycle_state: beginResult?.lifecycle_state, version: beginResult?.version, code: beginResult?.code }, null, 2));

// ── Check DB state before record_capture_result ────────────────────────────
const actionRow = await adminSql`
  SELECT action_id, action_type, status, lease_owner, lease_expires_at
  FROM authority_v1.payment_actions WHERE action_id = ${actionId}
`;
console.log('=== payment_actions state ===');
console.log(JSON.stringify(actionRow[0], null, 2));

const bindingRow = await adminSql`
  SELECT purchase_id, capture_state, frozen_authority_version, frozen_reservation_revision
  FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}
`;
console.log('=== reservation_payment_bindings state ===');
console.log(JSON.stringify(bindingRow[0], null, 2));

const authorityRow = await adminSql`
  SELECT listing_id, version, lifecycle_state, recovery_blocked
  FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}
`;
console.log('=== reservation_authority state ===');
console.log(JSON.stringify(authorityRow[0], null, 2));

// ── Call record_capture_result directly ────────────────────────────────────
const recordOpId = `op_record_${actionId}_${genId()}`;
const recordHash = sha256Hex(JSON.stringify({ op: 'record_capture', action_id: actionId, result: 'succeeded' }));

const recordResult = await recorderClient.recordCaptureResult(
  actionId, 'succeeded', { id: paymentIntentId, status: 'succeeded' }, null, recordOpId, recordHash,
);

console.log('=== record_capture_result return (sanitized) ===');
// Strip any credential-bearing fields
const sanitized = { ...recordResult };
delete sanitized.stripe_idempotency_key;
delete sanitized.action_id;
console.log(JSON.stringify(sanitized, null, 2));

// ── Check DB state after ───────────────────────────────────────────────────
const bindingAfter = await adminSql`
  SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}
`;
console.log('=== binding capture_state after ===');
console.log(JSON.stringify(bindingAfter[0], null, 2));

const authorityAfter = await adminSql`
  SELECT version, lifecycle_state FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}
`;
console.log('=== authority lifecycle after ===');
console.log(JSON.stringify(authorityAfter[0], null, 2));

await cleanupAll(adminSql);
console.log('=== done ===');