import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Anti-abuse config ───────────────────────────────────────────────────────
const MAX_DROPS_PER_USER_PER_EVENT = 2;
const MIN_MINUTES_BETWEEN_DROPS = 5;

// ── Trust score computation ─────────────────────────────────────────────────
function computeTrustScore({ ownershipVerified, ownershipMethod, transferConfirmed, sellerVerified, priorSuccessfulTransfers }) {
  let score = 0;
  const breakdown = {};

  if (ownershipVerified) {
    const ownershipPoints = ownershipMethod === 'verified_listing' ? 40 :
                            ownershipMethod === 'transfer_capability' ? 35 :
                            ownershipMethod === 'verified_ticket_file' ? 30 :
                            ownershipMethod === 'ownership_proof_upload' ? 20 : 15;
    breakdown.ownership_verified = ownershipPoints;
    score += ownershipPoints;
  } else {
    breakdown.ownership_verified = 0;
  }

  if (transferConfirmed) {
    breakdown.transfer_confirmed = 30;
    score += 30;
  } else {
    breakdown.transfer_confirmed = 0;
  }

  if (sellerVerified) {
    breakdown.verified_seller = 15;
    score += 15;
  } else {
    breakdown.verified_seller = 0;
  }

  const priorPoints = Math.min(15, (priorSuccessfulTransfers || 0) * 5);
  breakdown.prior_transfers = priorPoints;
  score += priorPoints;

  return { score: Math.min(100, score), breakdown };
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

    // ── Anti-abuse: rate limiting & duplicate detection ─────────────────────
    const existingDrops = await base44.asServiceRole.entities.FlashDrop.filter({
      donor_email: user.email,
      event_id,
    });

    const nonCancelledDrops = existingDrops.filter(d => d.status !== 'cancelled' && d.status !== 'expired');

    if (nonCancelledDrops.length >= MAX_DROPS_PER_USER_PER_EVENT) {
      return Response.json({
        error: `Maximum ${MAX_DROPS_PER_USER_PER_EVENT} Flash Drops per event. You already have ${nonCancelledDrops.length}.`,
        code: 'RATE_LIMIT_EVENT',
      }, { status: 429 });
    }

    // Check minimum time between drops (global, not per-event)
    const recentDrops = await base44.asServiceRole.entities.FlashDrop.filter({ donor_email: user.email });
    const latestDrop = recentDrops
      .filter(d => d.created_date)
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

    if (latestDrop?.created_date) {
      const minsSince = (Date.now() - new Date(latestDrop.created_date).getTime()) / 60000;
      if (minsSince < MIN_MINUTES_BETWEEN_DROPS) {
        return Response.json({
          error: `Please wait ${Math.ceil(MIN_MINUTES_BETWEEN_DROPS - minsSince)} more minute(s) before creating another Flash Drop.`,
          code: 'RATE_LIMIT_GLOBAL',
        }, { status: 429 });
      }
    }

    // ── Duplicate seat detection ─────────────────────────────────────────────
    const sectionMatch = nonCancelledDrops.find(
      d => d.section?.toLowerCase() === section?.toLowerCase() &&
           (!row || d.row?.toLowerCase() === row?.toLowerCase()) &&
           ['active', 'pending', 'winner_selected'].includes(d.status)
    );
    if (sectionMatch) {
      return Response.json({
        error: 'You already have an active Flash Drop for this section/row.',
        code: 'DUPLICATE_SEAT',
      }, { status: 409 });
    }

    // ── Ownership verification ───────────────────────────────────────────────
    let ownershipVerified = false;
    let ownershipMethod = null;
    let ownershipVerifiedAt = null;
    let trustTransferConfirmed = false;
    let sellerVerified = false;
    let priorSuccessful = 0;
    const abuseFlags = [];

    // Path 1: donor has a verified listing for this event/section
    if (ownership_listing_id) {
      const listings = await base44.asServiceRole.entities.Listing.filter({ id: ownership_listing_id });
      const listing = listings[0];
      if (listing && listing.seller_email === user.email &&
          listing.event_id === event_id &&
          listing.section === section &&
          (listing.status === 'active' || listing.status === 'sold')) {
        ownershipVerified = true;
        ownershipMethod = 'verified_listing';
        ownershipVerifiedAt = new Date().toISOString();
        trustTransferConfirmed = listing.transfer_status === 'transfer_confirmed';
      } else {
        abuseFlags.push('listing_mismatch');
      }
    }

    // Path 2: source_purchase_id — buyer upgrading, donating old seat
    if (source_purchase_id && !ownershipVerified) {
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: source_purchase_id });
      const purchase = purchases[0];
      if (purchase && purchase.buyer_email === user.email &&
          purchase.event_id === event_id &&
          purchase.payment_captured) {
        ownershipVerified = true;
        ownershipMethod = 'verified_ticket_file';
        ownershipVerifiedAt = new Date().toISOString();
        trustTransferConfirmed = true;
      }
    }

    // Path 3: proof upload (lower trust, still recorded)
    if (ownership_proof_url && !ownershipVerified) {
      ownershipVerified = true;
      ownershipMethod = 'ownership_proof_upload';
      ownershipVerifiedAt = new Date().toISOString();
    }

    // ── Fetch seller stats for trust score ──────────────────────────────────
    const [userRecords, outcomes] = await Promise.all([
      base44.asServiceRole.entities.User.filter({ email: user.email }),
      base44.asServiceRole.entities.TransferOutcome.filter({ seller_email: user.email }),
    ]);
    const userRecord = userRecords[0];
    sellerVerified = userRecord?.stripe_onboarding_complete === true || userRecord?.stripe_onboarding_complete === 'true';
    priorSuccessful = outcomes.filter(o => o.transfer_successful).length;

    // Suspicious ownership flags
    if (!ownershipVerified) {
      abuseFlags.push('unverified_ownership');
    }
    if ((userRecord?.strike_count || 0) >= 2) {
      abuseFlags.push('high_strike_count');
    }
    if ((userRecord?.transfer_false_claim_count || 0) >= 1) {
      abuseFlags.push('prior_false_claim');
    }

    const { score: trustScore, breakdown: trustBreakdown } = computeTrustScore({
      ownershipVerified,
      ownershipMethod,
      transferConfirmed: trustTransferConfirmed,
      sellerVerified,
      priorSuccessfulTransfers: priorSuccessful,
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
      ownership_verified: ownershipVerified,
      ownership_verification_method: ownershipMethod,
      ownership_verified_at: ownershipVerifiedAt,
      ownership_listing_id: ownership_listing_id || null,
      ownership_delivery_method: ownership_delivery_method || 'ticket_transfer',
      trust_score: trustScore,
      trust_breakdown: trustBreakdown,
      abuse_flags: abuseFlags,
      winner_selection_locked_at: null,
      winner_selection_request_id: null,
      selection_completed_at: null,
      metrics: { views: 0, entries: 0, loser_upgrade_clicks: 0, loser_purchases: 0, notification_sent: 0, notification_opened: 0 },
    });

    return Response.json({
      success: true,
      drop,
      ownership_verified: ownershipVerified,
      trust_score: trustScore,
      abuse_flags: abuseFlags,
    });
  }

  // ── ENTER A FLASH DROP ────────────────────────────────────────────────────
  if (action === 'enter') {
    const { flash_drop_id } = body;
    if (!flash_drop_id) return Response.json({ error: 'flash_drop_id required' }, { status: 400 });

    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Flash drop not found' }, { status: 404 });
    if (drop.status !== 'active') {
      return Response.json({ error: 'Entry window is closed', status: drop.status }, { status: 409 });
    }
    if (drop.entry_closes_at && new Date() > new Date(drop.entry_closes_at)) {
      return Response.json({ error: 'Entry window has expired' }, { status: 409 });
    }
    if (drop.donor_email === user.email) {
      return Response.json({ error: 'You cannot enter your own Flash Drop' }, { status: 403 });
    }

    // Dedup
    const existing = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id, entrant_email: user.email });
    if (existing.length > 0) {
      return Response.json({ error: 'Already entered', entry: existing[0] }, { status: 409 });
    }

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

    // ── IDEMPOTENCY CHECK 1: already completed ────────────────────────────
    if (drop.status === 'winner_selected' && drop.winner_email) {
      return Response.json({
        success: true,
        already_selected: true,
        winner: { email: drop.winner_email, name: drop.winner_name },
        entry_count: drop.entry_count,
      });
    }

    if (drop.status === 'expired') {
      return Response.json({ success: true, already_selected: true, winner: null, no_entries: true });
    }

    // ── IDEMPOTENCY CHECK 2: lock in progress ─────────────────────────────
    // If locked by another request more than 10s ago, it may have crashed — allow retry
    const lockAge = drop.winner_selection_locked_at
      ? (Date.now() - new Date(drop.winner_selection_locked_at).getTime()) / 1000
      : null;

    if (drop.winner_selection_locked_at && lockAge !== null && lockAge < 10) {
      // Another request is actively processing — return pending
      return Response.json({
        success: false,
        pending: true,
        message: 'Winner selection in progress. Poll for result.',
      });
    }

    // ── ACQUIRE LOCK ──────────────────────────────────────────────────────
    const reqId = request_id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
      winner_selection_locked_at: new Date().toISOString(),
      winner_selection_request_id: reqId,
    });

    // Re-fetch to confirm we own the lock (check request_id matches)
    const confirmDrops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const confirmDrop = confirmDrops[0];

    // If winner already selected (race — another request beat us between lock check and acquire)
    if (confirmDrop.status === 'winner_selected' && confirmDrop.winner_email) {
      return Response.json({
        success: true,
        already_selected: true,
        winner: { email: confirmDrop.winner_email, name: confirmDrop.winner_name },
        entry_count: confirmDrop.entry_count,
      });
    }

    // ── SELECT WINNER ─────────────────────────────────────────────────────
    const entries = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id });
    const now = new Date().toISOString();

    if (entries.length === 0) {
      await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
        status: 'expired',
        selection_completed_at: now,
        entry_count: 0,
      });
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

    // Fire-and-forget: winner notification
    base44.asServiceRole.functions.invoke('recordNotification', {
      user_email: winner.entrant_email,
      type: 'donation_won',
      title: '🎁 You won a Flash Drop!',
      body: `Section ${drop.section}${drop.row ? ` Row ${drop.row}` : ''} — ${drop.event_title}. Contact the donor to claim your seat.`,
      reference_id: flash_drop_id,
      reference_type: 'donation',
      icon: '🎁',
      action_url: `/event-mode/${drop.event_id}`,
    }).catch(() => {});

    return Response.json({
      success: true,
      winner: { email: winner.entrant_email, name: winner.entrant_name },
      entry_count: entries.length,
    });
  }

  // ── POLL FOR RESULT (clients call this instead of close_and_pick directly) ─
  if (action === 'poll_result') {
    const { flash_drop_id } = body;
    if (!flash_drop_id) return Response.json({ error: 'flash_drop_id required' }, { status: 400 });

    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });

    if (drop.status === 'winner_selected') {
      return Response.json({
        ready: true,
        winner: { email: drop.winner_email, name: drop.winner_name },
        entry_count: drop.entry_count,
        no_entries: false,
      });
    }
    if (drop.status === 'expired') {
      return Response.json({ ready: true, winner: null, no_entries: true });
    }

    return Response.json({ ready: false, status: drop.status });
  }

  // ── ACTIVATE SCHEDULED DROP ───────────────────────────────────────────────
  if (action === 'activate_scheduled') {
    const { flash_drop_id } = body;
    // Donor can activate their own scheduled drop
    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });

    if (drop.donor_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (drop.status !== 'pending') {
      return Response.json({ error: 'Drop is not in pending state' }, { status: 409 });
    }

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
    if (!validActions.includes(loser_action)) {
      return Response.json({ error: 'Invalid loser_action' }, { status: 400 });
    }
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
      await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
        metrics: { ...(drop.metrics || {}), views },
      });
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
});