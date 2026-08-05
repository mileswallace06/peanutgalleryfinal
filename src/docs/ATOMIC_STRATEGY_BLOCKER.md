# Atomic Strategy — Architectural Blocker Finding (7C.9C.2 — Requirement #3)

## Finding: Base44 does not support a usable atomic primitive for conditional reservation writes.

### Primitives Evaluated

| Primitive | Available in Base44? | Evidence |
|-----------|---------------------|----------|
| Transaction (multi-document) | **No** | SDK exposes no transaction API; all writes are independent |
| Atomic conditional update (compare-and-set) | **No** | `updateMany` with `$set` is a non-atomic read-then-write; confirmed by prior dead-end analysis: "Atomic conditional compare-and-set via updateMany — confirmed non-atomic read-then-write on this platform" |
| Expected-version update | **No** | `update(id, data)` has no `expected_version` or `if_match` parameter |
| Unique claim record (create-if-absent) | **No** | `create()` generates a new ID; no unique constraint enforcement on non-ID fields; duplicate records with same `listing_id` can coexist |
| Lock/lease entity | **No** | No server-side lock or lease primitive; all "locks" are application-level read-then-write patterns with the same race window |
| Atomic create-if-absent | **No** | `create()` always succeeds if the data is valid; no conditional create |
| `bulkCreate` / `bulkUpdate` | **No atomicity** | These are batch operations, not transactions; each item is independent |

### SDK Methods Available

```
base44.entities.Todo.create(data)
base44.entities.Todo.update(id, data)
base44.entities.Todo.updateMany(query, operators)   // non-atomic read-then-write
base44.entities.Todo.bulkCreate([...])
base44.entities.Todo.bulkUpdate([...])
base44.entities.Todo.filter(query, sort, limit)
base44.entities.Todo.delete(id)
base44.entities.Todo.deleteMany(query)
```

None of these methods accept an `expected_revision`, `if_match`, `condition`, or `where` clause
that would allow the server to atomically reject an update if the record has changed.

### Why This Is a Blocker

The requirement asks for a strategy that guarantees:
1. The first operation claims a generation or lease atomically
2. A competing operation cannot overwrite without owning the same claim
3. ListingPrivate and Listing transitions are tied to that claim
4. Stale owners cannot commit
5. Abandoned claims expire safely
6. Retries with the same operation ID are idempotent
7. Retries with a different operation ID cannot silently replace the winner

Without an atomic conditional primitive, there is no way to prevent a race between
the check (read current state) and the write (update with new state). Two concurrent
operations can both read the same state, both decide they are the winner, and both
write — one overwrites the other.

### Mitigation Strategy (Current Implementation)

Since true atomicity is not available, the current implementation uses the strongest
available strategy:

1. **Immutable quarantine snapshots** — First-quarantine snapshots are never overwritten
   by repeated quarantines. Divergence detection blocks recovery.

2. **Monotonic revision generation** — Every reservation tuple mutation generates a new
   unique revision. The revision is written to BOTH Listing and ListingPrivate. The
   capture freeze records the frozen revision, and finalization verifies the current
   revision matches the frozen revision before clearing.

3. **Stale-prefetch race detection** — `applyReservationTuple` re-fetches both records
   immediately before the first write and compares to the prefetch snapshot. If either
   record changed, it refuses to write and quarantines both records.

4. **Conditional second-write guard** — After writing ListingPrivate, the Listing is
   re-fetched and compared to the pre-write state. If Listing changed between writes,
   the operation refuses to overwrite the newer value and quarantines both records.

5. **Two-phase freeze-and-finalize** — Payment capture freezes the reservation tuple
   (immutable snapshot on PurchasePrivate). Finalization verifies the current tuple
   matches the frozen tuple before clearing. A different non-null tuple blocks
   finalization and triggers durable block + alert.

6. **Fail-closed verification** — Every write is verified through re-fetch. If any
   verification fails, the listing is quarantined, blocked, and alerted. No best-effort
   cleanup — every failure is escalated.

7. **Durable escalation idempotency** — AdminAlert records use a stable `incident_key`
   derived from listing_id, operation category, conflict class, and purchase ID.
   Retries update the existing unresolved alert instead of creating a duplicate.

8. **Generation-based recovery blocking** — `recovery_blocked` is set when divergence
   is detected. Blocked listings require manual resolution.

### Limitations of the Mitigation

- The stale-prefetch check reduces the race window but does not eliminate it. A
  competing write can land between the stale-prefetch check and the first write.
- The conditional second-write guard reduces the split-brain window but does not
  eliminate it. A competing write can land between the first and second writes.
- The two-phase freeze-and-finalize detects post-freeze mutation but cannot prevent
  it from happening.

These limitations are inherent to the platform and cannot be resolved without an
atomic conditional primitive. The mitigation strategy ensures that any race condition
is DETECTED (through tuple mismatch verification) and ESCALATED (through quarantine,
block, and alert), even if it cannot be PREVENTED.

### Conclusion

**Architectural blocker: Base44 does not support a usable atomic primitive for
conditional reservation writes.** The current mitigation strategy (stale-prefetch
detection, conditional second-write guard, two-phase freeze-and-finalize, fail-closed
verification, durable escalation idempotency) provides the strongest available
consistency guarantees but cannot guarantee true atomicity. All race conditions are
detected and escalated, but not prevented at the datastore level.