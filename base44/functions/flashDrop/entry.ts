import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { recordNotification } from '../../shared/notifications.ts';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { alertPrivateWriteFailure, getListingPrivate, upsertListingPrivate } from '../../shared/privateData.ts';
import {
  canCloseFlashDrop,
  deliveryActorFor,
  isSafeFlashDrop,
  isSafeListingTransferMethod,
  validateFlashDropListing,
} from '../../shared/flashDropPolicy.js';

// ── Config ──────────────────────────────────────────────────────────────────
const MAX_DROPS_PER_USER_PER_EVENT = 2;
const MIN_MINUTES_BETWEEN_DROPS = 5;
const ALLOW_UNVERIFIED_BETA = false; // BLOCKS unverified drops in production

// ── Trust score ─────────────────────────────────────────────────────────────
function computeTrustScore({ ownershipVerified, ownershipMethod, transferConfirmed, sellerVerified, priorSuccessfulTransfers }) {
  let score = 0;
  const breakdown = {};
  if (ownershipVerified) {
    const pts = ownershipMethod === 'verified_listing' ? 40 :
                ownershipMethod === 'transfer_capability' ? 35 :
                ownershipMethod === 'verified_ticket_file' ? 30 :
                ownershipMethod === 'ownership_proof_upload' ? 20 : 15;
    breakdown.ownership_verified = pts;
    score += pts;
  } else {
    breakdown.ownership_verified = 0;
  }
  breakdown.transfer_confirmed = transferConfirmed ? 30 : 0;
  score += breakdown.transfer_confirmed;
  breakdown.verified_seller = sellerVerified ? 15 : 0;
  score += breakdown.verified_seller;
  breakdown.prior_transfers = Math.min(15, (priorSuccessfulTransfers || 0) * 5);
  score += breakdown.prior_transfers;
  return { score: Math.min(100, score), breakdown };
}

// ── SeatInventory helpers ────────────────────────────────────────────────────

/**
 * Find existing active SeatInventory record for this owner+event+section+row.
 * "Active" means not cancelled or transferred.
 */
async function findExistingInventory(base44, { owner_email, event_id, section, row }) {
  const all = await base44.asServiceRole.entities.SeatInventory.filter({ owner_email, event_id });
  return all.find(inv =>
    inv.section?.toLowerCase() === section?.toLowerCase() &&
    (!row || !inv.row || inv.row?.toLowerCase() === row?.toLowerCase()) &&
    !['cancelled', 'transferred'].includes(inv.inventory_status)
  );
}

/**
 * Check if seat is already in a conflicting state (listed or in drop).
 * Returns { blocked: bool, reason: string }
 */
function checkInventoryConflict(inv) {
  if (!inv) return { blocked: false };
  const blocking = {
    listed_for_sale: 'This seat already has an active sale listing. Cancel it before creating a Flash Drop.',
    reserved_for_purchase: 'This seat is reserved for an active purchase. It cannot be Flash Dropped.',
    in_flash_drop: 'This seat is already in an active Flash Drop.',
    claimed_by_winner: 'This seat was already claimed by a winner.',
  };
  if (blocking[inv.inventory_status]) {
    return { blocked: true, reason: blocking[inv.inventory_status], inventory: inv };
  }
  return { blocked: false, inventory: inv };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  // Phase 0 maintenance gate — fail-closed. During maintenance EVERY mutating
  // action is blocked, including for admins. track_view and track_loser_action
  // mutate (metrics / entry writes) so they are blocked too. Only the genuinely
  // read-only poll_result diagnostic is permitted, and only for admins.
  if (isMaintenanceActive() && !(user.role === 'admin' && action === 'poll_result')) {
    return maintenance503('Flash Drops are temporarily unavailable for scheduled maintenance.');
  }

  // ── CREATE FLASH DROP ─────────────────────────────────────────────────────
  if (action === 'create') {
    const {
      event_id, section, row, seats, quantity, is_anonymous, donor_message,
      drop_type, entry_window_seconds, source_purchase_id,
      ownership_listing_id, ownership_proof_url, ownership_delivery_method,
    } = body;

    const requestedSection = String(section || '').trim();
    if (!event_id || !requestedSection) {
      return Response.json({ error: 'event_id and section required' }, { status: 400 });
    }
    if (ownership_proof_url) {
      return Response.json({
        error: 'A screenshot or public file URL cannot verify ticket ownership. Link an approved transferable listing instead.',
        code: 'UNTRUSTED_OWNERSHIP_PROOF',
      }, { status: 400 });
    }
    if (drop_type && drop_type !== 'immediate') {
      return Response.json({
        error: 'Scheduled Flash Drops are not available yet. Create an immediate drop when you are ready.',
        code: 'SCHEDULED_DROP_UNAVAILABLE',
      }, { status: 409 });
    }
    if (ownership_delivery_method && ownership_delivery_method !== 'ticket_transfer') {
      return Response.json({
        error: 'Flash Drops currently require an official electronic ticket transfer. Account sharing and manual handoffs are not supported.',
        code: 'UNSAFE_DELIVERY_METHOD',
      }, { status: 409 });
    }
    if (Boolean(ownership_listing_id) === Boolean(source_purchase_id)) {
      return Response.json({
        error: 'Choose exactly one verified ownership source: an approved listing or a completed purchase.',
        code: 'OWNERSHIP_SOURCE_REQUIRED',
      }, { status: 400 });
    }

    // ── Anti-abuse: rate limiting ───────────────────────────────────────────
    const existingDrops = await base44.asServiceRole.entities.FlashDrop.filter({ donor_email: user.email, event_id });
    const nonCancelledDrops = existingDrops.filter(d => !['cancelled', 'expired'].includes(d.status));

    if (nonCancelledDrops.length >= MAX_DROPS_PER_USER_PER_EVENT) {
      return Response.json({
        error: `Max ${MAX_DROPS_PER_USER_PER_EVENT} Flash Drops per event reached.`,
        code: 'RATE_LIMIT_EVENT',
      }, { status: 429 });
    }

    const recentDrops = await base44.asServiceRole.entities.FlashDrop.filter({ donor_email: user.email });
    const latestDrop = recentDrops
      .filter(d => d.created_date)
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];
    if (latestDrop?.created_date) {
      const minsSince = (Date.now() - new Date(latestDrop.created_date).getTime()) / 60000;
      if (minsSince < MIN_MINUTES_BETWEEN_DROPS) {
        return Response.json({
          error: `Wait ${Math.ceil(MIN_MINUTES_BETWEEN_DROPS - minsSince)} more minute(s) before creating another Flash Drop.`,
          code: 'RATE_LIMIT_GLOBAL',
        }, { status: 429 });
      }
    }

    // ── Ownership verification ──────────────────────────────────────────────
    let ownershipVerified = false;
    let ownershipMethod = null;
    let ownershipVerifiedAt = null;
    let trustTransferConfirmed = false;
    let sellerVerified = false;
    let priorSuccessful = 0;
    const abuseFlags = [];
    let ownershipListing = null;
    let ownershipListingPrivate = null;
    let canonicalSeat = {
      section: requestedSection,
      row: row || null,
      seats: seats || null,
      quantity: quantity || 1,
    };

    // Path 1: approved, active, safely transferable listing. ListingPrivate is
    // authoritative for identity/proof and must agree with the public record.
    if (ownership_listing_id) {
      const listings = await base44.asServiceRole.entities.Listing.filter({ id: ownership_listing_id });
      ownershipListing = listings[0] || null;
      ownershipListingPrivate = ownershipListing ? await getListingPrivate(base44, ownershipListing.id) : null;
      const validation = validateFlashDropListing({
        listing: ownershipListing,
        listingPrivate: ownershipListingPrivate,
        userEmail: user.email,
        eventId: event_id,
        section: requestedSection,
      });
      if (!validation.ok) {
        return Response.json({ error: validation.error, code: validation.code }, { status: 409 });
      }
      canonicalSeat = validation.canonical;
      ownershipVerified = true;
      ownershipMethod = 'verified_listing';
      ownershipVerifiedAt = new Date().toISOString();
      trustTransferConfirmed = true;
    }

    // Path 2: a fully completed purchase. Derive the seat tuple from the
    // originating private listing record rather than caller-supplied fields.
    if (source_purchase_id && !ownershipVerified) {
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: source_purchase_id });
      const purchase = purchases[0];
      const purchaseIsComplete = purchase &&
        purchase.buyer_email === user.email &&
        purchase.event_id === event_id &&
        purchase.payment_captured === true &&
        purchase.buyer_confirmed === true &&
        purchase.transfer_status === 'completed';
      if (!purchaseIsComplete || !purchase.listing_id) {
        return Response.json({
          error: 'That purchase is not a completed ticket owned by this account.',
          code: 'SOURCE_PURCHASE_NOT_VERIFIED',
        }, { status: 409 });
      }

      const sourceListings = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id });
      const sourceListing = sourceListings[0];
      const sourceListingPrivate = sourceListing ? await getListingPrivate(base44, sourceListing.id) : null;
      const sourceMatches = sourceListing && sourceListingPrivate &&
        sourceListing.event_id === event_id &&
        sourceListingPrivate.event_id === event_id &&
        String(sourceListing.section || '').trim().toLowerCase() === requestedSection.toLowerCase() &&
        String(sourceListingPrivate.section || '').trim().toLowerCase() === requestedSection.toLowerCase() &&
        sourceListing.transfer_status === 'transfer_confirmed' &&
        isSafeListingTransferMethod(sourceListing.transfer_method);
      if (!sourceMatches) {
        return Response.json({
          error: 'The completed purchase does not match this event and section or cannot be safely transferred.',
          code: 'SOURCE_PURCHASE_MISMATCH',
        }, { status: 409 });
      }

      canonicalSeat = {
        section: sourceListingPrivate.section,
        row: sourceListingPrivate.row ?? sourceListing.row ?? null,
        seats: sourceListingPrivate.seats ?? sourceListing.seats ?? null,
        quantity: sourceListingPrivate.quantity ?? purchase.quantity ?? sourceListing.quantity ?? 1,
      };
      ownershipVerified = true;
      ownershipMethod = 'verified_ticket_file';
      ownershipVerifiedAt = new Date().toISOString();
      trustTransferConfirmed = true;
    }

    if (!ownershipVerified && !ALLOW_UNVERIFIED_BETA) {
      return Response.json({ error: 'Verified ticket ownership is required.', code: 'OWNERSHIP_REQUIRED' }, { status: 403 });
    }
    if (!ownershipVerified) abuseFlags.push('unverified_ownership');

    const [userRecords, outcomes] = await Promise.all([
      base44.asServiceRole.entities.User.filter({ email: user.email }),
      base44.asServiceRole.entities.TransferOutcome.filter({ seller_email: user.email }),
    ]);
    const userRecord = userRecords[0];
    sellerVerified = userRecord?.stripe_onboarding_complete === true || userRecord?.stripe_onboarding_complete === 'true';
    priorSuccessful = outcomes.filter(o => o.transfer_successful).length;
    if ((userRecord?.strike_count || 0) >= 2) abuseFlags.push('high_strike_count');
    if ((userRecord?.transfer_false_claim_count || 0) >= 1) abuseFlags.push('prior_false_claim');

    const { score: trustScore, breakdown: trustBreakdown } = computeTrustScore({
      ownershipVerified, ownershipMethod, transferConfirmed: trustTransferConfirmed, sellerVerified, priorSuccessfulTransfers: priorSuccessful,
    });

    const events = await base44.asServiceRole.entities.Event.filter({ id: event_id });
    const event = events[0];
    if (!event) {
      return Response.json({ error: 'Event not found. Refresh and try again.', code: 'EVENT_NOT_FOUND' }, { status: 404 });
    }
    const windowSecs = Math.min(90, Math.max(30, entry_window_seconds || 60));

    // ── SeatInventory conflict check ────────────────────────────────────────
    const existingInv = await findExistingInventory(base44, {
      owner_email: user.email,
      event_id,
      section: canonicalSeat.section,
      row: canonicalSeat.row,
    });
    const convertingLinkedListing = Boolean(
      ownershipListing &&
      existingInv?.inventory_status === 'listed_for_sale' &&
      existingInv?.linked_listing_id === ownershipListing.id
    );
    const conflict = checkInventoryConflict(existingInv);
    if (conflict.blocked && !convertingLinkedListing) {
      return Response.json({ error: conflict.reason, code: 'INVENTORY_CONFLICT' }, { status: 409 });
    }

    const now = new Date();
    const entry_opens_at = now.toISOString();
    const entry_closes_at = new Date(now.getTime() + windowSecs * 1000).toISOString();
    let seatInventoryId = existingInv?.id || null;
    let createdInventory = false;
    let listingPauseIntentRecorded = false;
    let listingPaused = false;
    let drop = null;
    const previousInventory = existingInv ? {
      event_id: existingInv.event_id,
      event_title: existingInv.event_title,
      owner_email: existingInv.owner_email,
      owner_name: existingInv.owner_name,
      section: existingInv.section,
      row: existingInv.row,
      seats: existingInv.seats,
      quantity: existingInv.quantity,
      inventory_status: existingInv.inventory_status,
      inventory_intent: existingInv.inventory_intent,
      source_type: existingInv.source_type,
      ownership_verified: existingInv.ownership_verified,
      ownership_verification_method: existingInv.ownership_verification_method,
      ownership_verified_at: existingInv.ownership_verified_at,
      transfer_verified: existingInv.transfer_verified,
      transfer_status: existingInv.transfer_status,
      linked_listing_id: existingInv.linked_listing_id || null,
      linked_purchase_id: existingInv.linked_purchase_id || null,
      linked_flash_drop_id: existingInv.linked_flash_drop_id || null,
    } : null;
    const invData = {
      event_id,
      event_title: event?.title || '',
      owner_email: user.email,
      owner_name: user.full_name || user.email,
      section: canonicalSeat.section,
      row: canonicalSeat.row,
      seats: canonicalSeat.seats,
      quantity: canonicalSeat.quantity,
      inventory_status: 'in_flash_drop',
      inventory_intent: 'flash_drop',
      source_type: source_purchase_id ? 'purchase' : ownership_listing_id ? 'listing' : 'flash_drop',
      ownership_verified: ownershipVerified,
      ownership_verification_method: ownershipMethod,
      ownership_verified_at: ownershipVerifiedAt,
      transfer_verified: trustTransferConfirmed,
      transfer_status: trustTransferConfirmed ? 'transfer_confirmed' : 'transfer_unconfirmed',
      linked_listing_id: ownership_listing_id || null,
      linked_purchase_id: source_purchase_id || null,
    };

    try {
      // A sale listing cannot remain purchasable while its seat is being given
      // away. Record seller pause intent before hiding the public listing.
      if (ownershipListing) {
        await upsertListingPrivate(base44, ownershipListing.id, { seller_pause_requested_at: now.toISOString() });
        listingPauseIntentRecorded = true;
        await base44.asServiceRole.entities.Listing.update(ownershipListing.id, { status: 'hidden', hidden_reason: 'other' });
        listingPaused = true;
        const [pausedListing] = await base44.asServiceRole.entities.Listing.filter({ id: ownershipListing.id });
        if (pausedListing?.status !== 'hidden' || pausedListing?.hidden_reason !== 'other') {
          throw new Error('Sale listing pause verification failed');
        }
      }

      if (seatInventoryId) {
        await base44.asServiceRole.entities.SeatInventory.update(seatInventoryId, invData);
      } else {
        const inv = await base44.asServiceRole.entities.SeatInventory.create(invData);
        seatInventoryId = inv.id;
        createdInventory = true;
      }

      drop = await base44.asServiceRole.entities.FlashDrop.create({
        event_id,
        event_title: event.title || '',
        donor_email: user.email,
        donor_name: is_anonymous ? null : (user.full_name || user.email),
        is_anonymous: is_anonymous || false,
        section: canonicalSeat.section,
        row: canonicalSeat.row,
        seats: canonicalSeat.seats,
        quantity: canonicalSeat.quantity,
        donor_message: donor_message || null,
        drop_type: 'immediate',
        scheduled_label: null,
        entry_window_seconds: windowSecs,
        status: 'active',
        entry_opens_at,
        entry_closes_at,
        entry_count: 0,
        source_purchase_id: source_purchase_id || null,
        seat_inventory_id: seatInventoryId,
        ownership_verified: ownershipVerified,
        ownership_verification_method: ownershipMethod,
        ownership_verified_at: ownershipVerifiedAt,
        ownership_listing_id: ownership_listing_id || null,
        ownership_delivery_method: 'ticket_transfer',
        trust_score: trustScore,
        trust_breakdown: trustBreakdown,
        abuse_flags: abuseFlags,
        metrics: { views: 0, entries: 0, loser_upgrade_clicks: 0, loser_purchases: 0, notification_sent: 0, notification_opened: 0 },
      });

      await base44.asServiceRole.entities.SeatInventory.update(seatInventoryId, { linked_flash_drop_id: drop.id });
      const [verifiedInventory] = await base44.asServiceRole.entities.SeatInventory.filter({ id: seatInventoryId });
      if (verifiedInventory?.inventory_status !== 'in_flash_drop' || verifiedInventory?.linked_flash_drop_id !== drop.id) {
        throw new Error('Flash Drop inventory verification failed');
      }
      return Response.json({ success: true, drop, ownership_verified: ownershipVerified, trust_score: trustScore, abuse_flags: abuseFlags });
    } catch (error) {
      // Compensate the partially-created conversion. Every failure remains
      // closed: no active sale listing and active drop may survive together.
      if (drop?.id) {
        await base44.asServiceRole.entities.FlashDrop.update(drop.id, { status: 'cancelled' }).catch(() => {});
      }
      if (seatInventoryId) {
        if (createdInventory) {
          await base44.asServiceRole.entities.SeatInventory.update(seatInventoryId, { inventory_status: 'cancelled' }).catch(() => {});
        } else if (previousInventory) {
          await base44.asServiceRole.entities.SeatInventory.update(seatInventoryId, previousInventory).catch(() => {});
        }
      }
      await alertPrivateWriteFailure(base44, {
        entity: 'FlashDrop',
        reference_id: ownership_listing_id || source_purchase_id,
        reference_type: ownership_listing_id ? 'listing' : 'purchase',
        error,
      });
      const listingSafetyMessage = listingPauseIntentRecorded || listingPaused
        ? ' Your sale listing was left paused for safety; review it in My Sales before trying again.'
        : '';
      return Response.json({
        error: `Flash Drop could not be created safely. Your ticket was not dropped.${listingSafetyMessage}`,
        code: listingSafetyMessage ? 'FLASH_DROP_CREATE_FAILED_LISTING_PAUSED' : 'FLASH_DROP_CREATE_FAILED',
      }, { status: 500 });
    }
  }

  // ── ENTER A FLASH DROP ────────────────────────────────────────────────────
  if (action === 'enter') {
    const { flash_drop_id } = body;
    if (!flash_drop_id) return Response.json({ error: 'flash_drop_id required' }, { status: 400 });

    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Flash drop not found' }, { status: 404 });
    if (!isSafeFlashDrop(drop)) {
      return Response.json({ error: 'This Flash Drop cannot accept entries because its ownership or transfer method is not verified.', code: 'DROP_NOT_SAFE' }, { status: 409 });
    }
    if (drop.status !== 'active') return Response.json({ error: 'Entry window is closed', status: drop.status }, { status: 409 });
    if (drop.entry_closes_at && new Date() > new Date(drop.entry_closes_at)) {
      return Response.json({ error: 'Entry window has expired' }, { status: 409 });
    }
    if (drop.donor_email === user.email) return Response.json({ error: 'You cannot enter your own Flash Drop' }, { status: 403 });

    const existing = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id, entrant_email: user.email });
    if (existing.length > 0) return Response.json({ error: 'Already entered', entry: existing[0] }, { status: 409 });

    const entry = await base44.asServiceRole.entities.FlashDropEntry.create({
      flash_drop_id,
      event_id: drop.event_id,
      entrant_email: user.email,
      entrant_name: user.full_name || user.email,
      entered_at: new Date().toISOString(),
      is_winner: false,
      loser_action: 'none',
    });

    await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
      entry_count: (drop.entry_count || 0) + 1,
    });

    return Response.json({ success: true, entry });
  }

  // ── CLOSE DROP + SELECT WINNER (IDEMPOTENT, RACE-SAFE) ───────────────────
  if (action === 'close_and_pick') {
    const { flash_drop_id, request_id } = body;
    if (!flash_drop_id) return Response.json({ error: 'flash_drop_id required' }, { status: 400 });

    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });
    if (!canCloseFlashDrop(drop, user)) {
      return Response.json({ error: 'Only the donor or an administrator can select the winner.', code: 'CLOSE_FORBIDDEN' }, { status: 403 });
    }
    if (!isSafeFlashDrop(drop)) {
      return Response.json({ error: 'Winner selection is blocked because this drop is not safely verified.', code: 'DROP_NOT_SAFE' }, { status: 409 });
    }

    // Already done — return existing result
    if (drop.status === 'winner_selected' && drop.winner_email) {
      return Response.json({ success: true, already_selected: true, winner: { email: drop.winner_email, name: drop.winner_name }, entry_count: drop.entry_count });
    }
    if (drop.status === 'expired') {
      return Response.json({ success: true, already_selected: true, winner: null, no_entries: true });
    }
    if (drop.status !== 'active') {
      return Response.json({ error: `Winner selection is unavailable while the drop is ${drop.status}.`, code: 'DROP_NOT_ACTIVE' }, { status: 409 });
    }
    const closesAt = new Date(drop.entry_closes_at || '').getTime();
    if (!Number.isFinite(closesAt)) {
      return Response.json({ error: 'Winner selection is blocked because the entry deadline is missing.', code: 'ENTRY_DEADLINE_INVALID' }, { status: 409 });
    }
    if (Date.now() < closesAt) {
      return Response.json({ error: 'The entry window is still open.', code: 'ENTRY_WINDOW_OPEN' }, { status: 409 });
    }

    // Lock in progress check (< 10s old = another request is processing)
    const lockAge = drop.winner_selection_locked_at
      ? (Date.now() - new Date(drop.winner_selection_locked_at).getTime()) / 1000
      : null;
    if (drop.winner_selection_locked_at && lockAge !== null && lockAge < 10) {
      return Response.json({ success: false, pending: true, message: 'Winner selection in progress. Poll for result.' });
    }

    // ── Best-effort processing lock (NOT atomic — Base44 has no compare-and-set) ──
    // Concurrent close_and_pick calls can rarely both pass the lock above. The
    // post-pick re-check below returns an already-selected winner instead of
    // overwriting, minimizing double-winner writes; the FlashDrop record holds
    // a single winner_email (last writer), and is_winner dedup is handled by
    // reconcilePurchaseOutcomes for full consistency.
    const reqId = request_id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
        winner_selection_locked_at: new Date().toISOString(),
        winner_selection_request_id: reqId,
      });
    } catch {
      return Response.json({ error: 'Winner selection could not start safely. Try again.', code: 'WINNER_LOCK_FAILED' }, { status: 500 });
    }

    const entries = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id });
    const now = new Date().toISOString();

    if (entries.length === 0) {
      await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, { status: 'expired', selection_completed_at: now, entry_count: 0 });
      if (drop.seat_inventory_id) {
        await base44.asServiceRole.entities.SeatInventory.update(drop.seat_inventory_id, { inventory_status: 'available' }).catch(() => {});
      }
      return Response.json({ success: true, winner: null, no_entries: true });
    }

    const winner = entries[Math.floor(Math.random() * entries.length)];

    // Post-pick re-verify: a concurrent call may have already selected a winner.
    // If so, return the existing winner instead of overwriting.
    const confirmDrops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const confirmDrop = confirmDrops[0];
    if (confirmDrop?.status === 'winner_selected' && confirmDrop.winner_email) {
      return Response.json({ success: true, already_selected: true, winner: { email: confirmDrop.winner_email, name: confirmDrop.winner_name }, entry_count: confirmDrop.entry_count });
    }

    await Promise.all([
      base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
        status: 'winner_selected',
        winner_email: winner.entrant_email,
        winner_name: winner.entrant_name,
        winner_selected_at: now,
        selection_completed_at: now,
        entry_count: entries.length,
      }),
      base44.asServiceRole.entities.FlashDropEntry.update(winner.id, { is_winner: true }),
    ]);

    // Update SeatInventory → claimed_by_winner
    if (drop.seat_inventory_id) {
      await base44.asServiceRole.entities.SeatInventory.update(drop.seat_inventory_id, { inventory_status: 'claimed_by_winner' }).catch(() => {});
    }

    recordNotification(base44, {
      user_email: winner.entrant_email,
      type: 'donation_won',
      title: '🎁 You won a Flash Drop!',
      body: `Section ${drop.section}${drop.row ? ` Row ${drop.row}` : ''} — ${drop.event_title}. Contact the donor to claim your seat.`,
      reference_id: flash_drop_id,
      reference_type: 'donation',
      action_url: `/upgrades/${drop.event_id}`,
    }).catch(() => {});

    return Response.json({ success: true, winner: { email: winner.entrant_email, name: winner.entrant_name }, entry_count: entries.length });
  }

  // ── POLL FOR RESULT ───────────────────────────────────────────────────────
  if (action === 'poll_result') {
    const { flash_drop_id } = body;
    if (!flash_drop_id) return Response.json({ error: 'flash_drop_id required' }, { status: 400 });

    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });

    if (!canCloseFlashDrop(drop, user)) {
      const entries = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id, entrant_email: user.email });
      if (!entries[0]) {
        return Response.json({ error: 'Only participants can check this Flash Drop result.', code: 'POLL_FORBIDDEN' }, { status: 403 });
      }
    }

    if (drop.status === 'winner_selected') {
      return Response.json({ ready: true, winner: { email: drop.winner_email, name: drop.winner_name }, entry_count: drop.entry_count, no_entries: false });
    }
    if (drop.status === 'expired') {
      return Response.json({ ready: true, winner: null, no_entries: true });
    }
    return Response.json({ ready: false, status: drop.status });
  }

  // ── CONFIRM DELIVERY ──────────────────────────────────────────────────────
  if (action === 'confirm_delivery') {
    const { flash_drop_id } = body;
    if (!flash_drop_id) return Response.json({ error: 'flash_drop_id required' }, { status: 400 });
    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });
    if (drop.status !== 'winner_selected' || !drop.winner_email) {
      return Response.json({ error: 'Delivery can only be confirmed after a winner is selected.', code: 'DELIVERY_NOT_READY' }, { status: 409 });
    }
    const actor = deliveryActorFor(drop, user);
    if (!actor) {
      return Response.json({ error: 'Only this drop’s donor or winner can confirm delivery.', code: 'DELIVERY_FORBIDDEN' }, { status: 403 });
    }
    if (!drop.seat_inventory_id) {
      return Response.json({ error: 'Delivery cannot be confirmed because the seat record is missing. Contact support.', code: 'INVENTORY_MISSING' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const updates = actor === 'donor'
      ? { donor_delivery_confirmed: true, donor_delivery_confirmed_at: now }
      : { winner_delivery_confirmed: true, winner_delivery_confirmed_at: now };
    await base44.asServiceRole.entities.SeatInventory.update(drop.seat_inventory_id, updates);

    // If both authenticated participants confirmed, mark the seat transferred.
    const invs = await base44.asServiceRole.entities.SeatInventory.filter({ id: drop.seat_inventory_id });
    const inv = invs[0];
    if (!inv) {
      return Response.json({ error: 'Delivery confirmation could not be verified. Contact support.', code: 'INVENTORY_MISSING' }, { status: 409 });
    }
    const donorDone = actor === 'donor' ? true : inv.donor_delivery_confirmed === true;
    const winnerDone = actor === 'winner' ? true : inv.winner_delivery_confirmed === true;
    if (donorDone && winnerDone) {
      await base44.asServiceRole.entities.SeatInventory.update(drop.seat_inventory_id, { inventory_status: 'transferred' });
    }
    return Response.json({ success: true, confirmed_as: actor, transferred: donorDone && winnerDone });
  }

  // ── ACTIVATE SCHEDULED DROP ───────────────────────────────────────────────
  if (action === 'activate_scheduled') {
    const { flash_drop_id } = body;
    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });
    if (drop.donor_email !== user.email && user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    if (!isSafeFlashDrop(drop)) return Response.json({ error: 'This scheduled drop is not safely verified.', code: 'DROP_NOT_SAFE' }, { status: 409 });
    if (drop.status !== 'pending') return Response.json({ error: 'Drop is not in pending state' }, { status: 409 });

    const now = new Date();
    const closes = new Date(now.getTime() + (drop.entry_window_seconds || 60) * 1000);
    await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
      status: 'active',
      entry_opens_at: now.toISOString(),
      entry_closes_at: closes.toISOString(),
    });
    return Response.json({ success: true, entry_closes_at: closes.toISOString() });
  }

  // ── TRACK LOSER ACTION ────────────────────────────────────────────────────
  if (action === 'track_loser_action') {
    const { flash_drop_id, loser_action } = body;
    const validActions = ['none', 'viewed_upgrades', 'clicked_listing', 'purchased'];
    if (!validActions.includes(loser_action)) return Response.json({ error: 'Invalid loser_action' }, { status: 400 });
    const entries = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id, entrant_email: user.email });
    if (entries[0] && !entries[0].is_winner) {
      await base44.asServiceRole.entities.FlashDropEntry.update(entries[0].id, { loser_action });
    }
    return Response.json({ success: true });
  }

  // ── TRACK VIEW ────────────────────────────────────────────────────────────
  if (action === 'track_view') {
    const { flash_drop_id } = body;
    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (drop) {
      const views = ((drop.metrics || {}).views || 0) + 1;
      await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, { metrics: { ...(drop.metrics || {}), views } });
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
});
