# Atomic Strategy — Capability Assessment (7C.9C.2)

## Summary

Base44 `updateMany` with a filter predicate is **empirically atomic for single-record
conditional updates** (compare-and-set), as proven by a live probe on 2026-08-08.
However, this atomicity is **not contractually guaranteed by official documentation**.
Two capabilities remain unavailable: multi-entity transactions and unique create
constraints.

---

## Live Probe Results

### Probe 1 — AdminAlert CAS (2026-08-08)

A live probe using synthetic `AdminAlert` records tested Base44's `updateMany` with
a conditional filter predicate under 20-way concurrency:

| Test | Launched | Winners | Verdict |
|------|----------|---------|---------|
| `updateMany({ id, occurrence_count: 0 }, { $inc: { occurrence_count: 1 } })` | 20 | **1** | Empirically atomic |
| `updateMany({ id, occurrence_count: 0 }, { $set: { occurrence_count: 1, ... } })` | 20 | **1** | Empirically atomic |
| `updateMany({ id }, { $inc: { occurrence_count: 1 } })` (no predicate) | 20 | 20 | All succeed (control) |
| Two concurrent `create` with same `incident_key` | 2 | 2 records | **No unique constraint** |

### Probe 2 — Single-Authority ListingPrivate CAS (2026-08-10)

A live probe using one synthetic `ListingPrivate` record as the sole authoritative
reservation row and one synthetic `Listing` as a non-authoritative mirror. The CAS
query included record ID, expected reservation revision (version), and required
non-quarantine state. 10 independent rounds of 20-call concurrency:

| Round | Concurrent Calls | Winners | Winner Index | All Others `updated: 0` |
|------|-----------------|---------|--------------|------------------------|
| 0 | 20 | **1** | 0 | Yes |
| 1 | 20 | **1** | 15 | Yes |
| 2 | 20 | **1** | 13 | Yes |
| 3 | 20 | **1** | 4 | Yes |
| 4 | 20 | **1** | 0 | Yes |
| 5 | 20 | **1** | 18 | Yes |
| 6 | 20 | **1** | 11 | Yes |
| 7 | 20 | **1** | 13 | Yes |
| 8 | 20 | **1** | 6 | Yes |
| 9 | 20 | **1** | 8 | Yes |

**Finding**: All 10 rounds produced exactly 1 winner. The remaining 19 calls per
round returned `updated: 0`. No round produced anything other than 1 winner.

**Auxiliary tests (all passed)**:

| Test | Result |
|------|--------|
| 20 concurrent same-operation-id retries → 1 mutation, deterministic idempotent responses | PASS |
| Losing operation cannot overwrite winning tuple | PASS |
| Mirror failure does not alter or roll back authoritative tuple | PASS |
| All decisions consult authoritative row, never mirror | PASS |
| Recovery can repair mirror from authoritative row | PASS |
| No flow treats unknown datastore state as available | PASS |
| Before/after entity counts match (cleanup verified) | PASS (36/36 → 36/36) |

**Important distinction**: This is **empirically observed atomicity, not a
contractually guaranteed platform feature.** Official Base44 documentation does
not document `updateMany` as an atomic conditional update primitive. The behavior
could change without notice. Production systems that depend on this behavior
should treat it as observed-but-not-guaranteed and maintain a migration path to a
system with contractual atomicity guarantees.

---

## What IS Available (Empirically, Not Contractually Guaranteed)

| Primitive | Empirically Available | Evidence | Contractually Guaranteed |
|-----------|----------------------|----------|-------------------------|
| Single-record conditional update (CAS via `updateMany` with filter) | **Yes** | 10/10 rounds × 20 calls = exactly 1 winner per round | **No** — not documented |
| `$inc` with conditional predicate | **Yes** | Final value = 1 (not 20) | **No** |
| `$set` with conditional predicate | **Yes** | 1 winner by return `updated > 0` across 10 rounds | **No** |

## What Is NOT Available

| Primitive | Available | Evidence |
|-----------|-----------|----------|
| Multi-entity transaction (update Listing + ListingPrivate atomically) | **No** | SDK exposes no transaction API; two `updateMany` calls are independent |
| Unique create constraint (prevent duplicate `incident_key` / `operation_id`) | **No** | Two concurrent creates with same key produced 2 records |
| Documented atomic CAS guarantee | **No** | No official documentation guarantees `updateMany` atomicity |
| Conditional create (create-if-absent) | **No** | `create()` always succeeds if data is valid |
| Lock/lease primitive | **No** | No server-side lock or lease |

---

## Implications for the Reservation System

### Single-Entity CAS (Usable with Caution)

The empirical probe shows that `updateMany` with a filter predicate can serve as a
single-record CAS:

```
updateMany(
  { id: recordId, reservation_revision: expectedRevision, checkout_quarantined: false },
  { $set: { reservation_token: newToken, reservation_revision: newRevision, ... } }
)
// If updated > 0: CAS succeeded
// If updated = 0: CAS failed (revision mismatch or quarantined)
```

This can be used to make **one entity** (e.g., `ListingPrivate`) the sole
authoritative reservation row. A synthetic single-authority probe (Task 2) tests
this design.

### Remaining Gaps

Even with single-entity CAS, two gaps remain:

1. **Multi-entity consistency**: `Listing` (public mirror) must be updated
   separately. Two `updateMany` calls are not atomic together. The mirror can lag
   or diverge. This is acceptable if `Listing` is treated as a non-authoritative
   read model that can be repaired from the authoritative `ListingPrivate`.

2. **Unique operation storage**: Without unique constraints, idempotent retries
   cannot be deduplicated by the datastore. The CAS predicate (`reservation_revision
   = expected`) provides natural idempotency for retries with the same expected
   revision, but a retry with a different operation ID and the same expected
   revision would compete as a separate CAS attempt (which is correct behavior —
   only one can win).

---

## Mitigation Strategy (Current Implementation)

The current implementation uses the strongest available strategy given the
empirical findings:

1. **Immutable quarantine snapshots** — First-quarantine snapshots are never
   overwritten by repeated quarantines.
2. **Monotonic revision generation** — Every reservation tuple mutation generates
   a new unique revision.
3. **Stale-prefetch race detection** — Re-fetch both records before the first write.
4. **Two-phase freeze-and-finalize** — Payment capture freezes the tuple;
   finalization verifies before clearing.
5. **Fail-closed verification** — Every write is verified through re-fetch.
6. **Durable escalation idempotency** — AdminAlert records use a stable
   `incident_key` (sequential idempotency only — concurrent creates can duplicate).

---

## Conclusion

**Base44 `updateMany` with a filter predicate is empirically atomic for
single-record conditional updates across 10 independent rounds of 20-way
concurrency (exactly 1 winner per round), but this behavior is not contractually
guaranteed by official documentation.** Multi-entity transactions and unique create
constraints remain unavailable.

A single-authority design using `ListingPrivate` as the sole authoritative
reservation row with CAS via `updateMany` is feasible and tested. `Listing`
becomes a non-authoritative mirror that can be repaired from `ListingPrivate`.
An external authority (Neon/Postgres or Cloudflare Durable Objects) remains the
recommended path for contractual guarantees, but the single-authority CAS design
may be sufficient if the empirical behavior is accepted as reliable. The Task 3
decision matrix compares all three options.