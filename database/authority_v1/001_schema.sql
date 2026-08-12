-- ═══════════════════════════════════════════════════════════════════════════
-- authority_v1 — Schema (001)
-- Source of truth for the Postgres authority data model.
-- Referenced by: src/docs/ATOMICITY_ARCHITECTURE_DECISION.md
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
  current_operation_id         TEXT,
  last_operation_type          TEXT,
  last_operation_at            TIMESTAMPTZ,
  last_operation_payload_hash  TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT quarantine_reason_required
  CHECK (NOT checkout_quarantined OR checkout_quarantine_reason IS NOT NULL);

ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT recovery_block_reason_required
  CHECK (NOT recovery_blocked OR recovery_blocked_reason IS NOT NULL);

ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT frozen_requires_buyer
  CHECK (lifecycle_state <> 'frozen'
    OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL));

ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT reserved_requires_tuple
  CHECK (lifecycle_state <> 'reserved'
    OR (buyer_user_id IS NOT NULL AND reservation_token_hash IS NOT NULL AND reservation_expires_at IS NOT NULL));

ALTER TABLE authority_v1.reservation_authority
  ADD CONSTRAINT terminal_states_clear_tuple
  CHECK (lifecycle_state NOT IN ('sold','cancelled','expired')
    OR (buyer_user_id IS NULL AND reservation_token_hash IS NULL AND reservation_expires_at IS NULL));

CREATE INDEX idx_authority_stale_reserved
  ON authority_v1.reservation_authority (reservation_expires_at)
  WHERE lifecycle_state = 'reserved' AND checkout_quarantined = false;

CREATE INDEX idx_authority_seller
  ON authority_v1.reservation_authority (seller_user_id);

CREATE INDEX idx_authority_buyer
  ON authority_v1.reservation_authority (buyer_user_id)
  WHERE buyer_user_id IS NOT NULL;

-- ── 2. reservation_operations — Operation Ledger ───────────────────────────
CREATE TABLE authority_v1.reservation_operations (
  operation_id      TEXT        PRIMARY KEY,
  listing_id        TEXT        NOT NULL REFERENCES authority_v1.reservation_authority(listing_id),
  operation_type    TEXT        NOT NULL
    CHECK (operation_type IN (
      'reserve','release','freeze','bind_pi',
      'begin_capture','record_capture','finalize',
      'begin_cancel','record_cancel',
      'begin_refund','record_refund',
      'abort','cancel','expire','initialize','quarantine','anonymize'
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

CREATE INDEX idx_ops_listing
  ON authority_v1.reservation_operations (listing_id, created_at DESC);

CREATE INDEX idx_ops_pending
  ON authority_v1.reservation_operations (status)
  WHERE status = 'pending';

-- ── 3. reservation_payment_bindings — 13-State Payment Binding ────────────
CREATE TABLE authority_v1.reservation_payment_bindings (
  purchase_id                     TEXT        PRIMARY KEY,
  payment_intent_id               TEXT        UNIQUE,
  listing_id                      TEXT        NOT NULL REFERENCES authority_v1.reservation_authority(listing_id),
  buyer_user_id                   TEXT        NOT NULL,
  authority_version               INTEGER     NOT NULL,
  reservation_revision            TEXT        NOT NULL,
  reservation_token_hash          TEXT        NOT NULL,
  capture_state                   TEXT        NOT NULL DEFAULT 'authorized'
    CHECK (capture_state IN (
      'authorized',
      'capture_requested','capture_unknown','captured','finalized',
      'cancel_requested','cancel_unknown','canceled',
      'refund_requested','refund_unknown','refunded',
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

-- One active binding per listing — covers ALL states with unsettled obligations.
-- A second binding is blocked while any in-flight or captured-but-unsettled
-- obligation exists, including cancellation/refund states where the financial
-- obligation has not yet been resolved.
CREATE UNIQUE INDEX idx_one_active_binding_per_listing
  ON authority_v1.reservation_payment_bindings (listing_id)
  WHERE capture_state IN (
    'authorized',
    'capture_requested','capture_unknown','captured',
    'cancel_requested','cancel_unknown',
    'refund_requested','refund_unknown'
  );

-- ── 4. payment_actions — Durable Stripe Commands with Leasing ─────────────
CREATE TABLE authority_v1.payment_actions (
  action_id              TEXT        PRIMARY KEY,
  listing_id             TEXT        NOT NULL REFERENCES authority_v1.reservation_authority(listing_id),
  purchase_id            TEXT        NOT NULL,
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
  max_attempts           INTEGER     NOT NULL DEFAULT 5,
  next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_payment_actions_idem
  ON authority_v1.payment_actions (stripe_idempotency_key);

CREATE INDEX idx_payment_actions_claimable
  ON authority_v1.payment_actions (next_attempt_at)
  WHERE status IN ('pending','in_flight','unknown');

CREATE INDEX idx_payment_actions_purchase
  ON authority_v1.payment_actions (purchase_id, action_type);

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
  error_message          TEXT,
  processed_at           TIMESTAMPTZ,
  -- Leasing fields for worker claiming and crash recovery
  lease_owner            TEXT,
  lease_expires_at       TIMESTAMPTZ,
  claimed_at             TIMESTAMPTZ,
  attempt_count          INTEGER     NOT NULL DEFAULT 0,
  max_attempts           INTEGER     NOT NULL DEFAULT 5,
  next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
      'failed_transfer_after_payment','new_dispute','expired_verification',
      'low_confidence_listing','conflicting_community_reports',
      'transfer_disabled_active_listing','buyer_waiting_for_transfer',
      'seller_missed_deadline','seller_reliability_drop','admin_action_required'
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
  event_id           TEXT        UNIQUE,
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
  max_attempts       INTEGER     NOT NULL DEFAULT 10,
  next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error         TEXT,
  delivered_at       TIMESTAMPTZ,
  lease_owner        TEXT,
  lease_expires_at   TIMESTAMPTZ,
  claimed_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_claimable
  ON authority_v1.reservation_outbox (next_attempt_at)
  WHERE delivery_status IN ('pending','in_flight');