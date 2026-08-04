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
// to their paused states. Both rollback writes are AWAITED and VERIFIED.
// If either rollback cannot be verified, persists a durable recovery_blocked marker
// and a critical AdminAlert with the actual final state. Returns a neutral 500.
// Never claims "Listing reverted to paused" unless both were re-fetched and verified.
export async function clearPauseMarkerAfterResume(deps, { listing_id, listing_entity_id, seat_inventory_id }) {
  const lpRows = await deps.entities.ListingPrivate.filter({ listing_id });
  const lp = lpRows[0];
  if (!lp) {
    return { status: 500, error: 'ListingPrivate not found for pause marker clearing.' };
  }

  let clearFailed = false;
  let clearError = null;

  // Step 1: Try to clear the pause marker — awaited, no catch-and-ignore
  try {
    await deps.entities.ListingPrivate.update(lp.id, { seller_pause_requested_at: null });
  } catch (err) {
    clearFailed = true;
    clearError = err;
  }

  // Step 2: Verify the clear
  if (!clearFailed) {
    const lpVerifyRows = await deps.entities.ListingPrivate.filter({ listing_id });
    const lpVerify = lpVerifyRows[0];
    if (lpVerify && lpVerify.seller_pause_requested_at !== null && lpVerify.seller_pause_requested_at !== undefined) {
      clearFailed = true;
      clearError = new Error('Pause marker verification failed — still present after clear.');
    }
  }

  if (!clearFailed) {
    return { status: 200, ok: true };
  }

  // Step 3: Clear failed — rollback Listing and SeatInventory
  // Await both writes — NO catch-and-ignore
  let listingRollbackError = null;
  try {
    await deps.entities.Listing.update(listing_entity_id, { status: 'hidden', hidden_reason: 'other' });
  } catch (err) {
    listingRollbackError = err;
  }

  let seatRollbackError = null;
  if (seat_inventory_id) {
    try {
      await deps.entities.SeatInventory.update(seat_inventory_id, { inventory_status: 'available', inventory_intent: 'undecided' });
    } catch (err) {
      seatRollbackError = err;
    }
  }

  // Step 4: Re-fetch and verify both rollbacks
  let listingRollbackVerified = false;
  try {
    const listingRows = await deps.entities.Listing.filter({ id: listing_entity_id });
    const listingFinal = listingRows[0];
    if (listingFinal && listingFinal.status === 'hidden' && listingFinal.hidden_reason === 'other') {
      listingRollbackVerified = true;
    }
  } catch (_) { /* re-fetch failure means not verified */ }

  let seatRollbackVerified = !seat_inventory_id;
  if (seat_inventory_id) {
    try {
      const seatRows = await deps.entities.SeatInventory.filter({ id: seat_inventory_id });
      const seatFinal = seatRows[0];
      if (seatFinal && seatFinal.inventory_status === 'available' && seatFinal.inventory_intent === 'undecided') {
        seatRollbackVerified = true;
      }
    } catch (_) { /* re-fetch failure means not verified */ }
  }

  // Step 5: If both rollbacks verified, listing is safely paused
  if (listingRollbackVerified && seatRollbackVerified) {
    return { status: 500, error: 'Failed to clear pause intent. Listing reverted to paused.' };
  }

  // Step 6: Rollback incomplete — durable fail-closed marker + critical alert
  const actualState = {
    listingRollbackVerified,
    seatRollbackVerified,
    listingRollbackError: listingRollbackError?.message,
    seatRollbackError: seatRollbackError?.message,
    clearError: clearError?.message,
    pauseMarkerStillPresent: true,
  };
  try {
    const listingRows = await deps.entities.Listing.filter({ id: listing_entity_id });
    actualState.listingStatus = listingRows[0]?.status;
  } catch (_) { /* best effort */ }

  try {
    await deps.entities.ListingPrivate.update(lp.id, {
      recovery_blocked: true,
      recovery_blocked_reason: `Pause marker clear failed and rollback incomplete. Clear error: ${clearError?.message}. Listing rollback verified: ${listingRollbackVerified}. Seat rollback verified: ${seatRollbackVerified}. Actual state: ${JSON.stringify(actualState)}.`,
      recovery_blocked_at: new Date(deps.now()).toISOString(),
    });
  } catch (_) { /* best effort — alert is the durable record */ }

  try {
    await deps.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'critical',
      title: `PAUSE ROLLBACK FAILED for ${listing_id}`,
      description: `Pause marker clear failed and rollback could not be verified. Clear error: ${clearError?.message}. Listing rollback verified: ${listingRollbackVerified}. Seat rollback verified: ${seatRollbackVerified}. Actual state: ${JSON.stringify(actualState)}. Manual resolution required.`,
      reference_type: 'listing',
      reference_id: listing_id,
    });
  } catch (_) { /* alert failure must never throw */ }

  return { status: 500, error: 'Failed to clear pause intent. Manual resolution required.' };
}