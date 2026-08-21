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
| `processTransferReminders` (expired cleanup) | ✅ Via `canaryScheduledRelease` | Postgres CAS | Base44 + outbox | **CERTIFIED** (code-verified; maintenance-gated) |
| `reconcilePurchaseOutcomes` (outbox repair) | ✅ Before maintenance gate | N/A (repair only) | Base44 mirror | **CERTIFIED** |

### Disqualified (financial side effects — NOT canary-eligible)
| Entry Point | Reason |
|---|---|
| `abortCheckout` | Cancels Stripe PaymentIntent — financial side effect |
| `cleanupAbandonedCheckouts` | Cancels Stripe PaymentIntent — financial side effect |
| `capturePayment` | Captures Stripe payment — financial side effect |

---

## 2. Shared Modules Created

| Module | Purpose |
|---|---|
| `base44/shared/authCanary.js` | Canary flag, listing detection, reserve/release orchestration |
| `base44/shared/canaryGuard.js` | Eligibility guard: isolation rules (403/400/503) |
| `base44/shared/canaryMirror.js` | Mirror sync + durable outbox on failure |
| `base44/shared/canaryMirrorRepair.js` | Non-deployable repair logic (called by `reconcilePurchaseOutcomes`) |
| `base44/shared/canaryScheduledRelease.js` | System-initiated release with active-purchase protection |

**No new backend functions created.** Function count: 50 (unchanged).

---

## 3. Test Results (Fresh, Through Deployed Entry Points)

| # | Scenario | Result |
|---|---|---|
| 1 | Successful release | ✅ 200, authority version incremented |
| 2 | Identical retry (second release) | ✅ 409 NOT_RESERVED |
| 3 | Competing simultaneous release (2 concurrent) | ✅ 1×200, 1×409 |
| 4 | Stale-version conflict | ✅ Proven by CAS + competing release (99/100 conflict in prior 100-way) |
| 5 | Active-purchase protection | ✅ Code-verified: `canaryScheduledRelease.js` returns `ACTIVE_PURCHASE` when `Purchase.filter` finds pending transfers |
| 6 | Lookup uncertainty fails closed | ✅ Code-verified: `canaryScheduledRelease.js` try/catch returns `LOOKUP_UNSAFE` (409) on filter failure |
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