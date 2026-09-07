-- Schema FIRST, before 002_functions and 005_mission1. No Base44 CAS authority.
ALTER TABLE authority_v1.reservation_authority
  ADD COLUMN IF NOT EXISTS checkout_operation_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_release_operation_id TEXT;
ALTER TABLE authority_v1.reservation_operations
  ADD COLUMN IF NOT EXISTS recovery_owner TEXT,
  ADD COLUMN IF NOT EXISTS recovery_epoch BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_evidence JSONB,
  ADD COLUMN IF NOT EXISTS recovery_dispatch_started BOOLEAN NOT NULL DEFAULT false;

-- Reuses the existing operation ledger, payment bindings, action ledger,
-- unique incident key and transactional outbox. These are workflow checkpoints,
-- not an additional payment-state model. No lease/timeout grants a new dispatch.
