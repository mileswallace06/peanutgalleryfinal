/**
 * authorityAdmin.js — Schema-administration and test-only client (admin).
 *
 * Phase 1B F.3.1 ARTIFACT-AND-RUNTIME-BOUNDARY CORRECTION.
 *
 * This module is for DEPLOYMENT AND TEST USE ONLY.
 * It must NEVER be imported by a production request handler.
 *
 * It provides raw SQL execution, schema deployment, cleanup, count,
 * privilege inspection, and access to test-only functions (reserve_and_fail,
 * acquire_operation, cleanup_synthetic, count_synthetic).
 *
 * SECURITY RULES:
 *   - Admin URL is the Neon admin/owner connection.
 *   - Never log, return, or place credential-bearing values in errors.
 *   - cleanup_synthetic() deletes ALL rows in ALL probe tables — document
 *     this explicitly at every call site.
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';

/**
 * Create an admin client for schema/privilege management and test-only operations.
 *
 * @param {string} adminUrl - AUTHORITY_DB_URL_DEV_ADMIN (admin/owner connection)
 * @returns {object} Admin client with raw SQL and admin-only methods.
 */
export function createAdminClient(adminUrl) {
  if (!adminUrl) throw new Error('ADMIN_URL_REQUIRED');

  let parsed;
  try {
    parsed = new URL(adminUrl);
  } catch {
    throw new Error('ADMIN_URL_INVALID');
  }

  const database = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
  if (!database) throw new Error('ADMIN_URL_INVALID');

  const sql = neon(adminUrl);

  return {
    /** Database fingerprint (no credentials). */
    fingerprint: {
      role: decodeURIComponent(parsed.username),
      database,
    },

    /**
     * Raw SQL execution for schema deployment and privilege management.
     * @param {string} query - SQL string
     * @param {Array} [params] - Optional parameter array
     */
    async exec(query, params) {
      if (params && params.length > 0) {
        return sql(query, params);
      }
      return sql(query);
    },

    /**
     * Call any authority_probe_v2 function (including test-only).
     * Used by the probe for reserve_and_fail, cleanup_synthetic, count_synthetic.
     */
    async callFn(fnName, ...args) {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
      const queryStr = `SELECT authority_probe_v2.${fnName}(${placeholders}) as result`;
      const rows = await sql(queryStr, args);
      return rows[0]?.result;
    },

    /**
     * cleanup_synthetic() — DELETES ALL ROWS in ALL probe tables.
     * Admin/test-only. Never call from a production handler.
     * Deletes every row in reservation_authority, reservation_operations,
     * and operational_incidents. Does NOT drop the schema.
     */
    async cleanup() {
      return this.callFn('cleanup_synthetic');
    },

    /**
     * count_synthetic() — Count rows in all probe tables.
     * Admin/test-only.
     */
    async count() {
      return this.callFn('count_synthetic');
    },

    /**
     * Check PUBLIC EXECUTE privilege on all functions in the schema.
     * Uses aclexplode for accurate ACL evaluation.
     * Returns count of functions where PUBLIC (grantee=0) has EXECUTE.
     */
    async checkPublicExecuteCount() {
      const rows = await sql`
        SELECT count(*) as cnt
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'authority_probe_v2'
          AND EXISTS (
            SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))
            WHERE grantee = 0 AND privilege_type = 'EXECUTE'
          )
      `;
      return Number(rows[0]?.cnt || 0);
    },

    /**
     * Check which functions the executor role has EXECUTE on.
     * Returns array of function names.
     */
    async checkExecutorGrants() {
      const rows = await sql`
        SELECT p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'authority_probe_v2'
          AND has_function_privilege('authority_probe_executor', p.oid, 'EXECUTE')
      `;
      return rows.map(r => r.proname);
    },

    /**
     * Deploy schema SQL (split into individual statements for Neon HTTP driver).
     * @param {string} sqlText - Full SQL script
     */
    async deploySchema(sqlText) {
      const statements = splitSql(sqlText);
      for (const stmt of statements) {
        if (stmt.trim()) await sql(stmt);
      }
    },
  };
}

/**
 * Split a SQL script into individual statements for the Neon HTTP driver.
 * Handles $$ blocks and semicolons inside string literals.
 */
function splitSql(sqlText) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';

  const lines = sqlText.split('\n');
  for (const line of lines) {
    // Find ALL dollar-quote tags on this line (start AND end may be on same line)
    const matches = [...line.matchAll(/\$(\w*)\$/g)];
    for (const m of matches) {
      const tag = m[0];
      if (!inDollarQuote) {
        inDollarQuote = true;
        dollarTag = tag;
      } else if (tag === dollarTag) {
        inDollarQuote = false;
        dollarTag = '';
      }
    }

    current += line + '\n';

    // Split on semicolon if not inside a dollar-quoted block
    if (!inDollarQuote && line.trim().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}