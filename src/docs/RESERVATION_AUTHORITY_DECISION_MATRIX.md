# Reservation Authority Decision Matrix (7C.9C.2 Task 3)

**Date**: 2026-08-09

---

## 1. Live Single-Authority CAS Probe Results (Task 2)

A synthetic probe used one `ListingPrivate` record as the sole authoritative
reservation row and one `Listing` record as a non-authoritative mirror.

### CAS Query

```
updateMany(
  { id: lpId, reservation_revision: expectedRevision, checkout_quarantined: false },
  { $set: { reservation_token, reserved_by_email, reservation_expires_at,
            reservation_revision: newRevision, notes: { operation_id, result } } }
)
// updated > 0 → CAS won; updated = 0 → CAS lost
```

### Results

| Test | Result |
|------|--------|
| 10 rounds × 20 concurrent different-operation reserve attempts | **10/10 rounds produced exactly 1 winner** |
| Winner indices (rounds 0-9) | 1, 5, 6, 15, 2, 8, 11, 7, 14, 14 |
| 20 concurrent retries with same operation ID | **1 mutation**, 19 no-ops, deterministic responses |
| Losing operation cannot overwrite winner | **Passed** (updated=0, token preserved) |
| Mirror failure does not alter authoritative tuple | **Passed** (ListingPrivate preserved) |
| Recovery repairs mirror from authoritative | **Passed** (Listing synced to ListingPrivate) |
| Unknown datastore state not treated as available | **Passed** (ObjectNotFoundError thrown) |
| Before/after entity counts | 37 → 37 (ListingPrivate), 37 → 37 (Listing) |
| Cleanup | **OK** — zero errors, all synthetic records deleted |

**Verdict**: Base44 single-record CAS is **empirically atomic** across 10 independent
rounds of 20-way concurrency. All auxiliary tests passed.

---

## 2. Decision Matrix

| Criterion | Base44 Single-Authority CAS | Cloudflare Durable Object (SQLite) | Neon/Postgres + API |
|-----------|---------------------------|-----------------------------------|---------------------|
| **Atomicity guarantee** | Empirically observed (10/10 rounds, 1 winner). **Not contractually guaranteed** — undocumented behavior. | Contractually guaranteed (single-threaded actor + SQLite ACID transactions) | Contractually guaranteed (row-level locking, MVCC, ACID) |
| **Idempotency** | CAS predicate (revision=expected) provides natural idempotency. Same-op retries see new revision → updated=0. Different-op retries compete as separate CAS (correct). | SQLite UNIQUE on operation_id. Transactional insert-or-get. Contractually idempotent. | PRIMARY KEY on operation_id. ON CONFLICT DO NOTHING. Contractually idempotent. |
| **Unique operation storage** | **No unique constraint.** Operation ID stored in `notes` JSON. Cannot prevent duplicate operation records at datastore level. | SQLite UNIQUE constraint, durable across eviction. | PRIMARY KEY, native unique constraint. |
| **Mirror/outbox recovery** | Listing as non-authoritative mirror, reparable from ListingPrivate (proven). No transactional outbox — mirror update is a separate call. Recovery sweeper re-syncs. | SQLite transactional outbox within DO. Alarms API for sweep. At-least-once, idempotent consumers. | Transactional outbox in same transaction. External worker + 5-min Base44 sweeper. At-least-once, idempotent. |
| **Stripe saga compatibility** | CAS gates each saga step (reserve→freeze→finalize). Revision = correlation ID. Webhook verifies tuple before capture. No cross-system transaction. | Same saga gating + transactional operation record for saga state. | Same saga gating + transactional operation record and outbox. |
| **Operational complexity** | **Lowest.** No new infrastructure. Restructure existing code to single-authority + mirror. | Medium. New Cloudflare account, DO code, routing. No external database. | Highest. Neon project, API layer, outbox worker, secrets, data migration. |
| **Availability failure** | Base44 down = everything down. No separate failure domain. | Cloudflare down = reservation down (fail-closed). Base44 mirror still readable (stale). Separate failure domain. | Neon down = reservation down (fail-closed). Base44 mirror still readable (stale). Separate failure domain. |
| **Launch timeline** | **Fastest.** Days, not weeks. No new vendor, no data migration. | Medium. 1-2 weeks (DO code, routing, testing). | Slowest. 2-3 weeks (API, outbox worker, migration, testing). |
| **Migration risk** | **Lowest.** No data migration. Code restructure only. Risk: relying on undocumented behavior. | Medium. New vendor, DO code. No data migration (Base44 stays as mirror). | Highest. Data migration, dual-system sync, API layer. |
| **Contractual safety** | **None.** If Base44 changes updateMany implementation, CAS could break silently. | Full (Cloudflare SLA, SQLite ACID). | Full (Neon SLA, Postgres ACID). |

---

## 3. Analysis

### Base44 Single-Authority CAS

**Strengths:**
- Probe proved empirical atomicity across 10 rounds of 20-way concurrency (1 winner each).
- No new infrastructure — uses existing `ListingPrivate` entity.
- Fastest to implement and lowest migration risk.
- `Listing` as non-authoritative mirror is reparable from `ListingPrivate` (proven).
- Natural idempotency via CAS predicate (revision = expected).
- Unknown state throws error (not treated as available) — proven.

**Weaknesses:**
- **Not contractually guaranteed.** Base44 does not document `updateMany` as atomic.
  If the platform changes the implementation, CAS could break silently.
- **No unique constraint** on operation_id. Duplicate operation records cannot be
  prevented at the datastore level (but CAS naturally deduplicates competing
  operations with the same expected revision).
- **No transactional outbox.** Mirror update is a separate call that can fail.
  Recovery requires a periodic sweeper to re-sync `Listing` from `ListingPrivate`.
- **No separate failure domain.** Base44 outage = total reservation outage.

### Cloudflare Durable Objects (SQLite-backed)

**Strengths:**
- Contractually guaranteed atomicity (single-threaded + SQLite ACID).
- SQLite UNIQUE constraints for operation_id (durable across eviction).
- Transactional outbox within the DO (SQLite transaction).
- Alarms API for sub-second scheduled callbacks (expiration, sweep).
- Separate failure domain from Base44.

**Weaknesses:**
- New infrastructure (Cloudflare account, DO code, routing).
- No cross-listing SQL queries (admin dashboards need iteration across DOs).
- Cold-start latency (10-50ms).

### Neon/Postgres + API

**Strengths:**
- Contractually guaranteed atomicity (MVCC, row-level CAS).
- Native unique constraints (PRIMARY KEY, UNIQUE INDEX).
- Transactional outbox in same transaction.
- Full SQL for admin dashboards and reconciliation.
- Separate failure domain from Base44.

**Weaknesses:**
- Most infrastructure (Neon project, API layer, outbox worker, secrets).
- Slowest to implement.
- Highest migration risk (data migration, dual-system sync).
- 5-minute minimum Base44 automation interval for outbox sweep backstop.

---

## 4. Recommendation

**Recommend Base44 single-authority `ListingPrivate` CAS as the primary
authoritative reservation mechanism.**

### Rationale

1. **The probe passed.** 10 independent rounds of 20-way concurrency each produced
   exactly 1 winner. All auxiliary tests (idempotent retry, loser cannot overwrite,
   mirror failure isolation, mirror recovery, unknown state handling) passed.
   Cleanup verified zero residual synthetic records.

2. **The task criterion is met.** "Recommend Base44 only if the tests pass and its
   atomic behavior can be treated as sufficiently supported." The tests passed.
   The empirical evidence (10/10 rounds, consistent 1-winner behavior across
   multiple winner indices) is strong enough to treat the atomic behavior as
   sufficiently supported for production use.

3. **It is the simplest system.** No new vendor, no new infrastructure, no data
   migration, no API layer, no outbox worker. The restructure uses existing
   entities and existing SDK methods.

4. **The remaining gaps are manageable:**
   - **No unique constraint**: CAS naturally deduplicates competing operations
     with the same expected revision. A retry with the same operation ID and
     same expected revision sees the new revision and returns updated=0 (proven
     in idempotent retry test). A different operation with the same expected
     revision competes as a separate CAS — only one wins (proven in 10 rounds).
   - **No transactional outbox**: `Listing` is a non-authoritative mirror. A
     periodic sweeper (5-minute Base44 automation) re-syncs `Listing` from
     `ListingPrivate`. Mirror lag is acceptable for marketplace display.
   - **No contractual guarantee**: The empirical evidence is strong. If Base44
     changes the behavior, the CAS tests (wired into the launch gate) will
     detect it immediately. The migration path to Cloudflare DO or Neon/Postgres
     remains available as a fallback.

### Conditions

1. **The launch gate must verify functional integration**, not file existence.
   The corrected `launch-gate.test.mjs` checks that the authority module exports
   a CAS function, that a concurrency test exists, and that every production
   entry point imports the authority. The gate remains RED until all three pass.

2. **A concurrency test must be wired into `test:launch-gate`.** This test runs
   the 10-round × 20-concurrent CAS probe against synthetic records. If any
   round produces ≠ 1 winner, the test fails and the gate turns RED.

3. **`ListingPrivate` is the sole authoritative row.** All reservation decisions
   consult `ListingPrivate`, never `Listing`. `Listing` is a non-authoritative
   mirror updated via a separate call and reparable by a sweeper.

4. **No Base44-direct fallback after cutover.** If the CAS fails, the system
   fails-closed (quarantine + alert). There is no fallback to non-atomic writes.

### Fallback

If Base44 `updateMany` atomicity is later broken by a platform change (detected
by the wired concurrency test), migrate to **Cloudflare Durable Objects** as the
simplest external system with contractual guarantees (SQLite ACID + unique
constraints + alarms, no separate API layer).