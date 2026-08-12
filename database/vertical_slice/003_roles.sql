-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Vertical Slice Roles and Grants (Phase 1B live proof)
-- Role creation (with generated password) is done dynamically by the test
-- function BEFORE this file is applied. This file only contains grants/revokes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Executor role: CONNECT + USAGE + SELECT + EXECUTE only ──────────────────
-- current_database() cannot be used directly in GRANT; use DO block for dynamic exec.
DO $$ BEGIN EXECUTE 'GRANT CONNECT ON DATABASE ' || current_database() || ' TO authority_executor_dev'; END $$;
GRANT USAGE ON SCHEMA authority_v1 TO authority_executor_dev;
GRANT SELECT ON authority_v1.reservation_authority TO authority_executor_dev;
GRANT SELECT ON authority_v1.reservation_operations TO authority_executor_dev;
GRANT SELECT ON authority_v1.operational_incidents TO authority_executor_dev;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA authority_v1 TO authority_executor_dev;

-- ── Revoke all direct table mutations ───────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON authority_v1.reservation_authority FROM authority_executor_dev;
REVOKE INSERT, UPDATE, DELETE ON authority_v1.reservation_operations FROM authority_executor_dev;
REVOKE INSERT, UPDATE, DELETE ON authority_v1.operational_incidents FROM authority_executor_dev;

-- ── Revoke DDL ──────────────────────────────────────────────────────────────
REVOKE CREATE ON SCHEMA authority_v1 FROM authority_executor_dev;
DO $$ BEGIN EXECUTE 'REVOKE CREATE ON DATABASE ' || current_database() || ' FROM authority_executor_dev'; END $$;