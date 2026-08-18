-- ═══════════════════════════════════════════════════════════════════════════
-- authority_probe_v2 — Roles and Grants (003) — F.3.1 CORRECTED
-- Phase 1B F.3.1 ARTIFACT-AND-RUNTIME-BOUNDARY CORRECTION.
--
-- The authority_probe_executor role is created by the owner OUT OF BAND.
-- This file only contains grants, revokes, and default privileges.
-- It does NOT create, alter, or delete any role or password.
--
-- F.3.1 CHANGES:
--   - REVOKE EXECUTE on ALL functions from executor (clean slate).
--   - GRANT EXECUTE only on 6 allowlisted runtime functions:
--     get_state, initialize_listing, reserve_listing, release_listing,
--     get_operation_result, upsert_incident.
--   - EXPLICITLY DO NOT GRANT: acquire_operation, cleanup_synthetic,
--     count_synthetic, reserve_and_fail. These are admin/test-only.
--
-- cleanup_synthetic() DELETES ALL ROWS in ALL probe tables
--   (reservation_authority, reservation_operations, operational_incidents).
--   It is admin/test-only. It must NEVER be called from a production
--   request handler. It must NEVER be granted to the executor role.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Revoke CREATE on schema from PUBLIC and executor ───────────────────
REVOKE CREATE ON SCHEMA authority_probe_v2 FROM PUBLIC;
REVOKE CREATE ON SCHEMA authority_probe_v2 FROM authority_probe_executor;

-- ── 2. Revoke ALL table and sequence privileges from executor ─────────────
-- Executor can ONLY access tables through SECURITY DEFINER functions.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA authority_probe_v2 FROM authority_probe_executor;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA authority_probe_v2 FROM authority_probe_executor;

-- ── 3. Revoke EXECUTE on ALL functions from PUBLIC and executor ──────────
-- Clean slate: revoke everything, then grant only allowlisted functions.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA authority_probe_v2 FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA authority_probe_v2 FROM authority_probe_executor;

-- ── 4. Default privileges — prevent future functions from gaining PUBLIC EXECUTE
ALTER DEFAULT PRIVILEGES IN SCHEMA authority_probe_v2
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA authority_probe_v2
  REVOKE EXECUTE ON FUNCTIONS FROM authority_probe_executor;

-- ── 5. Grant CONNECT on current database and USAGE on schema ──────────────
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO authority_probe_executor', current_database());
END $$;

GRANT USAGE ON SCHEMA authority_probe_v2 TO authority_probe_executor;

-- ── 6. Grant EXECUTE — 6 allowlisted runtime functions ONLY ────────────────
-- These are the ONLY functions the executor may call.
GRANT EXECUTE ON FUNCTION authority_probe_v2.get_state(TEXT) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.initialize_listing(TEXT,TEXT,TEXT,JSONB) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.reserve_listing(TEXT,INTEGER,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.release_listing(TEXT,INTEGER,TEXT,TEXT,JSONB) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.get_operation_result(TEXT) TO authority_probe_executor;
GRANT EXECUTE ON FUNCTION authority_probe_v2.upsert_incident(TEXT,TEXT,TEXT,TEXT) TO authority_probe_executor;

-- ── 7. EXPLICITLY NOT GRANTED to executor (admin/test-only) ───────────────
-- The following functions are NOT granted to authority_probe_executor:
--   acquire_operation     — internal helper, called only by other functions
--   cleanup_synthetic()   — DELETES ALL probe data, admin/test-only
--   count_synthetic()     — admin/test-only diagnostic
--   reserve_and_fail(...) — test-only rollback verification
--
-- cleanup_synthetic() deletes every row in reservation_authority,
-- reservation_operations, and operational_incidents. It must never be
-- callable by the executor or any production request handler.