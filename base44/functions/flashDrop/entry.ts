import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { recordNotification } from '../../shared/notifications.ts';

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

  // ── CREATE FLASH DROP ─────────────────────────────────────────────────────
  if (action === 'create') {
    const {
      event_id, section, row, seats, quantity, is_anonymous, donor_message,
      drop_type, scheduled_label, entry_window_seconds, source_purchase_id,
      ownership_listing_id, ownership_proof_url, ownership_delivery_method,
    } = body;

    if (!event_id || !section) {
      return Response.json({ error: 'event_id and section required' }, { status: 400 });
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

    // ── SeatInventory conflict check ────────────────────────────────────────
    const existingInv = await findExistingInventory(base44, { owner_email: user.email, event_id, section, row });
    const conflict = checkInventoryConflict(existingInv);
    if (conflict.blocked) {
      return Response.json({ error: conflict.reason, code: 'INVENTORY_CONFLICT' }, { status: 409 });
    }

    // ── Ownership verification ──────────────────────────────────────────────
    let ownershipVerified = false;
    let ownershipMethod = null;
    let ownershipVerifiedAt = null;
    let trustTransferConfirmed = false;
    let sellerVerified = false;
    let priorSuccessful = 0;
    const abuseFlags = [];

    // Path 1: verified listing
    if (ownership_listing_id) {
      const listings = await base44.asServiceRole.entities.Listing.filter({ id: ownership_listing_id });
      const listing = listings[0];
      if (listing && listing.seller_email === user.email && listing.event_id === event_id && listing.section === section) {
        ownershipVerified = true;
        ownershipMethod = 'verified_listing';
        ownershipVerifiedAt = new Date().toISOString();
        trustTransferConfirmed = listing.transfer_status === 'transfer_confirmed';
      } else {
        abuseFlags.push('listing_mismatch');
      }
    }

    // Path 2: source_purchase_id
    if (source_purchase_id && !ownershipVerified) {
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: source_purchase_id });
      const purchase = purchases[0];
      if (purchase && purchase.buyer_email === user.email && purchase.event_id === event_id && purchase.payment_captured) {
        ownershipVerified = true;
        ownershipMethod = 'verified_ticket_file';
        ownershipVerifiedAt = new Date().toISOString();
        trustTransferConfirmed = true;
      }
    }

    // Path 3: proof upload
    if (ownership_proof_url && !ownershipVerified) {
      ownershipVerified = true;
      ownershipMethod = 'ownership_proof_upload';
      ownershipVerifiedAt = new Date().toISOString();
    }

    if (!ownershipVerified && !ALLOW_UNVERIFIED_BETA) {
      return Response.json({
        error: 'Ownership verification required. Link a listing, purchase, or upload a ticket screenshot.',
        code: 'OWNERSHIP_REQUIRED',
      }, { status: 403 });
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
    const windowSecs = Math.min(90, Math.max(30, entry_window_seconds || 60));

    let status = 'pending';
    let entry_opens_at = null;
    let entry_closes_at = null;
    if (drop_type === 'immediate') {
      const now = new Date();
      entry_opens_at = now.toISOString();
      entry_closes_at = new Date(now.getTime() + windowSecs * 1000).toISOString();
      status = 'active';
    }

    // ── Create or update SeatInventory ─────────────────────────────────────
    let seatInventoryId = existingInv?.id || null;
    const invData = {
      event_id,
      event_title: event?.title || '',
      owner_email: user.email,
      owner_name: user.full_name || user.email,
      section,
      row: row || null,
      seats: seats || null,
      quantity: quantity || 1,
      inventory_status: 'in_flash_drop',
      inventory_intent: 'flash_drop',
      source_type: source_purchase_id ? 'purchase' : ownership_listing_id ? 'listing' : 'flash_drop',
      ownership_verified: ownershipVerified,
      ownership_verification_method: ownershipMethod,
      ownership_verified_at: ownershipVerifiedAt,
      ownership_proof_url: ownership_proof_url || null,
      transfer_verified: trustTransferConfirmed,
    };

    if (seatInventoryId) {
      await base44.asServiceRole.entities.SeatInventory.update(seatInventoryId, invData);
    } else {
      const inv = await base44.asServiceRole.entities.SeatInventory.create(invData);
      seatInventoryId = inv.id;
    }

    // ── Create FlashDrop ────────────────────────────────────────────────────
    const drop = await base44.entities.FlashDrop.create({
      event_id,
      event_title: event?.title || '',
      donor_email: user.email,
      donor_name: is_anonymous ? null : (user.full_name || user.email),
      is_anonymous: is_anonymous || false,
      section,
      row: row || null,
      seats: seats || null,
      quantity: quantity || 1,
      donor_message: donor_message || null,
      drop_type: drop_type || 'immediate',
      scheduled_label: scheduled_label || null,
      entry_window_seconds: windowSecs,
      status,
      entry_opens_at,
      entry_closes_at,
      entry_count: 0,
      source_purchase_id: source_purchase_id || null,
      seat_inventory_id: seatInventoryId,
      ownership_verified: ownershipVerified,
      ownership_verification_method: ownershipMethod,
      ownership_verified_at: ownershipVerifiedAt,
      ownership_listing_id: ownership_listing_id || null,
      ownership_delivery_method: ownership_delivery_method || 'ticket_transfer',
      trust_score: trustScore,
      trust_breakdown: trustBreakdown,
      abuse_flags: abuseFlags,
      metrics: { views: 0, entries: 0, loser_upgrade_clicks: 0, loser_purchases: 0, notification_sent: 0, notification_opened: 0 },
    });

    // Link back from SeatInventory
    await base44.asServiceRole.entities.SeatInventory.update(seatInventoryId, { linked_flash_drop_id: drop.id });

    return Response.json({ success: true, drop, ownership_verified: ownershipVerified, trust_score: trustScore, abuse_flags: abuseFlags });
  }

  // ── ENTER A FLASH DROP ────────────────────────────────────────────────────
  if (action === 'enter') {
    const { flash_drop_id } = body;
    if (!flash_drop_id) return Response.json({ error: 'flash_drop_id required' }, { status: 400 });

    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Flash drop not found' }, { status: 404 });
    if (drop.status !== 'active') return Response.json({ error: 'Entry window is closed', status: drop.status }, { status: 409 });
    if (drop.entry_closes_at && new Date() > new Date(drop.entry_closes_at)) {
      return Response.json({ error: 'Entry window has expired' }, { status: 409 });
    }
    if (drop.donor_email === user.email) return Response.json({ error: 'You cannot enter your own Flash Drop' }, { status: 403 });

    const existing = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id, entrant_email: user.email });
    if (existing.length > 0) return Response.json({ error: 'Already entered', entry: existing[0] }, { status: 409 });

    const entry = await base44.entities.FlashDropEntry.create({
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

    // Already done — return existing result
    if (drop.status === 'winner_selected' && drop.winner_email) {
      return Response.json({ success: true, already_selected: true, winner: { email: drop.winner_email, name: drop.winner_name }, entry_count: drop.entry_count });
    }
    if (drop.status === 'expired') {
      return Response.json({ success: true, already_selected: true, winner: null, no_entries: true });
    }

    // Lock in progress check (< 10s old = another request is processing)
    const lockAge = drop.winner_selection_locked_at
      ? (Date.now() - new Date(drop.winner_selection_locked_at).getTime()) / 1000
      : null;
    if (drop.winner_selection_locked_at && lockAge !== null && lockAge < 10) {
      return Response.json({ success: false, pending: true, message: 'Winner selection in progress. Poll for result.' });
    }

    // Acquire lock
    const reqId = request_id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
      winner_selection_locked_at: new Date().toISOString(),
      winner_selection_request_id: reqId,
    });

    // Re-fetch to confirm we own lock
    const confirmDrops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const confirmDrop = confirmDrops[0];
    if (confirmDrop.status === 'winner_selected' && confirmDrop.winner_email) {
      return Response.json({ success: true, already_selected: true, winner: { email: confirmDrop.winner_email, name: confirmDrop.winner_name }, entry_count: confirmDrop.entry_count });
    }

    const entries = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id });
    const now = new Date().toISOString();

    if (entries.length === 0) {
      await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, { status: 'expired', selection_completed_at: now, entry_count: 0 });
      // Update SeatInventory → available
      if (drop.seat_inventory_id) {
        await base44.asServiceRole.entities.SeatInventory.update(drop.seat_inventory_id, { inventory_status: 'available' }).catch(() => {});
      }
      return Response.json({ success: true, winner: null, no_entries: true });
    }

    const winner = entries[Math.floor(Math.random() * entries.length)];

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
    const { flash_drop_id, role } = body; // role: 'donor' | 'winner'
    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });

    const now = new Date().toISOString();
    if (drop.seat_inventory_id) {
      const updates = role === 'donor'
        ? { donor_delivery_confirmed: true, donor_delivery_confirmed_at: now }
        : { winner_delivery_confirmed: true, winner_delivery_confirmed_at: now };
      await base44.asServiceRole.entities.SeatInventory.update(drop.seat_inventory_id, updates);

      // If both confirmed → transferred
      const invs = await base44.asServiceRole.entities.SeatInventory.filter({ id: drop.seat_inventory_id });
      const inv = invs[0];
      const donorDone = role === 'donor' ? true : inv?.donor_delivery_confirmed;
      const winnerDone = role === 'winner' ? true : inv?.winner_delivery_confirmed;
      if (donorDone && winnerDone) {
        await base44.asServiceRole.entities.SeatInventory.update(drop.seat_inventory_id, { inventory_status: 'transferred' });
      }
    }
    return Response.json({ success: true });
  }

  // ── ACTIVATE SCHEDULED DROP ───────────────────────────────────────────────
  if (action === 'activate_scheduled') {
    const { flash_drop_id } = body;
    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });
    if (drop.donor_email !== user.email && user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
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