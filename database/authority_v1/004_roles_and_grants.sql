-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Roles and Grants (004)
-- Source of truth for database security boundaries.
--
-- INSTALLATION ORDER: 001_schema → 002_functions → 003_workers → 004_roles
-- All functions (including workers) exist before this file grants EXECUTE.
--
-- Principles:
--   1. authority_owner is a NOLOGIN role — it owns objects but cannot connect.
--   2. authority_executor is for ordinary authority operations.
--   3. authority_stripe_recorder is for Stripe-result recording only
--      (record_capture_result, record_cancel_result, record_refund_result,
--      finalize_sale).
--   4. authority_worker is a dedicated worker role for lease claiming and
--      recovery. Ordinary authority callers do NOT get worker privileges.
--   5. Executor roles get CONNECT, USAGE, and EXECUTE only — NO direct table
--      privileges (no INSERT, UPDATE, DELETE, SELECT on authority tables).
--   6. CREATE is revoked on authority schemas from PUBLIC and all runtime
--      roles.
--   7. EXECUTE is revoked on ALL functions from PUBLIC. Only explicitly
--      selected function signatures are granted to the required roles.
--   8. Default privileges prevent future functions from regaining PUBLIC
--      EXECUTE.
--   9. No hardcoded database name — CONNECT is granted on current_database().
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Roles ────────────────────────────────────────────────────────────────

-- Owner role (NOLOGIN — owns objects, cannot connect)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authority_owner') THEN
    CREATE ROLE authority_owner NOLOGIN;
  END IF;
END $$;

-- Executor role — ordinary authority operations
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authority_executor') THEN
    CREATE ROLE authority_executor LOGIN;
  END IF;
END $$;

-- Stripe recorder role — Stripe-result recording only
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authority_stripe_recorder') THEN
    CREATE ROLE authority_stripe_recorder LOGIN;
  END IF;
END $$;

-- Dedicated worker role — lease claiming and recovery only
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authority_worker') THEN
    CREATE ROLE authority_worker LOGIN;
  END IF;
END $$;

-- ── 2. Schema ownership ────────────────────────────────────────────────────
ALTER SCHEMA authority_v1 OWNER TO authority_owner;

-- ── 3. Table and sequence ownership ────────────────────────────────────────
-- The NOLOGIN owner owns every table and sequence.
ALTER TABLE authority_v1.reservation_authority          OWNER TO authority_owner;
ALTER TABLE authority_v1.reservation_operations         OWNER TO authority_owner;
ALTER TABLE authority_v1.reservation_payment_bindings  OWNER TO authority_owner;
ALTER TABLE authority_v1.payment_actions               OWNER TO authority_owner;
ALTER TABLE authority_v1.stripe_webhook_events          OWNER TO authority_owner;
ALTER TABLE authority_v1.operational_incidents         OWNER TO authority_owner;
ALTER TABLE authority_v1.reservation_outbox            OWNER TO authority_owner;

-- Sequences (BIGSERIAL columns) owned by authority_owner
ALTER SEQUENCE authority_v1.operational_incidents_incident_id_seq OWNER TO authority_owner;
ALTER SEQUENCE authority_v1.reservation_outbox_outbox_id_seq OWNER TO authority_owner;

-- ── 4. Function ownership transfer (by exact signature) ──────────────────
-- Transfer ownership of every function to authority_owner using exact
-- routine signatures — not ambiguous routine names.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'authority_v1'
  LOOP
    EXECUTE format('ALTER FUNCTION authority_v1.%I(%s) OWNER TO authority_owner',
      r.proname, r.args);
  END LOOP;
END $$;

-- ── 5. Revoke CREATE on authority schema from PUBLIC and all runtime roles ─
REVOKE CREATE ON SCHEMA authority_v1 FROM PUBLIC;
REVOKE CREATE ON SCHEMA authority_v1 FROM authority_executor;
REVOKE CREATE ON SCHEMA authority_v1 FROM authority_stripe_recorder;
REVOKE CREATE ON SCHEMA authority_v1 FROM authority_worker;

-- ── 6. Revoke ALL table and sequence privileges from runtime roles ──────────
-- Runtime roles can ONLY access tables through SECURITY DEFINER functions.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA authority_v1 FROM authority_executor;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA authority_v1 FROM authority_stripe_recorder;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA authority_v1 FROM authority_worker;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA authority_v1 FROM authority_executor;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA authority_v1 FROM authority_stripe_recorder;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA authority_v1 FROM authority_worker;

-- ── 7. Revoke EXECUTE on ALL functions from PUBLIC ────────────────────────
-- By default PostgreSQL grants EXECUTE on functions to PUBLIC. This must
-- be explicitly revoked so only the granted roles can call authority functions.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA authority_v1 FROM PUBLIC;

-- ── 8. Default privileges — prevent future functions from gaining PUBLIC EXECUTE ─
ALTER DEFAULT PRIVILEGES IN SCHEMA authority_v1
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE authority_owner IN SCHEMA authority_v1
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── 9. Grant CONNECT on current database and USAGE on schema ──────────────
-- Uses current_database() — NOT a hardcoded database name.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO authority_executor', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO authority_stripe_recorder', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO authority_worker', current_database());
END $$;

GRANT USAGE ON SCHEMA authority_v1 TO authority_executor;
GRANT USAGE ON SCHEMA authority_v1 TO authority_stripe_recorder;
GRANT USAGE ON SCHEMA authority_v1 TO authority_worker;

-- ── 10. Grant EXECUTE — ordinary authority operations to authority_executor ─
GRANT EXECUTE ON FUNCTION authority_v1.acquire_operation(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.get_state(TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.initialize_listing(TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.reserve_listing(TEXT,INTEGER,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.release_listing(TEXT,INTEGER,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.expire_listing(TEXT,INTEGER,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.bind_payment_intent(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.begin_capture(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.begin_cancel(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.begin_refund(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.abort_binding(TEXT,INTEGER,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.cancel_listing(TEXT,INTEGER,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.quarantine_listing(TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.check_user_obligations(TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.anonymize_user(TEXT,TEXT,TEXT,TEXT) TO authority_executor;

-- ── 11. Grant EXECUTE — Stripe-result recording to authority_stripe_recorder ─
-- Separate least-privilege boundary: only the Stripe-result recording functions
-- and finalize_sale are granted to the stripe_recorder role.
--
-- acquire_operation is NOT granted to the recorder role. It is called
-- INTERNALLY by the SECURITY DEFINER record_*_result functions, which execute
-- as authority_owner. The recorder role does not need direct EXECUTE on it.
-- Revoking this grant reduces the recorder's surface area without breaking
-- any recording path (proven by P0-01G corrective tests).
GRANT EXECUTE ON FUNCTION authority_v1.record_capture_result(TEXT,TEXT,JSONB,TEXT,TEXT,TEXT) TO authority_stripe_recorder;
GRANT EXECUTE ON FUNCTION authority_v1.record_cancel_result(TEXT,TEXT,JSONB,TEXT,TEXT,TEXT) TO authority_stripe_recorder;
GRANT EXECUTE ON FUNCTION authority_v1.record_refund_result(TEXT,TEXT,JSONB,TEXT,TEXT,TEXT) TO authority_stripe_recorder;
GRANT EXECUTE ON FUNCTION authority_v1.finalize_sale(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authority_stripe_recorder;

-- ── 12. Grant EXECUTE — worker functions to authority_worker only ──────────
-- Worker functions (claim/recover/escalate) are granted to the dedicated
-- authority_worker role only. Ordinary authority callers do NOT get
-- payment/webhook-worker privileges.
GRANT EXECUTE ON FUNCTION authority_v1.claim_outbox_batch(TEXT,INTEGER,INTEGER) TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.complete_outbox_event(BIGINT,BOOLEAN,TEXT) TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.recover_expired_outbox_leases() TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.claim_payment_action(TEXT,TEXT,INTEGER) TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.recover_expired_payment_action_leases() TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.escalate_exhausted_payment_action() TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.claim_webhook_event(TEXT,INTEGER) TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.complete_webhook_event(TEXT,BOOLEAN,TEXT) TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.recover_expired_webhook_leases() TO authority_worker;
GRANT EXECUTE ON FUNCTION authority_v1.escalate_exhausted_webhook_event() TO authority_worker;