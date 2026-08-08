# External Transactional Reservation Authority — Architecture Design

## 7C.9C.2 Atomicity Decision Gate — No-Provisioning Design for Owner Approval

**Status**: DESIGN ONLY — no vendor provisioned, no credentials added, no production entry points integrated.

**Date**: 2026-08-08

---

## 1. Executive Summary

A live Base44 atomicity probe (20 concurrent `updateMany` calls with a conditional predicate) proved that **Base44 `updateMany` with a filter predicate IS atomic for single-entity conditional updates** — only 1 of 20 concurrent calls matched the predicate `{occurrence_count: 0}` and incremented to 1. The remaining 19 calls returned `updated: 0`.

However, the same probe proved that **Base44 does NOT enforce unique constraints** — two concurrent `create` calls with the same `incident_key` produced 2 records.

**Verdict**: SEQUENTIAL IDEMPOTENCY ONLY — NOT CONCURRENTLY ATOMIC.

An external transactional reservation authority is still required because:

1. **Multi-entity transactional consistency**: Reservation transitions must update BOTH `Listing` and `ListingPrivate` atomically. Base44 `updateMany` is atomic for a single entity, but two separate `updateMany` calls (one per entity) are NOT atomic together. A split-brain can occur if the first succeeds and the second fails.
2. **Unique constraints**: `operation_id` and `incident_key` require datastore-enforced uniqueness to prevent duplicate operations and duplicate alerts under concurrency. Base44 does not provide unique constraints.
3. **Transactional outbox**: Mirror updates to Base44 must be reliably delivered exactly-once. This requires a transactional outbox pattern (write outbox row in the same transaction as the reservation update) that Base44 cannot provide.

---

## 2. Probe Findings

### 2.1 Conditional $inc CAS Test

| Metric | Value |
|--------|-------|
| Probe ID | `6a779a4394da697431cd79e0` |
| Concurrent calls launched | 20 |
| Final `occurrence_count` | 1 |
| Winners (by $inc value) | 1 |
| Sample raw return (loser) | `{"success":true,"updated":0,"has_more":false}` |
| Errors | 0 |

**Finding**: Only 1 of 20 concurrent `updateMany({ id: probeId, occurrence_count: 0 }, { $inc: { occurrence_count: 1 } })` calls matched the predicate. The remaining 19 saw `occurrence_count: 1` and returned `updated: 0`. **The conditional update IS atomic.**

### 2.2 Conditional $set CAS Test

| Metric | Value |
|--------|-------|
| Probe ID | `6a779a44e9d156cbd4f9e388` |
| Concurrent calls launched | 20 |
| Final `occurrence_count` | 1 |
| Final `resolution_notes` | `winner_5` |
| Winners (by return `updated > 0`) | 1 |
| Sample raw return (loser) | `{"success":true,"updated":0,"has_more":false}` |
| Errors | 0 |

**Finding**: Only 1 of 20 concurrent calls returned `updated > 0`. The winner was call index 5 (`winner_5`). **The conditional $set IS atomic.**

### 2.3 Unconditional $inc Control

| Metric | Value |
|--------|-------|
| Probe ID | `6a779a445b6b019e9e212633` |
| Concurrent calls launched | 20 |
| Final `occurrence_count` | 20 |
| All succeeded | true |
| Sample raw return | `{"success":true,"updated":1,"has_more":false}` |
| Errors | 0 |

**Finding**: All 20 concurrent `updateMany({ id: probeId }, { $inc: { occurrence_count: 1 } })` calls succeeded. **$inc is concurrency-safe and calls do not block each other.**

### 2.4 Duplicate incident_key Test

| Metric | Value |
|--------|-------|
| Duplicate key | `[PROBE-ATOMICITY-1786223170942]-dup-key` |
| Records created | 2 |
| Unique constraint enforced | false |
| Record A ID | `6a779a461be01ac0d902b250` |
| Record B ID | `6a779a464f17236871909d46` |

**Finding**: Two concurrent `create` calls with the same `incident_key` both succeeded. **No unique constraint is enforced.**

### 2.5 Cleanup Proof

| Metric | Value |
|--------|-------|
| Starting AdminAlert count | 588 |
| Final AdminAlert count | 588 |
| Cleanup OK | true |
| Delete errors | 0 |

**All probe records deleted. Final count equals starting count.**

---

## 3. Why an External Authority Is Still Required

Despite the conditional update being atomic for single entities, three gaps remain:

### Gap 1: Multi-Entity Transactional Consistency

Reservation transitions require updating BOTH `Listing` (public) and `ListingPrivate` (private sidecar) with identical reservation tuples. Two separate `updateMany` calls are NOT atomic together:

```
updateMany on ListingPrivate  →  succeeds (CAS won)
updateMany on Listing         →  fails (concurrent modification)
→ Split-brain: LP has new tuple, Listing has old tuple
```

Even with CAS on both entities, the window between the two calls allows a split-brain. An external authority with a single-row transaction eliminates this gap.

### Gap 2: Unique Constraints

`operation_id` must be unique to enforce idempotency (a retry with the same `operation_id` must not create a duplicate reservation transition). `incident_key` must be unique to prevent duplicate alerts. Base44 does not provide datastore-enforced unique constraints.

### Gap 3: Transactional Outbox

After the authority commits a reservation transition, the mirror update to Base44 `Listing`/`ListingPrivate` must be reliably delivered. A transactional outbox (write the outbox row in the same transaction as the reservation update) guarantees at-least-once delivery with idempotent consumers. Base44 cannot provide this.

---

## 4. Option A: Neon/Postgres (RECOMMENDED)

### 4.1 Schema

```sql
CREATE TABLE reservations (
  listing_id          TEXT        PRIMARY KEY,
  version             INTEGER     NOT NULL DEFAULT 0,
  lifecycle_state     TEXT        NOT NULL DEFAULT 'available',
  -- available | reserved | frozen | sold | cancelled | expired
  reservation_token   TEXT,
  buyer_email         TEXT,
  expires_at          TIMESTAMPTZ,
  revision            TEXT,
  purchase_id         TEXT,
  payment_intent_id   TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_reservations_operation_id
  ON reservation_operations (operation_id);

CREATE TABLE reservation_operations (
  operation_id        TEXT        PRIMARY KEY,
  listing_id          TEXT        NOT NULL REFERENCES reservations(listing_id),
  expected_version    INTEGER     NOT NULL,
  requested_state     JSONB       NOT NULL,
  result_state        JSONB,
  status              TEXT        NOT NULL DEFAULT 'pending',
  -- pending | committed | rejected | failed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at        TIMESTAMPTZ
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
-- Single atomic conditional update with RETURNING
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

- If 0 rows returned: CAS failed (version mismatch). Another operation won.
- If 1 row returned: CAS succeeded. The returned row is the new authoritative state.

### 4.3 Transactionally Persisted Operation Result

```sql
BEGIN;

-- 1. Insert operation record (unique constraint prevents duplicate retries)
INSERT INTO reservation_operations (operation_id, listing_id, expected_version, requested_state)
VALUES ($op_id, $listing_id, $expected_version, $request)
ON CONFLICT (operation_id) DO NOTHING;

-- If conflict: this is a retry — fetch existing result
SELECT * FROM reservation_operations WHERE operation_id = $op_id;
-- If status = 'committed', return idempotent success with existing result_state.

-- 2. Atomic CAS on reservation row
UPDATE reservations SET ...
WHERE listing_id = $listing_id AND version = $expected_version
RETURNING *;

-- If 0 rows: operation rejected
UPDATE reservation_operations SET status = 'rejected', committed_at = now()
WHERE operation_id = $op_id;
-- ROLLBACK or COMMIT (no reservation change)

-- 3. If 1 row: persist result and enqueue outbox
UPDATE reservation_operations
SET status = 'committed', result_state = $row_json, committed_at = now()
WHERE operation_id = $op_id;

INSERT INTO reservation_outbox (operation_id, listing_id, mirror_payload)
VALUES ($op_id, $listing_id, $mirror_json);

COMMIT;
```

All three writes (CAS, operation record, outbox) are in a single transaction. Either all commit or all roll back.

### 4.4 Transactional Outbox for Base44 Mirror Updates

An outbox poller (separate process or scheduled function) reads undelivered outbox rows and applies mirror updates to Base44:

```
1. SELECT ... FROM reservation_outbox WHERE delivered = false ORDER BY created_at LIMIT 100
2. For each row:
   a. Apply mirror_payload to Base44 Listing (updateMany with CAS on revision)
   b. Apply mirror_payload to Base44 ListingPrivate (updateMany with CAS on revision)
   c. If both succeed: mark outbox row delivered = true
   d. If either fails: leave undelivered (retry on next poll)
3. Idempotent: if a retry re-applies the same payload, the CAS on revision prevents double-apply
```

**Listing and ListingPrivate become mirrors/read models. They are NOT independently authoritative.** The Postgres `reservations` table is the single source of truth. All reservation transitions go through the authority. Base44 entities are updated via the outbox.

### 4.5 Retry / Idempotency Contract

- Each operation has a unique `operation_id` (UUID generated by the caller).
- Retries with the same `operation_id` are deduplicated by the unique constraint on `reservation_operations.operation_id`.
- If the original operation committed: return the stored `result_state` (idempotent success).
- If the original operation is still pending: reject the retry (operation in progress).
- If the original operation was rejected: return the rejection (idempotent failure).
- The CAS `WHERE version = expected_version` ensures at most one concurrent operation wins. Losers receive `0 rows returned` and return a rejection.

### 4.6 Signed Server-to-Server Authentication

- The Base44 backend function calls the authority via HTTPS.
- Authentication: HMAC-SHA256 signed request with a shared secret stored as a Base44 secret.
- Each request includes:
  - `X-Operation-Id`: unique operation ID
  - `X-Timestamp`: request timestamp (reject if > 5 min old)
  - `X-Signature`: HMAC-SHA256(secret, `${operation_id}\n${timestamp}\n${body}`)
- The authority validates the signature and timestamp before processing.
- The shared secret is stored as a Base44 secret (e.g., `RESERVATION_AUTHORITY_SECRET`) and never exposed to the frontend.

### 4.7 Timeout and Unavailable-Service Behavior

- **Request timeout**: 5 seconds. If the authority does not respond, return `503 Service Unavailable` to the client.
- **Authority unavailable**: The reservation system enters **fail-closed mode**. No new reservations, releases, freezes, or finalizations are accepted. All reservation endpoints return `503` with a maintenance message.
- **Outbox delivery failure**: If the outbox poller cannot reach Base44, outbox rows accumulate. The authority continues accepting operations (reservations are authoritative). Mirror updates are deferred until Base44 is reachable. This is acceptable — the authority is the source of truth, and mirrors can lag.
- **Circuit breaker**: After 3 consecutive authority failures, the circuit opens for 30 seconds. All reservation endpoints return `503` during the open state. After 30 seconds, a half-open probe request tests recovery.

### 4.8 Migration and Rollback Plan

**Phase 1: Dual-write (no cutover)**
- Deploy the authority and outbox poller.
- All reservation operations write to BOTH the authority AND Base44 (dual-write).
- Base44 remains authoritative. The authority is a shadow.
- Monitor for divergence between authority and Base44.

**Phase 2: Authority-first (cutover)**
- Switch reservation operations to authority-first: write to authority, then mirror to Base44 via outbox.
- Base44 becomes a mirror. The authority is authoritative.
- Keep the dual-write fallback for 7 days. If the authority fails, fall back to Base44-direct.

**Phase 3: Authority-only (cleanup)**
- Remove the dual-write fallback.
- Base44 is purely a mirror.
- Remove the old `tupleTransition` / `captureReconciliation` non-atomic code paths.

**Rollback**: At any phase, switch back to Base44-direct by toggling a feature flag (`RESERVATION_AUTHORITY_ENABLED=false`). The authority's `reservations` table is discarded (Base44 was the source of truth during dual-write). During Phase 2, rollback requires reconciling the authority's state back to Base44 (the authority may have committed operations that Base44 doesn't yet mirror).

### 4.9 Synthetic Concurrency Test Plan

```sql
-- Test 1: 20 concurrent CAS on the same listing_id with the same expected_version
-- Expected: 1 winner, 19 rejected
SELECT plan;
-- Launch 20 concurrent:
-- UPDATE reservations SET version=version+1, lifecycle_state='reserved', ...
-- WHERE listing_id='test_1' AND version=0
-- Assert: exactly 1 returns RETURNING *, 19 return 0 rows

-- Test 2: 20 concurrent CAS with unique operation_id
-- Expected: all 20 insert, but only 1 CAS wins
-- Launch 20 concurrent:
-- INSERT INTO reservation_operations ... (unique operation_id)
-- UPDATE reservations ... WHERE version=expected
-- Assert: 1 committed, 19 rejected (version mismatch)

-- Test 3: Retry with same operation_id after commit
-- Expected: idempotent success, no duplicate CAS
-- Assert: returns stored result_state, no new UPDATE on reservations

-- Test 4: Outbox delivery exactly-once
-- Insert 1 outbox row, run poller twice
-- Assert: Base44 mirror updated once (CAS on revision prevents double-apply)

-- Test 5: Authority unavailable → fail-closed
-- Stop authority, attempt reservation
-- Assert: 503 Service Unavailable, no Base44 mutation

-- Test 6: Split-brain prevention
-- Launch 2 concurrent operations with different expected_version
-- Assert: only 1 wins, other rejected, no split state
```

---

## 5. Option B: Cloudflare Durable Objects

### 5.1 Architecture

Each `listing_id` maps to a single Durable Object (DO). The DO is a single-threaded actor — all operations on a given listing are serialized within the DO.

```
Durable Object: ReservationActor
  - state: { version, lifecycle_state, token, buyer, expires_at, revision, ... }
  - methods: reserve(), release(), freeze(), finalize(), cancel()
  - All methods are serialized (single-threaded)
  - No concurrent access to the same listing
```

### 5.2 Comparison

| Criterion | Neon/Postgres | Cloudflare Durable Objects |
|-----------|---------------|---------------------------|
| Atomicity model | Row-level CAS (UPDATE...WHERE version) | Single-threaded actor (serialized) |
| Unique constraints | Native (UNIQUE INDEX) | Enforced in code (Map key) |
| Transactional outbox | Native (same transaction) | Not native (requires separate storage) |
| Multi-row transactions | Native (BEGIN/COMMIT) | Not available (single DO) |
| Query capability | Full SQL | Key-value only (per DO) |
| Operational complexity | Low (managed Postgres) | Medium (DO lifecycle, eviction) |
| Latency | 5-15ms per operation | 10-50ms (cold start possible) |
| Cost | ~$0.10/GB + compute | ~$0.15/million requests |
| Migration effort | Low (SQL schema) | Medium (DO code, routing) |
| Failure recovery | Transaction rollback | DO state persisted (durable) |
| Cross-listing transactions | Native (JOIN, multi-row) | Not available (one DO per listing) |
| Monitoring | Standard Postgres tools | Cloudflare dashboard only |
| Vendor lock-in | Low (standard SQL) | Medium (DO-specific API) |
| Dec 17 launch feasibility | High (small schema, standard SQL) | Medium (DO code, testing) |

### 5.3 Why Neon/Postgres Is Recommended

1. **Transactional outbox**: Postgres provides a transactional outbox in the same transaction as the CAS. Durable Objects would need a separate storage call (Workers KV or D1) for the outbox, which is not transactional with the DO state.

2. **Unique constraints**: Postgres enforces `operation_id` uniqueness natively. Durable Objects must enforce it in code (a `Set` of processed `operation_id`s), which is in-memory and lost on eviction.

3. **Query capability**: Admin dashboards and reconciliation queries need SQL (e.g., "find all reservations in 'frozen' state for more than 1 hour"). Postgres supports this natively. Durable Objects require iterating across all DOs.

4. **Operational simplicity**: Managed Postgres (Neon) is a well-understood operational model. Durable Objects have cold-start latency, eviction, and a non-standard debugging experience.

5. **Migration effort**: A single SQL schema + a thin API service is less code than a Durable Object actor + routing + outbox storage.

---

## 6. Listing and ListingPrivate as Mirror / Read Models

After migration, the architecture is:

```
┌─────────────────────────────────────────────────────────────┐
│  External Authority (Neon/Postgres)                          │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │ reservations     │  │ reservation_ops   │                  │
│  │ (authoritative)  │  │ (idempotency)     │                  │
│  └────────┬────────┘  └──────────────────┘                  │
│           │                                                  │
│  ┌────────▼────────┐                                        │
│  │ reservation_    │  → Outbox Poller → Base44 Mirror        │
│  │ outbox          │                                        │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  Base44 (Mirror / Read Model)                                │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │ Listing          │  │ ListingPrivate    │                  │
│  │ (public mirror)  │  │ (private mirror)  │                  │
│  └─────────────────┘  └──────────────────┘                  │
│  NOT independently authoritative.                            │
│  Updated via outbox poller with CAS on revision.             │
│  Read by frontend for marketplace display.                   │
└─────────────────────────────────────────────────────────────┘
```

- All reservation transitions (reserve, release, freeze, finalize, cancel) go through the authority.
- The authority commits the transition in a single transaction (CAS + operation record + outbox row).
- The outbox poller reads committed outbox rows and applies mirror updates to Base44 `Listing` and `ListingPrivate`.
- Mirror updates use `updateMany` with CAS on `reservation_revision` (proven atomic by the probe) to prevent double-apply on retry.
- The frontend reads `Listing` for marketplace display (eventual consistency, typically < 1 second lag).
- `ListingPrivate` is updated identically and remains admin-only.
- The old `tupleTransition` / `captureReconciliation` non-atomic code paths are retired. The authority replaces them.

---

## 7. Recommendation

**Provision Neon/Postgres as the external transactional reservation authority.**

- Schema: `reservations` (CAS row) + `reservation_operations` (idempotency) + `reservation_outbox` (mirror delivery)
- CAS: `UPDATE reservations SET ... WHERE listing_id = ? AND version = ? RETURNING *`
- Outbox: same-transaction outbox row, polled by a scheduled function, applied to Base44 with CAS on revision
- Authentication: HMAC-SHA256 signed requests with a shared secret
- Fail-closed: authority unavailable → 503, no Base44 mutation
- Migration: dual-write → authority-first → authority-only (with feature flag rollback)

**Do NOT provision yet.** This is a design for owner approval. The next approved sub-batch will provision the Neon project, create the schema, and implement the authority API + outbox poller.