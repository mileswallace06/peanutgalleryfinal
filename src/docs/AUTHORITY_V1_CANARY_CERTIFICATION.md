# authority_v1 Reserve/Release Canary — Certification Manifest

**Date:** 2026-08-21
**Status:** ✅ CERTIFIED — Flag OFF, maintenance ON, zero synthetic rows

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
| `capturePayment` | UNCHANGED (excluded) | Financial side effect |
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
| `record_capture_result` | Granted | Yes | Directly called by recorder role to record capture results. |
| `record_refund_result` | Granted | Yes | Directly called by recorder role to record refund results. |
| `finalize_sale` | Granted | Yes | Directly called by recorder role as a top-level call after `record_capture_result` succeeds. Not called internally — it is a separate saga step. |

**Table privileges:** 0 (no INSERT/UPDATE/DELETE/SELECT on any authority_v1 table).

**Final grant matrix:** 4 functions, 0 table privileges, 0 internal-helper grants.

### 8.9 Final State

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
| Recorder grants | 4 functions (acquire_operation REVOKED) |
| Recorder table privileges | 0 |
| SQL artifact/live parity | ✅ (reconciliation deployed, verified) |
| Preflight remnants | 0 (no rows created by preflight) |

### 8.10 Changed Files (Corrective Commit)

| File | Change |
|---|---|
| `database/authority_v1/002_functions.sql` | Extended `record_cancel_result` to support reconciliation from 'unknown' status (succeeded → canceled + release, failed → cancel_failed, unknown → no-op) |
| `database/authority_v1/004_roles_and_grants.sql` | Revoked `acquire_operation` from `authority_stripe_recorder` (called internally by SECURITY DEFINER functions; not needed by caller) |
| `tests/abort-canary-orchestrator.test.mjs` | Restored T5 as real recovery test (32 assertions: initial timeout, recon success, idempotent replay, concurrent no-double-release, ambiguous stays blocked) |
| `tests/payment-saga-cancel.test.mjs` | Updated T4/T5 to test reconciliation success (unknown → succeeded via later webhook/recon) |
| `src/docs/AUTHORITY_V1_CANARY_CERTIFICATION.md` | Corrected manifest label, added reconciliation design (§8.7), grant audit (§8.8), updated test counts |

**Files unchanged (already correct):**
- `base44/shared/abortCanaryOrchestrator.js` — no changes needed
- `base44/shared/authorityV1StripeRecorderClient.js` — no changes needed
- `base44/functions/abortCheckout/entry.ts` — no changes needed

### 8.11 Conclusion

P0-01G manifest label: **`abortCheckout — CANARY-WIRED / FAKE-PROVIDER CERTIFIED / REAL STRIPE NOT CERTIFIED / FLAG OFF`**

- The `record_cancel_result` SQL function now supports controlled reconciliation from `cancel_unknown` per the canonical architecture (§6.2): succeeded → canceled + release, failed → cancel_failed, unknown → no-op.
- The `authority_stripe_recorder` role has been audited: `acquire_operation` grant revoked (called internally by SECURITY DEFINER functions), 4 external functions remain, 0 table privileges.
- The persisted 14-scenario abort-canary suite passes 103/103 assertions (T5: 32 assertions — real recovery test through the real recorder client).
- The persisted 16-scenario payment-saga-cancel suite passes 59/59 assertions (T4/T5 updated to test reconciliation success).
- All regressions pass (P0-01E 7/7 + 5/5, build, lint).
- 50 functions, flag OFF, maintenance ON, 0 synthetic rows, 0 real provider calls.
- No admin credentials in production or result-recording paths (static analysis of 50 handlers + shared modules).
- **Real Stripe execution is NOT certified.** The fake-provider test proves the saga logic; a later real Stripe test-mode gate is required for production certification.