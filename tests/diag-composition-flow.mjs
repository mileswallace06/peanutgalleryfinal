/**
 * Diagnostic: simulate the full composition flow (buyer confirm → capture)
 * to inspect what record_capture_result returns after buyer confirmation.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

import { createHash, randomUUID } from 'node:crypto';

function sha256Hex(text) { return createHash('sha-256').update(text).digest('hex'); }
function genId() { return randomUUID().replace(/-/g, '').slice(0, 16); }
function genEmail(prefix = 'user') { return `${prefix}_${genId()}@test.peanutgallery.app`; }

const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const recorderUrl = process.env.AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER;
const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
const adminSql = neon(adminUrl);

const { createAuthorityV1Client } = await import('../base44/shared/authorityV1Client.js');
const { createAuthorityV1StripeRecorderClient } = await import('../base44/shared/authorityV1StripeRecorderClient.js');

const executorClient = createAuthorityV1Client(executorUrl);
const recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint);

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

// ── Setup: frozen listing with capture action + seller report ─────────────
const listingId = `diag2_${genId()}`;
const sellerId = genEmail('seller');
const buyerId = genEmail('buyer');
const tokenHash = sha256Hex(`token_diag2_${genId()}`);
const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const purchaseId = `pur_diag2_${genId()}`;
const paymentIntentId = `pi_diag2_${genId()}`;
const actionId = `act_capture_diag2_${genId()}`;
const stripeIdemKey = `idem_capture_${actionId}`;

// 1. Initialize
const initOpId = `op_init_${listingId}_${genId()}`;
const initHash = sha256Hex(JSON.stringify({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
await executorClient.initializeListing(listingId, sellerId, initOpId, initHash);

// 2. Reserve
const reserveOpId = `op_reserve_${listingId}_${genId()}`;
const reserveHash = sha256Hex(JSON.stringify({ op: 'reserve', listing_id: listingId, expected_version: 0, buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt }));
const reserveResult = await executorClient.reserveListing(listingId, 0, buyerId, tokenHash, expiresAt, reserveOpId, reserveHash);
const revision = reserveResult?.revision;

// 3. Bind
const bindOpId = `op_bind_${listingId}_${genId()}`;
const bindHash = sha256Hex(JSON.stringify({ op: 'bind', listing_id: listingId, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, authority_version: 1, reservation_revision: revision, token_hash: tokenHash }));
await executorClient.bindPaymentIntent(listingId, purchaseId, paymentIntentId, buyerId, 1, revision, tokenHash, bindOpId, bindHash);

// 4. Begin capture
const beginOpId = `op_begin_${listingId}_${genId()}`;
const beginHash = sha256Hex(JSON.stringify({ op: 'begin_capture', listing_id: listingId, expected_version: 1, purchase_id: purchaseId, payment_intent_id: paymentIntentId, buyer_user_id: buyerId, action_id: actionId, idem_key: stripeIdemKey }));
await executorClient.beginCapture(listingId, 1, purchaseId, paymentIntentId, buyerId, revision, actionId, stripeIdemKey, beginOpId, beginHash);

// 5. Begin transfer + seller report
const transferOpId = `op_transfer_${listingId}_${genId()}`;
const transferHash = sha256Hex(JSON.stringify({ op: 'begin_transfer', listing_id: listingId, expected_version: 2, seller_user_id: sellerId }));
await executorClient.beginTransfer(listingId, 2, sellerId, transferOpId, transferHash);

const reportOpId = `op_report_${listingId}_${genId()}`;
const reportHash = sha256Hex(JSON.stringify({ op: 'record_seller_report', listing_id: listingId, expected_version: 3, seller_user_id: sellerId }));
await executorClient.recordSellerReport(listingId, 3, sellerId, reportOpId, reportHash);

// ── Check state before buyer confirmation ──────────────────────────────────
let stateBefore = await executorClient.getState(listingId);
console.log('=== State before buyer confirmation ===');
console.log(JSON.stringify({ ok: stateBefore?.ok, version: stateBefore?.version, lifecycle_state: stateBefore?.lifecycle_state, transfer_state: stateBefore?.transfer_state }, null, 2));

let bindingBefore = await adminSql`
  SELECT capture_state, frozen_authority_version, frozen_reservation_revision
  FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}
`;
console.log('=== Binding before buyer confirmation ===');
console.log(JSON.stringify(bindingBefore[0], null, 2));

// ── 6. Buyer confirmation ──────────────────────────────────────────────────
const confirmOpId = `op_buyer_confirm_${listingId}_${genId()}`;
const confirmHash = sha256Hex(JSON.stringify({ op: 'record_buyer_confirmation', listing_id: listingId, expected_version: 4, buyer_user_id: buyerId, purchase_id: purchaseId }));
const confirmResult = await executorClient.recordBuyerTransferConfirmation(listingId, 4, buyerId, purchaseId, confirmOpId, confirmHash);

console.log('=== Buyer confirmation result ===');
console.log(JSON.stringify({ ok: confirmResult?.ok, version: confirmResult?.version, transfer_state: confirmResult?.transfer_state, code: confirmResult?.code }, null, 2));

// ── Check state after buyer confirmation ───────────────────────────────────
let stateAfter = await executorClient.getState(listingId);
console.log('=== State after buyer confirmation ===');
console.log(JSON.stringify({ ok: stateAfter?.ok, version: stateAfter?.version, lifecycle_state: stateAfter?.lifecycle_state, transfer_state: stateAfter?.transfer_state }, null, 2));

let bindingAfter = await adminSql`
  SELECT capture_state, frozen_authority_version, frozen_reservation_revision
  FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}
`;
console.log('=== Binding after buyer confirmation ===');
console.log(JSON.stringify(bindingAfter[0], null, 2));

let authorityAfter = await adminSql`
  SELECT version, lifecycle_state, reservation_revision, recovery_blocked
  FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}
`;
console.log('=== Authority after buyer confirmation ===');
console.log(JSON.stringify(authorityAfter[0], null, 2));

// ── 7. Record capture result (succeeded) ───────────────────────────────────
const recordOpId = `op_record_${actionId}_${genId()}`;
const recordHash = sha256Hex(JSON.stringify({ op: 'record_capture', action_id: actionId, result: 'succeeded' }));

const recordResult = await recorderClient.recordCaptureResult(
  actionId, 'succeeded', { id: paymentIntentId, status: 'succeeded' }, null, recordOpId, recordHash,
);

console.log('=== record_capture_result return (sanitized) ===');
const sanitized = { ...recordResult };
delete sanitized.stripe_idempotency_key;
delete sanitized.action_id;
console.log(JSON.stringify(sanitized, null, 2));

// ── Check final state ──────────────────────────────────────────────────────
let bindingFinal = await adminSql`SELECT capture_state FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}`;
let authorityFinal = await adminSql`SELECT version, lifecycle_state FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}`;
console.log('=== Final binding capture_state ===');
console.log(JSON.stringify(bindingFinal[0], null, 2));
console.log('=== Final authority lifecycle ===');
console.log(JSON.stringify(authorityFinal[0], null, 2));

await cleanupAll(adminSql);
console.log('=== done ===');