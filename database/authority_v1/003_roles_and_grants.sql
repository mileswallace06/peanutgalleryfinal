-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Roles and Grants (003)
-- Source of truth for database security boundaries.
--
-- Principles:
--   1. authority_owner is a NOLOGIN role — it owns objects but cannot connect.
--   2. authority_executor is for ordinary authority operations (reserve,
--      release, freeze, finalize, cancel, etc.).
--   3. authority_stripe_recorder is for Stripe-result/webhook recording only
--      (record_capture_result, record_cancel_result, record_refund_result).
--   4. Executor roles get CONNECT, USAGE, and EXECUTE only — NO direct table
--      privileges (no INSERT, UPDATE, DELETE, SELECT on authority tables).
--   5. CREATE is revoked on authority schemas from PUBLIC and executor roles.
--   6. Every SECURITY DEFINER function uses a hardened search_path.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Owner role (NOLOGIN — owns objects, cannot connect) ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authority_owner') THEN
    CREATE ROLE authority_owner NOLOGIN;
  END IF;
END $$;

-- ── 2. Executor role — ordinary authority operations ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authority_executor') THEN
    CREATE ROLE authority_executor LOGIN;
  END IF;
END $$;

-- ── 3. Stripe recorder role — Stripe-result/webhook recording only ────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authority_stripe_recorder') THEN
    CREATE ROLE authority_stripe_recorder LOGIN;
  END IF;
END $$;

-- ── 4. Schema ownership ────────────────────────────────────────────────────
ALTER SCHEMA authority_v1 OWNER TO authority_owner;

-- All tables owned by authority_owner
ALTER TABLE authority_v1.reservation_authority          OWNER TO authority_owner;
ALTER TABLE authority_v1.reservation_operations         OWNER TO authority_owner;
ALTER TABLE authority_v1.reservation_payment_bindings  OWNER TO authority_owner;
ALTER TABLE authority_v1.payment_actions               OWNER TO authority_owner;
ALTER TABLE authority_v1.stripe_webhook_events          OWNER TO authority_owner;
ALTER TABLE authority_v1.operational_incidents         OWNER TO authority_owner;
ALTER TABLE authority_v1.reservation_outbox            OWNER TO authority_owner;

-- All functions owned by authority_owner (SECURITY DEFINER executes as owner)
-- Function ownership is set implicitly by the creator; if created by another
-- role, transfer ownership:
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT routine_name FROM information_schema.routines
           WHERE routine_schema = 'authority_v1' LOOP
    EXECUTE format('ALTER FUNCTION authority_v1.%I OWNER TO authority_owner', r.routine_name);
  END LOOP;
END $$;

-- ── 5. Revoke CREATE on authority schema from PUBLIC and executor roles ───
REVOKE CREATE ON SCHEMA authority_v1 FROM PUBLIC;
REVOKE CREATE ON SCHEMA authority_v1 FROM authority_executor;
REVOKE CREATE ON SCHEMA authority_v1 FROM authority_stripe_recorder;

-- ── 6. Revoke ALL table privileges from executor roles ────────────────────
-- Executor roles can ONLY access tables through SECURITY DEFINER functions.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA authority_v1 FROM authority_executor;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA authority_v1 FROM authority_stripe_recorder;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA authority_v1 FROM authority_executor;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA authority_v1 FROM authority_stripe_recorder;

-- ── 7. Grant CONNECT on database and USAGE on schema ─────────────────────
-- (Run from the target database)
GRANT CONNECT ON DATABASE postgres TO authority_executor;
GRANT CONNECT ON DATABASE postgres TO authority_stripe_recorder;
GRANT USAGE ON SCHEMA authority_v1 TO authority_executor;
GRANT USAGE ON SCHEMA authority_v1 TO authority_stripe_recorder;

-- ── 8. Grant EXECUTE — ordinary authority operations to authority_executor ─
GRANT EXECUTE ON FUNCTION authority_v1.acquire_operation(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.get_state(TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.initialize_listing(TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.reserve_listing(TEXT,INTEGER,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.release_listing(TEXT,INTEGER,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.expire_listing(TEXT,INTEGER,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.bind_payment_intent(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.begin_capture(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.finalize_sale(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.begin_cancel(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.begin_refund(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.abort_binding(TEXT,INTEGER,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.cancel_listing(TEXT,INTEGER,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.quarantine_listing(TEXT,TEXT,TEXT,TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.check_user_obligations(TEXT) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.anonymize_user(TEXT,TEXT,TEXT,TEXT) TO authority_executor;

-- ── 9. Grant EXECUTE — Stripe-result recording to authority_stripe_recorder ─
-- Separate least-privilege boundary: only the Stripe-result/webhook recording
-- functions are granted to the stripe_recorder role. This role is used by
-- the stripeWebhook entry point and the Stripe-result recording path.
GRANT EXECUTE ON FUNCTION authority_v1.acquire_operation(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT) TO authority_stripe_recorder;
GRANT EXECUTE ON FUNCTION authority_v1.record_capture_result(TEXT,TEXT,JSONB,TEXT,TEXT) TO authority_stripe_recorder;
GRANT EXECUTE ON FUNCTION authority_v1.record_cancel_result(TEXT,TEXT,JSONB,TEXT,TEXT) TO authority_stripe_recorder;
GRANT EXECUTE ON FUNCTION authority_v1.record_refund_result(TEXT,TEXT,JSONB,TEXT,TEXT) TO authority_stripe_recorder;
GRANT EXECUTE ON FUNCTION authority_v1.finalize_sale(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authority_stripe_recorder;

-- ── 10. Grant EXECUTE — worker functions to both roles ───────────────────
-- Worker functions (claim/recover) are granted to both executor roles so that
-- either a dedicated worker or the main executor can run recovery.
GRANT EXECUTE ON FUNCTION authority_v1.claim_outbox_batch(TEXT,INTEGER,INTEGER) TO authority_executor;
GRANT EXECUTE ON FUNCTION authority_v1.claim_outbox_batch(TEXT,INTEGER,INTEGER) TO authority_stripe_recorder;