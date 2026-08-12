-- ═══════════════════════════════════════════════════════════════════════════
-- authority_probe_v2 — Roles and Grants (003)
--
-- Hardened privileges:
--   1. Revoke ALL from PUBLIC on schema, tables, sequences, functions
--   2. NO GRANT EXECUTE ON ALL FUNCTIONS — exact allowlist only
--   3. Executor gets USAGE + EXECUTE on runtime functions only
--   4. State/operation reads through stored functions, not direct table SELECT
--   5. reserve_and_fail and cleanup_synthetic NOT granted to executor
--   6. Dynamic database grants use format('%I', current_database())
--
-- The executor password is NOT in this file — it is set dynamically by the
-- setup script using ALTER ROLE (generated with crypto.randomUUID()).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Create executor role (password set dynamically) ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authority_probe_executor') THEN
    CREATE ROLE authority_probe_executor LOGIN NOINHERIT;
  END IF;
END $$;

-- ── Revoke ALL from PUBLIC ──────────────────────────────────────────────────
REVOKE ALL ON SCHEMA authority_probe_v2 FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA authority_probe_v2 FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA authority_probe_v2 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA authority_probe_v2 FROM PUBLIC;

-- Prevent future functions from gaining PUBLIC EXECUTE
ALTER DEFAULT PRIVILEGES IN SCHEMA authority_probe_v2
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA authority_probe_v2
  REVOKE ALL ON TABLES FROM PUBLIC;

-- ── Grant schema USAGE to executor ──────────────────────────────────────────
GRANT USAGE ON SCHEMA authority_probe_v2 TO authority_probe_executor;

-- ── Grant EXECUTE on exact allowlist of runtime functions ───────────────────
-- NOT reserve_and_fail (test-only)
-- NOT cleanup_synthetic (test-only)
GRANT EXECUTE ON FUNCTION authority_probe_v2.initialize_listing TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.reserve_listing TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.release_listing TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.get_state TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.get_operation TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.create_incident TO authority_probe_executor;

-- ── Revoke direct table access from executor ───────────────────────────────
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA authority_probe_v2 FROM authority_probe_executor;

-- ── Revoke sequence access from executor ────────────────────────────────────
REVOKE ALL ON ALL SEQUENCES IN SCHEMA authority_probe_v2 FROM authority_probe_executor;

-- ── Revoke DDL from executor ────────────────────────────────────────────────
REVOKE CREATE ON SCHEMA authority_probe_v2 FROM authority_probe_executor;
DO $$
BEGIN
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM authority_probe_executor', current_database());
END $$;