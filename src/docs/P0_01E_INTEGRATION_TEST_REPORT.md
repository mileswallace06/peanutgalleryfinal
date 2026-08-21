# P0-01E Integration Test Report

**Date:** 2026-08-21
**Scope:** authority_v1 canary integration of `processTransferReminders` + exclusion analysis of `abortCheckout` and `cleanupAbandonedCheckouts`
**Status:** ✅ PASS — all executable tests green, both fail-closed protections proven, all three entry points accounted for

---

## 1. Status Table — Three Target Entry Points

| Entry Point | Changed? | Reservation Mutation | Financial/Provider Effects | authority_v1 Integration | Reason |
|---|---|---|---|---|---|
| `processTransferReminders` | **Unchanged** (canary routing already integrated) | Clears `reservation_token`, `reserved_by_email`, `reservation_expires_at`, `reservation_revision` on expired reservations (L301-314, L357-370) | None on canary path (Stripe PI cancel only on non-canary seller-no-show expiry at L210-218; canary routing `continue`s before that) | **INTEGRATED** — calls `runCanaryScheduledRelease` for `[AUTH_CANARY]` listings | Eligible: system-initiated expired-reservation release with no financial side effects on the canary path |
| `abortCheckout` | **Unchanged** | Clears reservation fields (L119-133) | **Cancels Stripe PaymentIntent** (L80-88: `stripe.paymentIntents.cancel`) | **EXCLUDED** | Financial: reservation release is embedded in a handler that cancels a Stripe PI. Cannot separate the release from the PI cancellation. No canary guard in `canaryGuard.js`. |
| `cleanupAbandonedCheckouts` | **Unchanged** | **None** — Phase 2 recovery explicitly does NOT clear reservation fields (L423: `Listing.update({ status: 'active', hidden_reason: null })` only); post-verify requires `reservation_token === null` (L448) | **Cancels Stripe PIs** (Phase 1, L166: `stripe.paymentIntents.cancel`); **finalizes captured payments** (Phase 3, L500-540) | **EXCLUDED** | Financial + no release: Phase 1 cancels PIs; Phase 2 does not perform reservation releases at all (it quarantines and recovers, requiring reservation fields to already be null). No reservation release exists to route. |

---

## 2. Executable Module Tests — Fail-Closed Protections

**Test file:** `tests/canary-scheduled-release-protections.test.mjs`
**Imports:** `runCanaryScheduledRelease` from `../base44/shared/canaryScheduledRelease.js` (the actual shared module)
**Method:** Dependency injection with explicit call counters; `isCanaryEnabledFn`, `createClientFn`, `applyMirrorFn` injected as mocks

### Results: 7/7 PASS

| # | Scenario | Result | Authority Release Calls | Mirror Mutations | Outbox Creations | Status Code | Code |
|---|---|---|---|---|---|---|---|
| 1 | Active purchase exists | PASS | 0 | 0 | 0 | 409 | `ACTIVE_PURCHASE` |
| 2 | Lookup throws (Error) | PASS | 0 | 0 | 0 | 409 | `LOOKUP_UNSAFE` |
| 3 | Lookup rejects (Promise.reject) | PASS | 0 | 0 | 0 | 409 | `LOOKUP_UNSAFE` |
| 4 | Lookup returns malformed (object) | PASS | 0 | 0 | 0 | 409 | `LOOKUP_MALFORMED` |
| 5 | Lookup returns malformed (null) | PASS | 0 | 0 | 0 | 409 | `LOOKUP_MALFORMED` |
| 6 | Lookup returns malformed (string) | PASS | 0 | 0 | 0 | 409 | `LOOKUP_MALFORMED` |
| 7 | Empty array (sanity: release proceeds) | PASS | 1 | 1 | 0 | 200 | `ok: true` |

**Proof:** For every fail-closed case, authority release call count = 0, mirror mutation count = 0, outbox creation count = 0, and the result is a structured 409 non-success. The sanity check confirms the happy path still reaches the authority and mirror.

### Minimal Refactor for Testability

`canaryScheduledRelease.js` was minimally refactored:
- Added optional `isCanaryEnabledFn`, `createClientFn`, `applyMirrorFn` injection points (defaults preserve deployed behavior — `processTransferReminders` passes none of these)
- Added `Array.isArray(activePurchases)` check for malformed-data fail-closed (correctness fix — previously, a non-array return would silently pass through)
- Changed `catch (e)` to `catch` (optional catch binding) to clear lint warning

**Deployed behavior unchanged:** `processTransferReminders/entry.ts` calls `runCanaryScheduledRelease` with `{ entities, executorUrl, listing_id }` only — no injection points are used.

---

## 3. AST-Based Wiring Proof

**Test file:** `tests/process-transfer-reminders-wiring.test.mjs`
**Method:** Parses `processTransferReminders/entry.ts` with acorn (ECMAScript parser), walks the AST to verify import + call + guard structure

### Results: 5/5 PASS

| # | Assertion | Result |
|---|---|---|
| 1 | entry.ts parses with acorn (valid ECMAScript) | PASS |
| 2 | Imports `runCanaryScheduledRelease` from `canaryScheduledRelease` | PASS |
| 3 | Calls `runCanaryScheduledRelease` in handler body (≥2 calls for both expired-reservation blocks) | PASS |
| 4 | Call is guarded by `isCanaryListing && isCanaryEnabled` condition | PASS |
| 5 | Call passes `entities`, `executorUrl`, and `listing_id` | PASS |

**Proof:** The AST walk verifies the actual import declaration and call expression nodes — not substring matches. This is an executable module/wiring proof, not a deployed runtime proof.

---

## 4. Deployed Handler Tests (Prior Session)

| # | Scenario | Result |
|---|---|---|
| 1 | Deployed `reserveListing` canary reserve | ✅ 200, authority version 1, mirror ok |
| 2 | Deployed `processTransferReminders` maintenance skip | ✅ `{ ok: true, skipped: "maintenance mode" }` |
| 3 | authority_v1 release + idempotent replay | ✅ Same operation → original result (not 409) |
| 4 | Different operation after release | ✅ 409 CONFLICT |
| 5 | Non-canary isolation | ✅ Non-canary listing unchanged |

---

## 5. Exclusion Evidence — abortCheckout & cleanupAbandonedCheckouts

### abortCheckout — EXCLUDED (financial side effects)

**Code path (entry.ts):**
1. L78-93: Retrieves and cancels Stripe PaymentIntent (`stripe.paymentIntents.cancel`)
2. L96-100: Marks Purchase expired
3. L102-143: Releases Listing reservation (clears `reservation_token`, `reserved_by_email`, etc.)

**Why excluded:** The reservation release at L119-133 is embedded in a handler that cancels a Stripe PI at L80-88. The release cannot be separated from the financial operation — they are part of the same atomic checkout-abort flow. There is no canary guard in `canaryGuard.js` for this entry point. Canary listings are synthetic and should never reach the real checkout/abort flow.

### cleanupAbandonedCheckouts — EXCLUDED (financial + no reservation release)

**Code path (cleanupOrchestrator.js):**
1. Phase 1 (L130-230): Cancels Stripe PIs (`stripe.paymentIntents.cancel` at L166), quarantines listings
2. Phase 2 (L260-490): Recovers quarantines — **explicitly does NOT clear reservation fields**:
   - L423: `Listing.update({ status: 'active', hidden_reason: null })` — no reservation fields touched
   - L448: Post-verify requires `reservation_token === null` — the function REQUIRES reservation fields to already be null
3. Phase 3 (L500-540): Finalizes captured payments (`finalizeCapturedPayment`)

**Why excluded:** (1) Financial side effects (PI cancellation + payment finalization). (2) No reservation release exists in this function to route — Phase 2 recovery activates the listing but does not clear reservation tokens. The reservation clearing for expired reservations is performed by `processTransferReminders`, not by this function.

---

## 6. Final State Verification

| Item | Value |
|---|---|
| `CANARY_ENABLED` flag | `false` (OFF) |
| Maintenance mode | ON |
| Base44 canary listings | 0 |
| Base44 CanaryMirrorOutbox records | 0 |
| Postgres `authority_v1.reservation_authority` | 0 rows |
| Postgres `authority_v1.reservation_operations` | 0 rows |
| Postgres `authority_v1.reservation_outbox` | 0 rows |
| Backend functions | 50 (unchanged) |
| Provider calls (Stripe/OneSignal/TM) | 0 |

---

## 7. Build, Lint, and Test Exit Codes

| Check | Exit Code | Details |
|---|---|---|
| `npm run build` (vite build) | 0 | Build succeeded |
| Scoped lint (changed files) | 0 | 0 errors, 0 warnings |
| Backend lint (`npm run lint:backend`) | 0 | 0 errors, 116 warnings (pre-existing) |
| `canary-scheduled-release-protections.test.mjs` | 0 | 7/7 pass |
| `process-transfer-reminders-wiring.test.mjs` | 0 | 5/5 pass |
| `search-normalize.test.mjs` (regression) | 0 | 28/28 pass |

| Git | Value |
|---|---|
| HEAD | `eb31487a138babfa2c1320a8f9ba177dd2b8a437` |
| Changed files | `M base44/shared/canaryScheduledRelease.js` |
| New files | `tests/canary-scheduled-release-protections.test.mjs`, `tests/process-transfer-reminders-wiring.test.mjs`, `tests/loaders/npm-compat-register.mjs`, `tests/loaders/npm-compat-hook.mjs`, `tests/loaders/base44-runtime-mock.mjs` |

---

## 8. Conclusion

P0-01E is **PASS**:
- `processTransferReminders` canary integration is proven by executable module tests (7/7) and AST wiring proof (5/5).
- Both fail-closed protections (active-purchase, lookup-uncertainty) pass executable tests with zero side-effect calls.
- `abortCheckout` is excluded with exact code-path evidence (financial: Stripe PI cancellation inseparable from reservation release).
- `cleanupAbandonedCheckouts` is excluded with exact code-path evidence (financial + no reservation release performed).
- Flag OFF, maintenance ON, zero synthetic rows, 50 functions, zero provider calls.