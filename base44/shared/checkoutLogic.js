/**
 * checkoutLogic.js — Pure decision functions shared by createCheckout,
 * cleanupAbandonedCheckouts, and executable tests.
 *
 * No side effects, no I/O, no Deno/Node-specific APIs.
 * Imported by:
 *   - base44/functions/createCheckout/entry.ts     (Deno)
 *   - base44/functions/cleanupAbandonedCheckouts/entry.ts (Deno)
 *   - tests/checkout-concurrency.test.mjs           (Node.js ESM)
 */

// ── 6-condition reservation verification ──────────────────────────────────
// Returns true ONLY when ALL six conditions hold:
//   1. Listing.status === 'pending_transfer'
//   2. Listing.reservation_token === token
//   3. Listing.reserved_by_email === buyerEmail
//   4. ListingPrivate.reservation_token === token
//   5. ListingPrivate.reserved_by_email === buyerEmail
//   6. Both expirations are current AND consistent (same timestamp, both future)
export function verifyReservation(listing, lp, token, buyerEmail) {
  if (!listing || !lp) return false;
  if (!token || !buyerEmail) return false;
  const now = Date.now();
  if (listing.status !== 'pending_transfer') return false;
  if (listing.reservation_token !== token) return false;
  if (listing.reserved_by_email !== buyerEmail) return false;
  if (lp.reservation_token !== token) return false;
  if (lp.reserved_by_email !== buyerEmail) return false;
  const lExpiry = listing.reservation_expires_at ? new Date(listing.reservation_expires_at).getTime() : 0;
  const lpExpiry = lp.reservation_expires_at ? new Date(lp.reservation_expires_at).getTime() : 0;
  if (lExpiry <= now || lpExpiry <= now) return false;
  if (lExpiry !== lpExpiry) return false;
  return true;
}

// ── Cleanup reservation verification (allows expired) ─────────────────────
// Same as verifyReservation but allows expired expirations.
// Used by cleanup to release abandoned checkouts where the reservation
// has naturally expired but all other conditions still hold.
// Requires matching expirations (same timestamp) but both can be past.
export function verifyCleanupReservation(listing, lp, token, buyerEmail) {
  if (!listing || !lp) return false;
  if (!token || !buyerEmail) return false;
  if (listing.status !== 'pending_transfer') return false;
  if (listing.reservation_token !== token) return false;
  if (listing.reserved_by_email !== buyerEmail) return false;
  if (lp.reservation_token !== token) return false;
  if (lp.reserved_by_email !== buyerEmail) return false;
  const lExpiry = listing.reservation_expires_at ? new Date(listing.reservation_expires_at).getTime() : 0;
  const lpExpiry = lp.reservation_expires_at ? new Date(lp.reservation_expires_at).getTime() : 0;
  if (lExpiry === 0 || lpExpiry === 0) return false;
  if (lExpiry !== lpExpiry) return false;
  return true;
}

// ── Derive Stripe idempotency key ──────────────────────────────────────────
// Key = checkout_<listing_id>_<listing_revision>
// listing_revision = listing.updated_date captured at fetch time (pre-reservation).
// Two buyers racing on the same listing revision get the same key → one PI.
export function deriveIdempotencyKey(listingId, listingRevision) {
  return `checkout_${listingId}_${listingRevision}`;
}

// ── Classify retry outcome ─────────────────────────────────────────────────
// Returns: 'retry' (return existing client_secret),
//          'blocked' (409, no new flow),
//          'new_flow' (proceed with new checkout)
export function classifyRetryOutcome(piStatus, purchaseStatus) {
  if (purchaseStatus !== 'pending_transfer') return 'new_flow';
  if (piStatus === 'requires_payment_method' || piStatus === 'requires_action') {
    return 'retry';
  }
  // requires_capture, succeeded, canceled, processing, unknown → blocked
  return 'blocked';
}

// ── Classify cleanup outcome ───────────────────────────────────────────────
// Returns: 'release' (expire + release listing),
//          'keep_locked' (skip — buyer may still confirm),
//          'quarantine' (fail-closed — admin must resolve)
//
// ownsByBuyer: listing.reserved_by_email === buyer_email
// ownsByToken: listing.reservation_token === pp.reservation_token
// Release requires BOTH (not OR).
export function classifyCleanupOutcome(piStatus, ownsByBuyer, ownsByToken) {
  // PI retrieval failed or unknown → quarantine (fail-closed)
  if (piStatus === null || piStatus === 'unknown') {
    return 'quarantine';
  }
  // Authorized states — buyer may still confirm, keep locked
  if (piStatus === 'requires_capture' || piStatus === 'succeeded' || piStatus === 'processing') {
    return 'keep_locked';
  }
  // Canceled — safe to release IF we own it (both buyer AND token)
  if (piStatus === 'canceled') {
    return (ownsByBuyer && ownsByToken) ? 'release' : 'quarantine';
  }
  // Never authorized (requires_payment_method / requires_action) — cancel + release IF we own it
  if (piStatus === 'requires_payment_method' || piStatus === 'requires_action') {
    return (ownsByBuyer && ownsByToken) ? 'release' : 'quarantine';
  }
  // Any other status → quarantine
  return 'quarantine';
}

// ── Check if an error is a Stripe idempotency error ────────────────────────
// Stripe throws StripeIdempotencyError when the same idempotency key is
// reused with different parameters. The losing buyer maps this to 409.
export function isStripeIdempotencyError(err) {
  if (!err) return false;
  if (err.type === 'StripeIdempotencyError') return true;
  if (err.type === 'stripe_error' && err.code === 'idempotency_error') return true;
  if (err.constructor && err.constructor.name === 'StripeIdempotencyError') return true;
  if (err.message && err.message.includes('idempotent')) return true;
  return false;
}

// ── Check if listing is in a quarantined state ────────────────────────────
export function isQuarantined(listing, lp) {
  if (listing && listing.status === 'hidden' && listing.hidden_reason === 'checkout_quarantine') {
    return true;
  }
  if (lp && lp.checkout_quarantined === true) {
    return true;
  }
  return false;
}

// ── Check if PI status allows retry (return existing client_secret) ────────
export function isRetryablePIStatus(piStatus) {
  return piStatus === 'requires_payment_method' || piStatus === 'requires_action';
}

// ── Verify cleanup ownership: Purchase ↔ PP ↔ Listing ↔ LP ↔ PI ───────────
// All conditions must hold. If ANY mismatch, the listing must be quarantined
// (not released), because Base44 lacks atomic conditional updates.
export function verifyCleanupOwnership(purchase, pp, listing, lp, pi) {
  if (!purchase || !pp || !listing || !lp || !pi) return false;
  // 1. Purchase ↔ PurchasePrivate listing_id match
  if (purchase.listing_id !== pp.listing_id) return false;
  // 2. PI metadata must exist and match
  if (!pi.metadata) return false;
  if (pi.metadata.listing_id !== listing.id) return false;
  if (pi.metadata.buyer_email !== pp.buyer_email) return false;
  if (pi.metadata.reservation_token !== pp.reservation_token) return false;
  // purchase_id is REQUIRED (not optional) for cleanup validation
  if (!pi.metadata.purchase_id) return false;
  if (pi.metadata.purchase_id !== purchase.id) return false;
  // 3. Listing + LP must match PurchasePrivate (cleanup allows expired reservations)
  if (!verifyCleanupReservation(listing, lp, pp.reservation_token, pp.buyer_email)) return false;
  return true;
}

// ── Check if a quarantined listing can be recovered ──────────────────────
// Only recover if: Listing is hidden+checkout_quarantine, LP is quarantined,
// PI is canceled, and no pending purchases exist.
export function canRecoverQuarantine(listing, lp, pi, pendingPurchases) {
  if (!listing || !lp) return false;
  if (listing.status !== 'hidden' || listing.hidden_reason !== 'checkout_quarantine') return false;
  if (!lp.checkout_quarantined) return false;
  if (!pi || pi.status !== 'canceled') return false;
  if (pendingPurchases && pendingPurchases.length > 0) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7C.7 — Durable quarantine snapshot, exact metadata, seller intent
// ═══════════════════════════════════════════════════════════════════════════

// ── Quarantine drain period — recovery must wait this long after quarantine ──
export const QUARANTINE_DRAIN_MS = 2 * 60 * 1000; // 2 minutes

// ── Verify exact PI metadata (7C.7 fix #2) ──────────────────────────────────
// All four metadata fields must exist and match exactly.
// Purchase.payment_intent_id and PurchasePrivate.payment_intent_id must
// agree with the retrieved PI's id.
// Missing purchase_id is a mismatch, never optional.
export function verifyExactPIMetadata(purchase, pp, pi) {
  if (!purchase || !pp || !pi) return false;
  if (!pi.metadata) return false;
  if (!pi.metadata.purchase_id) return false;
  if (pi.metadata.purchase_id !== purchase.id) return false;
  if (pi.metadata.listing_id !== purchase.listing_id) return false;
  if (pi.metadata.buyer_email !== pp.buyer_email) return false;
  if (pi.metadata.reservation_token !== pp.reservation_token) return false;
  if (purchase.payment_intent_id !== pi.id) return false;
  if (pp.payment_intent_id !== pi.id) return false;
  return true;
}

// ── Check for durable seller cancel intent (7C.7 fix #5) ────────────────────
export function hasSellerCancelIntent(lp) {
  if (!lp) return false;
  return !!lp.seller_cancel_requested_at;
}

// ── Check for durable seller pause intent (7C.7 fix #5) ─────────────────────
export function hasSellerPauseIntent(lp) {
  if (!lp) return false;
  return !!lp.seller_pause_requested_at;
}

// ── Match current LP state against durable quarantine snapshot (7C.7 fix #4)
// Recovery requires current reservation_token, reserved_by_email, and
// reservation_expires_at to exactly match the values captured at quarantine
// time. If any differ (e.g. a new token appeared), leave quarantined.
export function matchesQuarantineSnapshot(lp) {
  if (!lp) return false;
  if (lp.reservation_token !== (lp.quarantined_reservation_token ?? null)) return false;
  if (lp.reserved_by_email !== (lp.quarantined_buyer ?? null)) return false;
  if (lp.reservation_expires_at !== (lp.quarantined_expiration ?? null)) return false;
  return true;
}

// ── Check if drain period has passed (7C.7 fix #4) ───────────────────────────
export function drainPeriodPassed(lp, currentTime) {
  if (!lp || !lp.recovery_not_before) return true;
  return currentTime >= new Date(lp.recovery_not_before).getTime();
}

// ═══════════════════════════════════════════════════════════════════════════
// 7C.8 — Immutable quarantine snapshot, generation enforcement, recovery block
// ═══════════════════════════════════════════════════════════════════════════

// ── Check if recovery is blocked by a durable marker (7C.8 fix #1) ──────────
export function isRecoveryBlocked(lp) {
  if (!lp) return false;
  return lp.recovery_blocked === true;
}

// ── Check if current reservation state matches the immutable snapshot (7C.8 fix #1)
// If current token/buyer/expiry differ from the snapshot, the quarantine is
// in a conflicted state and automatic recovery must be blocked.
export function snapshotMatchesCurrentState(lp) {
  if (!lp) return false;
  const currentToken = lp.reservation_token ?? null;
  const currentBuyer = lp.reserved_by_email ?? null;
  const currentExpiry = lp.reservation_expires_at ?? null;
  const snapToken = lp.quarantined_reservation_token ?? null;
  const snapBuyer = lp.quarantined_buyer ?? null;
  const snapExpiry = lp.quarantined_expiration ?? null;
  return currentToken === snapToken && currentBuyer === snapBuyer && currentExpiry === snapExpiry;
}

// ── Check if both Listing and LP reservation fields are already null (7C.8 fix #3)
// Automatic recovery may activate only when both are null — no token to erase.
export function reservationFieldsAlreadyNull(listing, lp) {
  const lNull = !listing || (!listing.reservation_token && !listing.reserved_by_email && !listing.reservation_expires_at);
  const lpNull = !lp || (!lp.reservation_token && !lp.reserved_by_email && !lp.reservation_expires_at);
  return lNull && lpNull;
}

// ── Verify generation, PI ID, and purchase ID match recovery capture (7C.8 fix #2)
export function verifyGenerationMatch(capturedGen, capturedPiId, capturedPurchaseId, currentLP) {
  if (!currentLP) return false;
  if (currentLP.quarantine_generation !== capturedGen) return false;
  if (currentLP.checkout_quarantine_pi_id !== capturedPiId) return false;
  if (currentLP.quarantined_purchase_id !== capturedPurchaseId) return false;
  return true;
}

// ── Check if the quarantine snapshot has a token-bearing reservation (7C.8 fix #3)
// Token-bearing quarantines require clearing before activation. Because Base44
// lacks atomic conditional updates, we must verify after clearing that no new
// token appeared.
export function isTokenBearingQuarantine(lp) {
  if (!lp) return false;
  return !!lp.quarantined_reservation_token;
}