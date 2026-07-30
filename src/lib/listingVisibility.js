/**
 * Shared listing visibility utilities.
 * Used across EventDetail, EventDetailUpgrade, UpgradeFeed, MoveCloserRail,
 * and ListingCard to enforce consistent reservation and sold-listing filtering.
 *
 * Phase 1B-2: Uses safe backend-provided fields (is_verified, reservation_state,
 * is_demo_listing, viewer_is_seller) instead of private entity fields.
 */

const HIDDEN_STATUSES = ['sold', 'expired', 'cancelled', 'hidden', 'pending_payout_setup'];

/**
 * Check if a listing should be visible to the given user in public feeds.
 * A listing is visible if:
 *   - status is not in HIDDEN_STATUSES
 *   - is_verified is true (authoritative proof_status === 'approved')
 *   - not reserved by another user (reservation_state !== 'reserved_by_other')
 */
export function isListingVisible(listing, currentUserEmail) {
  if (!listing) return false;
  if (HIDDEN_STATUSES.includes(listing.status)) return false;
  if (listing.is_verified !== true) return false;
  if (isReservedByOther(listing, currentUserEmail)) return false;
  return true;
}

/**
 * Check if a listing is currently reserved by the current user.
 * Uses backend-provided reservation_state.
 */
export function isReservedByMe(listing, currentUserEmail) {
  if (!listing) return false;
  return listing.reservation_state === 'reserved_for_you';
}

/**
 * Check if a listing is currently reserved by another user.
 * Uses backend-provided reservation_state.
 */
export function isReservedByOther(listing, currentUserEmail) {
  if (!listing) return false;
  return listing.reservation_state === 'reserved_by_other';
}

/**
 * Check if a listing is sold.
 */
export function isSold(listing) {
  return listing?.status === 'sold';
}

/**
 * Get remaining reservation time in seconds (0 if expired).
 */
export function getReservationSecondsRemaining(listing) {
  if (!listing?.reservation_expires_at) return 0;
  const remaining = Math.floor((new Date(listing.reservation_expires_at).getTime() - Date.now()) / 1000);
  return Math.max(0, remaining);
}

/**
 * Format seconds as M:SS for countdown display.
 */
export function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}