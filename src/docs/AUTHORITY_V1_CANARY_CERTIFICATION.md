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
| `abortCheckout` | **NOT STARTED** | Production integration not certified; financial side effects |
| `cleanupAbandonedCheckouts` | UNCHANGED (excluded) | No reservation release to route |
| `capturePayment` | UNCHANGED (excluded) | Financial side effect |
| `stripeWebhook` | UNCHANGED | No authority_v1 integration |
| `confirmCheckoutAuthorized` | UNCHANGED | No authority_v1 integration |
| `cancelPurchase` | UNCHANGED | No authority_v1 integration |
| `verifyTransferProof` | UNCHANGED | No authority_v1 integration |

**P0-01F certifies the payment-cancellation substrate only.** `abortCheckout` production integration is NOT STARTED. All other financial entry points remain unchanged. Production Stripe execution is NOT certified.

### Prerequisite for P0-01G

**P0-01G (production-handler canary integration) is blocked** until an owner-managed `authority_stripe_recorder` connection and Base44 secret exist. No recorder password was created or reset in this gate.

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