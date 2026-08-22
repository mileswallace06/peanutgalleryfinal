/**
 * authorityV1StripeRecorderClient.js — Runtime-only authority_v1 client
 * (authority_stripe_recorder role).
 *
 * P0-01G PAYMENT-SAGA CANCELLATION HANDLER INTEGRATION.
 *
 * Recorder-only client for the authority_v1 Postgres schema. Used by
 * abortCheckout canary orchestrator to record Stripe cancellation results.
 * Postgres is authoritative; Base44 is mirror-only. No fallback.
 *
 * SECURITY RULES:
 *   - Reads ONLY AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER.
 *   - No admin URL. No executor URL. No admin connection. No executor connection.
 *   - No arbitrary raw-SQL method. Allowlisted function calls only.
 *   - Role must be exactly 'authority_stripe_recorder'.
 *   - Database and hostname must match the executor connection fingerprint
 *     (same Neon dev database).
 *   - Never logs, returns, or places credential-bearing values in errors.
 *
 * Allowlisted methods (recorder-granted only, per 004_roles_and_grants.sql §11):
 *   recordCancelResult, recordCaptureResult, recordRefundResult
 *
 * NOT included — executor-only:
 *   beginCancel, beginCapture, beginRefund, reserveListing, releaseListing, etc.
 * The recorder role lacks EXECUTE on these by design.
 *
 * finalizeSale is NOT exposed — record_capture_result atomically finalizes
 * the sale on succeeded capture (binding → finalized, authority → sold).
 * The recorder role cannot call finalize_sale directly.
 *
 * COMPLETELY SEPARATE from authorityV1Client.js (executor) and
 * authorityV1TestAdmin.js (admin/test). No shared state, no cross-imports.
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';

const RECORDER_ROLE = 'authority_stripe_recorder';

/**
 * Validate the recorder URL fingerprint.
 * Throws on mismatch — never includes credential values in errors.
 */
export function validateRecorderFingerprint(urlStr, executorFingerprint) {
  if (!urlStr || typeof urlStr !== 'string') {
    throw new Error('RECORDER_URL_REQUIRED');
  }
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('RECORDER_URL_INVALID');
  }

  const role = decodeURIComponent(parsed.username);
  const hostname = parsed.hostname;
  const database = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';

  if (role !== RECORDER_ROLE) {
    throw new Error('RECORDER_ROLE_MISMATCH');
  }
  if (!hostname.endsWith('.neon.tech') && !hostname.endsWith('.neon.build')) {
    throw new Error('HOSTNAME_NOT_NEON_DEV');
  }
  if (!database || database === 'postgres') {
    throw new Error('DATABASE_NAME_INVALID');
  }

  // Cross-check: database and hostname must match the executor fingerprint
  if (executorFingerprint) {
    if (hostname !== executorFingerprint.hostname) {
      throw new Error('HOSTNAME_MISMATCH_EXECUTOR');
    }
    if (database !== executorFingerprint.database) {
      throw new Error('DATABASE_MISMATCH_EXECUTOR');
    }
  }

  return { role, hostname, database };
}

/**
 * Create a runtime-only authority_v1 recorder client.
 * @param {string} recorderUrl - AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER
 * @param {{hostname:string,database:string}} [executorFingerprint] - optional cross-check
 */
export function createAuthorityV1StripeRecorderClient(recorderUrl, executorFingerprint) {
  const fingerprint = validateRecorderFingerprint(recorderUrl, executorFingerprint);
  const sql = neon(recorderUrl);

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

    /**
     * record_cancel_result(action_id, result_derived, stripe_response_jsonb,
     *   worker_id, operation_id, request_hash) → JSONB
     *
     * Records the Stripe cancellation result. Idempotent: same operation_id +
     * request_hash returns the stored result. Conflicting hash returns
     * OPERATION_ID_CONFLICT structured result.
     */
    async recordCancelResult(actionId, resultDerived, stripeResponse, workerId, operationId, requestHash) {
      return callFn('record_cancel_result',
        actionId, resultDerived, JSON.stringify(stripeResponse), workerId, operationId, requestHash);
    },

    /**
     * record_capture_result(action_id, result_derived, stripe_response_jsonb,
     *   worker_id, operation_id, request_hash) → JSONB
     */
    async recordCaptureResult(actionId, resultDerived, stripeResponse, workerId, operationId, requestHash) {
      return callFn('record_capture_result',
        actionId, resultDerived, JSON.stringify(stripeResponse), workerId, operationId, requestHash);
    },

    /**
     * record_refund_result(action_id, result_derived, stripe_response_jsonb,
     *   worker_id, operation_id, request_hash) → JSONB
     */
    async recordRefundResult(actionId, resultDerived, stripeResponse, workerId, operationId, requestHash) {
      return callFn('record_refund_result',
        actionId, resultDerived, JSON.stringify(stripeResponse), workerId, operationId, requestHash);
    },

  };
}