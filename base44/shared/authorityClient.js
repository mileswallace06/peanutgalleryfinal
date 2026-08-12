/**
 * authorityClient.js — Durable shared authority client for authority_probe_v2.
 *
 * Phase 1B F.3 RETAIN-AND-CERTIFY gate.
 *
 * This module provides a factory that creates admin and executor SQL
 * functions backed by @neondatabase/serverless in HTTP mode (neon()).
 *
 * SECURITY RULES:
 *   - Secrets are read inside the handler via secrets.get(), never at module
 *     scope. The factory receives the resolved URL values as parameters.
 *   - The executor URL must parse to role 'authority_probe_executor'.
 *   - Never falls back from executor to admin.
 *   - Never prints, returns, logs, or places either connection value in an
 *     error message. Error messages contain only safe codes.
 *   - The admin connection is used ONLY for schema/privilege administration.
 *   - The executor connection is used for ALL runtime calls and privilege
 *     tests.
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';

/**
 * Validate that a connection string parses to the expected role.
 * Returns the role name without exposing the password or full URL.
 * @param {string} urlStr
 * @param {string} expectedRole
 * @returns {{ valid: boolean, role: string, database: string }}
 */
function validateUrl(urlStr, expectedRole) {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, role: '', database: '' };
  }
  try {
    const parsed = new URL(urlStr);
    const role = decodeURIComponent(parsed.username);
    const database = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
    return {
      valid: role === expectedRole,
      role,
      database
    };
  } catch {
    return { valid: false, role: '', database: '' };
  }
}

/**
 * Create an authority client with admin and executor SQL functions.
 *
 * @param {string} adminUrl - AUTHORITY_DB_URL_DEV_ADMIN (admin/owner connection)
 * @param {string} executorUrl - AUTHORITY_DB_URL_DEV_EXECUTOR (restricted executor)
 * @returns {{ admin: Function, executor: Function, validation: object }}
 */
export function createAuthorityClient(adminUrl, executorUrl) {
  if (!adminUrl) throw new Error('ADMIN_URL_REQUIRED');
  if (!executorUrl) throw new Error('EXECUTOR_URL_REQUIRED');

  // Validate executor role without exposing the URL
  const executorValidation = validateUrl(executorUrl, 'authority_probe_executor');
  if (!executorValidation.valid) {
    throw new Error('EXECUTOR_ROLE_MISMATCH');
  }

  // Validate admin URL parses (don't check role — admin can be any owner role)
  const adminValidation = validateUrl(adminUrl, '');
  if (!adminValidation.database) {
    throw new Error('ADMIN_URL_INVALID');
  }

  // Verify both point to the same database fingerprint
  if (executorValidation.database && adminValidation.database &&
      executorValidation.database !== adminValidation.database) {
    throw new Error('DATABASE_FINGERPRINT_MISMATCH');
  }

  // Create neon() HTTP-mode SQL functions
  const adminSql = neon(adminUrl);
  const executorSql = neon(executorUrl);

  return {
    /**
     * Admin SQL execution — schema/privilege administration only.
     * @param {string} sql
     * @param {Array} [params]
     * @returns {Promise<Array>}
     */
    admin: async (sql, params) => {
      if (params && params.length > 0) {
        return adminSql(sql, params);
      }
      return adminSql(sql);
    },

    /**
     * Executor SQL execution — all runtime calls and privilege tests.
     * @param {string} sql
     * @param {Array} [params]
     * @returns {Promise<Array>}
     */
    executor: async (sql, params) => {
      if (params && params.length > 0) {
        return executorSql(sql, params);
      }
      return executorSql(sql);
    },

    /**
     * Validation metadata (no secret values).
     */
    validation: {
      executorRole: executorValidation.role,
      database: executorValidation.database,
      executorRoleValid: executorValidation.valid
    }
  };
}