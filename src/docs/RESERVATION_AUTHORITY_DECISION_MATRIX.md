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
| **Unique operation storage** | No unique constraint. Operation ID stored in `last_operation_id`. | SQLite UNIQUE constraint. | PRIMARY KEY. |
| **Mirror/outbox recovery** | Listing as non-authoritative mirror, reparable from ListingPrivate. No transactional outbox. | SQLite transactional outbox within DO. | Transactional outbox in same transaction. |
| **Operational complexity** | Lowest. No new infrastructure. | Medium. New Cloudflare account, DO code. | Highest. Neon project, API layer, outbox worker. |
| **Launch timeline** | Fastest. Days. | Medium. 1-2 weeks. | Slowest. 2-3 weeks. |
| **Migration risk** | Lowest. Code restructure only. Risk: relying on undocumented behavior. | Medium. New vendor, DO code. | Highest. Data migration, dual-system sync. |

---

## 4. Recommendation

**DO NOT recommend Base44 as production authority until a written affirmative
vendor guarantee is received from Base44.**

The empirical probe results are strong (10/10 rounds, 1 winner), but empirical
evidence is NOT a substitute for a contractual guarantee in a real-money
reservation system. The launch gate remains RED until:

1. Base44 provides a written affirmative answer to the vendor guarantee question
   (see `VENDOR_GUARANTEE_QUESTION.md`), OR
2. An external transactional authority (Cloudflare Durable Objects or
   Neon/Postgres) is provisioned and integrated.

### Current Status

- **Maintenance mode**: ON
- **Launch readiness**: 94% / NO-GO
- **Production entry points**: NOT integrated (all 11 remain `integrated: false`)
- **Existing records**: NOT initialized (MIGRATION_REQUIRED)
- **Vendor guarantee**: NOT received

### Conditions for Proceeding with Base44 (if vendor confirms)

1. Written affirmative vendor guarantee from Base44.
2. Migration initialization of all existing `ListingPrivate` records.
3. All 11 production entry points migrated to use the authority.
4. Entry-wrapper behavioral tests prove each deployed path delegates to the
   authority and cannot write the tuple independently.
5. Launch gate turns GREEN.

### Fallback

If Base44 `updateMany` atomicity is not contractually guaranteed, migrate to
**Cloudflare Durable Objects** (SQLite ACID + unique constraints + alarms) or
**Neon/Postgres** (MVCC + PRIMARY KEY + transactional outbox).