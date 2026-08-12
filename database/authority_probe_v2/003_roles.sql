-- ═══════════════════════════════════════════════════════════════════════════
-- authority_probe_v2 — Roles and Grants (003)
-- Phase 1B F.3 RETAIN-AND-CERTIFY gate.
--
-- The authority_probe_executor role is created by the owner OUT OF BAND.
-- This file only contains grants, revokes, and default privileges.
-- It does NOT create, alter, or delete any role or password.
--
-- Objects are owned by the Neon admin (who runs schema setup). The
-- SECURITY DEFINER functions execute with the admin's privileges. The
-- executor gets CONNECT, USAGE, and EXECUTE only — NO direct table access.
-- reserve_and_fail is NOT granted to the executor (test-only).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Revoke CREATE on schema from PUBLIC and executor ───────────────────
REVOKE CREATE ON SCHEMA authority_probe_v2 FROM PUBLIC;
REVOKE CREATE ON SCHEMA authority_probe_v2 FROM authority_probe_executor;

-- ── 2. Revoke ALL table and sequence privileges from executor ─────────────
-- Executor can ONLY access tables through SECURITY DEFINER functions.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA authority_probe_v2 FROM authority_probe_executor;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA authority_probe_v2 FROM authority_probe_executor;

-- ── 3. Revoke EXECUTE on ALL functions from PUBLIC ────────────────────────
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA authority_probe_v2 FROM PUBLIC;

-- ── 4. Default privileges — prevent future functions from gaining PUBLIC EXECUTE
ALTER DEFAULT PRIVILEGES IN SCHEMA authority_probe_v2
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── 5. Grant CONNECT on current database and USAGE on schema ──────────────
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO authority_probe_executor', current_database());
END $$;

GRANT USAGE ON SCHEMA authority_probe_v2 TO authority_probe_executor;

-- ── 6. Grant EXECUTE — runtime functions to executor ─────────────────────
-- reserve_and_fail is intentionally NOT granted — it is test-only.
GRANT EXECUTE ON FUNCTION authority_probe_v2.acquire_operation(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.get_state(TEXT) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.initialize_listing(TEXT,TEXT,TEXT,JSONB) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.reserve_listing(TEXT,INTEGER,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.release_listing(TEXT,INTEGER,TEXT,TEXT,JSONB) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.upsert_incident(TEXT,TEXT,TEXT,TEXT) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.get_operation_result(TEXT) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.cleanup_synthetic() TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.count_synthetic() TO authority_probe_executor;