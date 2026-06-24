/**
 * Shared listing visibility utilities.
 * Used across EventDetail, EventDetailUpgrade, UpgradeFeed, and ListingCard
 * to enforce consistent reservation and sold-listing filtering.
 */

const HIDDEN_STATUSES = ['sold', 'expired', 'cancelled', 'hidden', 'pending_payout_setup'];

/**
 * Check if a listing should be visible to the given user in public feeds.
 * A listing is visible if:
 *   - status is 'active' (not sold/expired/cancelled/hidden)
 *   - proof_status is 'approved'
 *   - not reserved by another user (or reservation expired)
 */
export function isListingVisible(listing, currentUserEmail) {
  if (!listing) return false;
  if (HIDDEN_STATUSES.includes(listing.status)) return false;
  if (listing.proof_status !== 'approved') return false;

  // Reserved by another user with a non-expired reservation → hide
  if (isReservedByOther(listing, currentUserEmail)) return false;

  return true;
}

/**
 * Check if a listing is currently reserved by the current user (reservation not expired).
 */
export function isReservedByMe(listing, currentUserEmail) {
  if (!listing || !currentUserEmail) return false;
  if (listing.reserved_by_email !== currentUserEmail) return false;
  if (!listing.reservation_expires_at) return false;
  return new Date(listing.reservation_expires_at).getTime() > Date.now();
}

/**
 * Check if a listing is currently reserved by another user (reservation not expired).
 */
export function isReservedByOther(listing, currentUserEmail) {
  if (!listing) return false;
  if (!listing.reserved_by_email) return false;
  if (listing.reserved_by_email === currentUserEmail) return false;
  if (!listing.reservation_expires_at) return false;
  return new Date(listing.reservation_expires_at).getTime() > Date.now();
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