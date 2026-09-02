/**
 * Diagnostic: check what get_state returns for a sold listing.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register(pathToFileURL('./tests/loaders/npm-compat-hook.mjs').href, pathToFileURL('./').href);

import { createHash, randomUUID } from 'node:crypto';

function sha256Hex(text) { return createHash('sha-256').update(text).digest('hex'); }
function genId() { return randomUUID().replace(/-/g, '').slice(0, 16); }

const executorUrl = process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR;
const adminUrl = process.env.AUTHORITY_DB_URL_DEV_ADMIN;

const { neon } = await import('npm:@neondatabase/serverless@0.10.4');
const adminSql = neon(adminUrl);

const { createAuthorityV1Client } = await import('../base44/shared/authorityV1Client.js');
const executorClient = createAuthorityV1Client(executorUrl);

async function cleanup(sql) {
  await sql`DELETE FROM authority_v1.reservation_outbox`;
  await sql`DELETE FROM authority_v1.stripe_webhook_events`;
  await sql`DELETE FROM authority_v1.payment_actions`;
  await sql`DELETE FROM authority_v1.operational_incidents`;
  await sql`DELETE FROM authority_v1.reservation_payment_bindings`;
  await sql`DELETE FROM authority_v1.reservation_operations`;
  await sql`DELETE FROM authority_v1.reservation_authority`;
}

await cleanup(adminSql);

const listingId = `statediag_${genId()}`;
const sellerId = `seller_${genId()}@test.app`;
const buyerId = `buyer_${genId()}@test.app`;
const tokenHash = sha256Hex(`tok_${genId()}`);
const expiresAt = new Date(Date.now() + 600000).toISOString();
const purchaseId = `pur_${genId()}`;
const piId = `pi_${genId()}`;
const actionId = `act_${genId()}`;
const idemKey = `idem_${actionId}`;

await executorClient.initializeListing(listingId, sellerId, `op_${genId()}`, sha256Hex('init'));
const reserveResult = await executorClient.reserveListing(listingId, 0, buyerId, tokenHash, expiresAt, `op_${genId()}`, sha256Hex('reserve'));
const revision = reserveResult?.revision;
await executorClient.bindPaymentIntent(listingId, purchaseId, piId, buyerId, 1, revision, tokenHash, `op_${genId()}`, sha256Hex('bind'));
await executorClient.beginCapture(listingId, 1, purchaseId, piId, buyerId, revision, actionId, idemKey, `op_${genId()}`, sha256Hex('begin'));

// Mark as sold directly
await adminSql`UPDATE authority_v1.reservation_authority SET lifecycle_state = 'sold' WHERE listing_id = ${listingId}`;

const state = await executorClient.getState(listingId);
console.log('=== get_state return for sold listing ===');
console.log(JSON.stringify(state, null, 2));
console.log('=== type of state ===', typeof state);
console.log('=== state?.ok ===', state?.ok);
console.log('=== state?.lifecycle_state ===', state?.lifecycle_state);

await cleanup(adminSql);
console.log('=== done ===');