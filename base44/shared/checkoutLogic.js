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