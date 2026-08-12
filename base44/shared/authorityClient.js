/**
 * authorityClient.js — Reusable authority client foundation.
 *
 * Uses ONLY AUTHORITY_DB_URL_DEV_EXECUTOR (never the admin credential).
 *
 * Requirements satisfied:
 *   - Fixed allowlisted stored-function calls (no arbitrary SQL method)
 *   - Connection and operation timeouts
 *   - Structured error classification
 *   - Secret-safe logging/redaction
 *   - Unknown responses remain unknown
 *   - No automatic assumption that a timed-out write failed
 *   - Operation lookup/recovery by operation ID
 *
 * NOT imported into production entry points during this round.
 */

import { neon } from 'npm:@neondatabase/serverless';

const ALLOWED_FUNCTIONS = new Set([
  'initialize_listing',
  'reserve_listing',
  'release_listing',
  'get_state',
  'get_operation',
  'create_incident',
]);

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Classify a database error into a structured code.
 * Unknown responses remain unknown — never assume a timed-out write failed.
 */
function classifyError(error) {
  const msg = error?.message || String(error);
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('fetch timed out')) {
    return { code: 'TIMEOUT', retryable: true, message: 'Request timed out — write may have succeeded' };
  }
  if (msg.includes('connection') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return { code: 'CONNECTION_ERROR', retryable: true, message: 'Connection error' };
  }
  if (msg.includes('permission') || msg.includes('42501') || msg.includes('PRIVILEGE')) {
    return { code: 'PERMISSION_DENIED', retryable: false, message: 'Permission denied' };
  }
  return { code: 'UNKNOWN', retryable: false, message: msg.substring(0, 200) };
}

/**
 * Redact credentials from a connection URL for safe logging.
 */
function redactUrl(url) {
  if (!url) return '<none>';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}:${u.port || '5432'}/${u.pathname.slice(1)}`;
  } catch {
    return '<redacted>';
  }
}

/**
 * Create an authority client bound to the executor credential.
 *
 * @param {Object} opts
 * @param {string} opts.executorUrl — AUTHORITY_DB_URL_DEV_EXECUTOR value
 * @param {number} [opts.timeoutMs=5000] — operation timeout
 * @returns {Object} — allowlisted function callers
 */
export function createAuthorityClient({ executorUrl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!executorUrl) {
    throw new Error('AUTHORITY_CLIENT_NO_SECRET: executorUrl is required');
  }

  const sql = neon(executorUrl, { fullResults: true, fetchTimeout: timeoutMs });
  const _redactedUrl = redactUrl(executorUrl);

  async function call(functionName, queryFn) {
    if (!ALLOWED_FUNCTIONS.has(functionName)) {
      throw new Error(`AUTHORITY_CLIENT_FUNCTION_NOT_ALLOWED: ${functionName}`);
    }
    try {
      const response = await queryFn(sql);
      const rows = response.rows || response;
      if (!rows || rows.length === 0) {
        return { ok: false, code: 'EMPTY_RESULT', retryable: true };
      }
      const result = rows[0].result;
      if (typeof result === 'string') {
        try {
          return JSON.parse(result);
        } catch {
          return { ok: false, code: 'PARSE_ERROR', raw: result.substring(0, 200) };
        }
      }
      return result;
    } catch (error) {
      const classified = classifyError(error);
      return {
        ok: false,
        code: classified.code,
        retryable: classified.retryable,
        message: classified.message,
      };
    }
  }

  return {
    /** Redacted URL for safe logging (no credentials). */
    _redactedUrl,

    async initializeListing(listingId, sellerUserId, operationId) {
      return call('initialize_listing', (s) =>
        s`SELECT authority_probe_v2.initialize_listing(${listingId}, ${sellerUserId}, ${operationId}) AS result`);
    },

    async reserveListing(listingId, expectedVersion, buyerUserId, tokenHash, expiresAt, operationId) {
      return call('reserve_listing', (s) =>
        s`SELECT authority_probe_v2.reserve_listing(${listingId}, ${expectedVersion}, ${buyerUserId}, ${tokenHash}, ${expiresAt}, ${operationId}) AS result`);
    },

    async releaseListing(listingId, expectedVersion, buyerUserId, operationId) {
      return call('release_listing', (s) =>
        s`SELECT authority_probe_v2.release_listing(${listingId}, ${expectedVersion}, ${buyerUserId}, ${operationId}) AS result`);
    },

    async getState(listingId) {
      return call('get_state', (s) =>
        s`SELECT authority_probe_v2.get_state(${listingId}) AS result`);
    },

    /** Operation lookup/recovery by operation ID. */
    async getOperation(operationId) {
      return call('get_operation', (s) =>
        s`SELECT authority_probe_v2.get_operation(${operationId}) AS result`);
    },

    async createIncident(incidentKey, incidentType, priority, title) {
      return call('create_incident', (s) =>
        s`SELECT authority_probe_v2.create_incident(${incidentKey}, ${incidentType}, ${priority}, ${title}) AS result`);
    },
  };
}