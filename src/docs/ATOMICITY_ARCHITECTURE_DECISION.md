# Atomicity Architecture Decision — 7C.9C.2F

**Date**: 2026-08-10
**Phase**: 1B — Architecture Decision Gate
**Status**: DECISION MADE — implementation NOT started

---

## 1. Executive Summary

**Decision**: Transactional Postgres becomes the sole authoritative reservation
system for Peanut Gallery. Base44 `Listing` and `ListingPrivate` become
non-authoritative read models/mirrors. No other candidate was selected.

**Rationale**: No written, authoritative Base44 response guarantees that
conditional `updateMany` predicates are atomically evaluated and updated per
record under concurrency. The Base44 single-row CAS prototype is empirically
successful (10/10 rounds, exactly 1 winner per round) but has no contractual
vendor guarantee. Per the decision rule, without an affirmative written
guarantee, the Base44 CAS prototype cannot be selected as the launch-grade
reservation authority for a real-money marketplace.

**What this document is NOT**: This is not an implementation. No infrastructure
is provisioned. No production entry points are integrated. No records are
migrated. No provider is contacted. Maintenance remains ON. The launch gate
remains RED. 7C.9D is not started.

---

## 2. Evidence Reviewed

### 2.1 Base44 `updateMany` CAS Probe (2026-08-10)

| Probe | Concurrency | Rounds | Winners per round | Contractually guaranteed |
|-------|-------------|--------|-------------------|--------------------------|
| ListingPrivate single-authority CAS | 20-way | 10 | Exactly 1 | **No** |
| AdminAlert `$inc` CAS | 20-way | 1 | 1 | **No** |
| AdminAlert duplicate `incident_key` create | 2-way | 1 | 2 records (no unique constraint) | N/A |

**Finding**: Base44 `updateMany` with a filter predicate is empirically atomic
for single-record conditional updates. This is an observation, not a contract.

### 2.2 Vendor Guarantee Status

- **Question submitted**: See `src/docs/VENDOR_GUARANTEE_QUESTION.md`.
- **Written affirmative response received**: **No.**
- **Written negative response received**: No.
- **Status**: Unanswered. Per the decision rule, absence of an affirmative
  written guarantee means the Base44 CAS prototype cannot be selected.

### 2.3 Known Limitations of Base44 Platform

| Capability | Available | Evidence |
|------------|-----------|----------|
| Single-record conditional update (CAS) | Empirically yes | 10/10 rounds, 1 winner |
| Multi-entity transaction | **No** | SDK exposes no transaction API |
| Unique create constraint | **No** | 2 concurrent creates → 2 records |
| Documented atomic CAS guarantee | **No** | No official documentation |
| Conditional create (create-if-absent) | **No** | `create()` always succeeds |
| Lock/lease primitive | **No** | No server-side lock |
| Server-side stored procedure | **No** | No server-side SQL execution |

### 2.4 Current Test State (verified this round)

| Suite | Result |
|-------|--------|
| authority-concurrency | 59/59 PASS |
| authority-adversarial | 52/52 PASS |
| round5-corrections | 39/39 PASS |
| round6-corrections | 37/37 PASS |
| round6b-corrections | 28/28 PASS |
| tuple-invariant-validation | 26/26 PASS |
| post-prefetch-concurrency | 13/13 PASS |
| launch-gate | 12/14 PASS (2 expected failures: concurrent-alert, production-integration) |
| aggregate runner | 20 suites — 18 PASS, 2 expected FAIL |
| build | PASS |
| backend lint | 0 errors, 116 warnings |
| scoped lint | 0 errors, 22 warnings |

**No skipped live probes.** All suites executed.

### 2.5 Existing Documentation Referenced

- `src/docs/ATOMIC_STRATEGY_BLOCKER.md` — empirical probe results, capability assessment
- `src/docs/EXTERNAL_RESERVATION_AUTHORITY_DESIGN.md` — prior design options (deferred)
- `src/docs/RESERVATION_AUTHORITY_DECISION_MATRIX.md` — prior decision matrix (deferred)
- `src/docs/VENDOR_GUARANTEE_QUESTION.md` — unanswered vendor question
- `base44/shared/reservationMutationManifest.js` — 11 unintegrated entry points

---

## 3. Selected Architecture: Transactional Postgres Authority

**Selection**: Transactional Postgres (managed, e.g. Neon or equivalent) becomes
the sole authoritative reservation system.

`Listing` and `ListingPrivate` become non-authoritative Base44 read
models/mirrors. All reservation transitions are decided by Postgres
transactions. Base44 mirrors are updated via a transactional outbox with
at-least-once delivery and idempotent consumers.

---

## 4. Rejected Alternatives

### 4.1 Rejected: Base44 Single-Row CAS using `ListingPrivate`

| Criterion | Assessment |
|-----------|------------|
| Documented atomicity | **No** — empirically observed only |
| Unique operation IDs | **No** — no unique constraint, duplicate creates possible |
| Transaction support | **No** — no multi-entity transactions |
| Exactly-one reservation winner | Empirically yes (10/10 rounds), contractually no |
| Vendor lock-in | Lowest |
| December 17 feasibility | Fastest (days) |

**Reason rejected**: No written vendor guarantee. A silent platform update
could break CAS without warning, allowing double-spending in a real-money
marketplace. Empirical success does not override the decision rule's
requirement for a contractual guarantee. The risk of a silent regression in
a real-money system is unacceptable without vendor commitment.

### 4.2 Rejected: Cloudflare Durable Object / Serialized Per-Listing Authority

| Criterion | Assessment |
|-----------|------------|
| Documented atomicity | Yes (single-threaded actor + SQLite ACID) |
| Unique operation IDs | Yes (SQLite UNIQUE, durable across eviction) |
| Transaction support | Yes (SQLite within DO) |
| Exactly-one reservation winner | Yes (serialized per listing) |
| Cross-listing queries | **No** — no cross-DO SQL queries; admin dashboards require iteration |
| Outbox sweep | Native (Alarms API, sub-second) |
| Operational complexity | Medium (DO lifecycle, routing, cold-start latency) |
| Vendor lock-in | Medium (DO-specific API) |
| December 17 feasibility | Medium (1-2 weeks) |

**Reason rejected**: Cross-listing query capability is required for admin
dashboards (e.g., "find all frozen reservations > 1 hour", operational
analytics, reconciliation). Durable Objects cannot perform cross-DO SQL
queries; each DO is isolated. This forces an external aggregation layer
for every operational query, increasing complexity and latency. Postgres
provides native cross-listing SQL with full ACID guarantees in a single
well-understood system. Postgres also has lower operational complexity
(managed Postgres is standard) and lower vendor lock-in (standard SQL).

---

## 5. Complete Data Model

### 5.1 Reservation Authority Table

```sql
CREATE TABLE reservation_authority (
  listing_id            TEXT        PRIMARY KEY,
  version               INTEGER     NOT NULL DEFAULT 0,
  lifecycle_state       TEXT        NOT NULL DEFAULT 'available'
    CHECK (lifecycle_state IN ('available','reserved','frozen','sold','cancelled','expired')),
  buyer_user_id         TEXT,       -- immutable authoritative buyer identity
  reservation_token     TEXT,       -- opaque token (or hash of token)
  reservation_expires_at TIMESTAMPTZ,
  reservation_revision  TEXT,       -- monotonic revision UUID
  checkout_quarantined  BOOLEAN     NOT NULL DEFAULT false,
  checkout_quarantine_reason TEXT,
  checkout_quarantined_at TIMESTAMPTZ,
  recovery_blocked      BOOLEAN     NOT NULL DEFAULT false,
  recovery_blocked_reason TEXT,
  recovery_blocked_at   TIMESTAMPTZ,
  recovery_not_before  TIMESTAMPTZ,
  seller_cancel_requested_at TIMESTAMPTZ,
  seller_pause_requested_at TIMESTAMPTZ,
  current_operation_id  TEXT,
  last_operation_type   TEXT,
  last_operation_at     TIMESTAMPTZ,
  last_operation_payload_hash TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce quarantine/recovery invariant at the database level
ALTER TABLE reservation_authority
  ADD CONSTRAINT quarantine_reason_required
  CHECK (NOT checkout_quarantined OR checkout_quarantine_reason IS NOT NULL);

ALTER TABLE reservation_authority
  ADD CONSTRAINT recovery_block_reason_required
  CHECK (NOT recovery_blocked OR recovery_blocked_reason IS NOT NULL);
```

### 5.2 Operation Ledger

```sql
CREATE TABLE reservation_operations (
  operation_id          TEXT        PRIMARY KEY,   -- unique, client-supplied
  listing_id            TEXT        NOT NULL REFERENCES reservation_authority(listing_id),
  operation_type        TEXT        NOT NULL
    CHECK (operation_type IN ('reserve','release','freeze','finalize','cancel','expire','initialize','quarantine')),
  requested_state       TEXT        NOT NULL,
  expected_version      INTEGER     NOT NULL,
  committed_version     INTEGER,
  request_hash          TEXT        NOT NULL,      -- SHA-256 of full semantic envelope
  result_json           TEXT,                      -- deterministic JSON response
  status                TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','committed','rejected','conflict','idempotent_replay')),
  error_code            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at          TIMESTAMPTZ
);

CREATE INDEX idx_ops_listing ON reservation_operations (listing_id, created_at DESC);
CREATE INDEX idx_ops_status ON reservation_operations (status) WHERE status = 'pending';
```

### 5.3 Payment Binding

```sql
CREATE TABLE reservation_payment_bindings (
  purchase_id           TEXT        PRIMARY KEY,   -- unique Purchase ID
  payment_intent_id    TEXT        UNIQUE,        -- unique Stripe PaymentIntent ID
  listing_id           TEXT        NOT NULL REFERENCES reservation_authority(listing_id),
  authority_version    INTEGER     NOT NULL,      -- version at bind time
  capture_state        TEXT        NOT NULL DEFAULT 'authorized'
    CHECK (capture_state IN ('authorized','captured','finalized','aborted','failed')),
  frozen_reservation_token     TEXT,   -- immutable freeze snapshot
  frozen_buyer_user_id         TEXT,
  frozen_reservation_expires_at TIMESTAMPTZ,
  frozen_reservation_revision  TEXT,
  freeze_finalized_at  TIMESTAMPTZ,
  finalization_started_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One binding per listing at a time (enforced by partial unique index)
CREATE UNIQUE INDEX idx_one_active_binding_per_listing
  ON reservation_payment_bindings (listing_id)
  WHERE capture_state IN ('authorized','captured');
```

### 5.4 Transactional Outbox

```sql
CREATE TABLE reservation_outbox (
  outbox_id           BIGSERIAL   PRIMARY KEY,
  event_id            TEXT        UNIQUE,         -- unique effect/event ID
  operation_id        TEXT        NOT NULL REFERENCES reservation_operations(operation_id),
  listing_id          TEXT        NOT NULL,
  committed_version   INTEGER     NOT NULL,
  effect_type         TEXT        NOT NULL
    CHECK (effect_type IN ('mirror_project','notification_dispatch','point_award','email_send','push_send','inventory_sync')),
  payload             JSONB       NOT NULL,
  delivery_status     TEXT        NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','in_flight','delivered','dead_letter')),
  attempt_count       INTEGER     NOT NULL DEFAULT 0,
  max_attempts        INTEGER     NOT NULL DEFAULT 10,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error          TEXT,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_pending ON reservation_outbox (next_attempt_at)
  WHERE delivery_status IN ('pending','in_flight');
```

---

## 6. Transaction Boundaries

Every operation is a single Postgres `BEGIN ... COMMIT`. Either all writes
commit or all roll back. No partial state.

### 6.1 Reserve

```sql
BEGIN;

-- Idempotent replay check
INSERT INTO reservation_operations (operation_id, listing_id, operation_type, requested_state, expected_version, request_hash, status)
VALUES ($op_id, $listing_id, 'reserve', 'reserved', $expected_version, $hash, 'pending')
ON CONFLICT (operation_id) DO NOTHING RETURNING operation_id;

-- If operation existed, fetch and return idempotent result
-- (handled in application layer before CAS)

-- CAS: exactly one winner
UPDATE reservation_authority
SET version = version + 1,
    lifecycle_state = 'reserved',
    buyer_user_id = $buyer,
    reservation_token = $token,
    reservation_expires_at = $expiry,
    reservation_revision = $revision,
    current_operation_id = $op_id,
    last_operation_type = 'reserve',
    last_operation_at = now(),
    last_operation_payload_hash = $hash,
    updated_at = now()
WHERE listing_id = $listing_id
  AND version = $expected_version
  AND lifecycle_state = 'available'
  AND checkout_quarantined = false
  AND recovery_blocked = false
RETURNING version, reservation_revision;

-- If 0 rows returned: CONFLICT or STALE — roll back, return conflict
-- If 1 row returned: commit operation + outbox

UPDATE reservation_operations
SET status = 'committed', committed_version = $new_version, result_json = $result, committed_at = now()
WHERE operation_id = $op_id;

INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
VALUES ($event_id, $op_id, $listing_id, $new_version, 'mirror_project', $mirror_payload);

COMMIT;
```

### 6.2 Release

```sql
BEGIN;
-- CAS: reserved → available, clear tuple
UPDATE reservation_authority
SET version = version + 1,
    lifecycle_state = 'available',
    buyer_user_id = NULL,
    reservation_token = NULL,
    reservation_expires_at = NULL,
    reservation_revision = $new_revision,
    current_operation_id = $op_id,
    last_operation_type = 'release',
    last_operation_at = now(),
    last_operation_payload_hash = $hash,
    updated_at = now()
WHERE listing_id = $listing_id
  AND version = $expected_version
  AND lifecycle_state = 'reserved'
RETURNING version;
-- + operation record + outbox row
COMMIT;
```

### 6.3 Expire

```sql
BEGIN;
-- CAS: reserved → expired (or available if seller wants to re-list)
UPDATE reservation_authority
SET version = version + 1,
    lifecycle_state = 'expired',
    buyer_user_id = NULL,
    reservation_token = NULL,
    reservation_expires_at = NULL,
    reservation_revision = $new_revision,
    current_operation_id = $op_id,
    last_operation_type = 'expire',
    last_operation_at = now(),
    last_operation_payload_hash = $hash,
    updated_at = now()
WHERE listing_id = $listing_id
  AND version = $expected_version
  AND lifecycle_state = 'reserved'
  AND reservation_expires_at < now()
RETURNING version;
-- + operation record + outbox row
COMMIT;
```

### 6.4 Freeze for Payment

```sql
BEGIN;
-- CAS: reserved → frozen
UPDATE reservation_authority
SET version = version + 1,
    lifecycle_state = 'frozen',
    reservation_revision = $new_revision,
    current_operation_id = $op_id,
    last_operation_type = 'freeze',
    last_operation_at = now(),
    last_operation_payload_hash = $hash,
    updated_at = now()
WHERE listing_id = $listing_id
  AND version = $expected_version
  AND lifecycle_state = 'reserved'
RETURNING version, reservation_token, buyer_user_id, reservation_expires_at, reservation_revision;

-- Bind payment (unique constraint on payment_intent_id prevents duplicates)
INSERT INTO reservation_payment_bindings (
  purchase_id, payment_intent_id, listing_id, authority_version,
  capture_state, frozen_reservation_token, frozen_buyer_user_id,
  frozen_reservation_expires_at, frozen_reservation_revision
) VALUES (
  $purchase_id, $pi_id, $listing_id, $new_version,
  'authorized', $frozen_token, $frozen_buyer, $frozen_expiry, $frozen_revision
)
ON CONFLICT (payment_intent_id) DO NOTHING;

-- + operation record + outbox row
COMMIT;
```

### 6.5 Bind Purchase / PaymentIntent

Handled within the freeze transaction (Section 6.4). The
`reservation_payment_bindings` table enforces uniqueness on
`payment_intent_id` and `purchase_id` at the database level. A duplicate
bind attempt is rejected by the unique constraint, not by application logic.

### 6.6 Capture / Finalize

```sql
BEGIN;
-- Phase 2 finalization: verify frozen tuple, then finalize
UPDATE reservation_authority
SET version = version + 1,
    lifecycle_state = 'sold',
    reservation_token = NULL,
    buyer_user_id = NULL,
    reservation_expires_at = NULL,
    reservation_revision = $new_revision,
    current_operation_id = $op_id,
    last_operation_type = 'finalize',
    last_operation_at = now(),
    last_operation_payload_hash = $hash,
    updated_at = now()
WHERE listing_id = $listing_id
  AND version = $expected_version
  AND lifecycle_state = 'frozen'
  AND reservation_revision = $frozen_revision
RETURNING version;

-- Mark binding as finalized
UPDATE reservation_payment_bindings
SET capture_state = 'finalized', freeze_finalized_at = now(), updated_at = now()
WHERE purchase_id = $purchase_id
  AND capture_state IN ('authorized','captured');

-- + operation record + outbox row (mirror_project + point_award + notification_dispatch)
COMMIT;
```

### 6.7 Abort

```sql
BEGIN;
-- CAS: frozen → available (release reservation after payment abort)
UPDATE reservation_authority
SET version = version + 1,
    lifecycle_state = 'available',
    buyer_user_id = NULL,
    reservation_token = NULL,
    reservation_expires_at = NULL,
    reservation_revision = $new_revision,
    current_operation_id = $op_id,
    last_operation_type = 'release',  -- abort = release from frozen
    last_operation_at = now(),
    last_operation_payload_hash = $hash,
    updated_at = now()
WHERE listing_id = $listing_id
  AND version = $expected_version
  AND lifecycle_state = 'frozen'
RETURNING version;

-- Mark binding as aborted
UPDATE reservation_payment_bindings
SET capture_state = 'aborted', updated_at = now()
WHERE purchase_id = $purchase_id;

-- + operation record + outbox row
COMMIT;
```

### 6.8 Cancel

```sql
BEGIN;
-- CAS: any reservable state → cancelled (seller-initiated)
UPDATE reservation_authority
SET version = version + 1,
    lifecycle_state = 'cancelled',
    buyer_user_id = NULL,
    reservation_token = NULL,
    reservation_expires_at = NULL,
    reservation_revision = $new_revision,
    seller_cancel_requested_at = now(),
    current_operation_id = $op_id,
    last_operation_type = 'cancel',
    last_operation_at = now(),
    last_operation_payload_hash = $hash,
    updated_at = now()
WHERE listing_id = $listing_id
  AND version = $expected_version
  AND lifecycle_state IN ('available','reserved','frozen')
  AND checkout_quarantined = false
RETURNING version;
-- + operation record + outbox row
COMMIT;
```

### 6.9 Quarantine

```sql
BEGIN;
-- CAS: set quarantine + recovery_blocked (only if not already quarantined)
UPDATE reservation_authority
SET version = version + 1,
    checkout_quarantined = true,
    checkout_quarantine_reason = $reason,
    checkout_quarantined_at = now(),
    recovery_blocked = true,
    recovery_blocked_reason = $reason,
    recovery_blocked_at = now(),
    reservation_revision = $new_revision,
    current_operation_id = $op_id,
    last_operation_type = 'quarantine',
    last_operation_at = now(),
    last_operation_payload_hash = $hash,
    updated_at = now()
WHERE listing_id = $listing_id
  AND version = $expected_version
  AND checkout_quarantined = false
RETURNING version;
-- + operation record + outbox row (mirror_project with hidden status)
COMMIT;
```

### 6.10 Account Deletion / Anonymization

```sql
BEGIN;
-- For each listing owned by the user:
--   If reservable: cancel (Section 6.8)
--   If reserved/frozen: block deletion, require manual resolution
--   If sold/cancelled/expired: anonymize buyer/seller fields
UPDATE reservation_authority
SET buyer_user_id = NULL,
    reservation_token = NULL,
    updated_at = now()
WHERE buyer_user_id = $user_id
  AND lifecycle_state IN ('sold','cancelled','expired');

-- Anonymize operation ledger references (retain for audit)
UPDATE reservation_operations
SET result_json = anonymize_result(result_json)
WHERE listing_id IN (SELECT listing_id FROM reservation_authority WHERE ...);
-- + operation record + outbox row
COMMIT;
```

---

## 7. Mirror Ownership

### 7.1 Authority Decides, Mirrors Reflect

1. **Postgres authority decides reservation availability.** Every
   reservation transition (reserve, release, freeze, finalize, cancel,
   expire, quarantine) is committed in a Postgres transaction. The
   authority is the sole source of truth for who holds a reservation.

2. **Base44 `Listing` and `ListingPrivate` never decide reservation
   winners.** No Base44 entity write may transition reservation state.
   The `reservation_token`, `reserved_by_email`, `reservation_expires_at`,
   `reservation_revision`, `reservation_version`, and
   `reservation_mirror_state` fields on `Listing` and `ListingPrivate`
   are mirror projections, not authoritative values.

3. **Base44 mirrors cannot mutate authority state.** Mirror updates
   flow exclusively from the outbox. No Base44 function, automation, or
   frontend call writes to the Postgres authority. The authority is
   read-only from Base44's perspective except via the authority API.

4. **Mirror projection is monotonic by committed version.** A mirror
   update with `reservation_version = N` is applied via CAS on the
   mirror's current `reservation_version`. A delayed outbox event with
   version `N` is rejected if the mirror already has version `> N`. This
   prevents stale mirror events from overwriting newer projections.

5. **Delayed or stale mirror updates are rejected.** The outbox consumer
   applies mirror updates using `updateMany` with a CAS predicate on
   `reservation_version`. If the mirror's version is already `>=` the
   outbox event's `committed_version`, the update returns `updated: 0`
   and the event is marked delivered (idempotent no-op).

6. **Mirror failure never rolls back the committed authority transition.**
   The authority transaction commits independently of mirror delivery.
   If the mirror is unavailable, the outbox row remains `pending` and is
   retried. The authority's committed state is never rolled back due to
   mirror failure.

7. **Outbox/reconciliation repairs mirrors.** A periodic outbox sweeper
   reads undelivered outbox rows and applies them to Base44 mirrors. If a
   mirror diverges (e.g., due to a missed delivery), a full reconciliation
   job reads the authority's current state for all listings and repairs
   every mirror row to match.

8. **Public reads fail closed when authority/mirror freshness cannot be
   established.** If the mirror's `reservation_version` is behind the
   authority's `version` by more than a configurable threshold (e.g., the
   outbox lag exceeds 30 seconds), public reads of the listing's
   reservation status return `unknown` or `stale` rather than a
   potentially-wrong `available`. The marketplace shows "reservation
   status being verified" rather than allowing a checkout against stale
   state.

### 7.2 Field Ownership After Cutover

#### Fields that REMAIN on Base44 `Listing` (business/publication state)

| Field | Owner | Notes |
|-------|-------|-------|
| `event_id`, `seller_email`, `section`, `row`, `seats`, `quantity` | Business | Static listing metadata |
| `tier`, `asking_price`, `original_price` | Business | Pricing |
| `transfer_method`, `listing_mode`, `listing_type` | Business | Listing configuration |
| `status`, `hidden_reason` | Business | Publication state (active/hidden/sold). NOT reservation state. |
| `proof_url`, `proof_status`, `ticket_file_url` | Business | Proof of ownership |
| `transfer_status`, `transfer_confidence_score` | Business | Transfer intelligence |
| `is_demo_listing` | Business | Demo flag |

#### Fields that MUST NO LONGER be authoritative on Base44 `Listing`

| Field | Why | New owner |
|-------|-----|-----------|
| `reservation_token` | Reservation state | Postgres authority |
| `reserved_by_email` | Reservation state | Postgres authority |
| `reservation_expires_at` | Reservation state | Postgres authority |
| `reservation_revision` | Reservation state | Postgres authority |
| `reservation_version` | Reservation state | Postgres authority (mirror only) |
| `reservation_mirror_state` | Reservation state | Postgres authority (mirror only) |

These fields remain on `Listing` as **mirror projections** (updated by the
outbox consumer) but are no longer authoritative. No Base44 function may
write to them directly. The listing-status-ownership test registry is
updated to reflect that only the outbox consumer writes these fields.

#### Fields that REMAIN on Base44 `ListingPrivate` (private business data)

| Field | Owner | Notes |
|-------|-------|-------|
| `seller_email`, `section`, `row`, `seats`, `quantity` | Business | Private listing metadata |
| `proof_url`, `proof_status`, `ticket_file_url` | Business | Private proof data |
| `current_proof_asset_id` | Business | Proof asset reference |
| `is_demo_listing`, `notes` | Business | Demo/notes |

#### Fields that MUST NO LONGER be authoritative on Base44 `ListingPrivate`

| Field | Why | New owner |
|-------|-----|-----------|
| `reservation_token` | Reservation state | Postgres authority |
| `reservation_expires_at` | Reservation state | Postgres authority |
| `reserved_by_email` | Reservation state | Postgres authority |
| `reservation_revision` | Reservation state | Postgres authority |
| `reservation_version` | Reservation state | Postgres authority |
| `reservation_lifecycle_state` | Reservation state | Postgres authority |
| `last_operation_id`, `last_operation_type`, `last_operation_payload_hash` | Operation ledger | Postgres `reservation_operations` |
| `last_operation_result_json`, `last_operation_at` | Operation ledger | Postgres `reservation_operations` |
| `pending_effects_json`, `pending_effects_hash` | Outbox | Postgres `reservation_outbox` |
| `checkout_quarantined` and related quarantine fields | Quarantine state | Postgres authority |
| `recovery_blocked` and related recovery fields | Recovery state | Postgres authority |
| `seller_cancel_requested_at`, `seller_pause_requested_at` | Seller intent | Postgres authority |

These fields remain on `ListingPrivate` as mirror projections or are
removed entirely after cutover (the authority table is the source of
truth). The `reservation_version` and `reservation_lifecycle_state`
fields remain as mirror projections for admin-read convenience.

---

## 8. Entry-Point Transition Map

All 11 production entry points are currently unintegrated
(`integrated: false` in `reservationMutationManifest.js`). After
cutover, each entry point delegates to the Postgres authority. No entry
point may independently update reservation tuple fields.

### 8.1 `reserveListing`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `reserve` (Section 6.1) |
| Expected version | Read from authority (not from Base44 mirror) |
| Operation-ID derivation | `reserve_{listing_id}_{buyer_user_id}_{nonce}` — deterministic per checkout attempt |
| Idempotent replay behavior | Same `operation_id` + same `request_hash` → return stored `result_json`; same `operation_id` + different `request_hash` → `OPERATION_ID_CONFLICT` |
| Transaction result | `{ ok: true, version: N, revision, token, expires_at }` or `{ ok: false, code: 'CONFLICT' }` |
| Base44 mirror/outbox effects | Outbox `mirror_project` event → update `Listing` + `ListingPrivate` reservation fields |
| Stripe interaction ordering | None — reserve is pre-payment |
| Compensation behavior | If authority unavailable → 503 fail-closed, no Base44 mutation |
| Fail-closed response | 503, no reservation created |

### 8.2 `releaseReservation`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `release` (Section 6.2) |
| Expected version | From authority |
| Operation-ID derivation | `release_{listing_id}_{operation_nonce}` |
| Idempotent replay | Same as reserve |
| Transaction result | `{ ok: true, version: N }` or conflict |
| Mirror/outbox effects | `mirror_project` → clear reservation fields on mirrors |
| Stripe ordering | None |
| Compensation | If authority unavailable → 503, reservation remains held until expiry |
| Fail-closed | 503 |

### 8.3 `createCheckout`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `reserve` (if not already reserved) or no-op (if already reserved by this buyer) |
| Expected version | From authority |
| Operation-ID | `checkout_{listing_id}_{buyer}_{checkout_nonce}` |
| Idempotent replay | Same operation_id → return stored result |
| Transaction result | Reservation token + expiry |
| Mirror/outbox | `mirror_project` |
| Stripe ordering | Reserve first, then create PaymentIntent (Stripe call is after authority commit) |
| Compensation | If Stripe fails after reserve → `release` operation (compensating transaction) |
| Fail-closed | 503, no Stripe call, no reservation |

### 8.4 `abortCheckout`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `release` from `reserved` or `abort` from `frozen` (Section 6.7) |
| Expected version | From authority |
| Operation-ID | `abort_{listing_id}_{checkout_nonce}` |
| Idempotent replay | Same operation_id → return stored result |
| Transaction result | Reservation released, binding marked `aborted` |
| Mirror/outbox | `mirror_project` → clear reservation fields |
| Stripe ordering | Cancel PaymentIntent first (if captured: refund), then abort authority |
| Compensation | If authority abort fails after Stripe cancel → retry authority abort; if authority unavailable → 503, Stripe already cancelled, outbox will reconcile |
| Fail-closed | 503 |

### 8.5 `cancelPurchase`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `cancel` (Section 6.8) or `release` if still reserved |
| Expected version | From authority |
| Operation-ID | `cancel_{listing_id}_{purchase_id}_{nonce}` |
| Idempotent replay | Same operation_id → return stored result |
| Transaction result | Listing cancelled or reservation released |
| Mirror/outbox | `mirror_project` + `notification_dispatch` (seller + buyer) + `point_award` (if applicable) |
| Stripe ordering | Refund PaymentIntent first (if captured), then cancel authority |
| Compensation | If authority cancel fails after Stripe refund → retry; if unavailable → 503, outbox reconciles |
| Fail-closed | 503 |

### 8.6 `processTransferReminders`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `expire` (Section 6.3) for stale reservations |
| Expected version | From authority |
| Operation-ID | `expire_{listing_id}_{scheduled_nonce}` |
| Idempotent replay | Same operation_id → return stored result |
| Transaction result | Expired reservations transitioned, reminders dispatched |
| Mirror/outbox | `mirror_project` + `notification_dispatch` (reminders) |
| Stripe ordering | None (reminders only); expiry may trigger release if payment not captured |
| Compensation | If authority unavailable → skip this cycle, retry next scheduled run |
| Fail-closed | Skip cycle (non-blocking — reminders are not real-time critical) |

### 8.7 `capturePayment`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `freeze` (Section 6.4) — Phase 1 of two-phase freeze-and-finalize |
| Expected version | From authority |
| Operation-ID | `freeze_{listing_id}_{payment_intent_id}` |
| Idempotent replay | Same operation_id → return stored frozen tuple |
| Transaction result | Frozen tuple + payment binding created |
| Mirror/outbox | `mirror_project` (frozen state) |
| Stripe ordering | Capture PaymentIntent first (Stripe API), then freeze authority. If freeze fails after capture → quarantine (Section 6.9) + AdminAlert |
| Compensation | If authority freeze fails after Stripe capture → quarantine + alert; manual resolution required |
| Fail-closed | 503, payment not captured (Stripe call is after authority availability check) |

### 8.8 `cleanupAbandonedCheckouts`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `expire` or `release` for abandoned reservations |
| Expected version | From authority |
| Operation-ID | `cleanup_{listing_id}_{abandonment_nonce}` |
| Idempotent replay | Same operation_id → return stored result |
| Transaction result | Abandoned reservations released |
| Mirror/outbox | `mirror_project` |
| Stripe ordering | Cancel stale PaymentIntents (Stripe API) before releasing authority |
| Compensation | If authority unavailable → skip, retry next cycle |
| Fail-closed | Skip cycle (non-blocking) |

### 8.9 `stripeWebhook`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `freeze` (payment_intent.succeeded → capture), `finalize` (Section 6.6), or `abort` (payment_intent.canceled) |
| Expected version | From authority |
| Operation-ID | `webhook_{event_id}_{listing_id}` — Stripe event ID is the idempotency key |
| Idempotent replay | Same Stripe event ID → return stored result (deduplicated by `operation_id` PRIMARY KEY) |
| Transaction result | Frozen → finalized (sold) or aborted |
| Mirror/outbox | `mirror_project` + `notification_dispatch` + `point_award` |
| Stripe ordering | Webhook is the Stripe event; authority operation is the response. Duplicate webhook delivery → same operation_id → idempotent replay |
| Compensation | If authority unavailable → 503 to Stripe (Stripe retries webhook). If authority commits but mirror fails → outbox reconciles. If finalize fails after capture → quarantine + alert |
| Fail-closed | 503 to Stripe (Stripe retries). Never ACK a webhook that the authority cannot process. |

### 8.10 `submitListing` / `manage_existing`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `initialize` (create authority row for new listing) or no-op (metadata update only) |
| Expected version | 0 for new listing; current version for metadata update |
| Operation-ID | `init_{listing_id}` for new; `update_meta_{listing_id}_{nonce}` for metadata |
| Idempotent replay | Same operation_id → return stored result |
| Transaction result | Authority row created (version=0, available) or metadata acknowledged |
| Mirror/outbox | `mirror_project` (if reservation-relevant metadata changed) |
| Stripe ordering | None |
| Compensation | If authority unavailable → 503, listing not created (or created in Base44 only with `pending_verification` — authority row created by reconciliation) |
| Fail-closed | 503 for authority init; Base44 listing creation may proceed but authority row must be backfilled before listing goes active |

### 8.11 `deleteAccount`

| Aspect | Specification |
|--------|---------------|
| Authority operation | `cancel` (for reservable listings) + `anonymize` (Section 6.10) |
| Expected version | From authority per listing |
| Operation-ID | `delete_account_{user_id}_{listing_id}_{nonce}` |
| Idempotent replay | Same operation_id → return stored result |
| Transaction result | User's reservable listings cancelled, sold/expired listings anonymized |
| Mirror/outbox | `mirror_project` + `notification_dispatch` (affected buyers) |
| Stripe ordering | Disconnect Stripe account, cancel pending payouts (Stripe API) before authority cancel |
| Compensation | If authority unavailable → 503, account not deleted. If some listings are frozen/reserved → block deletion, require manual resolution |
| Fail-closed | 503, no deletion, no anonymization |

---

## 9. Migration and Rollout Plan

**No dual-authoritative period is permitted.** The cutover is a one-time
switch. Before cutover, Base44 is authoritative and the authority is
shadow-only. After cutover, the authority is authoritative and Base44 is
mirror-only. There is no fallback to Base44-direct writes after cutover.

### Stage 1: Provision Isolated Development Authority

- Provision a development Postgres instance (Neon or equivalent).
- Create the schema (Sections 5.1-5.4).
- No production data, no production credentials.
- **Rollback**: Drop the development database. No production impact.

### Stage 2: Synthetic Transaction and Concurrency Tests

- Write and run synthetic tests against the development authority
  (Section 11).
- 100 concurrent different-operation attempts → exactly 1 winner.
- 100 same-operation retries → 1 commit, identical responses.
- All Section 11 tests pass.
- **Rollback**: Delete test data. No production impact.

### Stage 3: Build Injectable Authority Client

- Build a thin authority client (HTTP + HMAC signing) that Base44
  functions can call.
- The client is injectable (dependency injection) so tests can mock it.
- No production entry points are modified yet.
- **Rollback**: Remove the client. No production impact.

### Stage 4: Create Executable Entry-Wrapper Tests

- For each of the 11 entry points, write entry-wrapper behavioral tests
  that import the actual entry wrapper with injected authority
  dependencies.
- Tests verify the entry point delegates to the authority and does not
  write reservation fields directly.
- The launch gate integration portion turns GREEN when all entry-wrapper
  tests pass.
- **Rollback**: Remove the tests. No production impact.

### Stage 5: Backfill 34 Listings with Maintenance ON

- Run the authority initialization migration for all 34 listings.
- Create one authority row per listing (version=0, available or current
  state derived from Base44).
- Maintenance remains ON. No user traffic.
- **Rollback**: Delete authority rows. Base44 remains authoritative. No
  production impact (maintenance is ON, no user traffic).

### Stage 6: Verify One Authority Row Per Listing

- Query: `SELECT listing_id, COUNT(*) FROM reservation_authority GROUP BY listing_id HAVING COUNT(*) != 1`.
- Must return 0 rows.
- Verify authority state matches Base44 state for all 34 listings.
- **Rollback**: Drop authority table, re-run Stage 5. No production impact.

### Stage 7: Shadow-Read and Compare Base44 Against Authority

- Deploy the authority in shadow mode: all reservation operations
  continue to write to Base44 (Base44 remains authoritative).
- The authority receives shadow writes (same operations, same data) but
  its results are NOT used.
- A comparison job verifies authority state matches Base44 state after
  every operation.
- Monitor for divergence for a sustained period (e.g., 7 days).
- **Rollback**: Stop shadow writes. Base44 was always authoritative. No
  production impact.

### Stage 8: Integrate One Low-Risk Entry Point at a Time

- After shadow comparison shows zero divergence:
- Integrate entry points one at a time, lowest-risk first:
  1. `processTransferReminders` (read-only, non-blocking)
  2. `cleanupAbandonedCheckouts` (non-blocking)
  3. `releaseReservation` (simple release)
  4. `reserveListing` (core reserve)
  5. `createCheckout` (reserve + Stripe)
  6. `abortCheckout` (release + Stripe cancel)
  7. `cancelPurchase` (cancel + Stripe refund)
  8. `capturePayment` (freeze + Stripe capture)
  9. `stripeWebhook` (finalize/abort)
  10. `submitListing/manage_existing` (initialize)
  11. `deleteAccount` (cancel + anonymize)
- After each integration, run deterministic + live concurrency tests.
- **Rollback**: Revert the entry point to Base44-direct (before cutover
  only). After cutover, rollback requires manual reconciliation.

### Stage 9: Run Deterministic and Live Concurrency Tests

- For each integrated entry point, run:
  - 100 concurrent different-operation attempts → exactly 1 winner.
  - 100 same-operation retries → 1 commit, identical responses.
  - All Section 11 tests against the live authority.
- **Rollback**: Revert to Base44-direct (before cutover). After cutover,
  manual reconciliation.

### Stage 10: Reconcile Mirrors

- Run a full reconciliation job: read authority state for all listings,
  repair every Base44 mirror row to match.
- Verify zero divergence.
- **Rollback**: Re-run reconciliation. No production impact (mirror only).

### Stage 11: Complete Failure-Injection Testing

- Inject failures: authority timeout, connection loss, outbox worker
  crash, mirror outage.
- Verify fail-closed behavior: 503, no partial state, no double-spend.
- Verify outbox recovery: undelivered events are retried and delivered.
- Verify mirror recovery: stale mirrors are repaired.
- **Rollback**: Revert to Base44-direct (before cutover). After cutover,
  manual reconciliation.

### Stage 12: Obtain Rollback Evidence

- Document the rollback procedure for each stage.
- Verify rollback was tested at each stage.
- Obtain owner sign-off on rollback readiness.
- **Rollback**: Documented and tested.

### Stage 13: Consider Maintenance Removal

- Only after all 12 stages are complete:
- Owner approval to remove maintenance mode.
- Monitor closely for 48 hours.
- **Rollback**: Re-enable maintenance mode. If authority has committed
  operations that Base44 doesn't mirror, run reconciliation. No
  automatic fallback to Base44-direct (would create divergence).

---

## 10. Rollback Plan

| Stage | Rollback procedure | Production impact |
|-------|--------------------|-------------------|
| 1 (Provision) | Drop development database | None |
| 2 (Synthetic tests) | Delete test data | None |
| 3 (Authority client) | Remove client | None |
| 4 (Entry-wrapper tests) | Remove tests | None |
| 5 (Backfill) | Drop authority rows | None (maintenance ON) |
| 6 (Verify) | Drop authority table, re-run Stage 5 | None |
| 7 (Shadow-read) | Stop shadow writes | None (Base44 authoritative) |
| 8 (Integrate, pre-cutover) | Revert entry point to Base44-direct | None (Base44 authoritative) |
| 8 (Integrate, post-cutover) | Manual reconciliation | Requires reconciliation |
| 9 (Concurrency tests) | Revert to Base44-direct (pre-cutover) | None |
| 10 (Reconcile mirrors) | Re-run reconciliation | None (mirror only) |
| 11 (Failure injection) | Revert to Base44-direct (pre-cutover) | None |
| 12 (Rollback evidence) | Documented | None |
| 13 (Maintenance removal) | Re-enable maintenance + reconcile | Requires reconciliation |

**Critical rule**: After cutover (post-Stage 8), there is no automatic
fallback to Base44-direct writes. A fallback would create divergence
between the authority and the mirrors. If the authority fails after
cutover, the system fails-closed (503). Recovery requires reconciling
the authority's committed state to the mirrors, not reverting to
Base44-direct writes.

---

## 11. Required Certification Tests

Mocks alone are insufficient for final certification. Real isolated
Postgres transaction tests are required before production integration.

### 11.1 Concurrency Tests

| Test | Expected result |
|------|-----------------|
| 100 concurrent different-operation reservation attempts | Exactly 1 winner, 99 rejected |
| 100 same-operation retries (same operation_id + same request_hash) | 1 commit, 99 idempotent responses (identical result_json) |
| Stale-version rejection | `CONFLICT` (version mismatch) |
| Conflicting-payload same-operation rejection | `OPERATION_ID_CONFLICT` (same op_id, different hash) |
| Reserve vs. cancel (concurrent) | Exactly 1 winner, other rejected |
| Release vs. new reserve (concurrent) | Exactly 1 winner, other rejected |
| Expiration vs. checkout (concurrent) | Exactly 1 winner, other rejected |
| Capture vs. cancellation (concurrent) | Exactly 1 winner, other rejected |
| Duplicate webhook delivery (same Stripe event ID) | 1 commit, 1 idempotent replay, 0 duplicate financial effects |

### 11.2 Failure-Injection Tests

| Test | Expected result |
|------|-----------------|
| Database timeout before commit | Transaction rolls back, no partial state, 503 to caller |
| Connection loss after unknown commit result | Reconnect, query operation ledger by operation_id, return committed result or retry |
| Outbox replay (undelivered event) | Outbox sweeper delivers, mirror updated, idempotent (no double-apply) |
| Mirror outage and recovery | Authority continues accepting operations, outbox accumulates, mirror repaired on recovery |
| Stale mirror event rejection | Outbox event with version < mirror version → `updated: 0`, marked delivered |

### 11.3 Binding Uniqueness Tests

| Test | Expected result |
|------|-----------------|
| Unique PaymentIntent binding | Second bind with same PI → unique constraint violation, rejected |
| Unique Purchase binding | Second bind with same purchase_id → PRIMARY KEY violation, rejected |
| Quarantine/recovery block | Quarantined listing rejects all transitions, recovery_blocked prevents auto-recovery |
| Account deletion while reserved | Deletion blocked (reserved/frozen listings require manual resolution) |

### 11.4 Financial Integrity Tests

| Test | Expected result |
|------|-----------------|
| Zero duplicate financial effects | Duplicate webhook → 1 capture, 1 payout, 1 point award (idempotent) |
| Capture without freeze | Rejected (freeze is required before finalize) |
| Finalize without capture | Rejected (capture_state must be 'captured' before 'finalized') |
| Abort after capture | Requires refund (Stripe), then abort authority |

### 11.5 Certification Requirement

All Section 11 tests must pass against a **real isolated Postgres
instance** (not mocks). Mocks verify application logic; only real
Postgres transactions verify database-level atomicity, unique
constraints, and transaction rollback behavior. Certification is
blocked until real Postgres tests pass.

---

## 12. Operational Monitoring

### 12.1 Authority Health

| Metric | Alert threshold |
|--------|-----------------|
| Authority request latency (p99) | > 100ms |
| Authority error rate | > 1% |
| Authority availability | < 99.9% |
| Active reservations (reserved + frozen) | Trend monitor |
| Stale reservations (reserved > 15 min) | Alert — possible stuck reservation |
| Quarantined listings | Alert — requires manual resolution |

### 12.2 Outbox Health

| Metric | Alert threshold |
|--------|-----------------|
| Outbox lag (oldest undelivered event) | > 30 seconds |
| Outbox dead-letter count | > 0 |
| Outbox delivery failure rate | > 5% |
| Mirror divergence count (authority vs mirror) | > 0 |

### 12.3 Mirror Health

| Metric | Alert threshold |
|--------|-----------------|
| Mirror version lag (authority.version - mirror.version) | > 2 versions |
| Mirror reconciliation failures | > 0 |
| Public read fail-closed rate | Trend monitor (high rate indicates mirror lag) |

### 12.4 Financial Integrity

| Metric | Alert threshold |
|--------|-----------------|
| Duplicate PaymentIntent bindings | > 0 (unique constraint violation) |
| Captures without freeze | > 0 (should be impossible) |
| Finalizes without capture | > 0 (should be impossible) |
| Stripe webhook duplicate processing | > 0 (should be idempotent replay) |

---

## 13. Unresolved Blockers

| Blocker | Status | Resolution required before |
|---------|--------|-----------------------------|
| No written Base44 vendor guarantee | Unanswered | Architecture decision (this document resolves by selecting Postgres) |
| Concurrent AdminAlert uniqueness | Unresolved (no unique constraint) | Resolved by Postgres authority (unique constraints on operation_id, purchase_id, payment_intent_id) |
| Production entry points unintegrated | 11/11 unintegrated | Stage 8 (one at a time) |
| Existing records uninitialized | 34 listings need authority rows | Stage 5 (backfill) |
| Launch gate RED | 2 expected failures | Stage 4 (entry-wrapper tests) + Postgres integration |
| No real Postgres instance provisioned | Not provisioned | Stage 1 |
| No authority client built | Not built | Stage 3 |
| No entry-wrapper tests | None exist | Stage 4 |
| 7C.9D not started | Blocked | Not started (per instruction) |

---

## 14. Estimated Implementation Sequence

| Stage | Estimated duration | Dependency |
|-------|--------------------|------------|
| 1 (Provision dev authority) | 1 day | None |
| 2 (Synthetic tests) | 3 days | Stage 1 |
| 3 (Authority client) | 2 days | Stage 2 |
| 4 (Entry-wrapper tests) | 5 days | Stage 3 |
| 5 (Backfill 34 listings) | 1 day | Stages 2-4, maintenance ON |
| 6 (Verify 1:1) | 0.5 days | Stage 5 |
| 7 (Shadow-read, 7 days) | 7 days | Stage 6 |
| 8 (Integrate 11 entry points) | 5 days | Stage 7 |
| 9 (Concurrency tests per entry point) | 3 days | Stage 8 |
| 10 (Reconcile mirrors) | 1 day | Stage 9 |
| 11 (Failure injection) | 3 days | Stage 10 |
| 12 (Rollback evidence) | 1 day | Stage 11 |
| 13 (Maintenance removal) | 0.5 days + 48h monitor | Stage 12 + owner approval |

**Total estimated duration**: ~33 days (contiguous). With parallelism
where possible (Stages 3-4 can overlap with Stage 7 shadow-read),
approximately 25-30 days.

**December 17 feasibility**: Feasible if started immediately. The
critical path is Stage 7 (shadow-read, 7 days) + Stage 8 (integrate, 5
days) + Stage 9 (concurrency, 3 days) + Stage 11 (failure injection, 3
days) = 18 days minimum after Stages 1-6 (6 days). Total ~24 days
minimum. With buffer, 30 days. December 17 is ~18 weeks from the
August 10 decision date — ample time.

---

## 15. What This Document Does NOT Authorize

- **No infrastructure provisioning.** No Postgres instance is provisioned.
- **No production integration.** No entry point is modified.
- **No data migration.** No records are moved.
- **No provider contact.** No Stripe, email, push, points, or
  notification provider is contacted.
- **No maintenance change.** Maintenance remains ON.
- **No 7C.9D.** 7C.9D is not started.
- **No launch.** Readiness remains 94%, launch NO-GO, launch gate RED.

This document is an architecture decision and implementation plan. It
authorizes Stage 1 (provisioning a development authority) only after
explicit owner approval. All subsequent stages require explicit approval.

---

## 16. References

- `src/docs/ATOMIC_STRATEGY_BLOCKER.md` — empirical probe results, capability assessment
- `src/docs/EXTERNAL_RESERVATION_AUTHORITY_DESIGN.md` — prior design options (superseded by this document)
- `src/docs/RESERVATION_AUTHORITY_DECISION_MATRIX.md` — prior decision matrix (superseded by this document)
- `src/docs/VENDOR_GUARANTEE_QUESTION.md` — unanswered vendor question
- `base44/shared/reservationMutationManifest.js` — 11 unintegrated entry points
- `base44/shared/reservationAuthority.js` — current Base44 CAS prototype (empirical, not contractual)
- `base44/shared/reservationAuthorityMirror.js` — current mirror projection logic
- `base44/shared/reservationAuthorityConstants.js` — state transitions, validation, hashing
- `tests/reservation-authority-concurrency.test.mjs` — 59/59 PASS
- `tests/reservation-authority-adversarial.test.mjs` — 52/52 PASS
- `tests/launch-gate.test.mjs` — 12/14 PASS (2 expected failures)