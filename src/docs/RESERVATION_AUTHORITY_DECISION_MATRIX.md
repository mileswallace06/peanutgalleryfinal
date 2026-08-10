# Reservation Authority Decision Matrix (7C.9C.2E Correction)

**Date**: 2026-08-10

---

## 1. Live Single-Authority CAS Probe Results

A synthetic probe used one `ListingPrivate` record as the sole authoritative
reservation row and one `Listing` record as a non-authoritative mirror.

### What the Probe Tested

The probe tested **raw Base44 `updateMany` CAS behavior only**. It did NOT test:
- Module-level idempotent replay logic
- Mirror recovery or sweep logic
- Entry-point integration
- Pending-effects fail-closed behavior
- Full-envelope hashing

These are tested separately in the deterministic local module tests.

### CAS Query

```
updateMany(
  { id: lpId, reservation_version: expectedVersion, checkout_quarantined: false },
  { $set: { reservation_version: newVersion, ... } }
)
// updated > 0 → CAS won; updated = 0 → CAS lost
```

### Results

| Test | Result |
|------|--------|
| 10 rounds × 20 concurrent different-operation reserve attempts | **10/10 rounds produced exactly 1 winner** |
| 20 concurrent retries with same operation ID | **1 mutation**, 19 no-ops |
| Losing operation cannot overwrite winner | **Passed** (updated=0, token preserved) |
| Old operation retry after newer transition | **Passed** (updated=0, newer state preserved) |
| Before/after entity counts | Matched (cleanup OK) |

**Verdict**: Base44 single-record CAS is **empirically atomic** across 10 independent
rounds of 20-way concurrency. This is **empirical evidence, NOT a contractual guarantee.**

---

## 2. Key Facts About Base44 updateMany

- **`updateMany` does not trigger entity automations.** Entity automations
  (create/update/delete triggers) fire on entity-level events, not on
  `updateMany` batch operations. This means the authority's CAS writes do not
  trigger side-effect automations.

- **Existing records require initialization.** All existing `ListingPrivate`
  records lack `reservation_version`, `reservation_lifecycle_state`, and
  `last_operation_*` fields. These records require a MIGRATION_REQUIRED
  initialization before the authority can manage them. The migration is a
  separately gated, idempotent apply that requires explicit owner approval.

- **Empirical vs. contractual.** The probe proves empirical atomicity (10/10
  rounds, 1 winner). This is NOT a contractual guarantee from Base44. If
  Base44 changes the `updateMany` implementation, CAS could break silently.
  See `VENDOR_GUARANTEE_QUESTION.md` for the exact question submitted to Base44.

---

## 3. Decision Matrix

| Criterion | Base44 Single-Authority CAS | Cloudflare Durable Object (SQLite) | Neon/Postgres + API |
|-----------|---------------------------|-----------------------------------|---------------------|
| **Atomicity guarantee** | Empirically observed (10/10 rounds, 1 winner). **NOT contractually guaranteed.** | Contractually guaranteed (single-threaded actor + SQLite ACID) | Contractually guaranteed (row-level locking, MVCC, ACID) |
| **Contractual safety** | **None.** If Base44 changes `updateMany`, CAS could break silently. | Full (Cloudflare SLA, SQLite ACID). | Full (Neon SLA, Postgres ACID). |
| **Idempotency** | Module-level via `last_operation_id` + envelope hash. No datastore-level dedup. Concurrent same-op-id retries produce 1 mutation (empirically verified). | Datastore-level via SQLite UNIQUE on `operation_id`. Retry returns existing result. | Datastore-level via PRIMARY KEY on `operation_id`. Retry returns existing result. |
| **Unique operation storage** | No unique constraint. Operation ID stored in `last_operation_id` field. Duplicate creates possible under concurrency. | SQLite UNIQUE constraint on `operation_id`. Durable across eviction. | PRIMARY KEY on `operation_id`. Enforced by Postgres. |
| **Mirror/outbox recovery** | Listing as non-authoritative mirror, reparable from ListingPrivate. No transactional outbox — mirror update is best-effort with sweep. | SQLite transactional outbox within DO. Same transaction as CAS. | Transactional outbox in same transaction. External worker delivers. |
| **Stripe saga compatibility** | Compatible. Two-phase freeze-and-finalize uses CAS on ListingPrivate. Stripe webhook idempotency via operation_id + envelope hash. No distributed transaction across Stripe + Base44. | Compatible. DO serializes per-listing. Stripe webhook can call DO. Outbox ensures mirror delivery. | Compatible. Postgres transaction wraps CAS + outbox. Stripe webhook calls API. Strongest consistency. |
| **Operational complexity** | Lowest. No new infrastructure. Existing entities, existing SDK. | Medium. New Cloudflare account, DO code, routing. | Highest. Neon project, API layer, outbox worker, secrets management. |
| **Availability failure behavior** | Base44 unavailable → all reservation endpoints fail-closed (503). No partial state — CAS is all-or-nothing per record. | DO unavailable → 503 for that listing. Other listings unaffected. SQLite survives eviction. | Postgres unavailable → 503 for all. Neon auto-suspend after idle; cold start delay. |
| **Launch timeline** | Fastest. Days (code restructure + migration init). | Medium. 1-2 weeks (DO code + routing + testing). | Slowest. 2-3 weeks (schema + API + worker + migration). |
| **Migration risk** | Lowest. Code restructure only. Risk: relying on undocumented behavior. Existing records need init. | Medium. New vendor, DO code. Shadow comparison + cutover. | Highest. Data migration, dual-system sync. Shadow comparison + cutover. |

---

## 4. Recommendation

**The architecture decision is deferred.** No recommendation to select Base44,
Postgres, or Durable Objects is made at this time.

### Why the Decision Is Deferred

The prior report overstated readiness. The corrected prototype (Round 3) is being
tested. The following must be verified before any architecture decision:

1. The corrected authority module passes all behavioral tests (state validation,
   mirror projection, equal-version repair races, protection honesty, migration
   classification, pending-effects CAS).
2. The launch gate turns GREEN (entry-wrapper behavioral tests exist and pass).
3. The owner makes an explicit risk-tolerance decision about empirical vs.
   contractual atomicity.

### Four Concepts to Distinguish

1. **Empirically observed CAS behavior**: 10/10 rounds × 20 calls = exactly 1
   winner. This is an observation, not a guarantee.
2. **Undocumented vendor guarantee**: No written guarantee from Base44. The
   behavior could change without notice.
3. **Application correctness**: The module's logic is verified by tests — but
   only *given* the empirical CAS behavior holds.
4. **Production integration**: No entry points are integrated. No entry-wrapper
   behavioral tests exist. The launch gate is RED.

### Current Status

- **Maintenance mode**: ON
- **Launch readiness**: 94% / NO-GO
- **Production entry points**: NOT integrated (no entry-wrapper behavioral tests)
- **Existing records**: NOT initialized (MIGRATION_REQUIRED)
- **Vendor guarantee**: NOT received
- **Launch gate**: RED

### No Recommendation

Do not select Base44, Postgres, or Durable Objects until:
1. The corrected prototype passes all tests.
2. The owner makes an explicit risk-tolerance decision.
3. The launch gate turns GREEN.