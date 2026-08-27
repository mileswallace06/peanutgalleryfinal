-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Schema (001)
-- Source of truth for the Postgres authority data model.
-- Referenced by: src/docs/ATOMICITY_ARCHITECTURE_DECISION.md
--
-- INSTALLATION ORDER:
--   001_schema.sql        — tables, constraints, indexes
--   002_functions.sql     — all stored functions (authority + worker helpers)
--   003_workers.sql       — worker claiming, lease recovery, exhausted escalation
--   004_roles_and_grants.sql — roles, ownership transfer, grants, revokes
--
-- All functions (including workers) must exist before 004 grants EXECUTE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Schema ──────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS authority_v1;

-- ── 1. reservation_authority — Authoritative Reservation State ──────────────
CREATE TABLE authority_v1.reservation_authority (
  listing_id                   TEXT        PRIMARY KEY,
  version                      INTEGER     NOT NULL DEFAULT 0,
  lifecycle_state              TEXT        NOT NULL DEFAULT 'available'
    CHECK (lifecycle_state IN ('available','reserved','frozen','sold','cancelled','expired')),
  seller_user_id               TEXT        NOT NULL,
  buyer_user_id                TEXT,
  reservation_token_hash       TEXT,
  reservation_expires_at      TIMESTAMPTZ,
  reservation_revision         TEXT,
  checkout_quarantined         BOOLEAN     NOT NULL DEFAULT false,
  checkout_quarantine_reason   TEXT,
  checkout_quarantined_at       TIMESTAMPTZ,
  recovery_blocked             BOOLEAN     NOT NULL DEFAULT false,
  recovery_blocked_reason      TEXT,
  recovery_blocked_at          TIMESTAMPTZ,
  recovery_not_before          TIMESTAMPTZ,
  seller_cancel_requested_at   TIMESTAMPTZ,
  seller_pause_requested_at    TIMESTAMPTZ,
  -- P0-01M: Authoritative transfer lifecycle state. Distinct from lifecycle_state
  -- (reservation) and capture_state (payment). Seller self-report is NEVER
  -- provider-verified — 'seller_reported_sent' is the seller's attestation only.
  transfer_state               TEXT        NOT NULL DEFAULT 'not_started'
    CHECK (transfer_state IN ('not_started','in_progress','seller_reported_sent','unknown','terminal_cancelled')),
  transfer_state_updated_at    TIMESTAMPTZ,
  current_operation_id         TEXT,
  last_operation_type          TEXT,
  last_operation_at            TIMESTAMPTZ,
  last_operation_payload_hash  TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quarantine requires a reason and timestamp when enabled
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT quarantine_reason_required
  CHECK (NOT checkout_quarantined OR checkout_quarantine_reason IS NOT NULL);

ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT quarantine_timestamp_required
  CHECK (NOT checkout_quarantined OR checkout_quarantined_at IS NOT NULL);

-- Recovery block requires a reason and timestamp when enabled
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT recovery_block_reason_required
  CHECK (NOT recovery_blocked OR recovery_blocked_reason IS NOT NULL);

ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT recovery_block_timestamp_required
  CHECK (NOT recovery_blocked OR recovery_blocked_at IS NOT NULL);

-- frozen requires buyer, token hash, expiry, and revision
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT frozen_requires_full_tuple
  CHECK (lifecycle_state <> 'frozen'
    OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL
        AND reservation_expires_at IS NOT NULL AND reservation_revision IS NOT NULL));

-- reserved requires buyer, token hash, expiry, and revision
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT reserved_requires_full_tuple
  CHECK (lifecycle_state <> 'reserved'
    OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL
        AND reservation_expires_at IS NOT NULL AND reservation_revision IS NOT NULL));

-- available has a cleared tuple
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT available_clears_tuple
  CHECK (lifecycle_state <> 'available'
    OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL
        AND reservation_expires_at IS NULL));

-- Terminal states (sold/cancelled/expired) must have cleared tuple
ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT terminal_states_clear_tuple
  CHECK (lifecycle_state NOT IN ('sold','cancelled','expired')
    OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL
        AND reservation_expires_at IS NULL));

CREATE INDEX idx_authority_stale_reserved
  ON authority_v1.reservation_authority (reservation_expires_at)
  WHERE lifecycle_state = 'reserved' AND checkout_quarantined = false;

CREATE INDEX idx_authority_seller
  ON authority_v1.reservation_authority (seller_user_id);

CREATE INDEX idx_authority_buyer
  ON authority_v1.reservation_authority (buyer_user_id)
  WHERE buyer_user_id IS NOT NULL;

-- ── 2. reservation_operations — Operation Ledger (Generic Subject Model) ────
-- The operation ledger uses a generic subject model so that operations on
-- non-listing entities (e.g. anonymize_user) do not require a fake listing_id
-- FK. The listing_id column is nullable with a DEFERRABLE INITIALLY DEFERRED
-- FK so that initialize_listing can acquire the operation BEFORE the
-- authority row exists — the FK is checked at COMMIT time, not at INSERT time.
-- A deferred FK does NOT permit an invalid committed reference: if the
-- authority row is never inserted, the COMMIT fails with a FK violation.
CREATE TABLE authority_v1.reservation_operations (
  operation_id      TEXT        PRIMARY KEY,
  -- Generic subject identity — supports listing and user operations
  subject_type      TEXT        NOT NULL
    CHECK (subject_type IN ('listing','user')),
  subject_id        TEXT        NOT NULL,
  -- Nullable listing FK — DEFERRABLE so initialize_listing can acquire
  -- the operation before the authority row exists. NULL for user operations.
  listing_id        TEXT        REFERENCES authority_v1.reservation_authority(listing_id)
    DEFERRABLE INITIALLY DEFERRED,
  operation_type    TEXT        NOT NULL
    CHECK (operation_type IN (
      'reserve','release','freeze','bind_pi',
      'begin_capture','record_capture','finalize',
      'begin_cancel','record_cancel',
      'begin_refund','record_refund',
      'abort','cancel','expire','initialize','quarantine','anonymize',
      'begin_transfer','record_seller_report'
    )),
  requested_state    TEXT        NOT NULL,
  expected_version   INTEGER     NOT NULL,
  committed_version  INTEGER,
  request_hash       TEXT        NOT NULL,
  result_json        TEXT,
  status             TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','committed','rejected','conflict','idempotent_replay')),
  error_code         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at       TIMESTAMPTZ
);

-- Valid operation type / subject type combinations
ALTER TABLE authority_v1.reservation_operations
  ADD CONSTRAINT valid_operation_subject_combination
  CHECK (
  (subject_type = 'listing' AND operation_type IN (
    'reserve','release','freeze','bind_pi',
    'begin_capture','record_capture','finalize',
    'begin_cancel','record_cancel',
    'begin_refund','record_refund',
    'abort','cancel','expire','initialize','quarantine',
    'begin_transfer','record_seller_report'))
    OR
    (subject_type = 'user' AND operation_type = 'anonymize')
  );

-- Listing operations must have listing_id set (except initialize which
-- acquires the operation before the authority row exists — the deferred
-- FK is satisfied at COMMIT time when the authority row is inserted).
ALTER TABLE authority_v1.reservation_operations
  ADD CONSTRAINT listing_ops_require_listing_id
  CHECK (subject_type <> 'listing'
    OR operation_type = 'initialize'
    OR listing_id IS NOT NULL);

-- User operations must NOT have a listing_id
ALTER TABLE authority_v1.reservation_operations
  ADD CONSTRAINT user_ops_no_listing_id
  CHECK (subject_type <> 'user' OR listing_id IS NULL);

CREATE INDEX idx_ops_listing
  ON authority_v1.reservation_operations (listing_id, created_at DESC)
  WHERE listing_id IS NOT NULL;

CREATE INDEX idx_ops_subject
  ON authority_v1.reservation_operations (subject_type, subject_id, created_at DESC);

CREATE INDEX idx_ops_pending
  ON authority_v1.reservation_operations (status)
  WHERE status = 'pending';

-- ── 3. reservation_payment_bindings — 15-State Payment Binding ────────────
-- States exceed the prior 13-state model: cancel_failed and refund_failed
-- are explicitly unsettled states that preserve the underlying financial
-- obligation while a cancel/refund could not be confirmed. They remain in
-- the one-active-binding index so a second binding is blocked while money
-- may still be owed.
CREATE TABLE authority_v1.reservation_payment_bindings (
  purchase_id                     TEXT        PRIMARY KEY,
  payment_intent_id               TEXT        UNIQUE NOT NULL,
  listing_id                      TEXT        NOT NULL REFERENCES authority_v1.reservation_authority(listing_id),
  buyer_user_id                   TEXT        NOT NULL,
  authority_version               INTEGER     NOT NULL,
  reservation_revision            TEXT        NOT NULL,
  reservation_token_hash          TEXT        NOT NULL,
  capture_state                   TEXT        NOT NULL DEFAULT 'authorized'
    CHECK (capture_state IN (
      'authorized',
      'capture_requested','capture_unknown','captured','finalized',
      'cancel_requested','cancel_unknown','cancel_failed','canceled',
      'refund_requested','refund_unknown','refund_failed','refunded',
      'aborted','failed'
    )),
  frozen_reservation_token_hash   TEXT,
  frozen_buyer_user_id            TEXT,
  frozen_reservation_expires_at   TIMESTAMPTZ,
  frozen_reservation_revision     TEXT,
  frozen_authority_version        INTEGER,
  freeze_finalized_at             TIMESTAMPTZ,
  finalization_started_at         TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active binding per listing — covers ALL states with unsettled
-- obligations, including cancel_failed and refund_failed. A second binding
-- is blocked while any in-flight, captured-but-unsettled, or cancel/refund-
-- failed obligation exists.
CREATE UNIQUE INDEX idx_one_active_binding_per_listing
  ON authority_v1.reservation_payment_bindings (listing_id)
  WHERE capture_state IN (
    'authorized',
    'capture_requested','capture_unknown','captured',
    'cancel_requested','cancel_unknown','cancel_failed',
    'refund_requested','refund_unknown','refund_failed'
  );

-- ── 4. payment_actions — Durable Stripe Commands with Leasing ─────────────
CREATE TABLE authority_v1.payment_actions (
  action_id              TEXT        PRIMARY KEY,
  listing_id             TEXT        NOT NULL REFERENCES authority_v1.reservation_authority(listing_id),
  purchase_id           TEXT        NOT NULL,
  payment_intent_id      TEXT        NOT NULL,
  action_type            TEXT        NOT NULL
    CHECK (action_type IN ('capture','cancel','refund')),
  stripe_idempotency_key TEXT        NOT NULL,
  status                 TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_flight','succeeded','failed','unknown')),
  stripe_result_json     TEXT,
  stripe_error_code      TEXT,
  attempted_at           TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  -- Leasing fields for worker claiming and crash recovery
  lease_owner            TEXT,
  lease_expires_at       TIMESTAMPTZ,
  claimed_at             TIMESTAMPTZ,
  attempt_count          INTEGER     NOT NULL DEFAULT 0,
  max_attempts           INTEGER     NOT NULL DEFAULT 5
    CHECK (max_attempts > 0 AND max_attempts <= 20),
  next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attempt count must be non-negative and not exceed max_attempts + 1
-- (the +1 allows the final attempt that exhausts the lease)
ALTER TABLE authority_v1.payment_actions
  ADD CONSTRAINT attempt_count_valid
  CHECK (attempt_count >= 0 AND attempt_count <= max_attempts + 1);

-- If lease_owner is set, lease_expires_at and claimed_at must be set
ALTER TABLE authority_v1.payment_actions
  ADD CONSTRAINT lease_fields_consistent
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL AND claimed_at IS NULL)
    OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND claimed_at IS NOT NULL)
  );

-- Completed actions must have completed_at set
ALTER TABLE authority_v1.payment_actions
  ADD CONSTRAINT completed_actions_have_timestamp
  CHECK (status NOT IN ('succeeded','failed','unknown') OR completed_at IS NOT NULL);

CREATE UNIQUE INDEX idx_payment_actions_idem
  ON authority_v1.payment_actions (stripe_idempotency_key);

CREATE INDEX idx_payment_actions_claimable
  ON authority_v1.payment_actions (next_attempt_at)
  WHERE status IN ('pending','in_flight','unknown');

CREATE INDEX idx_payment_actions_purchase
  ON authority_v1.payment_actions (purchase_id, action_type);

-- One pending action per purchase per action_type — prevents concurrent
-- begin_cancel/begin_capture/begin_refund from creating multiple durable
-- actions for the same purchase (database-level enforcement).
CREATE UNIQUE INDEX idx_one_pending_cancel_per_purchase
  ON authority_v1.payment_actions (purchase_id)
  WHERE action_type = 'cancel' AND status IN ('pending', 'in_flight');

CREATE UNIQUE INDEX idx_one_pending_capture_per_purchase
  ON authority_v1.payment_actions (purchase_id)
  WHERE action_type = 'capture' AND status IN ('pending', 'in_flight');

CREATE UNIQUE INDEX idx_one_pending_refund_per_purchase
  ON authority_v1.payment_actions (purchase_id)
  WHERE action_type = 'refund' AND status IN ('pending', 'in_flight');

-- ── 5. stripe_webhook_events — Webhook Deduplication with Leasing ─────────
CREATE TABLE authority_v1.stripe_webhook_events (
  webhook_event_id       TEXT        PRIMARY KEY,
  event_type             TEXT        NOT NULL,
  received_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status      TEXT        NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','processing','processed','failed')),
  related_action_id      TEXT        REFERENCES authority_v1.payment_actions(action_id),
  related_operation_id   TEXT,
  raw_payload            JSONB,
  -- P0-01K minimal recovery envelope (no signatures/secrets/customer data stored)
  payment_intent_id      TEXT,
  livemode               BOOLEAN,
  provider_created_at    TIMESTAMPTZ,
  api_version            TEXT,
  payload_hash           TEXT,
  error_message          TEXT,
  processed_at           TIMESTAMPTZ,
  -- Leasing fields for worker claiming and crash recovery
  lease_owner            TEXT,
  lease_expires_at       TIMESTAMPTZ,
  claimed_at             TIMESTAMPTZ,
  attempt_count          INTEGER     NOT NULL DEFAULT 0,
  max_attempts           INTEGER     NOT NULL DEFAULT 5
    CHECK (max_attempts > 0 AND max_attempts <= 20),
  next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attempt count must be non-negative and not exceed max_attempts + 1
ALTER TABLE authority_v1.stripe_webhook_events
  ADD CONSTRAINT webhook_attempt_count_valid
  CHECK (attempt_count >= 0 AND attempt_count <= max_attempts + 1);

-- Lease fields consistency
ALTER TABLE authority_v1.stripe_webhook_events
  ADD CONSTRAINT webhook_lease_fields_consistent
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL AND claimed_at IS NULL)
    OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND claimed_at IS NOT NULL)
  );

-- Processed events must have processed_at set
ALTER TABLE authority_v1.stripe_webhook_events
  ADD CONSTRAINT processed_events_have_timestamp
  CHECK (processing_status NOT IN ('processed','failed') OR processed_at IS NOT NULL);

CREATE INDEX idx_webhook_claimable
  ON authority_v1.stripe_webhook_events (next_attempt_at)
  WHERE processing_status IN ('pending','processing');

-- ── 6. operational_incidents — Authoritative Incident Records ──────────────
CREATE TABLE authority_v1.operational_incidents (
  incident_id          BIGSERIAL   PRIMARY KEY,
  incident_key         TEXT        UNIQUE NOT NULL,
  incident_type        TEXT        NOT NULL
    CHECK (incident_type IN (
      'verification_mismatch','mirror_corruption',
      'capture_unknown','cancel_unknown','refund_unknown',
      'cancel_failed','refund_failed',
      'exhausted_capture','exhausted_cancel','exhausted_refund',
      'exhausted_webhook',
      'failed_transfer_after_payment','new_dispute','expired_verification',
      'low_confidence_listing','conflicting_community_reports',
      'transfer_disabled_active_listing','buyer_waiting_for_transfer',
      'seller_missed_deadline','seller_reliability_drop','admin_action_required',
      'transfer_cancelled_inventory_quarantined','transfer_state_conflict'
    )),
  priority             TEXT        NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('critical','high','medium','low')),
  title                TEXT        NOT NULL,
  description          TEXT,
  reference_id         TEXT,
  reference_type       TEXT,
  occurrence_count     INTEGER     NOT NULL DEFAULT 1,
  last_occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved             BOOLEAN     NOT NULL DEFAULT false,
  resolved_by          TEXT,
  resolved_at          TIMESTAMPTZ,
  resolution_notes     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidents_unresolved
  ON authority_v1.operational_incidents (priority, last_occurred_at)
  WHERE resolved = false;

-- ── 7. reservation_outbox — Transactional Outbox with Leasing ──────────────
CREATE TABLE authority_v1.reservation_outbox (
  outbox_id          BIGSERIAL   PRIMARY KEY,
  event_id           TEXT        UNIQUE NOT NULL,
  operation_id       TEXT        NOT NULL REFERENCES authority_v1.reservation_operations(operation_id),
  listing_id         TEXT        NOT NULL,
  committed_version  INTEGER     NOT NULL,
  effect_type        TEXT        NOT NULL
    CHECK (effect_type IN (
      'mirror_project','notification_dispatch','point_award',
      'email_send','push_send','inventory_sync','incident_create'
    )),
  payload            JSONB       NOT NULL,
  delivery_status    TEXT        NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','in_flight','delivered','dead_letter')),
  attempt_count      INTEGER     NOT NULL DEFAULT 0,
  max_attempts       INTEGER     NOT NULL DEFAULT 10
    CHECK (max_attempts > 0 AND max_attempts <= 100),
  next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error         TEXT,
  delivered_at       TIMESTAMPTZ,
  lease_owner        TEXT,
  lease_expires_at   TIMESTAMPTZ,
  claimed_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delivered events must have delivered_at set
ALTER TABLE authority_v1.reservation_outbox
  ADD CONSTRAINT delivered_events_have_timestamp
  CHECK (delivery_status <> 'delivered' OR delivered_at IS NOT NULL);

-- Lease fields consistency
ALTER TABLE authority_v1.reservation_outbox
  ADD CONSTRAINT outbox_lease_fields_consistent
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL AND claimed_at IS NULL)
    OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND claimed_at IS NOT NULL)
  );

CREATE INDEX idx_outbox_claimable
  ON authority_v1.reservation_outbox (next_attempt_at)
  WHERE delivery_status IN ('pending','in_flight');

-- ── P0-01M Migration: Add transfer_state columns to reservation_authority ────
-- Idempotent migration for existing databases. The CREATE TABLE above already
-- includes these columns for fresh installs.
ALTER TABLE authority_v1.reservation_authority
  ADD COLUMN IF NOT EXISTS transfer_state TEXT NOT NULL DEFAULT 'not_started'
    CHECK (transfer_state IN ('not_started','in_progress','seller_reported_sent','unknown','terminal_cancelled'));
ALTER TABLE authority_v1.reservation_authority
  ADD COLUMN IF NOT EXISTS transfer_state_updated_at TIMESTAMPTZ;