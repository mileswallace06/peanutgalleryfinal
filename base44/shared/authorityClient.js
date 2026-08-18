/**
 * authorityClient.js — Runtime-only authority client (executor-only).
 *
 * Phase 1B F.3.1 ARTIFACT-AND-RUNTIME-BOUNDARY CORRECTION.
 *
 * This module is the ONLY authority client importable by production handlers.
 * It provides executor-only access to 6 allowlisted SECURITY DEFINER functions.
 *
 * SECURITY RULES:
 *   - No admin URL parameter. No admin connection.
 *   - No arbitrary raw-SQL method. Allowlisted function calls only.
 *   - Executor role must be 'authority_probe_executor'.
 *   - Validates a real Neon dev fingerprint (hostname + database + role), not
 *     merely the database name 'neondb'.
 *   - Never logs, returns, or places credential-bearing values in errors.
 *   - Error messages contain only safe codes.
 *
 * Allowlisted methods:
 *   getState, initializeListing, reserveListing, releaseListing,
 *   getOperationResult, upsertIncident
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';

const EXECUTOR_ROLE = 'authority_probe_executor';

/**
 * Parse and validate a connection URL's fingerprint.
 * Checks role, hostname (Neon), and database name — not merely 'neondb'.
 * Never returns the password or full URL.
 */
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

  // Role must be the restricted executor
  if (role !== EXECUTOR_ROLE) {
    throw new Error('EXECUTOR_ROLE_MISMATCH');
  }

  // Hostname must be a Neon endpoint (real dev-environment fingerprint)
  if (!hostname.endsWith('.neon.tech') && !hostname.endsWith('.neon.build')) {
    throw new Error('HOSTNAME_NOT_NEON_DEV');
  }

  // Database must not be empty or the default 'postgres'
  if (!database || database === 'postgres') {
    throw new Error('DATABASE_NAME_INVALID');
  }

  return { role, hostname, database };
}

/**
 * Create a runtime-only authority client.
 *
 * @param {string} executorUrl - AUTHORITY_DB_URL_DEV_EXECUTOR
 * @returns {object} Client with 6 allowlisted methods + fingerprint metadata.
 */
export function createRuntimeClient(executorUrl) {
  const fingerprint = validateFingerprint(executorUrl);
  const sql = neon(executorUrl);

  // Internal helper: call an allowlisted SECURITY DEFINER function.
  // Only called with hardcoded function names — never exposed externally.
  const callFn = async (fnName, ...args) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const queryStr = `SELECT authority_probe_v2.${fnName}(${placeholders}) as result`;
    const rows = await sql(queryStr, args);
    return rows[0]?.result;
  };

  return {
    /** Fingerprint metadata (no credential values). */
    fingerprint: {
      role: fingerprint.role,
      hostname: fingerprint.hostname,
      database: fingerprint.database,
    },

    /**
     * Verify the authority_probe_v2 schema exists in this database.
     * Provides a real environment fingerprint check beyond the URL.
     */
    async verifyEnvironment() {
      const rows = await sql`
        SELECT 1 FROM information_schema.schemata
        WHERE schema_name = 'authority_probe_v2'
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

    /** initialize_listing(listing_id, seller_user_id, operation_id, payload) → JSONB */
    async initializeListing(listingId, sellerUserId, operationId, payload) {
      return callFn('initialize_listing', listingId, sellerUserId, operationId, JSON.stringify(payload));
    },

    /** reserve_listing(listing_id, expected_version, buyer_user_id, token_hash, expires_at, operation_id, payload) → JSONB */
    async reserveListing(listingId, expectedVersion, buyerUserId, tokenHash, expiresAt, operationId, payload) {
      return callFn('reserve_listing', listingId, expectedVersion, buyerUserId, tokenHash, expiresAt, operationId, JSON.stringify(payload));
    },

    /** release_listing(listing_id, expected_version, buyer_user_id, operation_id, payload) → JSONB */
    async releaseListing(listingId, expectedVersion, buyerUserId, operationId, payload) {
      return callFn('release_listing', listingId, expectedVersion, buyerUserId, operationId, JSON.stringify(payload));
    },

    /** get_operation_result(operation_id) → JSONB */
    async getOperationResult(operationId) {
      return callFn('get_operation_result', operationId);
    },

    /** upsert_incident(incident_key, incident_type, priority, title) → JSONB */
    async upsertIncident(incidentKey, incidentType, priority, title) {
      return callFn('upsert_incident', incidentKey, incidentType, priority, title);
    },
  };
}