# External Transactional Reservation Authority — Architecture Design

## 7C.9C.2 Atomicity Decision Gate — No-Provisioning Design for Owner Approval

**Status**: DESIGN ONLY — no vendor provisioned, no credentials added, no production entry points integrated.

**Date**: 2026-08-08 (corrected)

---

## 1. Executive Summary

A live Base44 atomicity probe (20 concurrent `updateMany` calls with a conditional
predicate) showed that **Base44 `updateMany` with a filter predicate is empirically
atomic for single-entity conditional updates** — only 1 of 20 concurrent calls
matched the predicate. This behavior is **not contractually guaranteed** by official
documentation.

The same probe proved that **Base44 does NOT enforce unique constraints** — two
concurrent `create` calls with the same `incident_key` produced 2 records.

**Verdict**: Single-entity CAS is empirically atomic (not guaranteed). Multi-entity
transactions and unique create constraints are unavailable.

An external transactional reservation authority may be required if contractual
guarantees are needed. A single-authority design using `ListingPrivate` CAS (Task 2)
may be sufficient if the empirical behavior is accepted as reliable.

---

## 2. Probe Findings

### 2.1 Conditional $inc CAS Test

| Metric | Value |
|--------|-------|
| Concurrent calls launched | 20 |
| Final `occurrence_count` | 1 |
| Winners | 1 |
| Sample raw return (loser) | `{"success":true,"updated":0,"has_more":false}` |

**Finding**: Only 1 of 20 concurrent calls matched the predicate. **Empirically atomic (not contractually guaranteed).**

### 2.2 Duplicate incident_key Test

| Metric | Value |
|--------|-------|
| Records created | 2 |
| Unique constraint enforced | false |

**Finding**: No unique constraint. **Not concurrently atomic for deduplication.**

---

## 3. Why an External Authority May Be Required

Three gaps remain:

1. **Multi-entity transactional consistency**: Two `updateMany` calls (Listing + ListingPrivate) are NOT atomic together.
2. **Unique constraints**: `operation_id` and `incident_key` require datastore-enforced uniqueness.
3. **Contractual guarantee**: Base44 does not document `updateMany` as atomic.

---

## 4. Option A: Neon/Postgres

### 4.1 Schema

```sql
-- Table before index (correct ordering)
CREATE TABLE reservation_operations (
  operation_id        TEXT        PRIMARY KEY,
  listing_id          TEXT        NOT NULL,
  expected_version    INTEGER     NOT NULL,
  requested_state     JSONB       NOT NULL,
  result_state        JSONB,
  status              TEXT        NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at        TIMESTAMPTZ
);

CREATE TABLE reservations (
  listing_id          TEXT        PRIMARY KEY,
  version             INTEGER     NOT NULL DEFAULT 0,
  lifecycle_state     TEXT        NOT NULL DEFAULT 'available',
  reservation_token   TEXT,
  buyer_email         TEXT,
  expires_at          TIMESTAMPTZ,
  revision            TEXT,
  purchase_id         TEXT,
  payment_intent_id   TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reservation_outbox (
  outbox_id           BIGSERIAL   PRIMARY KEY,
  operation_id        TEXT        NOT NULL REFERENCES reservation_operations(operation_id),
  listing_id          TEXT        NOT NULL,
  mirror_payload      JSONB       NOT NULL,
  delivered           BOOLEAN     NOT NULL DEFAULT false,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_undelivered ON reservation_outbox (created_at) WHERE delivered = false;
```

### 4.2 Atomic CAS Operation

```sql
UPDATE reservations
SET version = version + 1,
    lifecycle_state = $requested_state,
    reservation_token = $token,
    buyer_email = $buyer,
    expires_at = $expiry,
    revision = $revision,
    purchase_id = $purchase_id,
    payment_intent_id = $pi_id,
    updated_at = now()
WHERE listing_id = $listing_id
  AND version = $expected_version
RETURNING *;
```

### 4.3 Transactionally Persisted Operation Result

All writes (CAS + operation record + outbox) are in a single `BEGIN/COMMIT`. Either all commit or all roll back.

### 4.4 Transactional Outbox — At-Least-Once with Idempotent Consumers

Outbox delivery is **at-least-once**, not exactly-once. Consumers must be idempotent:

- The authority commits the outbox row in the same transaction as the CAS.
- An external worker (not a 30-second Base44 automation — Base44 scheduled functions have a minimum 5-minute interval) reads undelivered rows and applies mirror updates.
- **Immediate delivery**: The authority API response triggers an immediate mirror update attempt (best-effort).
- **Five-minute sweeper**: A Base44 scheduled automation (minimum interval: 5 minutes) sweeps undelivered outbox rows and applies mirror updates. This is the reliability backstop.
- **External alarm/worker** (alternative): An external cron job or worker process polls the outbox at a shorter interval if 5 minutes is too slow.
- Mirror updates use `updateMany` with CAS on `reservation_revision` to prevent double-apply on retry. A retry that re-applies the same payload sees the already-updated revision and returns `updated: 0` (idempotent no-op).

**Listing and ListingPrivate become mirrors/read models. They are NOT independently authoritative.**

### 4.5 Retry / Idempotency Contract

- Each operation has a unique `operation_id`.
- Retries with the same `operation_id` are deduplicated by the PRIMARY KEY on `reservation_operations`.
- The CAS `WHERE version = expected_version` ensures at most one concurrent winner.

### 4.6 Signed Server-to-Server Authentication

- HMAC-SHA256 signed request with a shared secret stored as a Base44 secret.
- Each request includes `X-Operation-Id`, `X-Timestamp` (reject if > 5 min old), `X-Signature`.

### 4.7 Timeout and Unavailable-Service Behavior

- **Request timeout**: 5 seconds. If the authority does not respond, return `503`.
- **Authority unavailable**: Fail-closed. All reservation endpoints return `503`. No Base44 mutation.
- **Outbox delivery failure**: Outbox rows accumulate. The authority continues accepting operations. Mirror updates are deferred.
- **Circuit breaker**: After 3 consecutive failures, circuit opens for 30 seconds.

### 4.8 Migration and Rollback Plan — Shadow Comparison + Explicit Cutover

**No dual-write.** Dual-write is unsafe because it allows the two systems to diverge silently. Instead:

**Phase 1: Shadow comparison (no cutover)**
- Deploy the authority and outbox worker.
- All reservation operations continue to write to Base44 (Base44 remains authoritative).
- The authority receives shadow writes (same operations, same data) but its results are NOT used.
- A comparison job verifies that the authority's state matches Base44's state after every operation.
- Monitor for divergence. If divergence is detected, fix the authority before cutover.

**Phase 2: Explicit cutover (one-time switch)**
- After shadow comparison shows zero divergence for a sustained period (e.g., 7 days):
- Switch all reservation operations to authority-first: write to authority, then mirror to Base44 via outbox.
- Base44 becomes a mirror. The authority is authoritative.
- **No Base44-direct fallback after cutover.** If the authority fails, the system fails-closed (503). There is no fallback to Base44-direct writes, because Base44 is no longer authoritative and a fallback would create divergence.

**Phase 3: Cleanup**
- Remove the shadow comparison job.
- Remove the old `tupleTransition` / `captureReconciliation` code paths.
- Base44 is purely a mirror.

**Rollback**: Before cutover (Phase 1), rollback is trivial — stop shadow writes, Base44 was always authoritative. After cutover (Phase 2), rollback requires reconciling the authority's state back to Base44 (the authority may have committed operations that Base44 doesn't yet mirror). This is a manual reconciliation process, not an automatic fallback.

### 4.9 Synthetic Concurrency Test Plan

1. 20 concurrent CAS on same listing_id with same expected_version → 1 winner, 19 rejected
2. 20 concurrent CAS with unique operation_id → 1 committed, 19 rejected
3. Retry with same operation_id after commit → idempotent success, no duplicate CAS
4. Outbox delivery at-least-once → mirror updated; retry does not double-apply (idempotent consumer)
5. Authority unavailable → 503 fail-closed, no Base44 mutation
6. Split-brain prevention → only 1 wins, other rejected, no split state

---

## 5. Option B: Cloudflare Durable Objects

### 5.1 Architecture

Each `listing_id` maps to a single Durable Object (DO). The DO is a single-threaded
actor — all operations on a given listing are serialized within the DO.

Current Cloudflare Durable Objects provide:
- **SQLite-backed transactional storage**: Each DO has a built-in SQLite database
  with full transaction support (BEGIN/COMMIT/ROLLBACK).
- **Persistent unique constraints**: SQLite UNIQUE and PRIMARY KEY constraints are
  durable and survive eviction/relocation.
- **Alarms API**: DO alarms provide scheduled callbacks (durable timers) for
  expiration, cleanup, and outbox sweeping without external infrastructure.
- **SQL support**: The DO's SQLite database supports full SQL queries within the DO.

```
Durable Object: ReservationActor (one per listing_id)
  - SQLite state: { version, lifecycle_state, token, buyer, expires_at, revision, ... }
  - SQLite operations table: { operation_id UNIQUE, expected_version, result, status }
  - SQLite outbox table: { outbox_id, operation_id, mirror_payload, delivered }
  - methods: reserve(), release(), freeze(), finalize(), cancel()
  - All methods serialized (single-threaded within DO)
  - Alarms: expiration timers, outbox sweep
  - Transaction: BEGIN; UPDATE ... WHERE version=expected; INSERT operation; INSERT outbox; COMMIT;
```

### 5.2 Comparison

| Criterion | Neon/Postgres | Cloudflare Durable Objects |
|-----------|---------------|---------------------------|
| Atomicity model | Row-level CAS (UPDATE...WHERE version) | Single-threaded actor (serialized) + SQLite transactions |
| Unique constraints | Native (UNIQUE INDEX) | Native (SQLite UNIQUE, durable across eviction) |
| Transactional outbox | Native (same transaction) | Native (SQLite transaction within DO) |
| Multi-row transactions | Native (BEGIN/COMMIT) | Within single DO (SQLite transaction) |
| Query capability | Full SQL (cross-listing) | SQL within single DO (no cross-DO queries) |
| Scheduled tasks | External cron/worker | Native Alarms API (durable timers) |
| Operational complexity | Low (managed Postgres) | Medium (DO lifecycle, routing) |
| Latency | 5-15ms per operation | 10-50ms (cold start possible) |
| Outbox sweep | External worker or 5-min Base44 automation | Native Alarms (sub-second scheduling) |
| Migration effort | Low (SQL schema) | Medium (DO code, routing) |
| Availability failure | Connection timeout → 503 | DO unavailable → 503 |
| Vendor lock-in | Low (standard SQL) | Medium (DO-specific API) |

### 5.3 Why Neon/Postgres May Be Preferred

1. **Cross-listing queries**: Admin dashboards need SQL across all listings (e.g., "find all frozen reservations > 1 hour"). Postgres supports this natively. Durable Objects require iterating across all DOs.

2. **Operational simplicity**: Managed Postgres is well-understood. Durable Objects have cold-start latency and a non-standard debugging experience.

3. **Migration effort**: A single SQL schema + thin API is less code than a DO actor + routing.

### 5.4 Why Cloudflare Durable Objects May Be Preferred

1. **No external outbox worker**: The Alarms API provides sub-second scheduled callbacks within the DO, eliminating the need for an external outbox poller.

2. **Transactional outbox within DO**: SQLite transactions within the DO provide a transactional outbox without a separate database.

3. **Single-threaded serialization**: No CAS complexity — all operations on a listing are serialized by design.

---

## 6. Listing and ListingPrivate as Mirror / Read Models

After cutover, Base44 entities are non-authoritative mirrors:

- All reservation transitions go through the authority.
- The authority commits the transition (CAS + operation record + outbox row in one transaction).
- The outbox worker applies mirror updates to Base44 `Listing` and `ListingPrivate`.
- Mirror updates use `updateMany` with CAS on `reservation_revision` (idempotent).
- The frontend reads `Listing` for marketplace display (eventual consistency).
- `ListingPrivate` is updated identically and remains admin-only.
- Old non-atomic code paths are retired after cutover. **No Base44-direct fallback.**

---

## 7. Recommendation

**The architecture decision is deferred.** No recommendation to select Base44,
Postgres, or Durable Objects is made at this time.

### Why the Decision Is Deferred

The prior report overstated readiness. The corrected prototype (Round 3) is being
tested. The following must be verified before any architecture decision:

1. The corrected authority module passes all behavioral tests.
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

### No Provisioning

Do not provision Neon/Postgres, Cloudflare Durable Objects, or any external
authority until:
1. The corrected prototype passes all tests.
2. The owner makes an explicit risk-tolerance decision.
3. The launch gate turns GREEN.