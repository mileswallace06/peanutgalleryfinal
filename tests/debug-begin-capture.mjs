import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
const { createHash, randomUUID } = await import('node:crypto');

const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;
const execUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const adminSql = neon(adminUrl);

await adminSql`DELETE FROM authority_v1.reservation_outbox`;
await adminSql`DELETE FROM authority_v1.stripe_webhook_events`;
await adminSql`DELETE FROM authority_v1.payment_actions`;
await adminSql`DELETE FROM authority_v1.operational_incidents`;
await adminSql`DELETE FROM authority_v1.reservation_payment_bindings`;
await adminSql`DELETE FROM authority_v1.reservation_operations`;
await adminSql`DELETE FROM authority_v1.reservation_authority`;

const { createAuthorityV1Client } = await import('./base44/shared/authorityV1Client.js');
const exec = createAuthorityV1Client(execUrl);

function sha256Hex(text) { return createHash('sha-256').update(text).digest('hex'); }
function genId() { return randomUUID().replace(/-/g, '').slice(0, 16); }

const listingId = `debug_${genId()}`;
const sellerId = `seller_${genId()}@test.com`;
const buyerId = `buyer_${genId()}@test.com`;
const tokenHash = sha256Hex(`tok_${genId()}`);
const revision = genId();
const expiresAt = new Date(Date.now() + 600000).toISOString();
const purchaseId = `pur_${genId()}`;
const piId = `pi_${genId()}`;
const actionId = `act_${genId()}`;
const idemKey = `idem_${actionId}`;

const initOp = `op_init_${genId()}`;
const initHash = sha256Hex(JSON.stringify({ op: 'initialize', listing_id: listingId, seller_user_id: sellerId }));
const initRes = await exec.initializeListing(listingId, sellerId, initOp, initHash);
console.log('init:', JSON.stringify(initRes));

const resOp = `op_res_${genId()}`;
const resHash = sha256Hex(JSON.stringify({ op: 'reserve', listing_id: listingId, expected_version: 0, buyer_user_id: buyerId, token_hash: tokenHash, expires_at: expiresAt }));
const resRes = await exec.reserveListing(listingId, 0, buyerId, tokenHash, expiresAt, resOp, resHash);
console.log('reserve:', JSON.stringify(resRes));

const bindOp = `op_bind_${genId()}`;
const bindHash = sha256Hex(JSON.stringify({ op: 'bind', listing_id: listingId, purchase_id: purchaseId, payment_intent_id: piId, buyer_user_id: buyerId, authority_version: 1, reservation_revision: revision, token_hash: tokenHash }));
const bindRes = await exec.bindPaymentIntent(listingId, purchaseId, piId, buyerId, 1, revision, tokenHash, bindOp, bindHash);
console.log('bind:', JSON.stringify(bindRes));

const beginOp = `op_begin_${genId()}`;
const beginHash = sha256Hex(JSON.stringify({ op: 'begin_capture', listing_id: listingId, expected_version: 1, purchase_id: purchaseId, payment_intent_id: piId, buyer_user_id: buyerId, action_id: actionId, idem_key: idemKey }));
const beginRes = await exec.beginCapture(listingId, 1, purchaseId, piId, buyerId, revision, actionId, idemKey, beginOp, beginHash);
console.log('begin_capture:', JSON.stringify(beginRes));

const state = await adminSql`SELECT version, lifecycle_state, transfer_state FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}`;
console.log('state:', JSON.stringify(state));

await adminSql`DELETE FROM authority_v1.reservation_outbox`;
await adminSql`DELETE FROM authority_v1.stripe_webhook_events`;
await adminSql`DELETE FROM authority_v1.payment_actions`;
await adminSql`DELETE FROM authority_v1.operational_incidents`;
await adminSql`DELETE FROM authority_v1.reservation_payment_bindings`;
await adminSql`DELETE FROM authority_v1.reservation_operations`;
await adminSql`DELETE FROM authority_v1.reservation_authority`;