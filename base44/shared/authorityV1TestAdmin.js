/**
 * authorityV1TestAdmin.js — Admin/test-only client for authority_v1.
 *
 * P0-01F PAYMENT-SAGA GATE.
 *
 * This module is for TEST USE ONLY. It must NEVER be imported by a production
 * request handler. It provides raw SQL execution for test setup, state
 * verification, and cleanup by exact synthetic ID allowlist.
 *
 * SECURITY RULES:
 *   - Admin URL is the Neon admin/owner connection.
 *   - Never log, return, or place credential-bearing values in errors.
 *   - cleanupByListingIds deletes ONLY rows matching the exact listing ID
 *     allowlist — never a blanket DELETE.
 *   - No production handler may import this module.
 */
import { neon } from 'npm:@neondatabase/serverless@0.10.4';

/**
 * Create an admin/test client for authority_v1.
 * @param {string} adminUrl - AUTHORITY_DB_URL_DEV_ADMIN
 */
export function createAuthorityV1TestAdmin(adminUrl) {
  if (!adminUrl) throw new Error('ADMIN_URL_REQUIRED');
  const sql = neon(adminUrl);

  return {
    /** Raw SQL execution for test setup and verification. */
    async exec(query, params) {
      if (params && params.length > 0) return sql(query, params);
      return sql(query);
    },

    /** Insert a synthetic authority row in 'available' state. */
    async setupAvailableListing(listingId, sellerUserId) {
      return sql`
        INSERT INTO authority_v1.reservation_authority (listing_id, version, lifecycle_state, seller_user_id)
        VALUES (${listingId}, 0, 'available', ${sellerUserId})
        ON CONFLICT (listing_id) DO NOTHING`;
    },

    /** Insert a synthetic authority row in 'reserved' state. */
    async setupReservedListing(listingId, sellerUserId, buyerUserId, tokenHash, expiresAt, revision) {
      return sql`
        INSERT INTO authority_v1.reservation_authority
          (listing_id, version, lifecycle_state, seller_user_id, buyer_user_id,
           reservation_token_hash, reservation_expires_at, reservation_revision)
        VALUES (${listingId}, 1, 'reserved', ${sellerUserId}, ${buyerUserId},
                ${tokenHash}, ${expiresAt}, ${revision})
        ON CONFLICT (listing_id) DO UPDATE SET
          version = 1, lifecycle_state = 'reserved',
          seller_user_id = ${sellerUserId}, buyer_user_id = ${buyerUserId},
          reservation_token_hash = ${tokenHash},
          reservation_expires_at = ${expiresAt},
          reservation_revision = ${revision},
          recovery_blocked = false, recovery_blocked_reason = null,
          recovery_blocked_at = null, updated_at = now()`;
    },

    /** Insert a synthetic payment binding in 'authorized' state. */
    async setupAuthorizedBinding(purchaseId, paymentIntentId, listingId, buyerUserId, authorityVersion, revision, tokenHash) {
      return sql`
        INSERT INTO authority_v1.reservation_payment_bindings
          (purchase_id, payment_intent_id, listing_id, buyer_user_id,
           authority_version, reservation_revision, reservation_token_hash, capture_state)
        VALUES (${purchaseId}, ${paymentIntentId}, ${listingId}, ${buyerUserId},
                ${authorityVersion}, ${revision}, ${tokenHash}, 'authorized')
        ON CONFLICT (purchase_id) DO UPDATE SET
          payment_intent_id = ${paymentIntentId}, listing_id = ${listingId},
          buyer_user_id = ${buyerUserId}, authority_version = ${authorityVersion},
          reservation_revision = ${revision}, reservation_token_hash = ${tokenHash},
          capture_state = 'authorized', updated_at = now()`;
    },

    /** Read authority state for a listing. */
    async getAuthority(listingId) {
      const rows = await sql`
        SELECT version, lifecycle_state, buyer_user_id, reservation_revision,
               recovery_blocked, recovery_blocked_reason
        FROM authority_v1.reservation_authority WHERE listing_id = ${listingId}`;
      return rows[0] || null;
    },

    /** Read binding state for a purchase. */
    async getBinding(purchaseId) {
      const rows = await sql`
        SELECT capture_state, authority_version, reservation_revision
        FROM authority_v1.reservation_payment_bindings WHERE purchase_id = ${purchaseId}`;
      return rows[0] || null;
    },

    /** Read payment action. */
    async getAction(actionId) {
      const rows = await sql`
        SELECT action_id, action_type, status, stripe_idempotency_key, completed_at
        FROM authority_v1.payment_actions WHERE action_id = ${actionId}`;
      return rows[0] || null;
    },

    /** Read incidents for a listing. */
    async getIncidentsByListing(listingId) {
      return sql`
        SELECT incident_key, incident_type, occurrence_count, resolved
        FROM authority_v1.operational_incidents WHERE reference_id = ${listingId}`;
    },

    /** Read webhook event. */
    async getWebhookEvent(eventId) {
      const rows = await sql`
        SELECT webhook_event_id, processing_status, related_action_id
        FROM authority_v1.stripe_webhook_events WHERE webhook_event_id = ${eventId}`;
      return rows[0] || null;
    },

    /** Insert a webhook event for testing. */
    async setupWebhookEvent(eventId, eventType, actionId) {
      return sql`
        INSERT INTO authority_v1.stripe_webhook_events
          (webhook_event_id, event_type, processing_status, related_action_id)
        VALUES (${eventId}, ${eventType}, 'pending', ${actionId})
        ON CONFLICT (webhook_event_id) DO NOTHING`;
    },

    /** Count rows in all authority_v1 tables. */
    async countAll() {
      const [ra] = await sql`SELECT count(*)::int as c FROM authority_v1.reservation_authority`;
      const [ro] = await sql`SELECT count(*)::int as c FROM authority_v1.reservation_operations`;
      const [rpb] = await sql`SELECT count(*)::int as c FROM authority_v1.reservation_payment_bindings`;
      const [pa] = await sql`SELECT count(*)::int as c FROM authority_v1.payment_actions`;
      const [swe] = await sql`SELECT count(*)::int as c FROM authority_v1.stripe_webhook_events`;
      const [oi] = await sql`SELECT count(*)::int as c FROM authority_v1.operational_incidents`;
      const [ob] = await sql`SELECT count(*)::int as c FROM authority_v1.reservation_outbox`;
      return {
        reservation_authority: ra.c,
        reservation_operations: ro.c,
        reservation_payment_bindings: rpb.c,
        payment_actions: pa.c,
        stripe_webhook_events: swe.c,
        operational_incidents: oi.c,
        reservation_outbox: ob.c,
      };
    },

    /**
     * Cleanup by exact synthetic ID allowlist.
     * Deletes ONLY rows matching the exact listing IDs in the allowlist.
     * Never a blanket DELETE.
     */
    async cleanupByListingIds(listingIds) {
      if (!listingIds || listingIds.length === 0) return { deleted: 0 };
      // Delete in dependency order, scoped to exact listing IDs
      await sql`DELETE FROM authority_v1.reservation_outbox WHERE listing_id = ANY(${listingIds})`;
      await sql`DELETE FROM authority_v1.payment_actions WHERE listing_id = ANY(${listingIds})`;
      await sql`DELETE FROM authority_v1.stripe_webhook_events WHERE related_action_id IN (SELECT action_id FROM authority_v1.payment_actions WHERE listing_id = ANY(${listingIds}))`;
      await sql`DELETE FROM authority_v1.operational_incidents WHERE reference_id = ANY(${listingIds})`;
      await sql`DELETE FROM authority_v1.reservation_payment_bindings WHERE listing_id = ANY(${listingIds})`;
      await sql`DELETE FROM authority_v1.reservation_operations WHERE listing_id = ANY(${listingIds})`;
      await sql`DELETE FROM authority_v1.reservation_authority WHERE listing_id = ANY(${listingIds})`;
      return { deleted: listingIds.length };
    },

    /** Cleanup all rows in all tables (nuclear option — test teardown only). */
    async cleanupAll() {
      await sql`DELETE FROM authority_v1.reservation_outbox`;
      await sql`DELETE FROM authority_v1.stripe_webhook_events`;
      await sql`DELETE FROM authority_v1.payment_actions`;
      await sql`DELETE FROM authority_v1.operational_incidents`;
      await sql`DELETE FROM authority_v1.reservation_payment_bindings`;
      await sql`DELETE FROM authority_v1.reservation_operations`;
      await sql`DELETE FROM authority_v1.reservation_authority`;
      return { ok: true };
    },

    /** Check if executor role has direct table privileges (should be 0). */
    async checkExecutorTablePrivileges() {
      const rows = await sql`
        SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = 'authority_executor'
          AND table_schema = 'authority_v1'
          AND privilege_type IN ('INSERT','UPDATE','DELETE','SELECT')`;
      return rows;
    },

    /** Try a direct table mutation as the executor (should fail). */
    async tryExecutorDirectMutation(executorUrl) {
      const executorSql = neon(executorUrl);
      try {
        await executorSql`INSERT INTO authority_v1.reservation_authority (listing_id, seller_user_id) VALUES ('test_direct_mutation', 'test')`;
        return { blocked: false, error: null };
      } catch (e) {
        return { blocked: true, error: (e.message || String(e)).slice(0, 200) };
      }
    },

    /** Call record_cancel_result via admin connection (recorder proxy for tests). */
    async recordCancelResult(actionId, resultDerived, stripeResponse, workerId, opId, requestHash) {
      const rows = await sql(
        `SELECT authority_v1.record_cancel_result($1, $2, $3::jsonb, $4, $5, $6) as result`,
        [actionId, resultDerived, JSON.stringify(stripeResponse), workerId, opId, requestHash]
      );
      return rows[0]?.result;
    },

    /** Count payment_actions for a specific purchase (scoped, not global). */
    async countPaymentActionsByPurchase(purchaseId) {
      const rows = await sql`SELECT count(*)::int as c FROM authority_v1.payment_actions WHERE purchase_id = ${purchaseId}`;
      return rows[0]?.c || 0;
    },

    /** Reset binding to 'authorized' and clear recovery_blocked (for T11 second iteration). */
    async resetBindingToAuthorized(purchaseId, listingId) {
      await sql`UPDATE authority_v1.reservation_payment_bindings SET capture_state = 'authorized', updated_at = now() WHERE purchase_id = ${purchaseId}`;
      await sql`UPDATE authority_v1.reservation_authority SET recovery_blocked = false, recovery_blocked_reason = null, recovery_blocked_at = null, updated_at = now() WHERE listing_id = ${listingId}`;
      return { ok: true };
    },

    /** Prove executor cannot call record_cancel_result (permission denied). */
    async checkExecutorCannotRecordCancel(executorUrl) {
      const executorSql = neon(executorUrl);
      try {
        await executorSql(
          `SELECT authority_v1.record_cancel_result('test', 'succeeded', '{}'::jsonb, null, 'test_op', 'test_hash') as result`
        );
        return { blocked: false, error: null };
      } catch (e) {
        return { blocked: true, error: (e.message || String(e)).slice(0, 200) };
      }
    },

    /** Prove recorder cannot call begin_cancel (SET ROLE test). */
    async checkRecorderCannotBeginCancel() {
      try {
        await sql`SET ROLE authority_stripe_recorder`;
        try {
          await sql(
            `SELECT authority_v1.begin_cancel('test', 1, 'test', 'test', 'test', 'test', 'test', 'test', 'test', 'test') as result`
          );
          return { blocked: false, error: null };
        } catch (e) {
          return { blocked: true, error: (e.message || String(e)).slice(0, 200) };
        }
      } finally {
        await sql`RESET ROLE`;
      }
    },

    /** Get EXECUTE grants for a specific role. */
    async getRoleGrants(roleName) {
      return sql`
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        JOIN information_schema.role_routine_grants g
          ON g.routine_schema = 'authority_v1'
          AND g.routine_name = p.proname
          AND g.grantee = ${roleName}
        WHERE n.nspname = 'authority_v1'
        ORDER BY p.proname`;
    },

    /** Get live function definition (prosrc) for artifact parity. */
    async getLiveFunctionDefinition(fnName) {
      const rows = await sql`
        SELECT prosrc FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'authority_v1' AND p.proname = ${fnName}`;
      return rows[0]?.prosrc || null;
    },

    /** Get live index definition for artifact parity. */
    async getLiveIndexDefinition(indexName) {
      const rows = await sql`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'authority_v1' AND indexname = ${indexName}`;
      return rows[0]?.indexdef || null;
    },
  };
}