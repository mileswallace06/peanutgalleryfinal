/**
 * getListingParticipantView — return an allowlisted listing view for the
 * calling participant (buyer / seller / admin / public).
 *
 * Three modes:
 *   1. Single record:  { listing_id }
 *   2. List by event:  { action: "list_active_by_event", event_id }
 *   3. List by seller: { action: "list_mine" }
 *
 * ListingPrivate is required (Phase 1A migration is complete). No legacy
 * fallback for sensitive fields.
 *
 * list_mine returns ALL of the seller's listings regardless of public
 * visibility. Identity comes exclusively from authenticated user.email.
 * ListingPrivate seller_email is authoritative.
 *
 * Never exposed to any role: seller_email, reserved_by_email,
 * reservation_token, proof_url, ticket_file_url, notes, private file/storage
 * identifiers, custody internals, fraud fields, admin-only identifiers.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { getListingPrivate } from '../../shared/privateData.ts';

const MAX_ID_LENGTH = 200;

// ── Input validation ────────────────────────────────────────────────────────
function validateId(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_ID_LENGTH) return false;
  if (value.trim().length === 0) return false;
  return true;
}

// ── Shared safe serializer (public / single record) ──────────────────────────
function serializeListing(listing, lp, viewerEmail, role, isConfirmedBuyer) {
  const authoritativeSellerEmail = lp?.seller_email ?? null;
  const authoritativeProofStatus = lp?.proof_status ?? null;
  const authoritativeSeats = lp?.seats ?? null;
  const authoritativeIsDemo = lp?.is_demo_listing ?? false;
  const authoritativeCustodyStatus = lp?.custody_status ?? null;
  const authoritativeReservedBy = lp?.reserved_by_email ?? null;
  const authoritativeReservationExpiresAt = lp?.reservation_expires_at ?? null;

  const isSeller = !!(viewerEmail && authoritativeSellerEmail === viewerEmail);
  const isAdmin = role === 'admin';

  const now = Date.now();
  const isReservationActive = !!(authoritativeReservedBy &&
    authoritativeReservationExpiresAt &&
    new Date(authoritativeReservationExpiresAt).getTime() > now);

  let reservationState = 'available';
  if (isReservationActive) {
    if (authoritativeReservedBy === viewerEmail) {
      reservationState = 'reserved_for_you';
    } else {
      reservationState = 'reserved_by_other';
    }
  }

  const out = {
    id: listing.id,
    event_id: listing.event_id,
    section: listing.section,
    row: listing.row,
    quantity: listing.quantity,
    tier: listing.tier,
    asking_price: listing.asking_price,
    original_price: listing.original_price,
    transfer_method: listing.transfer_method,
    status: listing.status,
    listing_mode: listing.listing_mode,
    listing_type: listing.listing_type,
    transfer_status: listing.transfer_status,
    listing_transfer_mode: listing.listing_transfer_mode,
    transfer_confidence_score: listing.transfer_confidence_score,
    last_transfer_verification: listing.last_transfer_verification,
    requires_location: listing.requires_location,
    location_requirement: listing.location_requirement,
    requires_existing_ticket: listing.requires_existing_ticket,
    is_demo_listing: !!authoritativeIsDemo,
    is_verified: authoritativeProofStatus === 'approved',
    is_instant_ready: listing.listing_mode === 'instant' && authoritativeCustodyStatus === 'verified',
    viewer_is_seller: isSeller,
    reservation_state: reservationState,
  };

  if (isSeller || isConfirmedBuyer || isAdmin) {
    out.seats = authoritativeSeats;
  }

  if (reservationState === 'reserved_for_you' || isSeller || isAdmin) {
    out.reservation_expires_at = authoritativeReservationExpiresAt;
  }

  return out;
}

// ── Seller-list serializer (list_mine) — exactly 26 keys, strict allowlist ───
function serializeSellerListing(listing, lp, viewerEmail) {
  const authoritativeSeats = lp?.seats ?? null;
  const authoritativeProofStatus = lp?.proof_status ?? null;
  const authoritativeProofRejectionReason = lp?.proof_rejection_reason ?? null;
  const authoritativeIsDemo = lp?.is_demo_listing ?? false;
  const authoritativeCustodyStatus = lp?.custody_status ?? null;
  const authoritativeReservedBy = lp?.reserved_by_email ?? null;
  const authoritativeReservationExpiresAt = lp?.reservation_expires_at ?? null;

  const isSeller = !!(viewerEmail && lp?.seller_email === viewerEmail);

  const now = Date.now();
  const isReservationActive = !!(authoritativeReservedBy &&
    authoritativeReservationExpiresAt &&
    new Date(authoritativeReservationExpiresAt).getTime() > now);

  let reservationState = 'available';
  if (isReservationActive) {
    if (authoritativeReservedBy === viewerEmail) {
      reservationState = 'reserved_for_you';
    } else {
      reservationState = 'reserved_by_other';
    }
  }

  return {
    id: listing.id,
    event_id: listing.event_id ?? null,
    section: listing.section ?? null,
    row: listing.row ?? null,
    seats: authoritativeSeats,
    quantity: listing.quantity ?? null,
    tier: listing.tier ?? null,
    asking_price: listing.asking_price ?? null,
    original_price: listing.original_price ?? null,
    transfer_method: listing.transfer_method ?? null,
    status: listing.status ?? null,
    hidden_reason: listing.hidden_reason ?? null,
    listing_mode: listing.listing_mode ?? null,
    listing_type: listing.listing_type ?? null,
    transfer_status: listing.transfer_status ?? null,
    listing_transfer_mode: listing.listing_transfer_mode ?? null,
    transfer_confidence_score: listing.transfer_confidence_score ?? null,
    last_transfer_verification: listing.last_transfer_verification ?? null,
    proof_status: authoritativeProofStatus,
    proof_rejection_reason: authoritativeProofRejectionReason,
    is_demo_listing: !!authoritativeIsDemo,
    is_instant_ready: listing.listing_mode === 'instant' && authoritativeCustodyStatus === 'verified',
    reservation_state: reservationState,
    reservation_expires_at: authoritativeReservationExpiresAt,
    viewer_is_seller: isSeller,
    created_date: listing.created_date ?? null,
  };
}

// ── Idempotent integrity alert (no catch on lookup) ──────────────────────────
async function alertListingIntegrityFailure(base44, title, listing_id, description) {
  const sr = base44.asServiceRole;
  try {
    const existing = await sr.entities.AdminAlert.filter({
      title,
      reference_type: 'listing',
      reference_id: listing_id,
    });

    const unresolved = existing.filter(a => !a.resolved);
    if (unresolved.length > 0) return;

    await sr.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'high',
      title,
      description,
      reference_type: 'listing',
      reference_id: listing_id,
    });
  } catch (_) { /* alert failure must never throw */ }
}

// ── Fetch Listings by ID using $in chunks (one query per ≤500 IDs) ──────────
async function fetchListingsByIds(sr, ids) {
  const CHUNK_SIZE = 500;
  const results = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const chunkResults = await sr.entities.Listing.filter({
      id: { $in: chunk }
    }, 'id', CHUNK_SIZE);
    results.push(...chunkResults);
  }
  return results;
}

// ── Fetch ListingPrivate by listing_id using $in chunks ──────────────────────
async function fetchListingPrivatesByListingIds(sr, ids) {
  const CHUNK_SIZE = 500;
  const results = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const chunkResults = await sr.entities.ListingPrivate.filter({
      listing_id: { $in: chunk }
    }, 'id', CHUNK_SIZE);
    results.push(...chunkResults);
  }
  return results;
}

// ── Stable sort: newest-first by created_date, then ID ───────────────────────
function sortByCreatedThenId(a, b) {
  const dateA = new Date(a.created_date || 0).getTime();
  const dateB = new Date(b.created_date || 0).getTime();
  if (dateB !== dateA) return dateB - dateA;
  return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user = null;
  try { user = await base44.auth.me(); } catch (_) { user = null; }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const sr = base44.asServiceRole;
  const viewerEmail = user?.email || null;
  const role = user?.role || null;

  // ── Input validation: action must be a string when supplied ──
  if (action !== undefined && typeof action !== 'string') {
    return Response.json({ error: 'action must be a string', code: 'INVALID_INPUT' }, { status: 400 });
  }

  // ── List action: list_mine ──────────────────────────────────────────────────
  if (action === 'list_mine') {
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    try {
      // ── Step 1: Fetch ListingPrivate by seller_email (authoritative, NO catch) ──
      const sellerLPs = await sr.entities.ListingPrivate.filter(
        { seller_email: viewerEmail }, '-created_date', 500
      );

      // ── Step 2: Build LP map (deduplicate by listing_id) ──
      const lpMap = new Map();
      for (const lp of sellerLPs) {
        if (lp.listing_id && !lpMap.has(lp.listing_id)) lpMap.set(lp.listing_id, lp);
      }

      // ── Step 3: Fetch Listings by $in chunks (NO catch) ──
      const listings = lpMap.size > 0 ? await fetchListingsByIds(sr, [...lpMap.keys()]) : [];
      const listingMap = new Map(listings.map(l => [l.id, l]));

      // ── Step 4: Detect genuinely missing sidecars ──
      // Legacy Listing query finds listings by legacy seller_email.
      // A listing absent from the LP map might:
      //   (a) have no ListingPrivate at all (genuine missing sidecar), OR
      //   (b) have a ListingPrivate under another authoritative identity.
      // Only (a) warrants an alert.
      const candidateMissingIds = new Set();
      const legacyListings = await sr.entities.Listing.filter(
        { seller_email: viewerEmail }, '-created_date', 500
      );
      for (const l of legacyListings) {
        if (!lpMap.has(l.id)) candidateMissingIds.add(l.id);
      }

      if (candidateMissingIds.size > 0) {
        const candidateIds = [...candidateMissingIds];
        const existingLPs = await fetchListingPrivatesByListingIds(sr, candidateIds);
        const globalLPIds = new Set(existingLPs.map(lp => lp.listing_id));

        for (const lid of candidateIds) {
          if (!globalLPIds.has(lid)) {
            await alertListingIntegrityFailure(base44, 'ListingPrivate sidecar missing', lid,
              `Listing ${lid} exists but has no ListingPrivate sidecar.`);
          }
        }
      }

      // ── Step 5: Serialize + detect orphan ListingPrivate ──
      const results = [];
      for (const [lid, lp] of lpMap) {
        const listing = listingMap.get(lid);
        if (!listing) {
          await alertListingIntegrityFailure(base44, 'Orphan ListingPrivate record', lid,
            `ListingPrivate for listing ${lid} exists but the Listing record is missing.`);
          continue;
        }
        results.push(serializeSellerListing(listing, lp, viewerEmail));
      }

      // ── Step 6: Sort + limit ──
      results.sort(sortByCreatedThenId);
      const final = results.slice(0, 500);

      return Response.json({ listings: final });
    } catch (err) {
      console.error('[getListingParticipantView] list_mine failed:', err?.message || err);
      return Response.json({
        error: 'Unable to load listing history',
        code: 'LISTING_HISTORY_UNAVAILABLE',
      }, { status: 500 });
    }
  }

  // ── List action: list_active_by_event ──
  if (action === 'list_active_by_event') {
    const event_id = body?.event_id;
    if (!validateId(event_id)) {
      return Response.json({ error: 'event_id must be a nonempty string', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const listings = await sr.entities.Listing.filter(
      { event_id, status: 'active' },
      'asking_price',
      200
    ).catch(() => []);

    if (listings.length === 0) {
      return Response.json({ listings: [] });
    }

    const listingPrivates = await sr.entities.ListingPrivate.filter(
      { event_id }, 'id', 500
    ).catch(() => []);
    const lpMap = new Map();
    for (const lp of listingPrivates) {
      if (lp.listing_id) lpMap.set(lp.listing_id, lp);
    }

    const confirmedListingIds = new Set();
    if (viewerEmail) {
      const buyerPurchases = await sr.entities.PurchasePrivate.filter(
        { event_id, buyer_email: viewerEmail }, 'id', 500
      ).catch(() => []);
      for (const pp of buyerPurchases) {
        if (pp.listing_id) confirmedListingIds.add(pp.listing_id);
      }
    }

    const now = Date.now();
    const result = [];
    for (const listing of listings) {
      const lp = lpMap.get(listing.id);

      if (!lp) {
        console.warn(`[getListingParticipantView] integrity failure: ListingPrivate missing for listing ${listing.id}`);
        continue;
      }

      if (lp.proof_status !== 'approved') continue;

      const reservedBy = lp.reserved_by_email;
      const reservationExpiresAt = lp.reservation_expires_at;
      const isReservationActive = !!(reservedBy && reservationExpiresAt &&
        new Date(reservationExpiresAt).getTime() > now);

      const isSeller = !!(viewerEmail && lp.seller_email === viewerEmail);
      const isAdmin = role === 'admin';

      if (isReservationActive && reservedBy !== viewerEmail && !isSeller && !isAdmin) {
        continue;
      }

      const isConfirmedBuyer = confirmedListingIds.has(listing.id);
      result.push(serializeListing(listing, lp, viewerEmail, role, isConfirmedBuyer));
    }

    return Response.json({ listings: result });
  }

  // ── Unknown action → 400 ──
  if (action) {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }

  // ── Single record ──
  const listing_id = body?.listing_id;
  if (!validateId(listing_id)) {
    return Response.json({ error: 'listing_id must be a nonempty string', code: 'INVALID_INPUT' }, { status: 400 });
  }

  const rows = await sr.entities.Listing.filter({ id: listing_id });
  const listing = rows[0];
  if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });

  const lp = await getListingPrivate(base44, listing.id);

  if (!lp) {
    if (role === 'admin') {
      console.error(`[getListingParticipantView] integrity failure: ListingPrivate missing for listing ${listing.id} (admin view)`);
      return Response.json({ error: 'Listing integrity error: private record missing', code: 'INTEGRITY_ERROR' }, { status: 500 });
    }
    if (viewerEmail) {
      const buyerPurchases = await sr.entities.PurchasePrivate.filter(
        { listing_id: listing.id, buyer_email: viewerEmail }, 'id', 500
      ).catch(() => []);
      if (buyerPurchases.length > 0) {
        console.error(`[getListingParticipantView] integrity failure: ListingPrivate missing for listing ${listing.id} (confirmed buyer view)`);
        return Response.json({ error: 'Listing integrity error: private record missing', code: 'INTEGRITY_ERROR' }, { status: 500 });
      }
    }
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }

  const authoritativeSellerEmail = lp.seller_email;
  const isSeller = !!(viewerEmail && authoritativeSellerEmail === viewerEmail);
  const isAdmin = role === 'admin';

  let isConfirmedBuyer = false;
  if (!isSeller && !isAdmin && viewerEmail) {
    const buyerPurchases = await sr.entities.PurchasePrivate.filter(
      { listing_id: listing.id, buyer_email: viewerEmail }, 'id', 500
    ).catch(() => []);
    isConfirmedBuyer = buyerPurchases.length > 0;
  }

  if (isSeller || isConfirmedBuyer || isAdmin) {
    return Response.json({ listing: serializeListing(listing, lp, viewerEmail, role, isConfirmedBuyer) });
  }

  if (listing.status !== 'active') {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }
  if (lp.proof_status !== 'approved') {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }
  const now = Date.now();
  const reservedBy = lp.reserved_by_email;
  const reservationExpiresAt = lp.reservation_expires_at;
  const isReservationActive = !!(reservedBy && reservationExpiresAt &&
    new Date(reservationExpiresAt).getTime() > now);
  if (isReservationActive && reservedBy !== viewerEmail) {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }

  return Response.json({ listing: serializeListing(listing, lp, viewerEmail, role, false) });
});