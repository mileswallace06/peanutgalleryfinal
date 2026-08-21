/**
 * authorityV1Client.js — Runtime-only authority_v1 client (executor-only).
 *
 * Executor-only client for the authority_v1 Postgres schema. Postgres is
 * authoritative; Base44 is mirror-only. No fallback.
 *
 * SECURITY RULES:
 *   - No admin URL. No admin connection.
 *   - No arbitrary raw-SQL method. Allowlisted function calls only.
 *   - Executor role must be 'authority_executor' (the dedicated authority_v1
 *     executor role; NOT the legacy authority_probe_executor).
 *   - Secret is read by the handler via secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR')
 *     from base44:runtime and passed into createAuthorityV1Client.
 *   - Validates a real Neon dev fingerprint (hostname + database + role).
 *   - Never logs, returns, or places credential-bearing values in errors.
 *
 * Allowlisted methods:
 *   getState, initializeListing, reserveListing, releaseListing,
 *   bindPaymentIntent, beginCancel, recordCancelResult, abortBinding,
 *   expireListing
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';

const EXECUTOR_ROLE = 'authority_executor';

function validateFingerprint(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    throw new Error('EXECUTOR_URL_REQUIRED');
  }
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('EXECUTOR_URL_INVALID');
  }

  const role = decodeURIComponent(parsed.username);
  const hostname = parsed.hostname;
  const database = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';

  if (role !== EXECUTOR_ROLE) {
    throw new Error('EXECUTOR_ROLE_MISMATCH');
  }
  if (!hostname.endsWith('.neon.tech') && !hostname.endsWith('.neon.build')) {
    throw new Error('HOSTNAME_NOT_NEON_DEV');
  }
  if (!database || database === 'postgres') {
    throw new Error('DATABASE_NAME_INVALID');
  }

  return { role, hostname, database };
}

/**
 * Create a runtime-only authority_v1 client.
 * @param {string} executorUrl - AUTHORITY_DB_URL_DEV_EXECUTOR
 */
export function createAuthorityV1Client(executorUrl) {
  const fingerprint = validateFingerprint(executorUrl);
  const sql = neon(executorUrl);

  const callFn = async (fnName, ...args) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const queryStr = `SELECT authority_v1.${fnName}(${placeholders}) as result`;
    const rows = await sql(queryStr, args);
    return rows[0]?.result;
  };

  return {
    fingerprint: {
      role: fingerprint.role,
      hostname: fingerprint.hostname,
      database: fingerprint.database,
    },

    async verifyEnvironment() {
      const rows = await sql`
        SELECT 1 FROM information_schema.schemata
        WHERE schema_name = 'authority_v1'
      `;
      if (!rows || rows.length === 0) {
        throw new Error('SCHEMA_NOT_FOUND');
      }
      return true;
    },

    /** get_state(listing_id) → JSONB */
    async getState(listingId) {
      return callFn('get_state', listingId);
    },

    /** initialize_listing(listing_id, seller_user_id, operation_id, request_hash) → JSONB */
    async initializeListing(listingId, sellerUserId, operationId, requestHash) {
      return callFn('initialize_listing', listingId, sellerUserId, operationId, requestHash);
    },

    /** reserve_listing(listing_id, expected_version, buyer_user_id, token_hash, expires_at, operation_id, request_hash) → JSONB */
    async reserveListing(listingId, expectedVersion, buyerUserId, tokenHash, expiresAt, operationId, requestHash) {
      return callFn('reserve_listing', listingId, expectedVersion, buyerUserId, tokenHash, expiresAt, operationId, requestHash);
    },

    /** release_listing(listing_id, expected_version, operation_id, request_hash) → JSONB */
    async releaseListing(listingId, expectedVersion, operationId, requestHash) {
      return callFn('release_listing', listingId, expectedVersion, operationId, requestHash);
    },

    /** expire_listing(listing_id, expected_version, operation_id, request_hash) → JSONB */
    async expireListing(listingId, expectedVersion, operationId, requestHash) {
      return callFn('expire_listing', listingId, expectedVersion, operationId, requestHash);
    },

    /** bind_payment_intent(listing_id, purchase_id, payment_intent_id, buyer_user_id, authority_version, reservation_revision, token_hash, operation_id, request_hash) → JSONB */
    async bindPaymentIntent(listingId, purchaseId, paymentIntentId, buyerUserId, authorityVersion, reservationRevision, tokenHash, operationId, requestHash) {
      return callFn('bind_payment_intent', listingId, purchaseId, paymentIntentId, buyerUserId, authorityVersion, reservationRevision, tokenHash, operationId, requestHash);
    },

    /** begin_cancel(listing_id, expected_version, purchase_id, payment_intent_id, buyer_user_id, expected_revision, action_id, stripe_idem_key, operation_id, request_hash) → JSONB */
    async beginCancel(listingId, expectedVersion, purchaseId, paymentIntentId, buyerUserId, expectedRevision, actionId, stripeIdemKey, operationId, requestHash) {
      return callFn('begin_cancel', listingId, expectedVersion, purchaseId, paymentIntentId, buyerUserId, expectedRevision, actionId, stripeIdemKey, operationId, requestHash);
    },

    /** record_cancel_result(action_id, result_derived, stripe_response, worker_id, operation_id, request_hash) → JSONB */
    async recordCancelResult(actionId, resultDerived, stripeResponse, workerId, operationId, requestHash) {
      return callFn('record_cancel_result', actionId, resultDerived, stripeResponse, workerId, operationId, requestHash);
    },

    /** abort_binding(listing_id, expected_version, purchase_id, operation_id, request_hash) → JSONB */
    async abortBinding(listingId, expectedVersion, purchaseId, operationId, requestHash) {
      return callFn('abort_binding', listingId, expectedVersion, purchaseId, operationId, requestHash);
    },
  };
}