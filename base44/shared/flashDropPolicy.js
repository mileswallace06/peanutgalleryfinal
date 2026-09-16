const SAFE_LISTING_TRANSFER_METHODS = new Set(['platform_transfer', 'email_transfer']);
const SAFE_OWNERSHIP_METHODS = new Set(['verified_listing', 'verified_ticket_file']);

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

function same(value, expected) {
  return normalized(value) === normalized(expected);
}

function rejected(code, error) {
  return { ok: false, code, error };
}

/**
 * Validate an existing sale listing before it can be converted into a Flash
 * Drop. ListingPrivate is authoritative for identity and proof approval; the
 * public Listing must agree with it and still be safely transferable.
 */
export function validateFlashDropListing({ listing, listingPrivate, userEmail, eventId, section }) {
  if (!listing) {
    return rejected('OWNERSHIP_LISTING_NOT_FOUND', 'The linked listing could not be found. Choose another verified listing.');
  }
  if (!listingPrivate) {
    return rejected('OWNERSHIP_LISTING_INTEGRITY', 'The linked listing is missing its private verification record. Contact support.');
  }

  const identityMatches =
    same(listing.seller_email, userEmail) &&
    same(listingPrivate.seller_email, userEmail) &&
    same(listing.event_id, eventId) &&
    same(listingPrivate.event_id, eventId) &&
    same(listing.section, section) &&
    same(listingPrivate.section, section);
  if (!identityMatches) {
    return rejected('OWNERSHIP_LISTING_MISMATCH', 'That listing does not match your account, event, and section.');
  }

  if (listing.status !== 'active') {
    return rejected('OWNERSHIP_LISTING_NOT_ACTIVE', 'Only an active listing can be converted into a Flash Drop.');
  }
  if (listing.proof_status !== 'approved' || listingPrivate.proof_status !== 'approved') {
    return rejected('OWNERSHIP_PROOF_NOT_APPROVED', 'The linked listing must have approved ownership proof first.');
  }
  if (listing.transfer_status !== 'transfer_confirmed' || !SAFE_LISTING_TRANSFER_METHODS.has(listing.transfer_method)) {
    return rejected('TRANSFER_NOT_SAFE', 'The linked listing must support a confirmed electronic ticket transfer.');
  }
  if (listingPrivate.checkout_quarantined || listingPrivate.recovery_blocked) {
    return rejected('OWNERSHIP_LISTING_QUARANTINED', 'That listing is under review and cannot be used for a Flash Drop.');
  }
  if (listingPrivate.reservation_token || listingPrivate.reserved_by_email) {
    return rejected('OWNERSHIP_LISTING_RESERVED', 'That listing is already reserved by a buyer and cannot be changed.');
  }
  if (listingPrivate.seller_cancel_requested_at || listingPrivate.seller_pause_requested_at) {
    return rejected('OWNERSHIP_LISTING_PENDING_CHANGE', 'That listing already has a pending seller change. Refresh and try again.');
  }

  return {
    ok: true,
    canonical: {
      section: listingPrivate.section,
      row: listingPrivate.row ?? listing.row ?? null,
      seats: listingPrivate.seats ?? listing.seats ?? null,
      quantity: listingPrivate.quantity ?? listing.quantity ?? 1,
    },
  };
}

export function canCloseFlashDrop(drop, user) {
  return Boolean(drop && user && (user.role === 'admin' || same(drop.donor_email, user.email)));
}

export function deliveryActorFor(drop, user) {
  if (!drop || !user?.email) return null;
  if (same(drop.donor_email, user.email)) return 'donor';
  if (same(drop.winner_email, user.email)) return 'winner';
  return null;
}

export function isSafeFlashDrop(drop) {
  return Boolean(
    drop?.ownership_verified === true &&
    SAFE_OWNERSHIP_METHODS.has(drop.ownership_verification_method) &&
    drop.ownership_delivery_method === 'ticket_transfer'
  );
}

export function isSafeListingTransferMethod(method) {
  return SAFE_LISTING_TRANSFER_METHODS.has(method);
}
