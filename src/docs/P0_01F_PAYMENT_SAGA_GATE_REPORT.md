# P0-01F Payment Saga Cancellation Gate Report

**Date:** 2026-08-22
**Scope:** Development-only Postgres payment-saga gate — cancellation primitives (substrate only)
**Status:** ✅ PASS — development database saga-substrate certification. Production handler integration is NOT certified.

---

## 1. Baseline Captured

| Item | Value |
|---|---|
| HEAD (before) | `51d33b43f22c773d9c5c8d33d67634f39bd9ac03` |
| Git status (before) | Clean |
| Function count | 50 |
| Canary flag | OFF (`CANARY_ENABLED = false`) |
| Maintenance | ON |
| Authority tables (before) | 3 (reservation_authority, reservation_operations, reservation_outbox) |
| Authority functions (before) | 5 (acquire_operation, get_state, initialize_listing, reserve_listing, release_listing) |
| Authority roles (before) | 3 (authority_executor, authority_probe_executor, authority_probe_owner) |
| Authority rows (before) | 0 in all tables |

---

## 2. Architecture Audit — Existing vs Missing

The SQL artifacts (`database/authority_v1/001_schema.sql`–`004_roles_and_grants.sql`) already contained the complete payment-saga substrate — 7 tables, 29 functions, 6 roles. Only 3 tables and 5 functions were deployed to the live dev database (the canary subset). The remaining 4 tables, 24 functions, and 3 roles were in the SQL files but not deployed. P0-01F deployed the full set.

### Documentation Inconsistency Noted

Section 7.11 of `ATOMICITY_ARCHITECTURE_DECISION.md` says `record_cancel_result` failed → binding `failed`, unknown → remains `cancel_requested`. Section 6.2 (corrected state machine) says failed → `cancel_failed`, unknown → `cancel_unknown`. The correction log (Section 18, item #8) resolves this: `cancel_failed` and `refund_failed` were added as explicitly unsettled states. **Section 6.2 is authoritative.**

---

## 3. Schema Changes Made

The full SQL artifacts were deployed to the dev database by dropping the existing 3 tables (CASCADE, 0 rows) and running `001_schema.sql` → `002_functions.sql` → `003_workers.sql` → `004_roles_and_grants.sql` in order.

### New Indexes (3 — concurrency enforcement)

| Index | Purpose |
|---|---|
| `idx_one_pending_cancel_per_purchase` | UNIQUE on `payment_actions(purchase_id)` WHERE `action_type='cancel' AND status IN ('pending','in_flight')` |
| `idx_one_pending_capture_per_purchase` | Same for capture actions |
| `idx_one_pending_refund_per_purchase` | Same for refund actions |

### Modified Function (1)

**`record_cancel_result`** — restructured to check idempotent replay BEFORE action status. `acquire_operation` now runs before the `ACTION_STATUS_INVALID` check, so a duplicate call with the same `operation_id + request_hash` returns the stored result even after the action is already completed.

### Deployed Objects (after)

| Object | Count |
|---|---|
| Tables | 7 |
| Functions | 29 (19 authority + 10 workers) |
| Roles | 6 (authority_owner, authority_executor, authority_stripe_recorder, authority_worker + 2 legacy probe) |

---

## 4. Transaction Semantics

### Begin Cancellation (`begin_cancel`)

1. Acquires `operation_id` — unique per call, idempotent replay or conflict detection
2. Locks binding with `SELECT ... FOR UPDATE` — row-level lock
3. Verifies binding is in cancellable state (`authorized`, `capture_requested`, `capture_unknown`)
4. Updates binding to `cancel_requested` — conditional UPDATE with `ROW_COUNT` check (exactly 1 row)
5. Creates `payment_action` — durable saga record with unique `stripe_idempotency_key`
6. Commits — all changes atomic

**No Stripe call inside the transaction.** The Stripe cancel call happens between `begin_cancel` and `record_cancel_result`.

### Record Cancellation Result (`record_cancel_result`)

1. Looks up action for `listing_id` (needed for `acquire_operation`)
2. Acquires operation — idempotent replay returns stored result; conflict returns error (BEFORE status check)
3. Checks action status (only for new operations, not replays)
4. Records Stripe result on the action (exactly 1 row)
5. Branches: succeeded → binding `canceled`, authority `available`; failed → `cancel_failed`, frozen, `recovery_blocked`, incident; unknown → `cancel_unknown`, frozen, `recovery_blocked`, incident
6. Commits — all changes atomic

### Correction: T9 Failure Root Cause

An earlier version of T9 counted **all** `payment_actions` rows globally (`countAll().payment_actions`) instead of counting only the **current test's purchase** (`WHERE purchase_id = ${ctx.purchaseId}`). This produced a false failure because rows from prior tests (T1–T8) were included in the count. The database unique constraint and partial index (`idx_one_pending_cancel_per_purchase`) were working correctly — the failure was an **unscoped test-counter bug**, not a Neon HTTP concurrency limitation. The corrected test counts only its own purchase's `payment_actions` and passes reliably.

---

## 5. Client Separation and Role Boundary

### Executor Client (`authorityV1Client.js`)

- **Allowlisted methods (executor-granted only):** getState, initializeListing, reserveListing, releaseListing, expireListing, bindPaymentIntent, beginCancel, abortBinding
- **`recordCancelResult` is NOT in the executor client** — the executor role lacks EXECUTE permission on it (granted to `authority_stripe_recorder` only, per `004_roles_and_grants.sql` §11). The method was removed from the executor client to enforce the boundary at the code level.
- **No admin URL. No admin connection.** No arbitrary raw-SQL method. No credentials logged or returned. Validates Neon dev fingerprint (hostname + database + role).

### Admin/Test Client (`authorityV1TestAdmin.js`)

- **NEVER imported by production handlers.** Static analysis: 0 of 50 production handler files import `authorityV1TestAdmin`.
- **No production runtime path uses the admin URL** (`AUTHORITY_DB_URL_DEV_ADMIN`). Static analysis: 0 of 50 production handler files reference `AUTHORITY_DB_URL_DEV_ADMIN`.
- Raw SQL execution for test setup, state verification, and cleanup. Cleanup by exact synthetic ID allowlist. No credentials logged or returned.

### Role Evidence

| Test | Proof | Result |
|---|---|---|
| T14: Executor cannot call `record_cancel_result` | `information_schema.role_routine_grants`: `authority_executor` has 0 grants on `record_cancel_result`. Actual call as executor: blocked (permission denied). | ✅ grantCount=0, callBlocked=true |
| T15: Recorder cannot call `begin_cancel` | `information_schema.role_routine_grants`: `authority_stripe_recorder` has 0 grants on `begin_cancel` (negative proof). `authority_stripe_recorder` has 1 grant on `record_cancel_result` (positive proof of allowlist). | ✅ recorderBeginGrants=0, recorderRecordGrants=1 |

### Role Separation

| Role | Purpose | Granted Functions |
|---|---|---|
| `authority_executor` | Ordinary authority operations | acquire_operation, get_state, initialize_listing, reserve_listing, release_listing, expire_listing, bind_payment_intent, begin_capture, begin_cancel, begin_refund, abort_binding, cancel_listing, quarantine_listing, check_user_obligations, anonymize_user |
| `authority_stripe_recorder` | Stripe-result recording only | acquire_operation, record_capture_result, record_cancel_result, record_refund_result, finalize_sale |
| `authority_worker` | Worker claiming and recovery | claim_outbox_batch, complete_outbox_event, recover_expired_outbox_leases, claim_payment_action, recover_expired_payment_action_leases, escalate_exhausted_payment_action, claim_webhook_event, complete_webhook_event, recover_expired_webhook_leases, escalate_exhausted_webhook_event |
| `authority_owner` | NOLOGIN — owns all objects | (no EXECUTE grants — owns objects via SECURITY DEFINER) |

**No role passwords or secrets were altered.**

### Recorder Login/Secret Prerequisite

No owner-managed `authority_stripe_recorder` login/secret exists in the app's secret store. The `authority_stripe_recorder` role was created with `LOGIN` in the database (`004_roles_and_grants.sql` §1), but no connection URL secret (e.g., `AUTHORITY_V1_DB_URL_DEV_RECORDER`) has been provisioned. **No actual recorder-role login connection was tested** because no owner-managed recorder credential/secret exists.

This is a **prerequisite for the later handler-integration gate (P0-01G)**: when a production handler needs to call `record_cancel_result`, it must use a recorder-role connection, not the executor or admin connection. The recorder password/secret must be provisioned by the app owner out-of-band. **Do not create or reset the recorder password in this gate.** The test suite proxies `record_cancel_result` through the admin connection as a test-only expedient.

Admin credentials (`AUTHORITY_DB_URL_DEV_ADMIN`) were used only for administration and testing and are not imported by production handlers.

---

## 6. SQL Artifact / Live-Database Parity (T16)

### Function Parity

| Object | Artifact Hash | Live Hash | Match |
|---|---|---|---|
| `record_cancel_result` body | `47ad19534a552947` | `47ad19534a552947` | ✅ |

**Method:** The function body (between `AS $$` and `$$`) was extracted from `002_functions.sql` and compared with `pg_proc.prosrc` from the live database. Both were normalized (comments stripped, whitespace collapsed, type casts removed, lowercased) and hashed with SHA-256 (first 16 hex chars). The replay-before-status structure was also verified: `acquire_operation` appears before `ACTION_STATUS_INVALID` in the live `prosrc`.

### Index Parity

| Index | Artifact Hash | Live Hash | Match |
|---|---|---|---|
| `idx_one_pending_cancel_per_purchase` | `959cdab59e72d762` | `959cdab59e72d762` | ✅ |
| `idx_one_pending_capture_per_purchase` | `27148cfd22e3af55` | `27148cfd22e3af55` | ✅ |
| `idx_one_pending_refund_per_purchase` | `df406739fd0c72c3` | `df406739fd0c72c3` | ✅ |

**Method:** Each index definition was extracted from `001_schema.sql` and compared with `pg_indexes.indexdef` from the live database. Both were normalized (schema prefix removed, `USING btree` removed, `::text` casts removed, `= ANY(ARRAY[...])` → `IN (...)`, parentheses removed, whitespace collapsed, lowercased) and hashed with SHA-256 (first 16 hex chars).

---

## 7. Test Evidence — 51/51 PASS from Persisted Runner

### Execution Method

The test module (`tests/payment-saga-cancel.test.mjs`) was refactored into an importable ESM module exporting `runAllTests(deps)`. The `exec_tool` sandbox dynamically imported the module and invoked `runAllTests({ execSql, adminSql })` with `neon()` connections created from the app's secrets (`AUTHORITY_V1_DB_URL_DEV_EXECUTOR` and `AUTHORITY_DB_URL_DEV_ADMIN`). This avoids the platform's restriction on passing DB credentials to child processes. Sanitized raw results were saved to `tests/payment-saga-cancel-results.json`.

**Exact command (reproducibility):**
```
node --import ./tests/loaders/npm-compat-register.mjs -e "
  const { neon } = require('@neondatabase/serverless');
  const execSql = neon(process.env.AUTHORITY_V1_DB_URL_DEV_EXECUTOR);
  const adminSql = neon(process.env.AUTHORITY_DB_URL_DEV_ADMIN);
  const m = await import('./tests/payment-saga-cancel.test.mjs');
  const r = await m.runAllTests({ execSql, adminSql });
  console.log(JSON.stringify({ passed: r.passed, failed: r.failed }, null, 2));
"
```
Note: `exec_tool` sandbox proxies the same import+invoke pattern internally.

### Test Scenarios (Fake Stripe Adapter Only)

| # | Test | Assertions | Result |
|---|---|---|---|
| 1 | Cancellation success | 6 | ✅ PASS |
| 2 | Definitive failure | 7 | ✅ PASS |
| 3 | Timeout/unknown | 7 | ✅ PASS |
| 4 | Later webhook success (durable unknown) | 3 | ✅ PASS |
| 5 | Later reconciliation success (durable unknown) | 3 | ✅ PASS |
| 6 | Duplicate webhook (idempotent) | 2 | ✅ PASS |
| 7 | Identical retry (same op_id + same hash) | 2 | ✅ PASS |
| 8 | Conflicting retry (structured result) | 3 | ✅ PASS |
| 9 | 20 concurrent begin (per-purchase scoped count) | 2 | ✅ PASS |
| 10 | Injected rollback (structured result) | 2 | ✅ PASS |
| 11 | Incident uniqueness (reset to authorized) | 2 | ✅ PASS |
| 12 | Executor denied direct table mutation | 2 | ✅ PASS |
| 13 | Cleanup by exact synthetic ID allowlist | 2 | ✅ PASS |
| 14 | Executor cannot call record_cancel_result | 2 | ✅ PASS (grantCount=0, callBlocked=true) |
| 15 | Recorder cannot call begin_cancel | 2 | ✅ PASS (recorderBeginGrants=0, recorderRecordGrants=1) |
| 16 | SQL artifact / live-database parity | 3 | ✅ PASS (fn + 3 indexes match) |
| Final | All tables 0 rows after cleanup | 1 | ✅ PASS |
| **Total** | | **51** | **51/51 PASS** |

**Fake Stripe adapter:** Tests use a JavaScript function returning a predetermined result (succeeded/failed/unknown). No real Stripe API is called. No real Stripe keys are used.

---

## 8. Build, Lint, and Regression Results

| Check | Exit Code | Details |
|---|---|---|
| `npm run build` (vite build) | 0 | Build succeeded |
| Scoped lint (changed files) | 0 | 0 errors, 0 warnings |
| Backend lint (`npm run lint:backend`) | 0 | 0 errors, 116 warnings (pre-existing) |
| P0-01E protections regression | 0 | 7/7 pass |
| P0-01E wiring regression | 0 | 5/5 pass |
| Search normalize regression | 0 | 28/28 pass |
| Payment saga cancellation tests (persisted runner) | 0 | 51/51 pass |

---

## 9. Final State

| Item | Value |
|---|---|
| `CANARY_ENABLED` flag | `false` (OFF) |
| Maintenance mode | ON |
| Function count | 50 (unchanged) |
| Authority tables | 7 |
| Authority functions | 29 |
| Authority roles | 6 |
| Authority rows (all tables) | 0 |
| Real Stripe calls | 0 |
| Real email/push/points/notifications | 0 |
| Production entry points modified | 0 (abortCheckout, capturePayment, refunds, webhook, 7C.9D unchanged) |
| Admin client imports in production handlers | 0 (50 handlers checked) |
| Admin URL usage in production handlers | 0 (50 handlers checked) |

---

## 10. Files Changed

| File | Change |
|---|---|
| `database/authority_v1/001_schema.sql` | Added 3 concurrency unique indexes |
| `database/authority_v1/002_functions.sql` | Modified `record_cancel_result` (replay-first) |
| `base44/shared/authorityV1Client.js` | Removed `recordCancelResult` from executor allowlist (recorder-only); added recorder-only comment |
| `base44/shared/authorityV1TestAdmin.js` | NEW — admin/test-only client with recordCancelResult proxy, per-purchase count, resetBindingToAuthorized, grant verification, artifact parity helpers |
| `tests/payment-saga-cancel.test.mjs` | NEW — 16-scenario importable ESM module (51 assertions) with fake Stripe adapter, structured result assertions, per-purchase scoped counts, role boundary proofs, artifact parity proofs |
| `tests/payment-saga-cancel-results.json` | NEW — sanitized raw results from persisted runner execution |

---

## 11. Conclusion

P0-01F is **PASS** as a **development database saga-substrate certification**:
- The cancellation saga primitives are proven by 51/51 executable tests from the **persisted runner** (not replacement inline code) against the real Postgres database.
- All required transaction behaviors are verified: atomic begin, no Stripe in transaction, exactly-once release on success, fail-closed on failure, unknown protection with incident, idempotent replay, conflict rejection, concurrent exactly-one, rollback safety.
- **Role boundary is proven:** executor cannot call `record_cancel_result` (grant table + actual call); recorder cannot call `begin_cancel` (grant table + positive proof of recorder allowlist); admin client never imported by production (static analysis of 50 handlers); no production path uses admin URL (static analysis).
- **Artifact/live parity is proven:** `record_cancel_result` body and all 3 unique indexes match by normalized hash.
- **Production Stripe execution is NOT certified.** No production handler calls `begin_cancel` or `record_cancel_result`. `abortCheckout` integration is NOT STARTED.

**P0-01G (production-handler canary integration) is blocked** until an owner-managed `authority_stripe_recorder` connection and Base44 secret exist. No recorder password was created or reset in this gate.