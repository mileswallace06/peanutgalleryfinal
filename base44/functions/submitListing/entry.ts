import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertListingPrivate, recordLegacyProofUrl, readUserSecurity, alertPrivateWriteFailure } from '../../shared/privateData.ts';
import { clearStalePauseMarker, clearPauseMarkerAfterResume } from '../../shared/resumeOrchestrator.js';

async function checkSuspicious(base44, sellerEmail, askingPrice) {
  const [purchases, allListings, sellerUsers] = await Promise.all([
    base44.asServiceRole.entities.Purchase.filter({ seller_email: sellerEmail }),
    base44.asServiceRole.entities.Listing.filter({ seller_email: sellerEmail }),
    base44.asServiceRole.entities.User.filter({ email: sellerEmail }),
  ]);
  const seller = sellerUsers[0];
  const strikeCount = seller ? await readUserSecurity(base44, seller, 'strike_count') : 0;
  if (strikeCount > 0) return { flagged: true, reason: `Seller has ${strikeCount} strike(s)` };
  const disputed = purchases.filter(p => p.transfer_status === 'disputed');
  if (disputed.length > 0) return { flagged: true, reason: `Seller has ${disputed.length} prior dispute(s)` };
  const expired = purchases.filter(p => p.transfer_status === 'expired' && !p.seller_confirmed);
  if (expired.length >= 3) return { flagged: true, reason: `Seller has ${expired.length} failed transfers` };
  const activeListings = allListings.filter(l => l.status === 'active');
  if (activeListings.length >= 10) return { flagged: true, reason: `Seller has ${activeListings.length} active listings (possible spam)` };
  if (askingPrice > 2000) return { flagged: true, reason: `Asking price $${askingPrice} is unusually high` };
  return { flagged: false, reason: null };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  // ── Input validation: action must be a string when supplied ──
  if (action !== undefined && typeof action !== 'string') {
    return Response.json({ error: 'action must be a string', code: 'INVALID_INPUT' }, { status: 400 });
  }

  // ── Manage existing listing (pause / resume / cancel) ──
  // This branch runs before all listing-creation logic.
  if (action === 'manage_existing') {
    const operation = body?.operation;
    if (typeof operation !== 'string' || !['pause', 'resume', 'cancel'].includes(operation)) {
      return Response.json({ error: 'operation must be pause, resume, or cancel', code: 'INVALID_INPUT' }, { status: 400 });
    }
    const listing_id = body?.listing_id;
    if (typeof listing_id !== 'string' || listing_id.length === 0 || listing_id.length > 200 || listing_id.trim().length === 0) {
      return Response.json({ error: 'listing_id must be a nonempty string', code: 'INVALID_INPUT' }, { status: 400 });
    }

    // Maintenance gate — before any mutation
    if (isMaintenanceActive()) {
      return maintenance503('Listing management is temporarily unavailable for scheduled maintenance.');
    }

    // Fetch ListingPrivate (authoritative seller identity)
    const lpResults = await base44.asServiceRole.entities.ListingPrivate.filter({ listing_id });
    const lp = lpResults[0];
    if (!lp) {
      return Response.json({ error: 'Listing not found' }, { status: 404 });
    }

    // Authorize exclusively through ListingPrivate.seller_email — never Listing.seller_email
    if (lp.seller_email !== user.email) {
      return Response.json({ error: 'Listing not found' }, { status: 404 });
    }

    // Fetch Listing
    const listingResults = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
    const listing = listingResults[0];
    if (!listing) {
      return Response.json({ error: 'Listing not found' }, { status: 404 });
    }

    // ── Re-fetch fresh state immediately before management writes ──
    const [lpFreshRows, listingFreshRows] = await Promise.all([
      base44.asServiceRole.entities.ListingPrivate.filter({ listing_id }),
      base44.asServiceRole.entities.Listing.filter({ id: listing_id }),
    ]);
    const lpFresh = lpFreshRows[0];
    const listingFresh = listingFreshRows[0];
    if (!lpFresh || !listingFresh) {
      return Response.json({ error: 'Listing not found' }, { status: 404 });
    }

    // Block pause/cancel if an active checkout reservation exists
    if (operation === 'pause' || operation === 'cancel') {
      const resToken = lpFresh.reservation_token;
      const resExpiry = lpFresh.reservation_expires_at;
      if (resToken && resExpiry && new Date(resExpiry).getTime() > Date.now()) {
        return Response.json({ error: 'Cannot modify listing: an active checkout reservation exists.' }, { status: 409 });
      }
    }

    const listingUpdates = {};
    let invUpdates = null;
    let resultStatus = '';
    let logType = '';

    if (operation === 'pause') {
      if (listingFresh.status === 'hidden' && listingFresh.hidden_reason === 'other') {
        return Response.json({ status: 'already_paused', listing_id, idempotent: true });
      }
      if (listingFresh.status !== 'active') {
        return Response.json({ error: `Cannot pause a listing with status: ${listingFresh.status}` }, { status: 409 });
      }
      // Write durable seller pause intent BEFORE public status change (7C.7 fix #5)
      try {
        await upsertListingPrivate(base44, listing_id, { seller_pause_requested_at: new Date().toISOString() });
      } catch (err) {
        await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing_id, reference_type: 'listing', error: err });
        return Response.json({ error: 'Failed to record seller intent. Please try again.' }, { status: 500 });
      }
      listingUpdates.status = 'hidden';
      listingUpdates.hidden_reason = 'other';
      invUpdates = { inventory_status: 'available' };
      resultStatus = 'paused';
      logType = 'listing_hidden';
    } else if (operation === 'resume') {
      if (listingFresh.status === 'active') {
        // 7C.8: Handle already-active listing with stale pause marker safely.
        // Require listing not quarantined and no active reservation before clearing.
        // Do not swallow clearing failure. Verify the clear. On failure return 500.
        if (lpFresh.seller_pause_requested_at) {
          const resumeDeps = {
            entities: {
              Listing: base44.asServiceRole.entities.Listing,
              ListingPrivate: base44.asServiceRole.entities.ListingPrivate,
              SeatInventory: base44.asServiceRole.entities.SeatInventory,
              AdminAlert: base44.asServiceRole.entities.AdminAlert,
            },
            now: () => Date.now(),
          };
          const result = await clearStalePauseMarker(resumeDeps, { listing_id, lpFresh });
          if (result.status !== 200) {
            await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing_id, reference_type: 'listing', error: new Error(result.error) });
            return Response.json({ error: result.error }, { status: 500 });
          }
        }
        return Response.json({ status: 'already_active', listing_id, idempotent: true });
      }
      if (listingFresh.status !== 'hidden' || listingFresh.hidden_reason !== 'other') {
        return Response.json({ error: `Cannot resume: listing is not seller-paused (status: ${listingFresh.status}, reason: ${listingFresh.hidden_reason})` }, { status: 409 });
      }
      if (lpFresh.proof_status !== 'approved') {
        return Response.json({ error: 'Cannot resume: listing proof must be approved first' }, { status: 409 });
      }
      if (listingFresh.transfer_status === 'transfer_disabled' || listingFresh.transfer_status === 'transfer_expired') {
        return Response.json({ error: 'Cannot resume: transfer is disabled or expired' }, { status: 409 });
      }
      // Confirm event has not ended — fail closed on any lookup/timing issue
      let eventResults;
      try {
        eventResults = await base44.asServiceRole.entities.Event.filter({ id: listing.event_id });
      } catch (err) {
        return Response.json({ error: 'Cannot resume: event verification failed' }, { status: 500 });
      }
      const ev = eventResults[0];
      if (!ev) {
        return Response.json({ error: 'Cannot resume: event not found' }, { status: 409 });
      }
      const startMs = ev.event_start_utc ? new Date(ev.event_start_utc).getTime() : ev.date ? new Date(ev.date).getTime() : null;
      if (!startMs || isNaN(startMs)) {
        return Response.json({ error: 'Cannot resume: event timing cannot be verified' }, { status: 409 });
      }
      const durationHours = ev.duration_hours || 4;
      if (Date.now() > startMs + durationHours * 60 * 60 * 1000) {
        return Response.json({ error: 'Cannot resume: this event has already ended' }, { status: 409 });
      }
      listingUpdates.status = 'active';
      listingUpdates.hidden_reason = null;
      invUpdates = { inventory_status: 'listed_for_sale', inventory_intent: 'sell', linked_listing_id: listing.id };
      resultStatus = 'resumed';
      logType = 'listing_restored';
    } else if (operation === 'cancel') {
      if (listingFresh.status === 'cancelled') {
        return Response.json({ status: 'already_cancelled', listing_id, idempotent: true });
      }
      if (listingFresh.status === 'pending_transfer' || listingFresh.status === 'sold') {
        return Response.json({ error: `Cannot cancel a listing with status: ${listingFresh.status}` }, { status: 409 });
      }
      // Write durable seller cancel intent BEFORE public status change (7C.7 fix #5)
      try {
        await upsertListingPrivate(base44, listing_id, { seller_cancel_requested_at: new Date().toISOString() });
      } catch (err) {
        await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing_id, reference_type: 'listing', error: err });
        return Response.json({ error: 'Failed to record seller intent. Please try again.' }, { status: 500 });
      }
      listingUpdates.status = 'cancelled';
      invUpdates = { inventory_status: 'available', inventory_intent: 'undecided', linked_listing_id: null };
      resultStatus = 'cancelled';
      logType = 'listing_hidden';
    }

    // Apply listing updates — never delete
    if (Object.keys(listingUpdates).length > 0) {
      await base44.asServiceRole.entities.Listing.update(listing.id, listingUpdates);
    }

    // ── Re-fetch after writes to verify no race with checkout ──
    const [lpAfterRows, listingAfterRows] = await Promise.all([
      base44.asServiceRole.entities.ListingPrivate.filter({ listing_id }),
      base44.asServiceRole.entities.Listing.filter({ id: listing_id }),
    ]);
    const lpAfter = lpAfterRows[0];
    const listingAfter = listingAfterRows[0];

    // If our write was overwritten by another request, return 409
    if (operation === 'pause' || operation === 'cancel') {
      if (listingAfter && listingUpdates.status && listingAfter.status !== listingUpdates.status) {
        return Response.json({ error: 'Listing was modified by another request. Please try again.' }, { status: 409 });
      }
      // If a checkout reservation appeared, checkout wins — do NOT revert, just return 409
      const resTokenAfter = lpAfter?.reservation_token;
      const resExpiryAfter = lpAfter?.reservation_expires_at;
      if (resTokenAfter && resExpiryAfter && new Date(resExpiryAfter).getTime() > Date.now()) {
        return Response.json({ error: 'A checkout reservation was created during your request. Please try again.' }, { status: 409 });
      }
    }

    // SeatInventory reconciliation — idempotently resolve or create (legacy listings)
    if (invUpdates) {
      let seatInventoryId = lpFresh.seat_inventory_id;
      if (!seatInventoryId) {
        // Search by linked_listing_id first, then by event+owner+section, then create
        try {
          const existingByListing = await base44.asServiceRole.entities.SeatInventory.filter({
            linked_listing_id: listing.id,
          });
          if (existingByListing.length > 0) {
            seatInventoryId = existingByListing[0].id;
            // Reconcile duplicates to one canonical record
            for (let i = 1; i < existingByListing.length; i++) {
              await base44.asServiceRole.entities.SeatInventory.delete(existingByListing[i].id).catch(() => {});
            }
          }
          if (!seatInventoryId) {
            const existingBySeat = await base44.asServiceRole.entities.SeatInventory.filter({
              event_id: listing.event_id, owner_email: lpFresh.seller_email,
            });
            const match = existingBySeat.find(inv =>
              inv.section?.toLowerCase() === (lpFresh.section || listing.section)?.toLowerCase() &&
              (!lpFresh.row || !inv.row || inv.row?.toLowerCase() === lpFresh.row?.toLowerCase()) &&
              !['cancelled', 'transferred'].includes(inv.inventory_status)
            );
            if (match) seatInventoryId = match.id;
          }
          if (!seatInventoryId) {
            const inv = await base44.asServiceRole.entities.SeatInventory.create({
              event_id: listing.event_id,
              owner_email: lpFresh.seller_email,
              owner_name: lpFresh.seller_email,
              section: lpFresh.section || listing.section,
              row: lpFresh.row || listing.row || null,
              seats: lpFresh.seats || listing.seats || null,
              quantity: lpFresh.quantity || listing.quantity || 1,
              inventory_status: 'available',
              inventory_intent: 'undecided',
              source_type: 'listing',
              linked_listing_id: listing.id,
            });
            seatInventoryId = inv.id;
          }
          // Write canonical ID to BOTH Listing and ListingPrivate
          await base44.asServiceRole.entities.Listing.update(listing.id, { seat_inventory_id: seatInventoryId });
          await upsertListingPrivate(base44, listing.id, { seat_inventory_id: seatInventoryId });
        } catch (err) {
          await alertPrivateWriteFailure(base44, { entity: 'SeatInventory', reference_id: listing.id, reference_type: 'listing', error: err });
          if (operation === 'resume') {
            await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'hidden', hidden_reason: 'other' }).catch(() => {});
            return Response.json({ error: 'Failed to create seat inventory. Listing reverted to hidden.' }, { status: 500 });
          }
          return Response.json({ error: 'Listing updated but seat inventory creation failed. Please contact support.' }, { status: 500 });
        }
      }
      // Apply inventory updates
      try {
        await base44.asServiceRole.entities.SeatInventory.update(seatInventoryId, invUpdates);
      } catch (err) {
        if (operation === 'resume') {
          await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'hidden', hidden_reason: 'other' }).catch(() => {});
          return Response.json({ error: 'Failed to update seat inventory. Listing reverted to hidden.' }, { status: 500 });
        }
        await alertPrivateWriteFailure(base44, { entity: 'SeatInventory', reference_id: seatInventoryId, reference_type: 'listing', error: err });
        return Response.json({ error: 'Listing updated but seat inventory reconciliation failed. Please contact support.' }, { status: 500 });
      }
    }

    // 7C.8: Clear pause intent SAFELY — only after Listing AND SeatInventory
    // resume writes succeed and are verified. If clearing fails or verification
    // fails, revert BOTH Listing AND SeatInventory to their paused states and
    // return 500. seller_cancel_requested_at is NEVER cleared — it remains
    // permanent for cancelled listings.
    if (operation === 'resume') {
      const resumeDeps = {
        entities: {
          Listing: base44.asServiceRole.entities.Listing,
          ListingPrivate: base44.asServiceRole.entities.ListingPrivate,
          SeatInventory: base44.asServiceRole.entities.SeatInventory,
          AdminAlert: base44.asServiceRole.entities.AdminAlert,
        },
        now: () => Date.now(),
      };
      const seatInvId = lpFresh.seat_inventory_id || null;
      const result = await clearPauseMarkerAfterResume(resumeDeps, {
        listing_id,
        listing_entity_id: listing.id,
        seat_inventory_id: seatInvId,
      });
      if (result.status !== 200) {
        await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing_id, reference_type: 'listing', error: new Error(result.error) });
        return Response.json({ error: result.error }, { status: 500 });
      }
    }

    // BetaTransferLog — server-derived authenticated identity
    try {
      await base44.asServiceRole.entities.BetaTransferLog.create({
        log_type: logType,
        actor_email: user.email,
        actor_role: 'seller',
        listing_id: listing.id,
        event_id: listing.event_id,
        before_state: { status: listingFresh.status, hidden_reason: listingFresh.hidden_reason ?? null },
        after_state: {
          status: listingUpdates.status || listingFresh.status,
          hidden_reason: 'hidden_reason' in listingUpdates ? listingUpdates.hidden_reason : (listingFresh.hidden_reason ?? null),
        },
        notes: `Seller ${operation} listing`,
      });
    } catch (_) { /* log failure must never break the flow */ }

    return Response.json({ status: resultStatus, listing_id, idempotent: false });
  }

  // ── Unknown action → 400 before any queries or writes ──
  if (action !== undefined) {
    return Response.json({ error: 'Unknown action', code: 'INVALID_INPUT' }, { status: 400 });
  }

  const askingPrice = parseFloat(body.asking_price) || 0;
  const optimisticId = body.optimistic_id;
  const isAdmin = user.role === 'admin';
  const isTest = body.is_test === true;

  // Phase 0 maintenance gate — fail-closed. During maintenance a listing may
  // be created ONLY by an admin exercising an explicit is_test=true request,
  // and that path is a TRUE DRY RUN: it creates NOTHING (no Listing, no
  // SeatInventory, no TransferVerificationLog). Blocked callers get a 503;
  // the admin dry-run returns a no-op. Zero writes occur for any caller.
  if (isMaintenanceActive() && !(isAdmin && isTest)) {
    return maintenance503('Listing creation is temporarily unavailable for scheduled maintenance.');
  }
  if (isMaintenanceActive() && isAdmin && isTest) {
    return Response.json({
      dry_run: true,
      created: false,
      message: 'Maintenance dry run: no listing, SeatInventory, or verification log was created.',
    });
  }

  if (!isAdmin) {
    const freshUsers = await base44.asServiceRole.entities.User.filter({ email: user.email });
    const freshUser = freshUsers[0];
    const onboardingComplete = freshUser?.stripe_onboarding_complete === true || freshUser?.stripe_onboarding_complete === 'true';
    if (!onboardingComplete) {
      return Response.json({ error: 'Connect your payout account before listing tickets.' }, { status: 403 });
    }
  }

  // ── SeatInventory conflict check ─────────────────────────────────────────
  // Block if this seat already has an active Flash Drop
  if (!isAdmin && !isTest) {
    const existingInv = await base44.asServiceRole.entities.SeatInventory.filter({
      owner_email: user.email,
      event_id: body.event_id,
    }).then(all => all.find(inv =>
      inv.section?.toLowerCase() === body.section?.toLowerCase() &&
      (!body.row || !inv.row || inv.row?.toLowerCase() === body.row?.toLowerCase()) &&
      !['cancelled', 'transferred'].includes(inv.inventory_status)
    )).catch(() => null);

    if (existingInv) {
      const blocking = {
        in_flash_drop: 'This seat is already in an active Flash Drop. Cancel or let it expire before listing for sale.',
        reserved_for_purchase: 'This seat is reserved for an active purchase.',
        claimed_by_winner: 'This seat was already claimed by a Flash Drop winner.',
      };
      if (blocking[existingInv.inventory_status]) {
        return Response.json({ error: blocking[existingInv.inventory_status], code: 'INVENTORY_CONFLICT' }, { status: 409 });
      }
    }
  }

  // ── Block listings for ended events ─────────────────────────────────────
  if (!isAdmin && !isTest && body.event_id) {
    const eventRecords = await base44.asServiceRole.entities.Event.filter({ id: body.event_id }).catch(() => []);
    const ev = eventRecords[0];
    if (ev) {
      const startMs = ev.event_start_utc ? new Date(ev.event_start_utc).getTime() : ev.date ? new Date(ev.date).getTime() : null;
      if (startMs) {
        const durationHours = ev.duration_hours || 4;
        const endMs = startMs + durationHours * 60 * 60 * 1000;
        if (Date.now() > endMs) {
          return Response.json({ error: 'This event has already ended. Listings are closed.' }, { status: 409 });
        }
      }
    }
  }

  const { flagged, reason } = isAdmin || isTest
    ? { flagged: false, reason: null }
    : await checkSuspicious(base44, user.email, askingPrice);

  // Proof duplicate check
  let proofDuplicate = false;
  if (body.proof_url && !isAdmin && !isTest) {
    const existingWithProof = await base44.asServiceRole.entities.Listing.filter({ proof_url: body.proof_url }).catch(() => []);
    const otherSellerMatches = existingWithProof.filter(l => l.seller_email !== user.email);
    if (otherSellerMatches.length > 0) proofDuplicate = true;
  }

  const now = new Date().toISOString();
  const hasScreenshot = !!(body.transfer_attestation_proof_url);
  const verificationMethod = hasScreenshot ? 'screenshot_verified' : 'seller_attestation';
  const confidenceScore = hasScreenshot ? 75 : 55;

  const listing = await base44.entities.Listing.create({
    event_id: body.event_id,
    seller_email: user.email,
    section: body.section,
    row: body.row,
    seats: body.seats || undefined,
    quantity: body.quantity || 1,
    tier: body.tier || undefined,
    asking_price: askingPrice,
    original_price: body.original_price || undefined,
    transfer_method: body.transfer_method || 'email_transfer',
    proof_url: body.proof_url || undefined,
    proof_status: (flagged || proofDuplicate) ? 'pending_review' : 'approved',
    proof_rejection_reason: flagged ? reason : proofDuplicate ? 'Duplicate proof image detected — requires manual review' : undefined,
    status: 'active',
    notes: (isAdmin || isTest) ? '[TEST] Admin/demo listing' : undefined,
    is_demo_listing: (isAdmin && isTest),
    last_transfer_verification: now,
    transfer_status: 'transfer_confirmed',
    transfer_verification_method: verificationMethod,
    transfer_verification_proof_url: body.transfer_attestation_proof_url || undefined,
    transfer_confidence_score: confidenceScore,
    transfer_verified_by: user.email,
    transfer_platform: body.transfer_source || undefined,
  });

  // ── Phase 1B: create ListingPrivate sidecar (authoritative private destination) ──
  try {
    await upsertListingPrivate(base44, listing.id, {
      event_id: body.event_id, seller_email: user.email, section: body.section, row: body.row,
      seats: body.seats || null, quantity: body.quantity || 1,
      proof_url: body.proof_url || null, proof_status: listing.proof_status,
      proof_rejection_reason: listing.proof_rejection_reason || null,
      transfer_verification_proof_url: body.transfer_attestation_proof_url || null,
      transfer_verified_by: user.email,
      is_demo_listing: (isAdmin && isTest), notes: listing.notes,
      migration_version: 3, migrated_at: now,
    });
  } catch (err) {
    // Required private write failed — safe compensation: cancel listing, alert
    await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'cancelled' }).catch(() => {});
    await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing.id, reference_type: 'listing', error: err });
    return Response.json({ error: 'Failed to create private listing record. Listing cancelled.' }, { status: 500 });
  }

  if (body.proof_url) {
    try {
      await recordLegacyProofUrl(base44, { owner_email: user.email, reference_type: 'listing', reference_id: listing.id, proof_type: 'listing_proof', legacy_url: body.proof_url });
    } catch (err) {
      // ProofAsset is required when a proof URL is supplied — cancel listing, alert
      await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'cancelled' }).catch(() => {});
      await alertPrivateWriteFailure(base44, { entity: 'ProofAsset', reference_id: listing.id, reference_type: 'listing', error: err });
      return Response.json({ error: 'Failed to create proof record. Listing cancelled.' }, { status: 500 });
    }
  }
  if (body.transfer_attestation_proof_url) {
    try {
      await recordLegacyProofUrl(base44, { owner_email: user.email, reference_type: 'listing', reference_id: listing.id, proof_type: 'transfer_attestation', legacy_url: body.transfer_attestation_proof_url });
    } catch (err) {
      await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'cancelled' }).catch(() => {});
      await alertPrivateWriteFailure(base44, { entity: 'ProofAsset', reference_id: listing.id, reference_type: 'listing', error: err });
      return Response.json({ error: 'Failed to create proof record. Listing cancelled.' }, { status: 500 });
    }
  }

  // ── Create/update SeatInventory for this listing (awaited, required) ──
  if (!isTest) {
    try {
      // Search by linked_listing_id first to avoid duplicates
      const byListing = await base44.asServiceRole.entities.SeatInventory.filter({
        linked_listing_id: listing.id,
      });
      let existingInv = byListing[0] || null;
      // Reconcile duplicates
      if (byListing.length > 1) {
        for (let i = 1; i < byListing.length; i++) {
          await base44.asServiceRole.entities.SeatInventory.delete(byListing[i].id).catch(() => {});
        }
      }
      if (!existingInv) {
        const allInv = await base44.asServiceRole.entities.SeatInventory.filter({
          owner_email: user.email, event_id: body.event_id,
        });
        existingInv = allInv.find(inv =>
          inv.section?.toLowerCase() === body.section?.toLowerCase() &&
          (!body.row || !inv.row || inv.row?.toLowerCase() === body.row?.toLowerCase()) &&
          !['cancelled', 'transferred'].includes(inv.inventory_status)
        );
      }

      const invData = {
        event_id: body.event_id,
        owner_email: user.email,
        owner_name: user.full_name || user.email,
        section: body.section,
        row: body.row || null,
        seats: body.seats || null,
        quantity: body.quantity || 1,
        inventory_status: 'listed_for_sale',
        inventory_intent: 'sell',
        source_type: 'listing',
        ownership_verified: hasScreenshot,
        ownership_verification_method: hasScreenshot ? 'transfer_capability' : null,
        ownership_verified_at: hasScreenshot ? now : null,
        transfer_verified: true,
        transfer_status: 'transfer_confirmed',
        last_transfer_verification: now,
        linked_listing_id: listing.id,
      };

      let seatInventoryId;
      if (existingInv) {
        await base44.asServiceRole.entities.SeatInventory.update(existingInv.id, invData);
        seatInventoryId = existingInv.id;
      } else {
        const inv = await base44.asServiceRole.entities.SeatInventory.create(invData);
        seatInventoryId = inv.id;
      }

      // Write seat_inventory_id to BOTH Listing and ListingPrivate (required)
      await base44.asServiceRole.entities.Listing.update(listing.id, { seat_inventory_id: seatInventoryId });
      await upsertListingPrivate(base44, listing.id, { seat_inventory_id: seatInventoryId });
    } catch (err) {
      // SeatInventory failure — cancel listing, alert, return error
      await base44.asServiceRole.entities.Listing.update(listing.id, { status: 'cancelled' }).catch(() => {});
      await alertPrivateWriteFailure(base44, { entity: 'SeatInventory', reference_id: listing.id, reference_type: 'listing', error: err });
      return Response.json({ error: 'Failed to create seat inventory. Listing cancelled.' }, { status: 500 });
    }
  }

  // Fire-and-forget: TransferVerificationLog
  base44.asServiceRole.entities.Event.filter({ id: body.event_id }).then(events => {
    const event = events[0];
    const eventStartMs = event?.event_start_utc ? new Date(event.event_start_utc).getTime() : event?.date ? new Date(event.date).getTime() : null;
    const minutesSinceStart = eventStartMs ? Math.round((Date.now() - eventStartMs) / 60000) : null;
    base44.asServiceRole.entities.TransferVerificationLog.create({
      listing_id: listing.id,
      event_id: body.event_id,
      seller_email: user.email,
      platform: body.transfer_source || undefined,
      verification_timestamp: now,
      transfer_available: true,
      verification_method: verificationMethod,
      event_start_utc: event?.event_start_utc || event?.date || undefined,
      minutes_since_event_start: minutesSinceStart,
      venue: event?.venue || undefined,
      city: event?.city || undefined,
      event_title: event?.title || undefined,
      has_screenshot: hasScreenshot,
      confidence_score: confidenceScore,
    }).catch(err => console.error('[submitListing] TransferVerificationLog failed:', err?.message));
  }).catch(err => console.error('[submitListing] event fetch failed:', err?.message));

  // Mark SeatInventory available when listing is cancelled (handled separately via listing status changes)

  return Response.json({ listing, flagged, flag_reason: reason, optimistic_id: optimisticId });
});