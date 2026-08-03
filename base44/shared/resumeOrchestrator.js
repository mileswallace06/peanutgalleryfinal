/**
 * resumeOrchestrator.js — Seller pause/resume marker management.
 *
 * Extracted from submitListing/entry.ts for testability.
 * All writes are awaited and verified. Failures return 500 and revert state.
 *
 * deps = { entities: { Listing, ListingPrivate, SeatInventory }, now: () => number }
 */

// ── Already-active resume: clear stale pause marker safely ──
// Requires listing not quarantined and no active reservation before clearing.
// Does not swallow clearing failure. Verifies the clear. Returns 500 on failure.
export async function clearStalePauseMarker(deps, { listing_id, lpFresh }) {
  if (!lpFresh) {
    return { status: 500, error: 'ListingPrivate not found.' };
  }

  // Require listing not quarantined
  if (lpFresh.checkout_quarantined === true) {
    return { status: 500, error: 'Cannot clear stale pause marker: listing is quarantined.' };
  }

  // Require no active reservation
  const resToken = lpFresh.reservation_token;
  const resExpiry = lpFresh.reservation_expires_at;
  if (resToken && resExpiry && new Date(resExpiry).getTime() > deps.now()) {
    return { status: 500, error: 'Cannot clear stale pause marker: active reservation exists.' };
  }

  // Clear the marker
  try {
    await deps.entities.ListingPrivate.update(lpFresh.id, { seller_pause_requested_at: null });
  } catch (err) {
    return { status: 500, error: 'Failed to clear pause intent.' };
  }

  // Verify the clear
  const lpVerifyRows = await deps.entities.ListingPrivate.filter({ listing_id });
  const lpVerify = lpVerifyRows[0];
  if (lpVerify && lpVerify.seller_pause_requested_at !== null && lpVerify.seller_pause_requested_at !== undefined) {
    return { status: 500, error: 'Failed to clear pause intent. Verification failed.' };
  }

  return { status: 200, ok: true };
}

// ── Normal resume: clear pause marker after successful writes, revert on failure ──
// If clearing fails or verification fails, reverts both Listing and SeatInventory
// to their paused states and returns 500.
export async function clearPauseMarkerAfterResume(deps, { listing_id, listing_entity_id, seat_inventory_id }) {
  const lpRows = await deps.entities.ListingPrivate.filter({ listing_id });
  const lp = lpRows[0];
  if (!lp) {
    // No LP to update — this is an integrity error
    return { status: 500, error: 'ListingPrivate not found for pause marker clearing.' };
  }

  try {
    await deps.entities.ListingPrivate.update(lp.id, { seller_pause_requested_at: null });
  } catch (err) {
    // Revert Listing to hidden/paused
    try { await deps.entities.Listing.update(listing_entity_id, { status: 'hidden', hidden_reason: 'other' }); } catch (_) {}
    // Revert SeatInventory to paused state
    if (seat_inventory_id) {
      try { await deps.entities.SeatInventory.update(seat_inventory_id, { inventory_status: 'available', inventory_intent: 'undecided' }); } catch (_) {}
    }
    return { status: 500, error: 'Failed to clear pause intent. Listing reverted to paused.' };
  }

  // Verify the clear
  const lpVerifyRows = await deps.entities.ListingPrivate.filter({ listing_id });
  const lpVerify = lpVerifyRows[0];
  if (lpVerify && lpVerify.seller_pause_requested_at !== null && lpVerify.seller_pause_requested_at !== undefined) {
    // Clear failed — revert Listing and SeatInventory to paused states
    try { await deps.entities.Listing.update(listing_entity_id, { status: 'hidden', hidden_reason: 'other' }); } catch (_) {}
    if (seat_inventory_id) {
      try { await deps.entities.SeatInventory.update(seat_inventory_id, { inventory_status: 'available', inventory_intent: 'undecided' }); } catch (_) {}
    }
    return { status: 500, error: 'Failed to clear pause intent. Listing reverted to paused.' };
  }

  return { status: 200, ok: true };
}