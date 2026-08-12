# Atomicity Architecture Decision — 7C.9C.2F.1 (Corrected)

**Date**: 2026-08-10 (original), 2026-08-12 (corrected)
**Phase**: 1B — Architecture Decision Gate (Correction Round)
**Status**: DECISION MADE — implementation NOT started — corrections applied

---

## 1. Executive Summary

**Decision**: Transactional Postgres becomes the sole authoritative reservation
system for Peanut Gallery. Base44 `Listing` and `ListingPrivate` become
non-authoritative read models/mirrors.

**Rationale**: No written, authoritative Base44 response guarantees that
conditional `updateMany` predicates are atomically evaluated and updated per
record under concurrency. The Base44 single-row CAS prototype is empirically
successful (10/10 rounds, exactly 1 winner per round) but has no contractual
vendor guarantee. Per the decision rule, without an affirmative written
guarantee, the Base44 CAS prototype cannot be selected as the launch-grade
reservation authority for a real-money marketplace.

**This correction round (7C.9C.2F.1)**: The original document (7C.9C.2F) was
not implementation-ready. It contained contradictions in Stripe ordering,
payment state model, SQL transaction examples, database schema, account
deletion ordering, mirror delivery, and the entry-point map. This corrected
document resolves all 14 identified defects (see Section 20, Correction
Change Log).

**What this document is NOT**: This is not an implementation. No infrastructure
is provisioned. No production entry points are integrated. No records are
migrated. No provider is contacted. Maintenance remains ON. The launch gate
remains RED. 7C.9D is not started.

---

## 2. Selected Execution Topology

**Topology**: Base44 backend function → shared authority client → Neon
serverless HTTP driver → versioned Postgres stored functions.

This is the exact, single selected topology. No alternative runtime is left
undefined.

### 2.1 Runtime Path

1. **Frontend** calls a Base44 backend function via HTTP.
2. **Base44 backend function** (`base44/functions/*/entry.ts`) authenticates
   the user via Base44 auth, validates input, derives `operation_id` and
   `request_hash`, and calls the shared authority client.
3. **Shared authority client** (`base44/shared/authorityClient.js`) — a thin
   JS module imported by the backend function — reads the restricted database
   credential from `process.env.AUTHORITY_DB_URL` (a Base44 Secret), constructs
   a parameterized SQL query, and executes it via the Neon serverless HTTP
   driver.
4. **Neon serverless HTTP driver** (`@neondatabase/serverless`) sends the SQL
   query over HTTP to the Neon proxy, which routes it to the Postgres compute
   instance. No persistent connection pool is required in the serverless
   runtime.
5. **Versioned Postgres stored function** (schema `authority_v1`, e.g.
   `authority_v1.reserve_listing(...)`) executes as a single database
   transaction (`BEGIN ... COMMIT` inside the function body). All authority
   mutations occur inside stored functions — never via ad-hoc SQL from the
   client.
6. **Result** returns: stored function → Neon proxy → HTTP response →
   authority client → backend function → frontend.

### 2.2 Security Model

| Layer | Privilege | Notes |
|-------|-----------|-------|
| Base44 Secret `AUTHORITY_DB_URL` | Connection string with SSL, restricted role | Read only inside backend function handlers via `process.env` |
| DB role `authority_executor` | `CONNECT` on database, `USAGE` on schema `authority_v1`, `EXECUTE` on all functions in `authority_v1` | **No** direct table privileges — no `INSERT`, `UPDATE`, `DELETE`, or `SELECT` on `reservation_authority`, `reservation_operations`, `reservation_payment_bindings`, `payment_actions`, `stripe_webhook_events`, `operational_incidents`, or `reservation_outbox` |
| Stored functions | `SECURITY DEFINER`, owned by `authority_owner` role | The function executes with the owner's privileges, not the caller's. The caller can only invoke the function, not bypass it to access tables directly. |
| `search_path` | `authority_v1, pg_catalog` — set explicitly in every function definition | Prevents search_path hijacking attacks |
| Parameters | All values passed as parameterized `$1, $2, ...` — no string interpolation | Prevents SQL injection |
| Frontend | **No database credentials.** The frontend never receives `AUTHORITY_DB_URL`. | The frontend only sees the backend function's HTTP response. |

### 2.3 Why Not a Separate HTTP Authority Service

A separate HTTP authority service (e.g., a Node.js/Express API deployed to
Railway, Render, or Fly.io) would add:

- A **second runtime** to operate, monitor, and scale independently.
- A **second authentication boundary** (service-to-service auth between Base44
  functions and the authority service), requiring its own secret management
  and token rotation.
- A **second deployment pipeline** with its own CI/CD, rollback, and uptime
  targets.
- Additional **cold-start latency** (the service must boot before handling the
  first request).
- **No additional transactional guarantee** over direct stored-function calls
  — Postgres ACID is native to the stored function; the service would merely
  forward SQL to the same Postgres instance.

The Neon serverless HTTP driver provides the same ACID guarantees (Postgres
transactions) without a separate service. Stored functions encapsulate all
transaction logic in the database, where ACID is native. The authority client
is a thin shared module imported by backend functions, not a separately
deployed service. This topology minimizes operational surface area while
providing full Postgres transactional integrity.

**Rejected**: Separate HTTP authority service — additional runtime,
authentication boundary, deployment pipeline, and cold-start latency with no
additional transactional guarantee.

---

## 3. Evidence Reviewed

### 3.1 Base44 `updateMany` CAS Probe (2026-08-10)

| Probe | Concurrency | Rounds | Winners per round | Contractually guaranteed |
|-------|-------------|--------|-------------------|--------------------------|
| ListingPrivate single-authority CAS | 20-way | 10 | Exactly 1 | **No** |
| AdminAlert `$inc` CAS | 20-way | 1 | 1 | **No** |
| AdminAlert duplicate `incident_key` create | 2-way | 1 | 2 records (no unique constraint) | N/A |

**Finding**: Base44 `updateMany` with a filter predicate is empirically atomic
for single-record conditional updates. This is an observation, not a contract.

### 3.2 Vendor Guarantee Status

- **Question submitted**: See `src/docs/VENDOR_GUARANTEE_QUESTION.md`.
- **Written affirmative response received**: **No.**
- **Status**: Unanswered. Per the decision rule, absence of an affirmative
  written guarantee means the Base44 CAS prototype cannot be selected.

### 3.3 Known Limitations of Base44 Platform

| Capability | Available | Evidence |
|------------|-----------|----------|
| Single-record conditional update (CAS) | Empirically yes | 10/10 rounds, 1 winner |
| Multi-entity transaction | **No** | SDK exposes no transaction API |
| Unique create constraint | **No** | 2 concurrent creates → 2 records |
| Documented atomic CAS guarantee | **No** | No official documentation |
| Server-side stored procedure | **No** | No server-side SQL execution |

### 3.4 Current Test State (verified 2026-08-10)

| Suite | Result |
|-------|--------|
| authority-concurrency | 59/59 PASS |
| authority-adversarial | 52/52 PASS |
| round5-corrections | 39/39 PASS |
| round6-corrections | 37/37 PASS |
| round6b-corrections | 28/28 PASS |
| tuple-invariant-validation | 26/26 PASS |
| post-prefetch-concurrency | 13/13 PASS |
| launch-gate | 12/14 PASS (2 expected failures) |
| aggregate runner | 20 suites — 18 PASS, 2 expected FAIL |
| build | PASS |

---

## 4. Rejected Alternatives

### 4.1 Rejected: Base44 Single-Row CAS using `ListingPrivate`

**Reason rejected**: No written vendor guarantee. A silent platform update
could break CAS without warning, allowing double-spending in a real-money
marketplace. Empirical success does not override the decision rule's
requirement for a contractual guarantee.

### 4.2 Rejected: Cloudflare Durable Object / Serialized Per-Listing Authority

**Reason rejected**: Cross-listing query capability is required for admin
dashboards and reconciliation. Durable Objects cannot perform cross-DO SQL
queries; each DO is isolated. Postgres provides native cross-listing SQL with
full ACID guarantees in a single well-understood system, with lower
operational complexity and lower vendor lock-in.

### 4.3 Rejected: Separate HTTP Authority Service

**Reason rejected**: See Section 2.3. A separate service adds a second runtime,
authentication boundary, deployment pipeline, and cold-start latency with no
additional transactional guarantee over direct stored-function calls via the
Neon HTTP driver.

---

## 5. Complete Data Model

### 5.1 `reservation_authority` — Authoritative Reservation State

```sql
CREATE SCHEMA IF NOT EXISTS authority_v1;

CREATE TABLE authority_v1.reservation_authority (
  listing_id              TEXT        PRIMARY KEY,
  version                 INTEGER     NOT NULL DEFAULT 0,
  lifecycle_state         TEXT        NOT NULL DEFAULT 'available'
    CHECK (lifecycle_state IN ('available','reserved','frozen','sold','cancelled','expired')),
  seller_user_id          TEXT        NOT NULL,  -- authoritative seller ownership (FK to Base44 User)
  buyer_user_id           TEXT,                  -- immutable authoritative buyer identity (NULL when available)
  reservation_token_hash   TEXT,                 -- SHA-256 hash of reservation token (never plaintext)
  reservation_expires_at   TIMESTAMPTZ,
  reservation_revision     TEXT,                 -- monotonic revision UUID
  checkout_quarantined     BOOLEAN     NOT NULL DEFAULT false,
  checkout_quarantine_reason    TEXT,
  checkout_quarantined_at       TIMESTAMPTZ,
  recovery_blocked        BOOLEAN     NOT NULL DEFAULT false,
  recovery_blocked_reason       TEXT,
  recovery_blocked_at          TIMESTAMPTZ,
  recovery_not_before    TIMESTAMPTZ,
  seller_cancel_requested_at   TIMESTAMPTZ,
  seller_pause_requested_at    TIMESTAMPTZ,
  current_operation_id    TEXT,
  last_operation_type     TEXT,
  last_operation_at       TIMESTAMPTZ,
  last_operation_payload_hash TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quarantine/recovery invariants
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT quarantine_reason_required
  CHECK (NOT checkout_quarantined OR checkout_quarantine_reason IS NOT NULL);

ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT recovery_block_reason_required
  CHECK (NOT recovery_blocked OR recovery_blocked_reason IS NOT NULL);

-- Lifecycle/payment compatibility: frozen requires a buyer and token hash
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT frozen_requires_buyer
  CHECK (lifecycle_state <> 'frozen' OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL));

-- Reserved requires a buyer and token hash and expiry
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT reserved_requires_tuple
  CHECK (lifecycle_state <> 'reserved' OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL AND reservation_expires_at IS NOT NULL));

-- Terminal states (sold/cancelled/expired) must have cleared tuple
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT terminal_states_clear_tuple
  CHECK (lifecycle_state NOT IN ('sold','cancelled','expired') OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL AND reservation_expires_at IS NULL));

-- Index for scheduled recovery: find stale reservations
CREATE INDEX idx_authority_stale_reserved ON authority_v1.reservation_authority (reservation_expires_at)
  WHERE lifecycle_state = 'reserved' AND checkout_quarantined = false;

-- Index for account deletion obligation check
CREATE INDEX idx_authority_seller ON authority_v1.reservation_authority (seller_user_id);
CREATE INDEX idx_authority_buyer ON authority_v1.reservation_authority (buyer_user_id)
  WHERE buyer_user_id IS NOT NULL;
```

**Correction**: Added `seller_user_id` (authoritative ownership for account
deletion and seller operations). Replaced `reservation_token` (plaintext) with
`reservation_token_hash` (SHA-256). Added lifecycle/payment compatibility
CHECK constraints. Added indexes for scheduled recovery and account deletion.

### 5.2 `reservation_operations` — Operation Ledger

```sql
CREATE TABLE authority_v1.reservation_operations (
  operation_id          TEXT        PRIMARY KEY,   -- unique, client-supplied
  listing_id            TEXT        NOT NULL REFERENCES authority_v1.reservation_authority(listing_id),
  operation_type        TEXT        NOT NULL
    CHECK (operation_type IN ('reserve','release','freeze','begin_capture','record_capture','finalize','begin_cancel','record_cancel','begin_refund','record_refund','abort','cancel','expire','initialize','quarantine','anonymize')),
  requested_state       TEXT        NOT NULL,
  expected_version      INTEGER     NOT NULL,
  committed_version    INTEGER,
  request_hash          TEXT        NOT NULL,      -- SHA-256 of full semantic envelope
  result_json           TEXT,                      -- deterministic JSON response
  status                TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','committed','rejected','conflict','idempotent_replay')),
  error_code            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at          TIMESTAMPTZ
);

CREATE INDEX idx_ops_listing ON authority_v1.reservation_operations (listing_id, created_at DESC);
CREATE INDEX idx_ops_pending ON authority_v1.reservation_operations (status) WHERE status = 'pending';
```

**Correction**: The stored function acquires the unique `operation_id` BEFORE
modifying authority. No authority CAS may run when this request did not
acquire or validly replay the operation. See Section 7 for the acquisition
pattern.

### 5.3 `reservation_payment_bindings` — Payment Binding with Expanded States

```sql
CREATE TABLE authority_v1.reservation_payment_bindings (
  purchase_id           TEXT        PRIMARY KEY,   -- unique Purchase ID
  payment_intent_id     TEXT        UNIQUE,        -- unique Stripe PaymentIntent ID
  listing_id            TEXT        NOT NULL REFERENCES authority_v1.reservation_authority(listing_id),
  buyer_user_id         TEXT        NOT NULL,
  authority_version     INTEGER     NOT NULL,      -- version at bind time
  capture_state         TEXT        NOT NULL DEFAULT 'authorized'
    CHECK (capture_state IN (
      'authorized','capture_requested','capture_unknown','captured','finalized',
      'cancel_requested','canceled','refund_requested','refund_unknown','refunded',
      'aborted','failed'
    )),
  frozen_reservation_token_hash  TEXT,   -- immutable freeze snapshot
  frozen_buyer_user_id           TEXT,
  frozen_reservation_expires_at  TIMESTAMPTZ,
  frozen_reservation_revision   TEXT,
  freeze_finalized_at    TIMESTAMPTZ,
  finalization_started_at TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active binding per listing at a time (authorized, capture_requested, capture_unknown, captured)
CREATE UNIQUE INDEX idx_one_active_binding_per_listing
  ON authority_v1.reservation_payment_bindings (listing_id)
  WHERE capture_state IN ('authorized','capture_requested','capture_unknown','captured');

-- Finalized requires prior captured (enforced by stored function, not just CHECK)
-- Aborted cannot overwrite captured without confirmed refund (enforced by stored function)
```

**Correction**: Expanded `capture_state` from 5 to 12 states. Added
`buyer_user_id` for binding identity verification. Added
`frozen_reservation_token_hash` (hash, not plaintext). Partial unique index
now covers all in-flight states.

### 5.4 `payment_actions` — Durable Stripe Command Log (NEW)

```sql
CREATE TABLE authority_v1.payment_actions (
  action_id             TEXT        PRIMARY KEY,   -- unique internal action ID
  listing_id            TEXT        NOT NULL REFERENCES authority_v1.reservation_authority(listing_id),
  purchase_id           TEXT        NOT NULL,
  payment_intent_id     TEXT        NOT NULL,
  action_type           TEXT        NOT NULL
    CHECK (action_type IN ('capture','cancel','refund')),
  stripe_idempotency_key TEXT        NOT NULL,      -- stable Stripe idempotency key
  status                TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_flight','succeeded','failed','unknown')),
  stripe_result_json    TEXT,
  stripe_error_code     TEXT,
  attempted_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every Stripe command has a unique stable idempotency key
CREATE UNIQUE INDEX idx_payment_actions_idem ON authority_v1.payment_actions (stripe_idempotency_key);

-- Index for reconciliation of unknown/pending actions
CREATE INDEX idx_payment_actions_pending ON authority_v1.payment_actions (status)
  WHERE status IN ('pending','in_flight','unknown');
CREATE INDEX idx_payment_actions_purchase ON authority_v1.payment_actions (purchase_id, action_type);
```

**Correction**: New table. Durable Stripe commands (capture, cancel, refund)
are persisted as saga steps with unique internal `action_id` and stable
Stripe idempotency key. No external Stripe request is part of a Postgres
transaction — each is a persisted saga step.

### 5.5 `stripe_webhook_events` — Webhook Deduplication (NEW)

```sql
CREATE TABLE authority_v1.stripe_webhook_events (
  webhook_event_id      TEXT        PRIMARY KEY,   -- unique Stripe event ID
  event_type            TEXT        NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at          TIMESTAMPTZ,
  processing_status     TEXT        NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','processing','processed','failed')),
  related_action_id     TEXT        REFERENCES authority_v1.payment_actions(action_id),
  related_operation_id  TEXT,
  raw_payload           JSONB,
  error_message         TEXT
);

CREATE INDEX idx_webhook_pending ON authority_v1.stripe_webhook_events (processing_status)
  WHERE processing_status IN ('pending','processing');
```

**Correction**: New table. Every Stripe webhook event ID is unique in Postgres
(PRIMARY KEY). Duplicate webhook delivery is deduplicated at the database
level, not by application logic.

### 5.6 `operational_incidents` — Authoritative Incident Records (NEW)

```sql
CREATE TABLE authority_v1.operational_incidents (
  incident_id           BIGSERIAL   PRIMARY KEY,
  incident_key          TEXT        UNIQUE NOT NULL,  -- unique incident deduplication key
  incident_type         TEXT        NOT NULL
    CHECK (incident_type IN (
      'verification_mismatch','mirror_corruption','capture_unknown','refund_unknown',
      'failed_transfer_after_payment','new_dispute','expired_verification',
      'low_confidence_listing','conflicting_community_reports',
      'transfer_disabled_active_listing','buyer_waiting_for_transfer',
      'seller_missed_deadline','seller_reliability_drop','admin_action_required'
    )),
  priority              TEXT        NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('critical','high','medium','low')),
  title                 TEXT        NOT NULL,
  description           TEXT,
  reference_id          TEXT,
  reference_type        TEXT,
  occurrence_count      INTEGER     NOT NULL DEFAULT 1,
  last_occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved              BOOLEAN     NOT NULL DEFAULT false,
  resolved_by           TEXT,
  resolved_at           TIMESTAMPTZ,
  resolution_notes      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidents_unresolved ON authority_v1.operational_incidents (priority, last_occurred_at)
  WHERE resolved = false;
```

**Correction**: New table. The authoritative incident itself has a unique
`incident_key` (UNIQUE constraint). This is the atomic uniqueness guarantee
that Base44 lacks — concurrent inserts of the same `incident_key` will fail
one of them at the database level. Base44 `AdminAlert` becomes a
non-authoritative incident projection mirror, updated via the outbox. The
concurrent AdminAlert uniqueness blocker is NOT solved merely by unique
operation, Purchase, and PaymentIntent IDs — it is solved by the unique
`incident_key` constraint on this authoritative table.

### 5.7 `reservation_outbox` — Transactional Outbox with Leasing

```sql
CREATE TABLE authority_v1.reservation_outbox (
  outbox_id           BIGSERIAL   PRIMARY KEY,
  event_id            TEXT        UNIQUE,         -- unique effect/event ID
  operation_id        TEXT        NOT NULL REFERENCES authority_v1.reservation_operations(operation_id),
  listing_id          TEXT        NOT NULL,
  committed_version   INTEGER     NOT NULL,
  effect_type         TEXT        NOT NULL
    CHECK (effect_type IN ('mirror_project','notification_dispatch','point_award','email_send','push_send','inventory_sync','incident_create')),
  payload             JSONB       NOT NULL,
  delivery_status     TEXT        NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','in_flight','delivered','dead_letter')),
  attempt_count       INTEGER     NOT NULL DEFAULT 0,
  max_attempts        INTEGER     NOT NULL DEFAULT 10,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error          TEXT,
  delivered_at        TIMESTAMPTZ,
  -- Leasing fields for worker claiming
  lease_owner         TEXT,
  lease_expires_at    TIMESTAMPTZ,
  claimed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_pending ON authority_v1.reservation_outbox (next_attempt_at)
  WHERE delivery_status IN ('pending','in_flight');
```

**Correction**: Added `lease_owner`, `lease_expires_at`, `claimed_at` for
worker leasing. Workers claim rows via `FOR UPDATE SKIP LOCKED` (see Section
7.10). Expired `in_flight` leases are recovered by the sweeper.

---

## 6. Payment State Machine

### 6.1 States (12)

| State | Description |
|------|-------------|
| `authorized` | PaymentIntent authorized, no capture attempted |
| `capture_requested` | `begin_capture` committed, Stripe capture call in flight |
| `capture_unknown` | Stripe capture returned timeout/unknown |
| `captured` | Stripe capture succeeded, recorded |
| `finalized` | Authority sold, financial outbox effects created |
| `cancel_requested` | Stripe PaymentIntent cancellation in flight |
| `canceled` | Stripe cancellation confirmed |
| `refund_requested` | Stripe refund in flight |
| `refund_unknown` | Stripe refund returned timeout/unknown |
| `refunded` | Stripe refund confirmed |
| `aborted` | Binding aborted, reservation released, no financial obligation |
| `failed` | Terminal failure (known Stripe failure) |

### 6.2 Allowed State Transitions

```
authorized ──begin_capture──→ capture_requested
authorized ──begin_cancel──→ cancel_requested

capture_requested ──record_capture(succeeded)──→ captured
capture_requested ──record_capture(unknown)──→ capture_unknown
capture_requested ──record_capture(failed)──→ failed

capture_unknown ──webhook/recon(succeeded)──→ captured
capture_unknown ──webhook/recon(failed)──→ canceled → aborted

captured ──finalize_sale──→ finalized
captured ──begin_refund──→ refund_requested

cancel_requested ──record_cancel(succeeded)──→ canceled
cancel_requested ──record_cancel(failed)──→ failed

refund_requested ──record_refund(succeeded)──→ refunded
refund_requested ──record_refund(unknown)──→ refund_unknown

refund_unknown ──webhook/recon(succeeded)──→ refunded

refunded ──abort_binding──→ aborted
failed ──abort_binding──→ aborted (if reservation can be released)
failed ──begin_cancel──→ cancel_requested (if PI still active)
canceled ──abort_binding──→ aborted
```

### 6.3 Required Invariants

1. **`finalized` requires prior `captured`**: The `finalize_sale` stored
   function rejects if the binding is not in `captured` state. `authorized`
   is never directly accepted for finalization.

2. **`aborted` cannot overwrite `captured` without a confirmed refund**: The
   `abort_binding` stored function rejects if the binding is `captured` or
   `finalized` unless a corresponding `refund` action with `status =
   'succeeded'` exists in `payment_actions`.

3. **`cancelled` authority state cannot silently discard a frozen or captured
   binding**: The `cancel_listing` stored function (simple seller cancel)
   rejects `lifecycle_state = 'frozen'`. Frozen/payment-in-flight states
   require the durable cancellation/refund saga.

4. **Unknown Stripe outcomes remain frozen and recovery-blocked**:
   `capture_unknown` and `refund_unknown` bindings keep the authority
   `frozen` with `recovery_blocked = true`. The listing is never released or
   sold while the Stripe result is unknown.

5. **Every Stripe command has a unique internal action ID and stable Stripe
   idempotency key**: `payment_actions.action_id` (PRIMARY KEY) and
   `payment_actions.stripe_idempotency_key` (UNIQUE).

6. **Every Stripe webhook event ID is unique in Postgres**:
   `stripe_webhook_events.webhook_event_id` (PRIMARY KEY).

---

## 7. Stored Function Transaction Boundaries

Every authority operation is a single Postgres stored function executing as
one `BEGIN ... COMMIT` transaction. Either all writes commit or all roll back.
No partial state. Base44 functions never contain independent transaction
logic — they call stored functions via the authority client.

### 7.1 Operation-ID Acquisition Pattern (applies to ALL stored functions)

The stored function acquires the unique `operation_id` BEFORE modifying
authority. No authority CAS may run when this request did not acquire or
validly replay the operation.

```sql
CREATE OR REPLACE FUNCTION authority_v1.acquire_operation(
  p_operation_id   TEXT,
  p_listing_id     TEXT,
  p_operation_type TEXT,
  p_requested_state TEXT,
  p_expected_version INTEGER,
  p_request_hash   TEXT
) RETURNS TABLE(acquired BOOLEAN, existing_status TEXT, existing_result JSONB, existing_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_existing reservation_operations%ROWTYPE;
BEGIN
  -- Attempt to insert. If operation_id exists, ON CONFLICT does nothing.
  INSERT INTO reservation_operations (operation_id, listing_id, operation_type, requested_state, expected_version, request_hash, status)
  VALUES (p_operation_id, p_listing_id, p_operation_type, p_requested_state, p_expected_version, p_request_hash, 'pending')
  ON CONFLICT (operation_id) DO NOTHING;

  -- Check if it already existed
  SELECT * INTO v_existing FROM reservation_operations WHERE operation_id = p_operation_id FOR UPDATE;

  IF v_existing.request_hash = p_request_hash AND v_existing.status = 'committed' THEN
    -- Deterministic replay: return stored result
    RETURN QUERY SELECT true, v_existing.status, v_existing.result_json::JSONB, v_existing.request_hash;
  ELSIF v_existing.request_hash != p_request_hash THEN
    -- Same operation_id, different request hash → conflict
    RAISE EXCEPTION 'OPERATION_ID_CONFLICT: same operation_id with different request_hash';
  ELSIF v_existing.status = 'pending' THEN
    -- Pending operation from another request → in-progress
    RETURN QUERY SELECT false, 'pending'::TEXT, NULL::JSONB, v_existing.request_hash;
  ELSE
    -- Newly acquired
    RETURN QUERY SELECT true, 'pending'::TEXT, NULL::JSONB, p_request_hash;
  END IF;
END;
$$;
```

**Rules**:
- Same `operation_id` + same `request_hash` + committed → deterministic replay
  (return stored `result_json`).
- Same `operation_id` + different `request_hash` → `OPERATION_ID_CONFLICT`
  (entire transaction rolls back).
- Pending operation from another request → return `IN_PROGRESS` (caller
  waits, retries, or returns deterministic in-progress status).
- No authority CAS may run when this request did not acquire or validly
  replay the operation.

### 7.2 `reserve_listing`

```sql
CREATE OR REPLACE FUNCTION authority_v1.reserve_listing(
  p_listing_id TEXT, p_expected_version INTEGER, p_buyer_user_id TEXT,
  p_token_hash TEXT, p_expires_at TIMESTAMPTZ,
  p_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_replay JSONB; v_new_version INTEGER; v_revision TEXT;
BEGIN
  -- Step 1: Acquire operation_id
  SELECT * INTO v_acquired, _, v_replay, _ FROM acquire_operation(
    p_operation_id, p_listing_id, 'reserve', 'reserved', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;  -- idempotent replay
  IF NOT v_acquired THEN RAISE EXCEPTION 'IN_PROGRESS'; END IF;

  -- Step 2: CAS — exactly one winner
  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'reserved',
      buyer_user_id = p_buyer_user_id, reservation_token_hash = p_token_hash,
      reservation_expires_at = p_expires_at, reservation_revision = v_revision,
      current_operation_id = p_operation_id, last_operation_type = 'reserve',
      last_operation_at = now(), last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'available' AND checkout_quarantined = false AND recovery_blocked = false
  RETURNING version, reservation_revision INTO v_new_version, v_revision;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT' WHERE operation_id = p_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  -- Step 3: Record result + outbox
  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision),
    committed_at = now() WHERE operation_id = p_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'reserved', 'token_hash', p_token_hash));

  RETURN jsonb_build_object('ok', true, 'version', v_new_version, 'revision', v_revision);
END;
$$;
```

### 7.3 `release_listing`

CAS: `reserved → available`, clears tuple. Acquires operation_id first.
Legal starting state: `reserved`.

### 7.4 `expire_listing`

CAS: `reserved → expired` (when `reservation_expires_at < now()`), clears
tuple. Acquires operation_id first. Legal starting state: `reserved` (expired).

### 7.5 `begin_capture` — Durable Saga Step 1 (Corrected)

```sql
CREATE OR REPLACE FUNCTION authority_v1.begin_capture(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_buyer_user_id TEXT, p_expected_revision TEXT,
  p_action_id TEXT, p_stripe_idem_key TEXT,
  p_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_acquired BOOLEAN; v_replay JSONB; v_new_version INTEGER; v_revision TEXT;
  v_frozen_token_hash TEXT; v_frozen_expires TIMESTAMPTZ;
  v_existing_binding reservation_payment_bindings%ROWTYPE;
BEGIN
  -- Step 1: Acquire operation_id
  SELECT * INTO v_acquired, _, v_replay, _ FROM acquire_operation(
    p_operation_id, p_listing_id, 'begin_capture', 'frozen', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT v_acquired THEN RAISE EXCEPTION 'IN_PROGRESS'; END IF;

  -- Step 2: CAS — reserved → frozen (verify exact buyer + revision)
  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'frozen', reservation_revision = v_revision,
      current_operation_id = p_operation_id, last_operation_type = 'begin_capture',
      last_operation_at = now(), last_operation_payload_hash = p_request_hash, updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'reserved' AND buyer_user_id = p_buyer_user_id
    AND reservation_revision = p_expected_revision
  RETURNING version, reservation_token_hash, reservation_expires_at
  INTO v_new_version, v_frozen_token_hash, v_frozen_expires;

  IF NOT FOUND THEN
    UPDATE reservation_operations SET status = 'conflict', error_code = 'CONFLICT' WHERE operation_id = p_operation_id;
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
  END IF;

  -- Step 3: Binding — prove exactly one matching binding, or create it
  -- NO unconditional ON CONFLICT DO NOTHING
  SELECT * INTO v_existing_binding FROM reservation_payment_bindings
  WHERE payment_intent_id = p_payment_intent_id FOR UPDATE;

  IF FOUND THEN
    -- Existing binding: verify ALL fields match (idempotent replay) or conflict
    IF v_existing_binding.purchase_id = p_purchase_id
       AND v_existing_binding.listing_id = p_listing_id
       AND v_existing_binding.buyer_user_id = p_buyer_user_id
       AND v_existing_binding.authority_version = v_new_version
       AND v_existing_binding.frozen_reservation_revision = v_revision THEN
      -- Exact same idempotent binding → return stored result
      UPDATE reservation_operations SET status = 'idempotent_replay',
        result_json = jsonb_build_object('ok', true, 'frozen', true, 'action_id', p_action_id),
        committed_at = now() WHERE operation_id = p_operation_id;
      RETURN jsonb_build_object('ok', true, 'frozen', true, 'action_id', p_action_id, 'idempotent', true);
    ELSE
      -- Mismatch → PAYMENT_BINDING_CONFLICT — roll back entire transaction
      RAISE EXCEPTION 'PAYMENT_BINDING_CONFLICT: payment_intent_id already bound to different purchase/buyer';
    END IF;
  ELSE
    -- No existing binding → insert (unique constraint on payment_intent_id prevents duplicates)
    INSERT INTO reservation_payment_bindings (
      purchase_id, payment_intent_id, listing_id, buyer_user_id, authority_version,
      capture_state, frozen_reservation_token_hash, frozen_buyer_user_id,
      frozen_reservation_expires_at, frozen_reservation_revision
    ) VALUES (
      p_purchase_id, p_payment_intent_id, p_listing_id, p_buyer_user_id, v_new_version,
      'capture_requested', v_frozen_token_hash, p_buyer_user_id, v_frozen_expires, v_revision
    );
  END IF;

  -- Step 4: Create payment_action (durable saga record)
  INSERT INTO payment_actions (action_id, listing_id, purchase_id, payment_intent_id,
    action_type, stripe_idempotency_key, status)
  VALUES (p_action_id, p_listing_id, p_purchase_id, p_payment_intent_id,
    'capture', p_stripe_idem_key, 'pending');

  -- Step 5: Record result + outbox
  UPDATE reservation_operations SET status = 'committed', committed_version = v_new_version,
    result_json = jsonb_build_object('ok', true, 'frozen', true, 'action_id', p_action_id,
      'idempotency_key', p_stripe_idem_key, 'version', v_new_version, 'revision', v_revision),
    committed_at = now() WHERE operation_id = p_operation_id;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'frozen'));

  RETURN jsonb_build_object('ok', true, 'frozen', true, 'action_id', p_action_id,
    'idempotency_key', p_stripe_idem_key, 'version', v_new_version, 'revision', v_revision);
END;
$$;
```

**Corrections**:
- Removed the unconditional binding-conflict suppression that silently ignored
  duplicate PaymentIntent bindings.
- A conflicting PaymentIntent or Purchase binding must either be proven to be
  the exact same idempotent binding (all fields match → return stored result)
  or fail the entire transaction with `PAYMENT_BINDING_CONFLICT`.
- The authority never commits `frozen` without confirming exactly one matching
  binding exists.
- Never captures a PaymentIntent unless the authority is already frozen for
  that exact buyer, Purchase, PaymentIntent, version, and reservation revision.

### 7.6 `record_capture_result` — Durable Saga Step 3

```sql
CREATE OR REPLACE FUNCTION authority_v1.record_capture_result(
  p_action_id TEXT, p_stripe_result TEXT, p_stripe_response JSONB,
  p_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_action payment_actions%ROWTYPE; v_binding reservation_payment_bindings%ROWTYPE;
  v_new_version INTEGER; v_revision TEXT;
BEGIN
  -- Acquire operation_id
  SELECT * INTO v_acquired, _, v_replay, _ FROM acquire_operation(
    p_operation_id, v_action.listing_id, 'record_capture', '', 0, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- Lock the payment action
  SELECT * INTO v_action FROM payment_actions WHERE action_id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTION_NOT_FOUND'; END IF;

  -- Lock the binding
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = v_action.purchase_id FOR UPDATE;

  -- Update payment action with Stripe result
  UPDATE payment_actions SET status = p_stripe_result,
    stripe_result_json = p_stripe_response::TEXT, completed_at = now(), updated_at = now()
  WHERE action_id = p_action_id;

  IF p_stripe_result = 'succeeded' THEN
    -- Stripe succeeded → binding captured, then finalize
    UPDATE reservation_payment_bindings SET capture_state = 'captured', updated_at = now()
    WHERE purchase_id = v_action.purchase_id AND capture_state = 'capture_requested';

    -- Finalize: frozen → sold
    v_revision := gen_random_uuid()::TEXT;
    UPDATE reservation_authority
    SET version = version + 1, lifecycle_state = 'sold', buyer_user_id = NULL,
        reservation_token_hash = NULL, reservation_expires_at = NULL,
        reservation_revision = v_revision, current_operation_id = p_operation_id,
        last_operation_type = 'finalize', last_operation_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id AND lifecycle_state = 'frozen'
    RETURNING version INTO v_new_version;

    UPDATE reservation_payment_bindings SET capture_state = 'finalized',
      freeze_finalized_at = now(), updated_at = now() WHERE purchase_id = v_action.purchase_id;

    -- Outbox: mirror_project + notification_dispatch + point_award
    INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
    SELECT gen_random_uuid()::TEXT, p_operation_id, v_action.listing_id, v_new_version, effect_type, payload
    FROM (VALUES
      ('mirror_project', jsonb_build_object('version', v_new_version, 'state', 'sold')),
      ('notification_dispatch', jsonb_build_object('type', 'sale_completed')),
      ('point_award', jsonb_build_object('type', 'sale_completed'))
    ) AS t(effect_type, payload);

    RETURN jsonb_build_object('ok', true, 'captured', true, 'finalized', true, 'version', v_new_version);

  ELSIF p_stripe_result = 'failed' THEN
    -- Known failure → binding failed, release or abort per policy
    UPDATE reservation_payment_bindings SET capture_state = 'failed', updated_at = now()
    WHERE purchase_id = v_action.purchase_id;

    -- Release reservation (frozen → available)
    v_revision := gen_random_uuid()::TEXT;
    UPDATE reservation_authority
    SET version = version + 1, lifecycle_state = 'available', buyer_user_id = NULL,
        reservation_token_hash = NULL, reservation_expires_at = NULL, reservation_revision = v_revision,
        current_operation_id = p_operation_id, last_operation_type = 'record_capture', updated_at = now()
    WHERE listing_id = v_action.listing_id AND lifecycle_state = 'frozen'
    RETURNING version INTO v_new_version;

    UPDATE reservation_payment_bindings SET capture_state = 'aborted', updated_at = now()
    WHERE purchase_id = v_action.purchase_id;

    INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
    VALUES (gen_random_uuid()::TEXT, p_operation_id, v_action.listing_id, v_new_version, 'mirror_project',
      jsonb_build_object('version', v_new_version, 'state', 'available'));

    RETURN jsonb_build_object('ok', true, 'captured', false, 'failed', true, 'released', true);

  ELSE
    -- Unknown/timeout → capture_unknown, authority remains frozen, recovery_blocked
    UPDATE reservation_payment_bindings SET capture_state = 'capture_unknown', updated_at = now()
    WHERE purchase_id = v_action.purchase_id;

    UPDATE reservation_authority
    SET recovery_blocked = true, recovery_blocked_reason = 'capture_unknown',
        recovery_blocked_at = now(), updated_at = now()
    WHERE listing_id = v_action.listing_id;

    -- Create operational incident
    INSERT INTO operational_incidents (incident_key, incident_type, priority, title, description, reference_id, reference_type)
    VALUES ('capture_unknown:' || v_action.listing_id, 'capture_unknown', 'critical',
      'Capture Result Unknown', 'Stripe capture returned unknown result', v_action.listing_id, 'listing')
    ON CONFLICT (incident_key) DO UPDATE SET occurrence_count = operational_incidents.occurrence_count + 1,
      last_occurred_at = now();

    INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
    VALUES (gen_random_uuid()::TEXT, p_operation_id, v_action.listing_id, v_binding.authority_version, 'incident_create',
      jsonb_build_object('type', 'capture_unknown', 'listing_id', v_action.listing_id));

    RETURN jsonb_build_object('ok', true, 'capture_unknown', true, 'frozen', true, 'recovery_blocked', true);
  END IF;
END;
$$;
```

**Corrections**:
- `succeeded` → binding `captured`, authority `sold/finalized`, financial
  outbox effects created.
- Known failure/cancellation → binding updated and reservation safely released
  or aborted according to policy.
- Timeout/unknown → binding `capture_unknown`, authority remains `frozen`,
  `recovery_blocked = true`.
- Never releases or sells a listing while the Stripe result is unknown.

### 7.7 `finalize_sale` (Corrected)

```sql
CREATE OR REPLACE FUNCTION authority_v1.finalize_sale(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_payment_intent_id TEXT, p_buyer_user_id TEXT, p_frozen_revision TEXT,
  p_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_binding reservation_payment_bindings%ROWTYPE; v_new_version INTEGER; v_revision TEXT;
  v_updated_count INTEGER;
BEGIN
  -- Acquire operation_id
  SELECT * INTO v_acquired, _, v_replay, _ FROM acquire_operation(
    p_operation_id, p_listing_id, 'finalize', 'sold', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- Verify binding is CAPTURED and ALL fields match
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id
    AND payment_intent_id = p_payment_intent_id
    AND listing_id = p_listing_id
    AND buyer_user_id = p_buyer_user_id
    AND authority_version = p_expected_version
    AND frozen_reservation_revision = p_frozen_revision
    AND capture_state = 'captured'
  FOR UPDATE;

  -- If 0 rows: FINALIZE_REJECTED (binding not captured or mismatch)
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINALIZE_REJECTED: binding not captured or field mismatch';
  END IF;

  -- authorized is NEVER accepted for finalization (enforced by capture_state = 'captured' above)

  -- CAS: frozen → sold
  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'sold', buyer_user_id = NULL,
      reservation_token_hash = NULL, reservation_expires_at = NULL,
      reservation_revision = v_revision, current_operation_id = p_operation_id,
      last_operation_type = 'finalize', last_operation_at = now(), updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state = 'frozen' AND reservation_revision = p_frozen_revision
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN RAISE EXCEPTION 'CONFLICT'; END IF;

  -- Update binding: captured → finalized (exactly one row must update)
  UPDATE reservation_payment_bindings
  SET capture_state = 'finalized', freeze_finalized_at = now(), updated_at = now()
  WHERE purchase_id = p_purchase_id AND capture_state = 'captured';
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Zero or multiple affected rows → roll back
  IF v_updated_count != 1 THEN
    RAISE EXCEPTION 'FINALIZE_BINDING_COUNT: expected 1 row, got %', v_updated_count;
  END IF;

  -- Outbox
  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  SELECT gen_random_uuid()::TEXT, p_operation_id, p_listing_id, v_new_version, effect_type, payload
  FROM (VALUES
    ('mirror_project', jsonb_build_object('version', v_new_version, 'state', 'sold')),
    ('notification_dispatch', jsonb_build_object('type', 'sale_completed')),
    ('point_award', jsonb_build_object('type', 'sale_completed'))
  ) AS t(effect_type, payload);

  RETURN jsonb_build_object('ok', true, 'finalized', true, 'version', v_new_version);
END;
$$;
```

**Corrections**:
- Binding must already be `captured` (not `authorized`).
- Binding `purchase_id`, `payment_intent_id`, `listing_id`, `buyer_user_id`,
  `authority_version`, and `frozen_revision` all must match.
- Exactly one binding row must update (`ROW_COUNT = 1`).
- Zero or multiple affected rows → roll back the transaction.
- `authorized` is never directly accepted for finalization.

### 7.8 `abort_binding` (Corrected)

```sql
CREATE OR REPLACE FUNCTION authority_v1.abort_binding(
  p_listing_id TEXT, p_expected_version INTEGER, p_purchase_id TEXT,
  p_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
DECLARE
  v_binding reservation_payment_bindings%ROWTYPE; v_new_version INTEGER; v_revision TEXT;
  v_refund_exists BOOLEAN; v_updated_count INTEGER;
BEGIN
  -- Acquire operation_id
  SELECT * INTO v_acquired, _, v_replay, _ FROM acquire_operation(
    p_operation_id, p_listing_id, 'abort', 'available', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- Lock binding and check state
  SELECT * INTO v_binding FROM reservation_payment_bindings
  WHERE purchase_id = p_purchase_id FOR UPDATE;

  -- Allowed states for abort: authorized, cancel_requested, canceled, failed, refunded
  -- NOT allowed: captured, finalized (requires confirmed refund first)
  IF v_binding.capture_state IN ('captured','finalized') THEN
    -- Must have confirmed refund
    SELECT EXISTS(
      SELECT 1 FROM payment_actions
      WHERE listing_id = p_listing_id AND purchase_id = p_purchase_id
        AND action_type = 'refund' AND status = 'succeeded'
    ) INTO v_refund_exists;
    IF NOT v_refund_exists THEN
      RAISE EXCEPTION 'ABORT_REJECTED: binding is captured/finalized without confirmed refund';
    END IF;
  END IF;

  -- CAS: frozen → available (release reservation)
  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'available', buyer_user_id = NULL,
      reservation_token_hash = NULL, reservation_expires_at = NULL, reservation_revision = v_revision,
      current_operation_id = p_operation_id, last_operation_type = 'abort', updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version AND lifecycle_state = 'frozen'
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN RAISE EXCEPTION 'CONFLICT'; END IF;

  -- Update binding → aborted (require allowed state)
  UPDATE reservation_payment_bindings
  SET capture_state = 'aborted', updated_at = now()
  WHERE purchase_id = p_purchase_id
    AND capture_state IN ('authorized','cancel_requested','canceled','failed','refunded');
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count != 1 THEN RAISE EXCEPTION 'ABORT_BINDING_COUNT: expected 1, got %', v_updated_count; END IF;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'available'));

  RETURN jsonb_build_object('ok', true, 'aborted', true, 'version', v_new_version);
END;
$$;
```

**Corrections**:
- Abort requires an allowed binding state.
- Cannot rewrite `captured` or `finalized` to `aborted` without a confirmed
  Stripe cancellation/refund result (`payment_actions` with `action_type =
  'refund'` and `status = 'succeeded'`).

### 7.9 `cancel_listing` — Simple Seller Cancel (Corrected)

```sql
CREATE OR REPLACE FUNCTION authority_v1.cancel_listing(
  p_listing_id TEXT, p_expected_version INTEGER,
  p_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
DECLARE v_new_version INTEGER; v_revision TEXT;
BEGIN
  -- Acquire operation_id
  SELECT * INTO v_acquired, _, v_replay, _ FROM acquire_operation(
    p_operation_id, p_listing_id, 'cancel', 'cancelled', p_expected_version, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- CAS: available or reserved → cancelled
  -- frozen is NOT allowed (requires durable cancellation/refund saga)
  v_revision := gen_random_uuid()::TEXT;
  UPDATE reservation_authority
  SET version = version + 1, lifecycle_state = 'cancelled', buyer_user_id = NULL,
      reservation_token_hash = NULL, reservation_expires_at = NULL, reservation_revision = v_revision,
      seller_cancel_requested_at = now(), current_operation_id = p_operation_id,
      last_operation_type = 'cancel', updated_at = now()
  WHERE listing_id = p_listing_id AND version = p_expected_version
    AND lifecycle_state IN ('available','reserved') AND checkout_quarantined = false
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    -- Check if it was frozen
    IF EXISTS(SELECT 1 FROM reservation_authority WHERE listing_id = p_listing_id AND lifecycle_state = 'frozen') THEN
      RAISE EXCEPTION 'CANCEL_REJECTED_FROZEN: frozen listings require durable cancellation/refund saga';
    ELSE
      RAISE EXCEPTION 'CONFLICT';
    END IF;
  END IF;

  INSERT INTO reservation_outbox (event_id, operation_id, listing_id, committed_version, effect_type, payload)
  VALUES (gen_random_uuid()::TEXT, p_operation_id, p_listing_id, v_new_version, 'mirror_project',
    jsonb_build_object('version', v_new_version, 'state', 'cancelled'));

  RETURN jsonb_build_object('ok', true, 'cancelled', true, 'version', v_new_version);
END;
$$;
```

**Corrections**:
- Simple seller cancellation must not allow `lifecycle_state = 'frozen'`.
- Frozen/payment-in-flight states require the durable cancellation/refund saga
  (`begin_cancel` → Stripe cancel → `record_cancel_result` → `abort_binding`).

### 7.10 Outbox Worker Claiming — `FOR UPDATE SKIP LOCKED`

```sql
-- Worker claims a batch of pending/expired-lease outbox rows
CREATE OR REPLACE FUNCTION authority_v1.claim_outbox_batch(
  p_worker_id TEXT, p_batch_size INTEGER, p_lease_seconds INTEGER
) RETURNS SETOF reservation_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
BEGIN
  UPDATE reservation_outbox
  SET lease_owner = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::INTERVAL,
      claimed_at = now(),
      delivery_status = 'in_flight',
      attempt_count = attempt_count + 1
  WHERE outbox_id IN (
    SELECT outbox_id FROM reservation_outbox
    WHERE delivery_status IN ('pending','in_flight')
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
      AND next_attempt_at <= now()
    ORDER BY outbox_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING *;
END;
$$;

-- Recovery of expired in_flight leases
CREATE OR REPLACE FUNCTION authority_v1.recover_expired_leases()
 RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE reservation_outbox
  SET delivery_status = 'pending', lease_owner = NULL, lease_expires_at = NULL
  WHERE delivery_status = 'in_flight' AND lease_expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
```

**Corrections**: Workers claim via `FOR UPDATE SKIP LOCKED`. Expired
`in_flight` leases are recovered by `recover_expired_leases()`.

### 7.11 `begin_cancel`, `record_cancel_result`, `begin_refund`, `record_refund_result`

These follow the same durable saga pattern as `begin_capture` /
`record_capture_result`:

- `begin_cancel`: acquires operation_id, creates `payment_actions` row with
  `action_type = 'cancel'`, sets binding to `cancel_requested`, returns
  idempotency key.
- `record_cancel_result`: Stripe succeeded → binding `canceled`; failed →
  binding `failed`; unknown → binding remains `cancel_requested` (or
  `capture_unknown` if applicable), recovery_blocked.
- `begin_refund`: acquires operation_id, creates `payment_actions` row with
  `action_type = 'refund'`, sets binding to `refund_requested`, returns
  idempotency key.
- `record_refund_result`: Stripe succeeded → binding `refunded`; failed →
  binding `failed`; unknown → binding `refund_unknown`, recovery_blocked.

### 7.12 `quarantine_listing`, `initialize_listing`, `anonymize_user`

- `quarantine_listing`: CAS sets `checkout_quarantined = true`,
  `recovery_blocked = true`. Creates `operational_incidents` row with unique
  `incident_key`.
- `initialize_listing`: Creates `reservation_authority` row with `version =
  0`, `lifecycle_state = 'available'`, `seller_user_id` set.
- `anonymize_user`: See Section 10 (Account Deletion Ordering).

---

## 8. Durable Stripe Saga

### 8.1 Capture Flow (Durable Saga)

The capture flow is a **durable saga**, not a simple ordering. No external
Stripe request is part of a Postgres transaction.

**Step 1: `begin_capture` transaction** (Postgres stored function)
- Verifies the authoritative reservation is `reserved` for the exact buyer,
  Purchase, PaymentIntent, version, and reservation revision.
- Transitions authority to `frozen`.
- Records `capture_requested` on the binding.
- Creates a `payment_actions` row with `action_id`, `stripe_idempotency_key`,
  `status = 'pending'`.
- Commits a durable payment-action record.
- Returns deterministic replay data (frozen tuple, `action_id`, idempotency
  key).

**Step 2: Stripe capture call** (outside Postgres, in the backend function)
- Uses the stable Stripe idempotency key from Step 1.
- If the same `action_id` is retried, the same idempotency key is used →
  Stripe deduplicates.

**Step 3: `record_capture_result` transaction** (Postgres stored function)
- Stripe `succeeded` → binding `captured`, then `finalize_sale` transitions
  authority to `sold`, financial outbox effects created.
- Known capture failure/cancellation → binding `failed`, reservation safely
  released or aborted according to policy.
- Timeout or unknown result → binding `capture_unknown`, authority remains
  `frozen`, `recovery_blocked = true` until Stripe is queried or a webhook
  resolves it.

**Step 4: Webhook/reconciliation resolution**
- A Stripe webhook or reconciliation worker calls `record_capture_result`
  with the resolved Stripe result.
- Idempotent: same `action_id` + same result → deterministic replay.

**Rules**:
- Never release or sell a listing while the Stripe result is unknown
  (`capture_unknown` stays `frozen` + `recovery_blocked`).
- Never capture a PaymentIntent unless the authority is already frozen for
  that exact buyer, Purchase, PaymentIntent, version, and reservation
  revision (verified in `begin_capture`).

### 8.2 Same Pattern Applied to Other Stripe Commands

| Command | Saga steps |
|---------|-----------|
| PaymentIntent cancellation | `begin_cancel` → Stripe cancel → `record_cancel_result` |
| Refunds | `begin_refund` → Stripe refund → `record_refund_result` |
| Payout-affecting cancellation | `begin_refund` → Stripe refund → `record_refund_result` → `abort_binding` |
| Account deletion with unsettled obligations | `check_user_obligations` (block) → resolve → `anonymize_user` (see Section 10) |

No external Stripe request can be part of a Postgres transaction. Each is
modeled as a persisted saga with idempotent commands and reconciliation.

---

## 9. Mirror Ownership and Delivery Ordering

### 9.1 Authority Decides, Mirrors Reflect

1. **Postgres authority decides reservation availability.** Every reservation
   transition is committed in a Postgres stored function. The authority is
   the sole source of truth.

2. **Base44 `Listing` and `ListingPrivate` never decide reservation winners.**
   No Base44 entity write may transition reservation state. Reservation
   fields on `Listing` and `ListingPrivate` are mirror projections.

3. **Only the designated projection worker writes authority-owned mirror
   fields.** No Base44 function, automation, or frontend call writes to
   `reservation_token`, `reserved_by_email`, `reservation_expires_at`,
   `reservation_revision`, `reservation_version`, or
   `reservation_mirror_state` on Base44 entities. Only the outbox projection
   worker applies these updates.

4. **Events for each listing are processed in committed-version order.** The
   projection worker processes outbox events for a given listing in
   ascending `committed_version` order. It does not apply version N+1 before
   version N.

5. **Stale versions are rejected.** A mirror update with
   `reservation_version = N` is applied via CAS on the mirror's current
   `reservation_version`. If the mirror's version is already `>= N`, the
   update returns `updated: 0` and the event is marked delivered (idempotent
   no-op).

6. **Gaps trigger authoritative reconciliation.** If the projection worker
   detects a gap (e.g., mirror is at version 5, next event is version 7 —
   version 6 is missing), it triggers an authoritative reconciliation: reads
   the authority's current state for that listing and repairs the mirror to
   match.

7. **Retrying an unknown Base44 write result performs a read/compare before
   another write.** If the outbox worker receives an unknown result from a
   Base44 mirror update (e.g., network timeout), it reads the mirror's current
   state and compares it to the expected projection before attempting another
   write. This prevents duplicate or stale writes.

8. **Mirror lag never changes the Postgres winner.** The authority's
   committed state is final. Mirror lag only affects what the public reads,
   not what the authority decided.

9. **Checkout always consults Postgres.** A checkout attempt calls the
   authority (`reserve_listing` stored function) directly. It never relies
   on the Base44 mirror's reservation state to decide availability.

10. **Public availability is hidden or marked unavailable when required
    freshness cannot be established.** If the mirror's `reservation_version`
    is behind the authority's `version` by more than a configurable threshold
    (e.g., outbox lag exceeds 30 seconds), public reads of the listing's
    reservation status return `unknown` or `stale`. The marketplace shows
    "reservation status being verified" rather than allowing a checkout
    against stale state.

### 9.2 Field Ownership After Cutover

#### Fields that REMAIN on Base44 `Listing` (business/publication state)

| Field | Owner | Notes |
|-------|-------|-------|
| `event_id`, `seller_email`, `section`, `row`, `seats`, `quantity` | Business | Static listing metadata |
| `tier`, `asking_price`, `original_price` | Business | Pricing |
| `transfer_method`, `listing_mode`, `listing_type` | Business | Listing configuration |
| `status`, `hidden_reason` | Business | Publication state. NOT reservation state. |
| `proof_url`, `proof_status`, `ticket_file_url` | Business | Proof of ownership |
| `transfer_status`, `transfer_confidence_score` | Business | Transfer intelligence |
| `is_demo_listing` | Business | Demo flag |

#### Fields that become MIRROR PROJECTIONS on Base44 `Listing` (non-authoritative)

| Field | Authority owner | Notes |
|-------|-----------------|-------|
| `reservation_token` | Postgres `reservation_authority.reservation_token_hash` | Mirror stores hash, not plaintext |
| `reserved_by_email` | Postgres `reservation_authority.buyer_user_id` | Mirror projects buyer identity |
| `reservation_expires_at` | Postgres `reservation_authority.reservation_expires_at` | Mirror projection |
| `reservation_revision` | Postgres `reservation_authority.reservation_revision` | Mirror projection |
| `reservation_version` | Postgres `reservation_authority.version` | Mirror projection |
| `reservation_mirror_state` | Postgres `reservation_authority.lifecycle_state` | Mirror projection |

Only the designated projection worker writes these fields. No Base44
function may write to them directly.

#### Fields that become MIRROR PROJECTIONS on Base44 `ListingPrivate`

All reservation, operation-ledger, quarantine, recovery, and seller-intent
fields become mirror projections or are removed after cutover. The
`reservation_version` and `reservation_lifecycle_state` fields remain as
mirror projections for admin-read convenience.

#### Base44 `AdminAlert` becomes a non-authoritative incident projection

Base44 `AdminAlert` is a mirror of Postgres `operational_incidents`. The
authoritative incident record has a unique `incident_key` constraint (Section
5.6). The outbox `incident_create` effect type projects new incidents to
Base44 `AdminAlert`. Concurrent AdminAlert uniqueness is solved by the
Postgres unique constraint, NOT by unique operation/Purchase/PaymentIntent
IDs alone.

---

## 10. Account Deletion Ordering (Corrected)

Account deletion must follow this exact ordering:

1. **Query Postgres authority first.** Call
   `authority_v1.check_user_obligations(p_user_id)` to find all listings
   where the user is seller or buyer with unsettled obligations
   (`reserved`, `frozen`, `capture_unknown`, `refund_unknown`, or any
   binding in an in-flight payment state).

2. **Block while the user has unsettled obligations.** If any unsettled
   obligations exist, deletion is blocked. Return the list of obligations to
   the caller. The user or admin must resolve or manually adjudicate those
   obligations (complete the transfer, refund the payment, or admin-resolve
   the unknown capture/refund).

3. **Resolve or manually adjudicate those obligations.** This may involve:
   - Completing a pending transfer (seller confirms transfer).
   - Refunding a captured payment (admin initiates refund saga).
   - Admin-resolving an unknown capture/refund (query Stripe, record result).
   - Admin-force-cancelling a stuck reservation (quarantine + manual
     resolution).

4. **Preserve legally/financially required audit data under a pseudonymous
   identifier.** Sold, cancelled, and expired listings are anonymized:
   `buyer_user_id` and `seller_user_id` are replaced with a pseudonymous
   identifier (e.g., `deleted_user_<hash>`). Operation ledger records are
   retained for audit but anonymized. Financial records (payment_actions,
   reservation_payment_bindings) are retained for legal/financial
   compliance.

5. **Only then disconnect Stripe or remove the Base44 account according to
   policy.** Stripe account disconnection and Base44 account removal happen
   AFTER the authority confirms all obligations are resolved and audit data
   is preserved.

**Never disconnect Stripe first and attempt authority cancellation
afterward.** Stripe disconnection first would prevent refund/cancellation
sagas from executing, leaving the authority in an unsettled state with no
way to resolve the financial obligation.

```sql
CREATE OR REPLACE FUNCTION authority_v1.check_user_obligations(
  p_user_id TEXT
) RETURNS TABLE(listing_id TEXT, role TEXT, lifecycle_state TEXT, capture_state TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT ra.listing_id, 'seller'::TEXT, ra.lifecycle_state, b.capture_state::TEXT
  FROM reservation_authority ra
  LEFT JOIN reservation_payment_bindings b ON b.listing_id = ra.listing_id
  WHERE ra.seller_user_id = p_user_id
    AND (ra.lifecycle_state IN ('reserved','frozen')
         OR b.capture_state IN ('capture_requested','capture_unknown','cancel_requested',
                                 'refund_requested','refund_unknown','captured'))

  UNION ALL

  SELECT ra.listing_id, 'buyer'::TEXT, ra.lifecycle_state, b.capture_state::TEXT
  FROM reservation_authority ra
  LEFT JOIN reservation_payment_bindings b ON b.listing_id = ra.listing_id
  WHERE ra.buyer_user_id = p_user_id
    AND (ra.lifecycle_state IN ('reserved','frozen')
         OR b.capture_state IN ('capture_requested','capture_unknown','cancel_requested',
                                 'refund_requested','refund_unknown','captured'));
END;
$$;

CREATE OR REPLACE FUNCTION authority_v1.anonymize_user(
  p_user_id TEXT, p_pseudonymous_id TEXT,
  p_operation_id TEXT, p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = authority_v1, pg_catalog
AS $$
DECLARE v_count INTEGER;
BEGIN
  -- Verify no unsettled obligations
  IF EXISTS(SELECT 1 FROM check_user_obligations(p_user_id)) THEN
    RAISE EXCEPTION 'DELETION_BLOCKED: user has unsettled obligations';
  END IF;

  -- Anonymize seller references on terminal-state listings
  UPDATE reservation_authority SET seller_user_id = p_pseudonymous_id, updated_at = now()
  WHERE seller_user_id = p_user_id AND lifecycle_state IN ('sold','cancelled','expired');

  -- Anonymize buyer references on terminal-state listings
  UPDATE reservation_authority SET buyer_user_id = p_pseudonymous_id, updated_at = now()
  WHERE buyer_user_id = p_user_id AND lifecycle_state IN ('sold','cancelled','expired');

  -- Anonymize operation ledger result_json (retain for audit)
  UPDATE reservation_operations SET result_json = anonymize_result(result_json, p_pseudonymous_id)
  WHERE listing_id IN (SELECT listing_id FROM reservation_authority WHERE seller_user_id = p_pseudonymous_id);

  RETURN jsonb_build_object('ok', true, 'anonymized', true, 'pseudonymous_id', p_pseudonymous_id);
END;
$$;
```

---

## 11. Entry-Point Transition Map (Corrected)

All 11 production entry points are currently unintegrated. After cutover,
each delegates to Postgres stored functions via the authority client. No
entry point may independently update reservation tuple fields. All
entry-point mappings below use the same payment state machine (Section 6)
and stored functions (Section 7).

### 11.1 `reserveListing`

| Aspect | Specification |
|--------|---------------|
| Stored function | `authority_v1.reserve_listing` |
| Authenticated actor | Buyer (user_id from Base44 auth) |
| Operation-ID | `reserve_{listing_id}_{buyer_user_id}_{checkout_nonce}` |
| Expected version | Read from authority via `authority_v1.get_state` |
| Legal starting states | `available` |
| Transaction result | `{ ok: true, version, revision, token_hash, expires_at }` or `{ ok: false, code: 'CONFLICT' }` |
| External Stripe command | None — reserve is pre-payment |
| Unknown-outcome behavior | N/A (no external call) |
| Webhook/reconciliation | N/A |
| Mirror/outbox effects | `mirror_project` event → update Base44 `Listing` + `ListingPrivate` reservation fields |
| Fail-closed response | 503, no reservation created |

### 11.2 `releaseReservation`

| Aspect | Specification |
|--------|---------------|
| Stored function | `authority_v1.release_listing` |
| Authenticated actor | System (cleanup) or buyer (explicit release) |
| Operation-ID | `release_{listing_id}_{release_nonce}` |
| Expected version | From authority |
| Legal starting states | `reserved` |
| Transaction result | `{ ok: true, version }` or conflict |
| External Stripe command | None |
| Unknown-outcome behavior | N/A |
| Webhook/reconciliation | N/A |
| Mirror/outbox effects | `mirror_project` → clear reservation fields on mirrors |
| Fail-closed response | 503, reservation remains held until expiry |

### 11.3 `createCheckout`

| Aspect | Specification |
|--------|---------------|
| Stored function | `authority_v1.reserve_listing` (if not already reserved by this buyer) |
| Authenticated actor | Buyer (user_id from Base44 auth) |
| Operation-ID | `checkout_{listing_id}_{buyer_user_id}_{checkout_nonce}` |
| Expected version | From authority |
| Legal starting states | `available` (or already `reserved` by same buyer) |
| Transaction result | Reservation token_hash + expiry |
| External Stripe command | Create PaymentIntent (after authority commit) |
| Unknown-outcome behavior | If Stripe PI creation fails/times out → `authority_v1.release_listing` (compensating transaction) |
| Webhook/reconciliation | N/A |
| Mirror/outbox effects | `mirror_project` |
| Fail-closed response | 503, no Stripe call, no reservation (if authority fails); release reservation if Stripe fails after reserve |

### 11.4 `abortCheckout` (Corrected — Durable Saga)

| Aspect | Specification |
|--------|---------------|
| Stored functions | `authority_v1.begin_cancel` → (Stripe cancel) → `authority_v1.record_cancel_result` → `authority_v1.abort_binding` |
| Authenticated actor | Buyer or system |
| Operation-ID | `abort_{listing_id}_{purchase_id}_{abort_nonce}` |
| Expected version | From authority |
| Legal starting states | `reserved` (simple release) or `frozen` (durable cancel saga) |
| Transaction result | Reservation released, binding `aborted` |
| External Stripe command | Cancel PaymentIntent (durable saga: `begin_cancel` records action, Stripe cancel call, `record_cancel_result` records result) |
| Unknown-outcome behavior | `cancel_unknown` → authority remains `frozen`, `recovery_blocked = true`; webhook/recon resolves |
| Webhook/reconciliation | Resolves `cancel_unknown` → `record_cancel_result` → `abort_binding` if allowed |
| Mirror/outbox effects | `mirror_project` + `notification_dispatch` |
| Fail-closed response | 503, if `begin_cancel` fails → no Stripe cancel; if Stripe cancel unknown → `cancel_unknown`, frozen, recovery_blocked |

### 11.5 `cancelPurchase` (Corrected — Durable Saga)

| Aspect | Specification |
|--------|---------------|
| Stored functions | If `frozen`/`captured`: `authority_v1.begin_refund` → (Stripe refund) → `authority_v1.record_refund_result` → `authority_v1.abort_binding`; if `available`/`reserved`: `authority_v1.cancel_listing` |
| Authenticated actor | Buyer or admin |
| Operation-ID | `cancel_{listing_id}_{purchase_id}_{cancel_nonce}` |
| Expected version | From authority |
| Legal starting states | `reserved` (simple cancel), `frozen` (with refund saga), `available` (seller cancel) |
| Transaction result | Listing cancelled or reservation released with refund |
| External Stripe command | Refund PaymentIntent (durable saga) if captured; cancel PaymentIntent if authorized but not captured |
| Unknown-outcome behavior | `refund_unknown` → authority remains `frozen`, `recovery_blocked = true` |
| Webhook/reconciliation | Resolves `refund_unknown` → `record_refund_result` → `abort_binding` |
| Mirror/outbox effects | `mirror_project` + `notification_dispatch` + `point_award` (reversal) |
| Fail-closed response | 503, if authority fails → no Stripe refund; if Stripe refund unknown → `refund_unknown`, frozen, recovery_blocked |

### 11.6 `processTransferReminders`

| Aspect | Specification |
|--------|---------------|
| Stored function | `authority_v1.expire_listing` (for stale reservations) |
| Authenticated actor | System (scheduled) |
| Operation-ID | `expire_{listing_id}_{scheduled_nonce}` |
| Expected version | From authority |
| Legal starting states | `reserved` (expired) |
| Transaction result | Expired reservations transitioned, reminders dispatched |
| External Stripe command | None (reminders only) |
| Unknown-outcome behavior | N/A |
| Webhook/reconciliation | N/A |
| Mirror/outbox effects | `mirror_project` + `notification_dispatch` (reminders) |
| Fail-closed response | Skip cycle (non-blocking — reminders are not real-time critical) |

### 11.7 `capturePayment` (Corrected — Durable Saga)

| Aspect | Specification |
|--------|---------------|
| Stored functions | `authority_v1.begin_capture` → (Stripe capture) → `authority_v1.record_capture_result` → (if succeeded) `authority_v1.finalize_sale` |
| Authenticated actor | System (stripeWebhook) or admin |
| Operation-ID | `capture_{listing_id}_{payment_intent_id}_{capture_nonce}` |
| Expected version | From authority |
| Legal starting states | `reserved` (`begin_capture` transitions to `frozen`) |
| Transaction result | Step 1: frozen tuple + `action_id` + idempotency key. Step 3: `captured` + `finalized` (if succeeded) or `capture_unknown` (if unknown) |
| External Stripe command | Capture PaymentIntent (durable saga: `begin_capture` records action, Stripe capture call, `record_capture_result` records result) |
| Unknown-outcome behavior | `capture_unknown` → authority `frozen`, `recovery_blocked = true`; webhook/recon resolves |
| Webhook/reconciliation | Resolves `capture_unknown` → `record_capture_result` → `finalize_sale` (if succeeded) |
| Mirror/outbox effects | `mirror_project` (frozen) + `mirror_project` (sold) + `notification_dispatch` + `point_award` |
| Fail-closed response | 503, if `begin_capture` fails → no Stripe capture; if Stripe capture unknown → `capture_unknown`, frozen, recovery_blocked. Never release/sell while Stripe result unknown. |

### 11.8 `cleanupAbandonedCheckouts`

| Aspect | Specification |
|--------|---------------|
| Stored functions | `authority_v1.expire_listing` (for expired reservations) + `authority_v1.begin_cancel` (for stale PIs) → `record_cancel_result` |
| Authenticated actor | System (scheduled) |
| Operation-ID | `cleanup_{listing_id}_{scheduled_nonce}` |
| Expected version | From authority |
| Legal starting states | `reserved` (expired) |
| Transaction result | Expired reservations released, stale PIs cancelled |
| External Stripe command | Cancel stale PaymentIntents (durable saga) |
| Unknown-outcome behavior | `cancel_unknown` → frozen, recovery_blocked |
| Webhook/reconciliation | Resolves `cancel_unknown` |
| Mirror/outbox effects | `mirror_project` |
| Fail-closed response | Skip cycle (non-blocking) |

### 11.9 `stripeWebhook` (Corrected)

| Aspect | Specification |
|--------|---------------|
| Stored functions | `authority_v1.record_capture_result` / `record_cancel_result` / `record_refund_result` (depending on event type) |
| Authenticated actor | Stripe (webhook) |
| Operation-ID | `webhook_{stripe_event_id}` — Stripe event ID is the idempotency key |
| Expected version | From authority (at time of resolution) |
| Legal starting states | `capture_requested`, `cancel_requested`, `refund_requested`, `capture_unknown`, `refund_unknown` |
| Transaction result | Binding state updated, authority finalized/released/aborted |
| External Stripe command | None (webhook IS the Stripe event) |
| Unknown-outcome behavior | N/A (webhook resolves unknown states) |
| Webhook/reconciliation | Idempotent by `stripe_webhook_events.webhook_event_id` (PRIMARY KEY). Duplicate delivery → 1 process, 1 idempotent replay. |
| Mirror/outbox effects | `mirror_project` + `notification_dispatch` + `point_award` |
| Fail-closed response | 503 to Stripe (Stripe retries). Never ACK a webhook the authority cannot process. |

### 11.10 `submitListing` / `manage_existing`

| Aspect | Specification |
|--------|---------------|
| Stored function | `authority_v1.initialize_listing` |
| Authenticated actor | Seller (user_id from Base44 auth) |
| Operation-ID | `init_{listing_id}` for new; `update_meta_{listing_id}_{nonce}` for metadata |
| Expected version | 0 for new listing; current version for metadata update |
| Legal starting states | New (no authority row yet) |
| Transaction result | Authority row created (`version = 0`, `available`, `seller_user_id` set) or metadata acknowledged |
| External Stripe command | None |
| Unknown-outcome behavior | N/A |
| Webhook/reconciliation | N/A |
| Mirror/outbox effects | `mirror_project` (if reservation-relevant metadata changed) |
| Fail-closed response | 503 for authority init; Base44 listing creation may proceed with `pending_verification` but authority row must be backfilled before listing goes active |

### 11.11 `deleteAccount` (Corrected)

| Aspect | Specification |
|--------|---------------|
| Stored functions | `authority_v1.check_user_obligations` → (block if unsettled) → resolve → `authority_v1.anonymize_user` |
| Authenticated actor | User (self) or admin |
| Operation-ID | `delete_account_{user_id}_{nonce}` |
| Expected version | N/A (multi-listing) |
| Legal starting states | All user's listings must be in `sold`/`cancelled`/`expired`/`aborted` (no `reserved`/`frozen`/`capture_unknown`/`refund_unknown`) |
| Transaction result | User's listings anonymized under pseudonymous ID, audit data preserved |
| External Stripe command | Disconnect Stripe account (AFTER authority anonymization confirms no unsettled obligations) |
| Unknown-outcome behavior | If any listing is unsettled → block deletion, return obligations list |
| Webhook/reconciliation | N/A |
| Mirror/outbox effects | `mirror_project` + `notification_dispatch` (affected buyers if any active) |
| Fail-closed response | 503, no deletion, no Stripe disconnect, no anonymization. **Never disconnect Stripe first.** |

---

## 12. Migration and Rollout Plan

**No dual-authoritative period is permitted.** The cutover is a one-time
switch. Before cutover, Base44 is authoritative and the authority is
shadow-only. After cutover, the authority is authoritative and Base44 is
mirror-only.

### Stage 1: Isolated Feasibility Gate (Corrected)

Stage 1 is an **isol feasibility gate**, NOT broad implementation. It proves
connectivity and transaction behavior with zero production impact.

**Acceptance criteria** (all must pass before Stage 2):

- [ ] Development-only Postgres instance provisioned (Neon free tier or
      local Docker — no production credentials).
- [ ] Synthetic credentials only (no real Stripe keys, no production data).
- [ ] Connectivity from a deployed Base44 backend function to the development
      Postgres instance via the Neon serverless HTTP driver.
- [ ] Secret read inside the handler (`process.env.AUTHORITY_DB_URL`).
- [ ] Successful single stored-function call over the selected transport
      (e.g., `authority_v1.initialize_listing` returns `{ ok: true }`).
- [ ] Real rollback test: begin a transaction, insert a row, roll back,
      verify the row does not exist.
- [ ] Real unique-constraint test: insert a duplicate `operation_id`, verify
      the second insert fails with a unique constraint violation.
- [ ] 100-way exactly-one reservation test: 100 concurrent
      `reserve_listing` calls with the same `listing_id` and
      `expected_version` → exactly 1 winner, 99 rejected.
- [ ] Unknown-commit recovery by operation ID: commit a transaction, close
      the connection, reconnect, query `reservation_operations` by
      `operation_id`, verify the committed result is returned.
- [ ] Latency measurements: p50, p95, p99 for a single stored-function call
      over the Neon HTTP driver.
- [ ] Complete synthetic cleanup: all test data deleted, development database
      left clean.
- [ ] Zero production data and zero Stripe calls.

**Do NOT perform Stage 1 in this correction round.** Stage 1 is the next
gate after this correction is approved.

**Rollback**: Drop the development database. No production impact.

### Stages 2-13 (unchanged from original, summarized)

| Stage | Description | Rollback |
|-------|-------------|----------|
| 2 | Synthetic transaction and concurrency tests | Delete test data |
| 3 | Build injectable authority client | Remove client |
| 4 | Create executable entry-wrapper tests | Remove tests |
| 5 | Backfill 34 listings with maintenance ON | Drop authority rows |
| 6 | Verify one authority row per listing | Drop and re-run Stage 5 |
| 7 | Shadow-read and compare Base44 against authority (7 days) | Stop shadow writes |
| 8 | Integrate one low-risk entry point at a time | Revert to Base44-direct (pre-cutover) |
| 9 | Run deterministic and live concurrency tests | Revert (pre-cutover) |
| 10 | Reconcile mirrors | Re-run reconciliation |
| 11 | Complete failure-injection testing | Revert (pre-cutover) |
| 12 | Obtain rollback evidence | Documented |
| 13 | Consider maintenance removal | Re-enable maintenance + reconcile |

**Critical rule**: After cutover (post-Stage 8), there is no automatic
fallback to Base44-direct writes. If the authority fails after cutover, the
system fails-closed (503). Recovery requires reconciling the authority's
committed state to the mirrors.

---

## 13. Required Certification Tests

Mocks alone are insufficient. Real isolated Postgres transaction tests are
required before production integration.

### 13.1 Concurrency Tests

| Test | Expected result |
|------|-----------------|
| 100 concurrent different-operation reservation attempts | Exactly 1 winner, 99 rejected |
| 100 same-operation retries (same operation_id + same request_hash) | 1 commit, 99 idempotent responses (identical result_json) |
| Stale-version rejection | `CONFLICT` (version mismatch) |
| Conflicting-payload same-operation rejection | `OPERATION_ID_CONFLICT` |
| Reserve vs. cancel (concurrent) | Exactly 1 winner |
| Release vs. new reserve (concurrent) | Exactly 1 winner |
| Expiration vs. checkout (concurrent) | Exactly 1 winner |
| Capture vs. cancellation (concurrent) | Exactly 1 winner |
| Duplicate webhook delivery (same Stripe event ID) | 1 commit, 1 idempotent replay, 0 duplicate financial effects |
| Duplicate incident_key insert | 1 commit, 1 rejected (unique constraint) |

### 13.2 Failure-Injection Tests

| Test | Expected result |
|------|-----------------|
| Database timeout before commit | Transaction rolls back, no partial state, 503 |
| Connection loss after unknown commit result | Reconnect, query by operation_id, return committed result |
| Outbox replay (undelivered event) | Outbox sweeper delivers, mirror updated, idempotent |
| Mirror outage and recovery | Authority continues, outbox accumulates, mirror repaired |
| Stale mirror event rejection | Version < mirror version → `updated: 0`, marked delivered |
| Expired lease recovery | `recover_expired_leases()` resets `in_flight` → `pending` |

### 13.3 Payment State Machine Tests

| Test | Expected result |
|------|-----------------|
| Finalize from `authorized` | Rejected (`FINALIZE_REJECTED`) |
| Finalize from `captured` | Accepted |
| Abort from `captured` without refund | Rejected (`ABORT_REJECTED`) |
| Abort from `captured` with confirmed refund | Accepted |
| Cancel listing from `frozen` | Rejected (`CANCEL_REJECTED_FROZEN`) |
| Capture unknown → frozen + recovery_blocked | Authority frozen, recovery_blocked, incident created |
| Refund unknown → frozen + recovery_blocked | Authority frozen, recovery_blocked, incident created |

### 13.4 Binding Uniqueness Tests

| Test | Expected result |
|------|-----------------|
| Unique PaymentIntent binding | Second bind with same PI → `PAYMENT_BINDING_CONFLICT` |
| Same idempotent binding replay | All fields match → return stored result |
| Mismatched binding conflict | Any field differs → `PAYMENT_BINDING_CONFLICT` |
| Unique Purchase binding | Second bind with same purchase_id → PRIMARY KEY violation |

### 13.5 Account Deletion Tests

| Test | Expected result |
|------|-----------------|
| Delete with reserved listing | Blocked (obligations returned) |
| Delete with frozen listing | Blocked (obligations returned) |
| Delete with capture_unknown listing | Blocked (obligations returned) |
| Delete with all terminal listings | Allowed, anonymized under pseudonymous ID |
| Stripe disconnected before authority | Rejected (never allowed) |

### 13.6 Certification Requirement

All tests must pass against a **real isolated Postgres instance** (not mocks).

---

## 14. Operational Monitoring

### 14.1 Authority Health

| Metric | Alert threshold |
|--------|-----------------|
| Authority request latency (p99) | > 100ms |
| Authority error rate | > 1% |
| Authority availability | < 99.9% |
| Stale reservations (reserved > 15 min) | Alert |
| Quarantined listings | Alert |
| `capture_unknown` bindings | Alert — requires resolution |
| `refund_unknown` bindings | Alert — requires resolution |

### 14.2 Outbox Health

| Metric | Alert threshold |
|--------|-----------------|
| Outbox lag (oldest undelivered event) | > 30 seconds |
| Outbox dead-letter count | > 0 |
| Expired lease count | > 0 (sweeper not keeping up) |
| Mirror divergence count | > 0 |

### 14.3 Financial Integrity

| Metric | Alert threshold |
|--------|-----------------|
| Duplicate PaymentIntent bindings | > 0 |
| Captures without freeze | > 0 (impossible) |
| Finalizes without capture | > 0 (impossible) |
| Aborts without confirmed refund (from captured) | > 0 (impossible) |
| Stripe webhook duplicate processing | > 0 (should be idempotent replay) |

---

## 15. Unresolved Blockers

| Blocker | Status | Resolution |
|---------|--------|------------|
| No written Base44 vendor guarantee | Unanswered | Resolved by selecting Postgres |
| Concurrent AdminAlert uniqueness | Resolved by `operational_incidents.incident_key` UNIQUE constraint | This document |
| Production entry points unintegrated | 11/11 unintegrated | Stage 8 |
| Existing records uninitialized | 34 listings need authority rows | Stage 5 |
| Launch gate RED | 2 expected failures | Stage 4 + Postgres integration |
| No real Postgres instance provisioned | Not provisioned | Stage 1 |
| No authority client built | Not built | Stage 3 |
| No entry-wrapper tests | None exist | Stage 4 |
| 7C.9D not started | Blocked | Not started |

---

## 16. What This Document Does NOT Authorize

- No infrastructure provisioning. No Postgres instance is provisioned.
- No production integration. No entry point is modified.
- No data migration. No records are moved.
- No provider contact. No Stripe, email, push, points, or notification
  provider is contacted.
- No maintenance change. Maintenance remains ON.
- No 7C.9D. 7C.9D is not started.
- No launch. Readiness remains 94%, launch NO-GO, launch gate RED.

---

## 17. References

- `src/docs/ATOMIC_STRATEGY_BLOCKER.md` — empirical probe results
- `src/docs/VENDOR_GUARANTEE_QUESTION.md` — unanswered vendor question
- `base44/shared/reservationMutationManifest.js` — 11 unintegrated entry points
- `base44/shared/reservationAuthority.js` — current Base44 CAS prototype
- `tests/reservation-authority-concurrency.test.mjs` — 59/59 PASS
- `tests/reservation-authority-adversarial.test.mjs` — 52/52 PASS
- `tests/launch-gate.test.mjs` — 12/14 PASS (2 expected failures)

---

## 18. Correction Change Log (7C.9C.2F → 7C.9C.2F.1)

| # | Defect in original (7C.9C.2F) | Correction in 7C.9C.2F.1 |
|---|-------------------------------|--------------------------|
| 1 | Topology left undefined ("Postgres, e.g. Neon") | Section 2: Exact topology selected — Base44 backend function → shared authority client → Neon serverless HTTP driver → versioned Postgres stored functions. Security model with restricted DB role, `SECURITY DEFINER`, hardened `search_path`. Separate HTTP authority service explicitly rejected with rationale. |
| 2 | Stripe ordering captured before freezing authority | Section 8: Replaced with durable saga — `begin_capture` (freeze + durable action record) → Stripe capture → `record_capture_result`. No external Stripe request is part of a Postgres transaction. |
| 3 | Payment state model had 5 states | Section 6: Expanded to 12 states (`authorized`, `capture_requested`, `capture_unknown`, `captured`, `finalized`, `cancel_requested`, `canceled`, `refund_requested`, `refund_unknown`, `refunded`, `aborted`, `failed`) with allowed transitions and 6 required invariants. |
| 4 | Freeze SQL silently ignored duplicate PaymentIntent bindings | Section 7.5: Removed unconditional conflict suppression. Conflicting binding must be proven exact same (return stored result) or fail with `PAYMENT_BINDING_CONFLICT`. Authority never commits `frozen` without exactly one matching binding. |
| 5 | Finalization accepted `authorized` | Section 7.7: Finalization requires `captured` state. All IDs must match. Exactly one binding row must update (`ROW_COUNT = 1`). Zero or multiple → roll back. `authorized` never accepted. |
| 6 | Abort could rewrite `captured`/`finalized` to `aborted` | Section 7.8: Abort requires allowed binding state. Cannot rewrite `captured`/`finalized` without confirmed Stripe refund (`payment_actions` with `action_type = 'refund'`, `status = 'succeeded'`). |
| 7 | Cancel allowed `lifecycle_state = 'frozen'` | Section 7.9: Simple seller cancel rejects `frozen`. Frozen states require durable cancellation/refund saga. |
| 8 | Operation ledger CAS could run before operation_id acquisition | Section 7.1: `acquire_operation` pattern — operation_id acquired BEFORE any authority CAS. Same ID + same hash → replay; same ID + different hash → `OPERATION_ID_CONFLICT`; pending → `IN_PROGRESS`. |
| 9 | Schema missing `seller_user_id`, stored plaintext token, missing tables | Section 5: Added `seller_user_id`, `reservation_token_hash` (not plaintext), `payment_actions` table, `stripe_webhook_events` table, `operational_incidents` table, outbox leasing fields (`lease_owner`, `lease_expires_at`, `claimed_at`), `FOR UPDATE SKIP LOCKED` claiming, expired lease recovery, lifecycle/payment CHECK constraints. |
| 10 | Claimed AdminAlert uniqueness solved by unique operation/Purchase/PI IDs | Section 5.6: Authoritative `operational_incidents` table with UNIQUE `incident_key`. Base44 `AdminAlert` becomes non-authoritative projection. Uniqueness solved by the unique constraint, not by other IDs. |
| 11 | Account deletion disconnected Stripe first | Section 10: Query Postgres first → block while unsettled → resolve/adjudicate → preserve audit under pseudonymous ID → then disconnect Stripe. Never disconnect Stripe first. |
| 12 | Mirror delivery underspecified | Section 9: 10 specific ordering rules — only projection worker writes, committed-version order, stale rejection, gap reconciliation, read/compare before retry, mirror lag never changes winner, checkout always consults Postgres, public availability hidden when stale. |
| 13 | Entry-point map contradicted state machine | Section 11: All 11 entry points rewritten with stored function, actor, operation-ID, expected version, legal starting states, transaction result, external Stripe command, unknown-outcome behavior, webhook/reconciliation, mirror/outbox, fail-closed. All use the same payment state machine (Section 6). |
| 14 | Stage 1 was broad implementation | Section 12: Stage 1 is an isolated feasibility gate with 12 specific acceptance criteria. Do NOT perform Stage 1 in this correction round. |