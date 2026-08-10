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

**Do not choose based on prior assumptions.** The recommendation follows directly
from the probe results and the comparison above.

### Test Outcome

The Task 2 probe passed all tests:
- 10/10 rounds of 20-call concurrency produced exactly 1 winner per round.
- 20 concurrent same-operation-id retries produced 1 mutation.
- Losing operations could not overwrite the winning tuple.
- Mirror failure did not alter the authoritative tuple.
- All decisions consulted the authoritative row, never the mirror.
- Recovery repaired the mirror from the authoritative row.
- No flow treated unknown datastore state as available.
- Before/after entity counts matched (cleanup verified).

### Is Base44 Atomic Behavior "Sufficiently Supported"?

**Yes, empirically — but not contractually.** The probe provides strong empirical
evidence (10/10 rounds, exactly 1 winner, zero anomalies). However, official
Base44 documentation does not document `updateMany` as an atomic conditional
update primitive. The behavior could change without notice.

For a real-money reservation system, the question is whether empirical evidence
is sufficient or whether a contractual guarantee is required. This is a risk
tolerance decision for the owner, not a technical fact.

### Recommendation

**Base44 single-authority CAS is the recommended path IF AND ONLY IF the owner
accepts empirical-only atomicity (no contractual guarantee).** The probe results
are strong, the implementation is complete, and the migration path is the
simplest. The owner must understand the risk: if Base44 changes `updateMany`
internals, CAS could break silently.

**If the owner requires a contractual guarantee, Neon/Postgres is the simplest
external system that supplies the missing guarantee.** It provides MVCC, PRIMARY
KEY uniqueness, and transactional outbox in a single well-understood package.
Cloudflare Durable Objects are a viable alternative if per-listing serialization
and built-in alarms are preferred over cross-listing SQL queries.

### Current Status

- **Maintenance mode**: ON
- **Launch readiness**: 94% / NO-GO
- **Production entry points**: NOT integrated (all 11 remain `integrated: false`)
- **Existing records**: NOT initialized (MIGRATION_REQUIRED)
- **Vendor guarantee**: NOT received
- **Launch gate**: RED (honestly — 13/14 pass, 1 expected fail:
  `production_entry_points_integrated`)

### Conditions for Proceeding with Base44 (owner accepts empirical atomicity)

1. Owner explicitly accepts empirical-only atomicity (no contractual guarantee).
2. Migration initialization of all existing `ListingPrivate` records.
3. All 11 production entry points migrated to use the authority.
4. Entry-wrapper behavioral tests prove each deployed path delegates to the
   authority and cannot write the tuple independently.
5. Launch gate turns GREEN.

### Conditions for Proceeding with External Authority (contractual guarantee)

1. Provision Neon/Postgres (simplest) or Cloudflare Durable Objects.
2. Shadow comparison phase: authority receives shadow writes, verify zero
   divergence for a sustained period.
3. Explicit cutover: switch all reservation operations to authority-first.
4. No Base44-direct fallback after cutover (fail-closed 503 on authority outage).
5. Launch gate turns GREEN.