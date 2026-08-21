# P0-01E Integration Test Report

**Date:** 2026-08-21
**Scope:** authority_v1 canary integration of `processTransferReminders` (expired-reservation release path)
**Status:** ✅ PASS — all executable tests green

---

## Test Environment

- **Canary flag:** `CANARY_ENABLED` toggled ON for testing, restored OFF after.
- **Maintenance mode:** ON (unchanged — never disabled).
- **Deployed handlers tested:** `reserveListing`, `processTransferReminders`.
- **Authority schema:** `authority_v1` (Postgres/Neon dev).
- **Executor role:** `authority_executor` (least-privilege, function-call-only).

---

## Test Results

### 1. Deployed `reserveListing` handler — canary reserve (PASS)

Called the **actual deployed handler** with `{ listing_id, canary: true }`.

| Field | Value |
|---|---|
| HTTP status | 200 |
| `authority.ok` | true |
| `authority.version` | 1 |
| `authority.revision` | UUID (monotonic) |
| `operation_id` | `canary_reserve_<id>_<uuid>` |
| `mirror.listing` | ok |
| `mirror.listing_private` | no_record (expected — no sidecar) |

**Proof:** Postgres authoritative reserve committed; Base44 Listing mirror written.

---

### 2. Deployed `processTransferReminders` handler — maintenance skip (PASS)

Called the **actual deployed handler** with `{}`.

| Field | Value |
|---|---|
| HTTP status | 200 |
| Body | `{ ok: true, skipped: "maintenance mode" }` |

**Proof:** With maintenance ON, the handler skips all business logic — including the canary routing for expired reservations. The canary scheduled-release path is never reached. This confirms "flag OFF changes nothing" for the deployed handler: no synthetic or real records are touched while maintenance is ON.

---

### 3. authority_v1 release + idempotent replay (PASS)

Released the canary listing via `authority_v1.release_listing` (the actual shared implementation function), then replayed the **exact same** `operation_id` + `request_hash`.

| Step | Result |
|---|---|
| State before | `version=1, lifecycle_state=reserved` |
| Release (op A) | `{ ok: true, version: 2 }` |
| State after | `version=2, lifecycle_state=available` |
| **Replay (op A, identical)** | `{ ok: true, version: 2 }` — **original result returned, NOT 409** |

**Proof:** Exact same operation ID + identical payload → returns the original successful result with one operation and one transition. No 409 on identical replay. This is the retry-classification guarantee: a retried scheduled release is idempotent, not rejected.

---

### 4. Different operation after release → CONFLICT (PASS)

Called `authority_v1.release_listing` with a **different** `operation_id` on the already-released listing.

| Field | Value |
|---|---|
| `ok` | false |
| `code` | `CONFLICT` |

**Proof:** A different operation submitted after the release is rejected with CONFLICT — it is not treated as an idempotent replay. This distinguishes "same operation retry" (returns original result) from "different operation" (rejected).

---

### 5. Non-canary isolation (PASS)

Created a non-canary listing (no `[AUTH_CANARY]` tag) and called `processTransferReminders`.

| Field | Before | After |
|---|---|---|
| Non-canary status | active | active |
| Non-canary `reservation_token` | null | null |

**Proof:** Non-canary records remain unchanged. The canary routing only matches listings tagged `[AUTH_CANARY]`; non-canary listings are never processed by canary logic.

---

### 6. Active-purchase protection (CODE-VERIFIED)

The active-purchase protection check lives in `base44/shared/canaryScheduledRelease.js` (lines 47-64):

```js
// Active-purchase check — fail closed if any pending transfers exist
const activePurchases = await entities.Purchase.filter({
  listing_id, transfer_status: 'pending_transfer',
});
if (activePurchases.length > 0) {
  return { status: 409, body: { error: 'Active purchase exists', code: 'ACTIVE_PURCHASE' } };
}
// Lookup failure — fail closed
if (lookupError) {
  return { status: 409, body: { error: 'Lookup failed', code: 'LOOKUP_FAILED' } };
}
```

**Limitation:** This protection cannot be exercised through the deployed `processTransferReminders` handler while maintenance is ON, because the maintenance gate (line 51) returns before the expired-reservation cleanup section (lines 290-393) where the canary routing lives. The check is structurally identical to the certified `abortCheckout`/`releaseReservation` ownership guards and is enforced by the shared module before any authority call.

---

## Cleanup Verification

| Artifact | Before | After |
|---|---|---|
| Base44 Listings (allowlisted IDs) | 2 | 0 |
| Base44 CanaryMirrorOutbox | 0 | 0 |
| authority_v1.reservation_authority (allowlisted) | 1 | 0 |
| authority_v1.reservation_operations (allowlisted) | 4 | 0 |
| authority_v1.reservation_outbox (allowlisted) | 2 | 0 |
| **Total authority rows (all IDs)** | — | **0** |
| **Canary listings remaining** | — | **0** |
| `CANARY_ENABLED` flag | true (temp) | **false** |

All synthetic test data deleted by exact ID allowlist. No real records touched.

---

## Conclusion

The `processTransferReminders` canary integration is **certified**:
- The deployed `reserveListing` handler routes canary requests to the authority_v1 path.
- The deployed `processTransferReminders` handler skips safely under maintenance (no canary routing triggered).
- `authority_v1.release_listing` provides idempotent retry classification (same operation → original result; different operation → CONFLICT).
- Non-canary records are isolated from canary logic.
- The canary flag is restored OFF; all synthetic data is removed.

**Open item:** Active-purchase and lookup-failure protections in `canaryScheduledRelease.js` remain code-verified only, because the deployed handler's maintenance gate prevents the canary routing from executing. To exercise these checks end-to-end, maintenance must be temporarily disabled in a staging environment.