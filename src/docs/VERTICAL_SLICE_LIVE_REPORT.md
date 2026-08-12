# Phase 1B — Live Neon Vertical-Slice Gate: Evidence Report

**Date**: 2026-08-12
**Verdict**: **PASS** — all 11 live database proofs passed against real Neon PostgreSQL.
**Maintenance**: ON (unchanged)
**Launch**: NO-GO (unchanged)
**7C.9D**: Not started (unchanged)

---

## 1. Executive Summary

A temporary `authority_vertical_slice` action was added to the existing admin-only
`migrateSensitiveData` function. The deployed function connected to the isolated
Neon development database, applied a minimal schema, created a restricted executor
role, and ran 11 live proofs — including 100-way concurrent reservation and
100-way concurrent incident writes. All proofs passed. The function was then
restored byte-for-byte to its original migration logic.

**No production data was touched. No Stripe, email, push, points, or notification
providers were contacted. All synthetic rows were cleaned and verified to zero.**

---

## 2. Pre-Test State

| Field | Value |
|---|---|
| Git HEAD | `43edc7c5105d77ace4333794a71013417f49db6a` |
| Git status | clean |
| Deployed function count | 50 |
| `migrateSensitiveData/entry.ts` SHA-256 | `eb1f31bd7116882f3fa7a091fe7bb3e12957d66c6d3472acb345954a45e359a3` |
| Maintenance mode | ON |

---

## 3. Security Model

- **Admin role required**: `user.role !== 'admin'` → 403 Forbidden.
- **Maintenance mode required**: `isMaintenanceActive()` must return true → 409 otherwise.
- **No request-supplied SQL**: All SQL is embedded as fixed constants.
- **No request-supplied credentials**: The function reads `AUTHORITY_DB_URL_DEV_ADMIN`
  via `secrets.get()` from `base44:runtime` inside the handler.
- **Executor password**: Generated with `crypto.randomUUID()` — never returned, logged, or committed.
- **Executor role**: `CONNECT` + `USAGE` + `SELECT` + `EXECUTE` only. All direct
  `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER` denied (proven in Test 10).

---

## 4. Live Proof Results

| # | Test | Result |
|---|---|---|
| 1 | Initialize listing | PASS — `{ ok: true, version: 0 }` |
| 2 | Idempotent replay (same op_id + same hash) | PASS — identical result returned |
| 3 | Conflict rejection (same op_id, different hash) | PASS — `OPERATION_ID_CONFLICT` raised |
| 4 | Stale version rejection (expected_version=5 on v0) | PASS — `{ ok: false, code: 'CONFLICT' }` |
| 5 | Rollback (injected post-update failure) | PASS — `INJECTED_FAILURE` raised, state unchanged (v0, available) |
| 6 | 100 concurrent reservations → 1 winner | PASS — 1 winner, 99 CONFLICT |
| 7 | Release by winning buyer | PASS — version 2, available |
| 8 | Unknown response recovery (query by operation_id) | PASS — committed + result_json exists |
| 9 | 100 concurrent incidents with same key → 1 row | PASS — 1 winner, 99 failures, dbCount=1 |
| 10 | Executor privilege denial (INSERT/UPDATE/DELETE/CREATE/ALTER) | PASS — all DENIED |
| 11 | Latency (20 samples via Neon HTTP) | min 9ms, median 11ms, p95 21ms, max 21ms |
| — | Cleanup (zero synthetic rows remaining) | PASS — 0/0/0 |

---

## 5. Architecture Proven

1. **One authoritative reservation row per synthetic listing** — `reservation_authority` PK.
2. **Monotonic versioning** — `version` increments on every transition (0→1 reserve, 1→2 release).
3. **Operation-id idempotency** — same `operation_id` + `request_hash` returns stored result.
4. **Row locking / atomic transition** — `UPDATE ... WHERE version = expected AND state = 'available'`
   produces exactly 1 winner under 100-way concurrency.
5. **Unique incident keys** — `UNIQUE` constraint on `incident_key` rejects 99 of 100 concurrent writes.
6. **Rollback on injected failure** — `reserve_and_fail` raises after `reserve_listing` succeeds;
   the entire function transaction rolls back, leaving state unchanged.

---

## 6. Latency

| Metric | Value |
|---|---|
| Min | 9 ms |
| Median | 11 ms |
| P95 | 21 ms |
| Max | 21 ms |

Measured on 20 sequential `get_state` calls via the Neon serverless HTTP driver
from the deployed Base44 function.

---

## 7. Post-Test Restoration

| Field | Value |
|---|---|
| `migrateSensitiveData/entry.ts` restored | Yes — SHA-256 matches pre-test hash |
| `authority_vertical_slice` action | Removed |
| Original migration path | Verified (dry-run mode) |
| Deployed function count | 50 (unchanged) |
| `verticalSlice.ts` shared module | Deleted |
| Synthetic rows remaining | 0 in all probe tables |

---

## 8. Durable Artifacts Committed

- `database/vertical_slice/001_schema.sql` — minimal schema (3 tables)
- `database/vertical_slice/002_functions.sql` — 6 stored functions
- `database/vertical_slice/003_roles.sql` — executor role grants/revokes
- `tests/vertical-slice-live-results.json` — redacted raw results
- `tests/vertical-slice-live.test.mjs` — executable live-probe test
- `src/docs/VERTICAL_SLICE_LIVE_REPORT.md` — this report

---

## 9. What This Does NOT Authorize

- No production entry points modified.
- No production data migration.
- No 7C.9D.
- No launch. Readiness unchanged. Launch gate remains RED.
- The development schema and stored functions may remain in the Neon dev database
  for the next implementation stage.