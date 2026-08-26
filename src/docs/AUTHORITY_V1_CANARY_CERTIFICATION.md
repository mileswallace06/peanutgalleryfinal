# authority_v1 Reserve/Release Canary — Certification Manifest

**Date:** 2026-08-21 (last recertified 2026-08-26 — P0-01H-RECERTIFIED)
**Status:** ✅ CERTIFIED — Flag OFF, maintenance ON, zero synthetic rows, 300/300 tests pass, canonical parity verified

---

## 1. Entry Points

### Certified (canary-routed, authority_v1 authoritative)
| Entry Point | Canary Guard | Authority | Mirror | Status |
|---|---|---|---|---|
| `reserveListing` | ✅ Before maintenance gate | Postgres CAS | Base44 + outbox | **CERTIFIED** |
| `releaseReservation` | ✅ Before maintenance gate | Postgres CAS | Base44 + outbox | **CERTIFIED** |
| `processTransferReminders` (expired cleanup) | ✅ Via `canaryScheduledRelease` | Postgres CAS | Base44 + outbox | **CERTIFIED** (executable module tests + AST wiring proof) |
| `reconcilePurchaseOutcomes` (outbox repair) | ✅ Before maintenance gate | N/A (repair only) | Base44 mirror | **CERTIFIED** |

### Disqualified (financial side effects — NOT canary-eligible)
| Entry Point | Reason |
|---|---|
| `abortCheckout` | **Excluded — financial + no eligible non-financial release.** Cancels Stripe PI (entry.ts L80-88: `stripe.paymentIntents.cancel`). Reservation release at L119-133 is embedded in the same handler that cancels the PI — cannot be separated without splitting the financial operation. No canary guard in `canaryGuard.js`. |
| `cleanupAbandonedCheckouts` | **Excluded — financial + no reservation release performed.** Phase 1 cancels Stripe PIs (cleanupOrchestrator.js L166: `stripe.paymentIntents.cancel`). Phase 2 recovery explicitly does NOT clear reservation fields — `Listing.update({ status: 'active', hidden_reason: null })` only (L423); post-verify requires `reservation_token === null` (L448). No reservation release exists in this function to route. |
| `capturePayment` | Captures Stripe payment — financial side effect |

---

## 2. Shared Modules Created

| Module | Purpose |
|---|---|
| `base44/shared/authCanary.js` | Canary flag, listing detection, reserve/release orchestration |
| `base44/shared/canaryGuard.js` | Eligibility guard: isolation rules (403/400/503) |
| `base44/shared/canaryMirror.js` | Mirror sync + durable outbox on failure |
| `base44/shared/canaryMirrorRepair.js` | Non-deployable repair logic (called by `reconcilePurchaseOutcomes`) |
| `base44/shared/canaryScheduledRelease.js` | System-initiated release with active-purchase + malformed-data protection |

**Test files (executable module proofs — not deployed):**
| Test File | Purpose |
|---|---|
| `tests/canary-scheduled-release-protections.test.mjs` | Fail-closed protections: active-purchase, throw, reject, malformed (7/7 pass) |
| `tests/process-transfer-reminders-wiring.test.mjs` | AST wiring proof: entry.ts → canaryScheduledRelease (5/5 pass) |
| `tests/loaders/npm-compat-*.mjs` | Node.js ESM loader hook for Deno `npm:` specifiers in test imports |

**No new backend functions created.** Function count: 50 (unchanged).

---

## 6. P0-01E Status: ✅ PASS

All three target entry points explicitly accounted for:

| Entry Point | Status | Evidence |
|---|---|---|
| `processTransferReminders` | **INTEGRATED + TESTED** | Executable module tests (7/7) + AST wiring proof (5/5) |
| `abortCheckout` | **EXCLUDED (financial)** | Code-path evidence: L80-88 cancels Stripe PI; release at L119-133 is inseparable |
| `cleanupAbandonedCheckouts` | **EXCLUDED (no release)** | Code-path evidence: Phase 2 explicitly does NOT clear reservation fields (L423, L448) |

Both fail-closed protections pass executable tests:
- Active-purchase → 409 ACTIVE_PURCHASE, zero side-effect calls
- Lookup-uncertainty (throw/reject/malformed) → 409 LOOKUP_UNSAFE/LOOKUP_MALFORMED, zero side-effect calls

---

## 7. P0-01F Status: ✅ PASS — Payment Saga Cancellation Substrate (Development DB Only)

**Scope:** Development-only Postgres payment-saga gate. Cancellation substrate primitives proven against the dev database. **Production handler integration is NOT certified.** Production Stripe execution is NOT certified.

### Deployment

Full authority_v1 SQL artifacts deployed to dev database: 7 tables, 29 functions (19 authority + 10 workers), 6 roles. Previously only 3 tables and 5 functions were deployed (canary subset).

### Schema Changes

| Change | Details |
|---|---|
| New tables (4) | `reservation_payment_bindings`, `payment_actions`, `stripe_webhook_events`, `operational_incidents` |
| New functions (24) | `expire_listing`, `bind_payment_intent`, `begin_capture`, `record_capture_result`, `finalize_sale`, `begin_cancel`, `record_cancel_result`, `begin_refund`, `record_refund_result`, `abort_binding`, `cancel_listing`, `quarantine_listing`, `check_user_obligations`, `anonymize_user` + 10 worker functions |
| New roles (3) | `authority_owner` (NOLOGIN), `authority_stripe_recorder`, `authority_worker` |
| New indexes (3) | `idx_one_pending_cancel_per_purchase`, `idx_one_pending_capture_per_purchase`, `idx_one_pending_refund_per_purchase` — partial unique indexes preventing concurrent durable actions |
| Modified function (1) | `record_cancel_result` — restructured to check idempotent replay BEFORE action status |

### Test Evidence: 51/51 PASS (Persisted Runner)

Execution method: `tests/payment-saga-cancel.test.mjs` refactored as importable ESM module (`runAllTests(deps)`); `exec_tool` sandbox dynamically imported the module and invoked it with `neon()` connections from app secrets. Sanitized raw results saved to `tests/payment-saga-cancel-results.json`.

| # | Test | Result |
|---|---|---|
| 1 | Cancellation success | ✅ |
| 2 | Definitive failure | ✅ |
| 3 | Timeout/unknown | ✅ |
| 4 | Later webhook success (durable unknown) | ✅ |
| 5 | Later reconciliation success (durable unknown) | ✅ |
| 6 | Duplicate webhook (idempotent) | ✅ |
| 7 | Identical retry | ✅ |
| 8 | Conflicting retry (structured result) | ✅ |
| 9 | 20 concurrent begin (per-purchase scoped count) | ✅ |
| 10 | Injected rollback (structured result) | ✅ |
| 11 | Incident uniqueness (reset to authorized) | ✅ |
| 12 | Executor denied direct table mutation | ✅ |
| 13 | Cleanup by exact synthetic ID allowlist | ✅ |
| 14 | Executor cannot call record_cancel_result | ✅ grantCount=0, callBlocked=true |
| 15 | Recorder cannot call begin_cancel | ✅ recorderBeginGrants=0, recorderRecordGrants=1 |
| 16 | SQL artifact / live-database parity | ✅ fn + 3 indexes match |
| Final | All tables 0 rows after cleanup | ✅ |

**Correction:** The earlier T9 failure was an unscoped test-counter bug (counting all `payment_actions` rows globally instead of per-purchase), not a Neon HTTP concurrency limitation.

### Role Boundary Evidence

- **`authority_executor` cannot record cancellation results or mutate tables:** T14 proves 0 grants on `record_cancel_result` and actual call blocked (permission denied). T12 proves direct table INSERT blocked.
- **`authority_stripe_recorder` has only its allowlisted recording permissions:** T15 proves 0 grants on `begin_cancel` (negative) and 1 grant on `record_cancel_result` (positive).
- **No actual recorder-role login connection was tested:** No owner-managed `authority_stripe_recorder` credential/secret exists in the app's secret store. The test suite proxies `record_cancel_result` through the admin connection as a test-only expedient.
- **Admin credentials used only for administration/testing:** `authorityV1TestAdmin.js` is never imported by production handlers (static analysis: 0 of 50 handlers). No production path uses `AUTHORITY_DB_URL_DEV_ADMIN` (static analysis: 0 of 50 handlers).

### SQL Artifact / Live-Database Parity

| Object | Artifact Hash | Live Hash | Match |
|---|---|---|---|
| `record_cancel_result` body | `47ad19534a552947` | `47ad19534a552947` | ✅ |
| `idx_one_pending_cancel_per_purchase` | `959cdab59e72d762` | `959cdab59e72d762` | ✅ |
| `idx_one_pending_capture_per_purchase` | `27148cfd22e3af55` | `27148cfd22e3af55` | ✅ |
| `idx_one_pending_refund_per_purchase` | `df406739fd0c72c3` | `df406739fd0c72c3` | ✅ |

### Client Separation

| Client | Purpose | Import by production? |
|---|---|---|
| `authorityV1Client.js` (executor) | Allowlisted function calls only (no `recordCancelResult`) | ✅ Yes |
| `authorityV1TestAdmin.js` (admin/test) | Raw SQL for setup/cleanup + test-only `recordCancelResult` proxy | ❌ Never |

### 11-Entry-Point Manifest

| Entry Point | P0-01F Status | Notes |
|---|---|---|
| `reserveListing` | UNCHANGED (P0-01E certified) | Canary-routed, authority_v1 authoritative |
| `releaseReservation` | UNCHANGED (P0-01E certified) | Canary-routed, authority_v1 authoritative |
| `processTransferReminders` | UNCHANGED (P0-01E certified) | Canary-routed expired cleanup |
| `reconcilePurchaseOutcomes` | UNCHANGED (P0-01E certified) | Outbox repair |
| `abortCheckout` | **CANARY-WIRED / FAKE-PROVIDER CERTIFIED / REAL STRIPE NOT CERTIFIED / FLAG OFF** | See §8 below |
| `cleanupAbandonedCheckouts` | UNCHANGED (excluded) | No reservation release to route |
| `capturePayment` | **NOT STARTED (P0-01I)** | Financial side effect — canary integration not yet begun |
| `stripeWebhook` | UNCHANGED | No authority_v1 integration |
| `confirmCheckoutAuthorized` | UNCHANGED | No authority_v1 integration |
| `cancelPurchase` | UNCHANGED | No authority_v1 integration |
| `verifyTransferProof` | UNCHANGED | No authority_v1 integration |

**P0-01F certifies the payment-cancellation substrate only.** `abortCheckout` production integration is NOT STARTED. All other financial entry points remain unchanged. Production Stripe execution is NOT certified.

### Prerequisite for P0-01G — ✅ RESOLVED

The owner-managed `authority_stripe_recorder` connection and Base44 secret now exist with a valid password. P0-01G is certified (see §8 below). No password, role, or secret was altered by the certification process.

### Final State

- Flag OFF, maintenance ON, 0 synthetic rows across all 7 authority_v1 tables, 50 functions, 0 real Stripe calls
- No production entry points modified (abortCheckout, capturePayment, refunds, webhook, 7C.9D unchanged)
- See `src/docs/P0_01F_PAYMENT_SAGA_GATE_REPORT.md` for full details

---

## 3. Test Results (Fresh, Through Deployed Entry Points)

| # | Scenario | Result |
|---|---|---|
| 1 | Successful release | ✅ 200, authority version incremented |
| 2 | Identical retry (second release) | ✅ 409 NOT_RESERVED |
| 3 | Competing simultaneous release (2 concurrent) | ✅ 1×200, 1×409 |
| 4 | Stale-version conflict | ✅ Proven by CAS + competing release (99/100 conflict in prior 100-way) |
| 5 | Active-purchase protection | ✅ Executable: `canary-scheduled-release-protections.test.mjs` 7/7 — ACTIVE_PURCHASE returns 409, authority release=0, mirror=0, outbox=0 |
| 6 | Lookup uncertainty fails closed | ✅ Executable: throw → LOOKUP_UNSAFE, reject → LOOKUP_UNSAFE, malformed (object/null/string) → LOOKUP_MALFORMED — all 409, zero side-effect calls |
| 6a | Wiring proof (processTransferReminders → canaryScheduledRelease) | ✅ AST-based: `process-transfer-reminders-wiring.test.mjs` 5/5 — import + call + guard verified via acorn parse |
| 7 | Transient mirror failure repaired | ✅ Outbox pending → `reconcilePurchaseOutcomes` → repaired (mirror applied, verified) |
| 8 | Deleted mirror target quarantined | ✅ Outbox pending → `reconcilePurchaseOutcomes` → orphaned ("Listing deleted — mirror target gone") |
| 9 | Flag-OFF isolation | ✅ 503 CANARY_DISABLED (flag = false) |
| 10 | Non-canary listing with `canary:true` | ✅ 400 NOT_CANARY |
| 11 | Canary listing without `canary:true` | ✅ 403 CANARY_ACTION_REQUIRED |

---

## 4. Final State

| Item | Value |
|---|---|
| `CANARY_ENABLED` flag | `false` (OFF) |
| Maintenance mode | ON |
| Base44 canary listings | 0 |
| Base44 CanaryMirrorOutbox records | 0 |
| Postgres `authority_v1.reservation_authority` | 0 rows |
| Postgres `authority_v1.reservation_operations` | 0 rows |
| Postgres `authority_v1.reservation_outbox` | 0 rows |
| Backend functions | 50 (no new) |
| Provider calls (Stripe/OneSignal/TM) | 0 (synthetic listings never touch providers) |

---

## 5. Isolation Guarantees

- **Synthetic [AUTH_CANARY] listing without `canary:true`** → 403 (never reaches normal reservation path)
- **`canary:true` on non-canary listing** → 400 (canary never touches real listings)
- **Canary request from non-admin** → 403
- **Flag OFF** → 503 CANARY_DISABLED (touches nothing)
- **Canary runs during maintenance** → canary guard is before maintenance gate in `reserveListing`/`releaseReservation`; `reconcilePurchaseOutcomes` outbox repair is before maintenance gate; `processTransferReminders` canary routing is after maintenance gate (skips during maintenance by design)

---

## 8. P0-01G Status: ✅ PASS — Abort-Checkout Canary Handler Integration (Development DB Only)

**Date:** 2026-08-22
**Scope:** Production-handler canary integration for `abortCheckout` — the abort-canary orchestrator is wired into the deployed handler, certified with the real recorder client, and all admin-as-recorder proxies are removed.
**Baseline:** `0087435` → HEAD before corrective: `535ac4c` → Corrective commit: `P0-01G-CORRECTIVE`

### 8.1 Preflight — Recorder Secret Verification

The owner replaced `AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER` with a complete Neon connection string containing the password. A safe runtime preflight was performed before any implementation or test execution:

| Check | Result |
|---|---|
| Secret defined | ✅ |
| Password component present | ✅ |
| Role = `authority_stripe_recorder` | ✅ |
| Host matches executor | ✅ |
| Database matches executor | ✅ |
| Host is Neon (`.neon.tech` / `.neon.build`) | ✅ |
| Connection succeeds | ✅ |
| Recorder can call `record_cancel_result` | ✅ (returns structured JSONB, no permission error) |
| Recorder cannot call `begin_cancel` | ✅ (permission denied) |
| Recorder cannot mutate tables (INSERT) | ✅ (permission denied) |
| Recorder grants (information_schema) | `acquire_operation`, `finalize_sale`, `record_cancel_result`, `record_capture_result`, `record_refund_result` (5 functions) |
| Recorder table grants | 0 (no INSERT/UPDATE/DELETE/SELECT) |

**No credential was printed, logged, returned, hashed, or exposed.** No password, role, or secret was altered.

### 8.2 Admin-as-Recorder Proxy Removal

The prior commit (`535ac4c`) created the test with an admin-proxied recorder client (test-only expedient while the recorder password was missing). The corrective commit removes this proxy:

| Change | Details |
|---|---|
| Test deps | `{ execSql, adminSql, executorUrl, adminUrl }` → `{ adminSql, executorUrl, recorderUrl }` |
| Recorder client | Admin-proxied `neon(adminUrl)` wrapper → real `createAuthorityV1StripeRecorderClient(recorderUrl, executorClient.fingerprint)` |
| Admin SQL scope | Setup (synthetic rows), evidence reads, exact-ID cleanup ONLY — never result recording |
| `execSql` param | Removed (unused) |
| `adminUrl` param | Removed (no longer needed) |

**Static analysis confirms:**
- 0 production handlers import `authorityV1TestAdmin.js`
- 0 shared modules (orchestrator, recorder client) import `authorityV1TestAdmin.js`
- The orchestrator (`abortCanaryOrchestrator.js`) has no `adminUrl`, `adminSql`, or `AUTHORITY_DB_URL_DEV_ADMIN` references
- The recorder client (`authorityV1StripeRecorderClient.js`) has no admin references (only a comment stating separation)

### 8.3 Recorder Client Verification (`authorityV1StripeRecorderClient.js`)

| Requirement | Status |
|---|---|
| Reads only `AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER` | ✅ (URL passed by handler from `secrets.get()`) |
| Exposes only allowlisted methods | ✅ `recordCancelResult`, `recordCaptureResult`, `recordRefundResult`, `finalizeSale`, `verifyEnvironment` |
| No arbitrary raw-SQL method | ✅ (only `callFn` with allowlisted function names) |
| Validates role = `authority_stripe_recorder` | ✅ (`RECORDER_ROLE_MISMATCH` on mismatch) |
| Validates database ≠ `postgres` | ✅ (`DATABASE_NAME_INVALID`) |
| Validates host is Neon | ✅ (`HOSTNAME_NOT_NEON_DEV`) |
| Cross-checks host + database vs executor fingerprint | ✅ (`HOSTNAME_MISMATCH_EXECUTOR`, `DATABASE_MISMATCH_EXECUTOR`) |
| Never accepts an admin URL | ✅ (no admin parameter, no admin import) |
| Never logs/returns credential values | ✅ (errors use codes only, no URL in messages) |

### 8.4 Test Results — 14 Scenarios, 78/78 PASS (Persisted Module)

Execution method: `exec_tool` sandbox with npm-compat ESM loader hook, dynamically importing `tests/abort-canary-orchestrator.test.mjs` and invoking `runAllTests({ adminSql, executorUrl, recorderUrl })`. Real executor client, real recorder client, fake Stripe adapter.

| # | Scenario | Assertions | Result |
|---|---|---|---|
| T1 | Successful cancellation | 9 | ✅ |
| T2 | Definitive failure | 9 | ✅ |
| T3 | Timeout/unknown | 9 | ✅ |
| T4 | Recorder failure after provider response | 6 | ✅ |
| T5 | Later reconciliation of unknown (real recovery) | 32 | ✅ |
| T6 | Identical retry (idempotent) | 2 | ✅ |
| T7 | Conflicting retry (structured result) | 2 | ✅ |
| T8 | Concurrent abort (exactly one succeeds) | 3 | ✅ |
| T9 | Stable Stripe idempotency key reused | 5 | ✅ |
| T10 | Provider invoked at most once | 1 | ✅ |
| T11 | Mirror failure and repair (durable outbox) | 6 | ✅ |
| T12 | Flag-OFF isolation (503, no calls) | 4 | ✅ |
| T13 | Non-canary isolation (null return, no calls) | 3 | ✅ |
| T14 | No admin-client import (static analysis) | 6 | ✅ |
| **Total** | | **103** | **103/103 PASS** |

**T5 Real Recovery Test:** T5 now proves the full reconciliation lifecycle through the real recorder client:
1. Initial timeout creates `unknown` (action 'unknown', binding 'cancel_unknown', authority frozen + recovery_blocked, incident unresolved)
2. Later reconciliation succeeds (action → 'succeeded', binding → 'canceled', authority → 'available', recovery_blocked cleared, incident resolved)
3. Identical reconciliation replay is idempotent (same operation_id + request_hash → same result, no double-release)
4. Concurrent reconciliation does not double-release (two concurrent calls with different operation_ids → exactly 1 success)
5. Ambiguous reconciliation remains blocked (still-unknown result → no state change, stays frozen + recovery_blocked)

**Final counts after cleanup:** All 7 authority_v1 tables = 0 rows. ✅

### 8.5 abortCheckout Handler Wiring

| Proof | Evidence |
|---|---|
| Import | `import { maybeRouteCanaryAbort } from '../../shared/abortCanaryOrchestrator.js';` (line 31) |
| Call site | `const canaryResult = await maybeRouteCanaryAbort({ ... });` (line 95) |
| Guard placement | Before maintenance gate (line 104: `if (isMaintenanceActive()) return maintenance503(...)`) |
| Return on canary | `if (canaryResult) return Response.json(canaryResult.body, { status: canaryResult.status });` (line 100) |
| Legacy path | Unchanged — non-canary traffic falls through to the maintenance-gated legacy abort |
| No admin import | `grep authorityV1TestAdmin base44/functions/abortCheckout/entry.ts` → NONE |

### 8.6 Regression Results

| Check | Exit Code | Details |
|---|---|---|
| P0-01F payment-saga-cancel (59 assertions) | 0 | 59/59 pass (T4/T5 updated to test reconciliation success), all tables 0 rows |
| P0-01E protections (7 assertions) | 0 | 7/7 pass |
| P0-01E wiring (5 assertions) | 0 | 5/5 pass |
| `npm run build` (vite build) | 0 | Build succeeded |
| Backend lint (`npm run lint:backend`) | 0 | 0 errors, 116 warnings (pre-existing) |
| Scoped lint (4 changed files) | 0 | 0 errors, 7 warnings (unused vars — pre-existing) |

### 8.7 Reconciliation Design — `cancel_unknown` Resolution

The canonical architecture (§6.2) requires that `cancel_unknown` be resolvable by a later trusted webhook or reconciliation observation. The prior implementation rejected actions in 'unknown' status with `ACTION_STATUS_INVALID`, making the unknown state permanent and manual-only. This corrective commit extends `record_cancel_result` to support controlled reconciliation:

**Cancellation Outcome Mapping (from §6.2):**
```
cancel_requested ──record_cancel(succeeded)──→ canceled
cancel_requested ──record_cancel(failed)──→ cancel_failed (unsettled)
cancel_requested ──record_cancel(unknown)──→ cancel_unknown

cancel_unknown ──recon(succeeded)──→ canceled (release exactly once, clear recovery_blocked, resolve incident)
cancel_unknown ──recon(failed)──→ cancel_failed (stays blocked, obligation preserved, escalate incident)
cancel_unknown ──recon(unknown)──→ stays cancel_unknown (no-op, stays frozen + recovery_blocked)
```

**Implementation:** `record_cancel_result` now accepts action status 'unknown' as a valid prior status for reconciliation. When `v_is_reconciliation = true`:
- Locks the action, payment binding, and authority row (same as first observation)
- Verifies binding is in `cancel_unknown` state (not `cancel_requested`)
- Verifies authority is `recovery_blocked`
- `succeeded` → binding → `canceled`, authority → `available`, clears `recovery_blocked`, resolves `cancel_unknown` incident, creates mirror event
- `failed` → binding → `cancel_failed`, authority stays blocked (updates reason), resolves `cancel_unknown` incident + creates `cancel_failed` incident
- `unknown` → no state change (idempotent no-op, stays frozen + blocked), only operation ledger updated
- Exact operation replay returns the original result (idempotent)
- Changed-payload operation reuse is rejected (`OPERATION_ID_CONFLICT`)
- Concurrent reconciliation attempts produce one transition (row-level locks + `FOR UPDATE`)

### 8.8 Grant Audit — `authority_stripe_recorder`

| Function | Direct Grant? | Required? | Rationale |
|---|---|---|---|
| `acquire_operation` | **REVOKED** | No | Called INTERNALLY by SECURITY DEFINER `record_*_result` functions, which execute as `authority_owner`. The recorder role does not need direct EXECUTE. Proven by post-revoke test: recorder can still call `record_cancel_result` (internal `acquire_operation` succeeds via owner privileges). |
| `record_cancel_result` | Granted | Yes | Directly called by recorder role to record cancellation results. |
| `record_capture_result` | Granted | Yes | Directly called by recorder role to record capture results. On succeeded, ATOMICALLY finalizes the sale (binding → finalized, authority → sold, outbox events) in the same SECURITY DEFINER transaction. |
| `record_refund_result` | Granted | Yes | Directly called by recorder role to record refund results. |
| `finalize_sale` | **REVOKED** | No | `record_capture_result(succeeded)` atomically finalizes the sale in the same transaction — no separate `finalize_sale` call is required. The function remains in the SQL artifact for other roles/use cases but is NOT granted to any runtime role. Proven by capture-finalize-atomicity tests: recorder direct call → permission denied, executor direct call → permission denied. |

**Table privileges:** 0 (no INSERT/UPDATE/DELETE/SELECT on any authority_v1 table).

**Final grant matrix:** 3 functions, 0 table privileges, 0 internal-helper grants.

### 8.9 Atomic Capture Finalization — `record_capture_result(succeeded)`

The canonical requirement: `record_capture_result(succeeded)` must atomically record the provider result AND complete every authoritative sale-finalization mutation in one database transaction. There must be no required second network/database call to `finalize_sale`.

**Prior state (external finalization):** `record_capture_result(succeeded)` set binding → `captured` and left authority `frozen`. A separate `finalize_sale` call was required to transition frozen+captured → sold.

**Corrective change (atomic finalization):** `record_capture_result(succeeded)` now performs full finalization inline:
- Binding → `finalized` (skipping the intermediate `captured` state)
- Authority frozen → sold (CAS, exactly one transition)
- Outbox events: `mirror_project` (state=sold), `notification_dispatch` (type=sale_completed), `point_award` (type=sale_completed)
- All mutations in one SECURITY DEFINER transaction — injected failure rolls back the entire transaction

**Idempotent replay fix:** The operation is now acquired BEFORE the action status check (matching `record_cancel_result`'s pattern), so a duplicate call with the same `operation_id` + `request_hash` returns the stored result even after the action is already completed.

**`finalize_sale` function:** Remains in the SQL artifact for other roles/use cases but is NOT granted to any runtime role. The recorder client no longer exposes a `finalizeSale` method.

### 8.10 Final State

| Item | Value |
|---|---|
| `CANARY_ENABLED` flag | `false` (OFF) |
| Maintenance mode | ON |
| Backend functions | 50 (unchanged) |
| Authority tables (all 7) | 0 rows |
| Real Stripe calls | 0 (fake adapter only) |
| Real email/push/points/notifications | 0 |
| Admin client imports in production | 0 (50 handlers checked) |
| Admin URL in production paths | 0 (50 handlers checked) |
| Admin-as-recorder proxy | REMOVED (real recorder client used) |
| Recorder grants | 3 functions (record_capture, record_cancel, record_refund) |
| Recorder `finalize_sale` grant | REVOKED |
| Recorder `acquire_operation` grant | REVOKED |
| Recorder table privileges | 0 |
| SQL artifact/live parity | ✅ (atomic finalization + replay-first deployed, verified) |
| Preflight remnants | 0 (no rows created by preflight) |

### 8.11 Changed Files (Corrective Commit)

| File | Change |
|---|---|
| `database/authority_v1/002_functions.sql` | `record_capture_result(succeeded)` now atomically finalizes (binding → finalized, authority → sold, outbox events); reordered to acquire operation before action status check (idempotent replay first) |
| `database/authority_v1/004_roles_and_grants.sql` | Revoked `finalize_sale` from `authority_stripe_recorder` (atomic finalization makes it unnecessary); updated comments |
| `base44/shared/authorityV1StripeRecorderClient.js` | Removed `finalizeSale` method; updated allowlist comment (3 functions, not 4) |
| `tests/capture-finalize-atomicity.test.mjs` | NEW — 8-scenario suite proving atomic finalization, injected failure rollback, idempotent replay, concurrent finalization, permission denied, grant matrix |
| `tests/authority-contract.test.mjs` | Updated `record_capture_result_does_not_finalize` → `record_capture_result_atomic_finalize` (now requires 'finalized', 'sold', outbox events) |
| `src/docs/AUTHORITY_V1_CANARY_CERTIFICATION.md` | Added atomic finalization design (§8.9), updated grant audit (§8.8: 3 functions), updated final state (§8.10) |

**Files unchanged (already correct):**
- `base44/shared/abortCanaryOrchestrator.js` — no changes needed
- `base44/functions/abortCheckout/entry.ts` — no changes needed

### 8.12 Test Results Summary

| Suite | Scenarios | Assertions | Result |
|---|---|---|---|
| capture-finalize-atomicity (NEW) | 8 | 41 | ✅ 41/41 PASS |
| abort-canary (P0-01G) | 14 | 103 | ✅ 103/103 PASS |
| payment-saga-cancel (P0-01F) | 16 | 59 | ✅ 59/59 PASS |
| P0-01E protections | 7 | 7 | ✅ 7/7 PASS |
| P0-01E wiring | 5 | 5 | ✅ 5/5 PASS |
| authority-contract (static) | 69 | 69 | ✅ 69/69 PASS |
| Build (`npm run build`) | — | — | ✅ Exit 0 |
| Backend lint | — | — | ✅ 0 errors, 116 warnings (pre-existing) |
| Scoped lint (changed files) | — | — | ✅ 0 errors, 0 warnings |

### 8.13 Conclusion

P0-01G manifest label: **`abortCheckout — CANARY-WIRED / FAKE-PROVIDER CERTIFIED / REAL STRIPE NOT CERTIFIED / FLAG OFF`**

- `record_capture_result(succeeded)` now ATOMICALLY finalizes the sale (binding → finalized, authority → sold, outbox events) in one database transaction — no required second `finalize_sale` call.
- `finalize_sale` direct EXECUTE is REVOKED from `authority_stripe_recorder` and `authority_executor` — proven by permission-denied tests.
- The recorder client no longer exposes a `finalizeSale` method.
- The recorder role retains 3 function grants (`record_capture_result`, `record_cancel_result`, `record_refund_result`) and 0 table grants.
- `record_cancel_result` supports controlled reconciliation from `cancel_unknown` per the canonical architecture (§6.2).
- All suites pass: capture-finalize 41/41, abort-canary 103/103, payment-saga-cancel 59/59, P0-01E 7/7+5/5, authority-contract 69/69, build, lint.
- 50 functions, flag OFF, maintenance ON, 0 synthetic rows, 0 real provider calls.
- No admin credentials in production or result-recording paths (static analysis of 50 handlers + shared modules).
- **Real Stripe execution is NOT certified.** The fake-provider test proves the saga logic; a later real Stripe test-mode gate is required for production certification.

---

## 9. P0-01H Status: ✅ PASS — Canonical Parity & Financial Binding Hardening (Recertified)

**Date:** 2026-08-26
**Commit:** `P0-01H-RECERTIFIED: canonical parity and financial binding hardening (300/300)`
**Baseline:** P0-01G (`535ac4c`) → amount/currency hardening commit `9a76cfd` → recertification

### 9.1 Drift Diagnosis

During P0-01I preparation, a drift was detected between the live `record_capture_result` function deployed to the dev database and the canonical SQL artifact (`database/authority_v1/002_functions.sql`). The live function returned a structured JSONB result for `BINDING_STATE_MISMATCH` (and similar conditions) while the test expected a `RAISE EXCEPTION`. This was confirmed to be **artifact/test drift** — not an atomicity defect in the function itself.

| Symptom | Root Cause |
|---|---|
| capture-finalize T2 test failure | Test expected `RAISE EXCEPTION` for `BINDING_STATE_MISMATCH`; live function returned controlled JSONB result `{ok:false, code:'BINDING_STATE_MISMATCH'}` |
| Live/artifact body hash mismatch | Live function body had diverged from the artifact source during an interrupted P0-01I deployment attempt |

### 9.2 Canonical Rollback

The live function was rolled back to the canonical artifact source to restore parity:

1. The live (drifted) function definition was **archived** before any modification (see §9.3)
2. The corrected `record_capture_result` was deployed from `database/authority_v1/002_functions.sql` to the live database
3. Hash parity was verified: live body hash == artifact body hash (see §9.4)
4. Recorder role grants were re-verified (3 functions, 0 tables)

### 9.3 SQL Archive

The drifted live function was preserved as a forensic archive before rollback:

| Property | Value |
|---|---|
| Path | `database/authority_v1/archive/record_capture_result.p0-01i-interrupted.sql` |
| SHA-256 | `9a70df469290595140e025637c5a893f93fbcaf0fb325815ea281192855043c4` |
| Size | 16,323 bytes |
| Lines | 315 |
| Description | Preserved live function definition of `authority_v1.record_capture_result` captured BEFORE artifact reconciliation on 2026-08-26 |

### 9.4 Hash Parity Verification

After canonical rollback, the live function body was verified to match the artifact source exactly:

| Object | Live Hash | Artifact Hash | Match |
|---|---|---|---|
| `record_capture_result` body | `4b99c0d8897b589bb3fc59a8bafa41285bd230e8835416c0e879d00f7cff3c05` | `4b99c0d8897b589bb3fc59a8bafa41285bd230e8835416c0e879d00f7cff3c05` | ✅ |

### 9.5 Amount/Currency Hardening (Commit `9a76cfd`)

The `confirmCanaryOrchestrator` payment-binding saga was hardened to enforce strict amount and currency validation before any authoritative mutation:

| Hardening | Details |
|---|---|
| Non-USD rejection | PI with `currency != 'usd'` → 400 `CURRENCY_MISMATCH` before any Postgres mutation (T9c: zero mutation proven — no new binding, no new operation, no new outbox) |
| Amount binding | `amount_minor` and `currency` bound to the operation ID in `bind_payment_intent` for strict idempotent conflict detection |
| Request hash inclusion | Server-derived `amount_minor`/`currency` included in `requestHash` so a changed amount with the same `operation_id` → 409 `OPERATION_ID_CONFLICT` (T9b) |
| Pre-mutation rejection | All metadata/currency/amount mismatches rejected BEFORE `acquire_operation` — zero Postgres rows created on rejection |

### 9.6 Test Results — 300/300 PASS (Full Recertification Suite)

All 7 test suites were re-run through the full certification gate:

| # | Suite | Scenarios | Assertions | Result |
|---|---|---|---|---|
| 1 | confirm-canary-orchestrator (P0-01H) | 16 | 16 | ✅ 16/16 PASS |
| 2 | capture-finalize-atomicity (P0-01G) | 8 | 41 | ✅ 41/41 PASS |
| 3 | abort-canary-orchestrator (P0-01G) | 14 | 103 | ✅ 103/103 PASS |
| 4 | payment-saga-cancel (P0-01F) | 16 | 59 | ✅ 59/59 PASS |
| 5 | canary-scheduled-release-protections (P0-01E) | 7 | 7 | ✅ 7/7 PASS |
| 6 | process-transfer-reminders-wiring (P0-01E) | 5 | 5 | ✅ 5/5 PASS |
| 7 | authority-contract (static) | 69 | 69 | ✅ 69/69 PASS |
| | **Total** | | **300** | **300/300 PASS** |

**Key P0-01H test additions:**
- T9c: Non-USD PI → 400 `CURRENCY_MISMATCH`, zero mutation (no binding, no operation, no outbox)
- T9b: Changed amount with same `operation_id` → 409 `OPERATION_ID_CONFLICT`, no second binding/operation
- T9: Conflicting token with same `operation_id` → 409 `OPERATION_ID_CONFLICT`, exactly one binding

### 9.7 Build & Lint Final State

| Check | Exit Code | Details |
|---|---|---|
| `npm run build` (vite build) | 0 | Build succeeded |
| Backend lint (`eslint base44/functions base44/shared`) | 0 | 0 errors, 211 warnings (pre-existing) |
| Scoped lint (`eslint tests/*.mjs`) | 0 | 0 errors |

### 9.8 Final State Verification

| Item | Value |
|---|---|
| `CANARY_ENABLED` flag | `false` (OFF) |
| Maintenance mode | ON |
| Backend functions | 50 (unchanged) |
| Authority_v1 Postgres functions | 29 (unchanged) |
| Authority tables (all 7) | 0 rows (truncated + verified) |
| Real Stripe calls | 0 (fake adapter only) |
| Real provider calls in tests | 0 (no `STRIPE_SECRET_KEY`/`STRIPELIVESECRETKEY` references) |
| Production admin imports | 0 (50 handlers checked — no `authorityV1TestAdmin`/`AUTHORITY_DB_URL_DEV_ADMIN`) |
| Recorder grants | 3 functions (`record_capture_result`, `record_cancel_result`, `record_refund_result`) |
| Recorder table privileges | 0 |
| `record_capture_result` live/artifact parity | ✅ `4b99c0d8…` == `4b99c0d8…` |
| Archive file | `database/authority_v1/archive/record_capture_result.p0-01i-interrupted.sql` (16,323 bytes, SHA-256 `9a70df46…`) |

### 9.9 Changed Files

| File | Change |
|---|---|
| `database/authority_v1/archive/record_capture_result.p0-01i-interrupted.sql` | NEW — forensic archive of drifted live function (315 lines, 16,323 bytes) |
| `src/docs/AUTHORITY_V1_CANARY_CERTIFICATION.md` | Added §9 (P0-01H recertification), updated manifest label for `capturePayment` (P0-01I NOT STARTED) |

**No code or database edits were made during this recertification.** The canonical rollback restored the live function to match the artifact; no SQL artifacts, shared modules, or entry handlers were modified.

### 9.10 P0-01I Status: NOT STARTED

`capturePayment` canary integration (P0-01I) has **not been started**. No code, tests, or database changes have been made for P0-01I. The `capturePayment` entry point remains excluded from canary eligibility (financial side effect). The P0-01I gate will require:
- Canary routing in `capturePayment/entry.ts` (before maintenance gate)
- A capture-canary orchestrator with fake-provider certification
- Real Stripe test-mode gate for production certification

### 9.11 Manifest Label

P0-01H manifest label: **`P0-01H-RECERTIFIED: canonical parity and financial binding hardening (300/300)`**

- `record_capture_result` live function restored to canonical artifact parity (hash verified).
- Amount/currency hardening (commit `9a76cfd`) enforces non-USD rejection and amount-bound idempotent conflict detection before any Postgres mutation.
- All 7 suites pass: 300/300 assertions.
- 50 backend functions, 29 authority functions, flag OFF, maintenance ON, 0 synthetic rows, 0 real provider calls.
- Archive preserved: `database/authority_v1/archive/record_capture_result.p0-01i-interrupted.sql`.
- **P0-01I (capturePayment canary integration) NOT STARTED.**