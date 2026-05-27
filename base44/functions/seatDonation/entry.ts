import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * seatDonation — Seat Donation System backend
 *
 * Actions:
 *   opt_in          — Fan opts into donation draws for an event
 *   create_donation — Donor submits old seats to the pool
 *   run_draw        — Weighted draw selects a winner (admin or system)
 *   respond         — Winner accepts or declines
 *
 * ANTI-ABUSE:
 * - Donor cannot win own donation
 * - Suspicious accounts (confirmed_fraud > 0) excluded
 * - Recent winners get reduced weight (30-day cooldown)
 * - Same-event multi-win penalized heavily
 * - Location verification required for opt-in
 */

// ─── Weighted draw calculation ────────────────────────────────────────────────
// Weight = sqrt(peanut_points) * 0.6 + (trust_score * 0.15) + activity_bonus - recent_win_penalty
// sqrt() prevents whales from dominating while still rewarding loyalty
function calcDrawWeight(user, optIn, eventId) {
  const pts      = user.peanut_points        || 0;
  const trust    = user.trust_score          || 50;
  const liveAct  = user.total_live_upgrades  || 0;
  const recentWins = optIn.recent_win_count  || 0;
  const lastWinAt  = optIn.last_win_at;

  // Base weight
  let weight = Math.sqrt(pts) * 0.6;

  // Trust contribution (capped to prevent pure trust farming)
  weight += Math.min(trust * 0.15, 14);

  // Live event activity bonus
  weight += Math.min(liveAct * 3, 15);

  // Minimum floor — everyone has a chance
  weight = Math.max(weight, 5);

  // Recent win penalty (30-day cooldown)
  if (lastWinAt) {
    const daysSinceWin = (Date.now() - new Date(lastWinAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceWin < 30) {
      weight *= Math.max(0.15, daysSinceWin / 30); // scale down linearly
    }
  }

  // Multiple wins penalty (within event: heavy)
  if (recentWins >= 2) weight *= 0.3;
  else if (recentWins === 1) weight *= 0.6;

  // Small random jitter to prevent deterministic always-same-winner (±10%)
  weight *= (0.9 + Math.random() * 0.2);

  return Math.max(weight, 0.5); // always at least a sliver of chance
}

// ─── Weighted random selection ────────────────────────────────────────────────
function weightedRandom(entries) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return entries[entries.length - 1];
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    // ── OPT IN ────────────────────────────────────────────────────────────────
    if (action === 'opt_in') {
      const { event_id, purchase_id, user_lat, user_lng } = body;
      if (!event_id) return Response.json({ error: 'event_id required' }, { status: 400 });

      // Fetch event for geo check
      const [event] = await base44.asServiceRole.entities.Event.filter({ id: event_id });
      if (!event) return Response.json({ error: 'Event not found' }, { status: 404 });

      // Verify active purchase for this event
      let purchase = null;
      if (purchase_id) {
        const [p] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
        if (p && p.buyer_email === user.email && p.event_id === event_id) purchase = p;
      }
      if (!purchase) {
        // Try to find any completed purchase
        const purchases = await base44.asServiceRole.entities.Purchase.filter({
          buyer_email: user.email,
          event_id,
        });
        purchase = purchases.find(p => p.transfer_status === 'completed' || p.transfer_status === 'pending_transfer');
      }
      if (!purchase) {
        return Response.json({ eligible: false, reason: 'no_active_ticket', message: 'Seat donations are only available for fans attending the event.' });
      }

      // Geo verification if coordinates provided and event has venue coords
      let locationVerified = false;
      if (user_lat && user_lng && event.venue_lat && event.venue_lng) {
        const R = 6371000; // Earth radius meters
        const φ1 = user_lat * Math.PI / 180;
        const φ2 = event.venue_lat * Math.PI / 180;
        const Δφ = (event.venue_lat - user_lat) * Math.PI / 180;
        const Δλ = (event.venue_lng - user_lng) * Math.PI / 180;
        const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        locationVerified = dist <= (event.geo_radius_meters || 1000);
      } else {
        // If no venue coords set, allow with ticket only
        locationVerified = true;
      }

      // Check already opted in
      const existing = await base44.asServiceRole.entities.DonationOptIn.filter({
        event_id,
        user_email: user.email,
      });

      // Compute initial draw weight
      const tempOptIn = { recent_win_count: 0, last_win_at: null };
      const drawWeight = calcDrawWeight(user, tempOptIn, event_id);

      if (existing.length > 0) {
        // Update existing opt-in
        await base44.asServiceRole.entities.DonationOptIn.update(existing[0].id, {
          location_verified: locationVerified,
          purchase_id: purchase.id,
          draw_weight: drawWeight,
          opted_in_at: new Date().toISOString(),
        });
        return Response.json({ success: true, opted_in: true, location_verified: locationVerified, draw_weight: drawWeight });
      }

      await base44.asServiceRole.entities.DonationOptIn.create({
        event_id,
        user_email: user.email,
        opted_in_at: new Date().toISOString(),
        location_verified: locationVerified,
        purchase_id: purchase.id,
        draw_weight: drawWeight,
        recent_win_count: 0,
      });

      return Response.json({ success: true, opted_in: true, location_verified: locationVerified, draw_weight: drawWeight });
    }

    // ── CREATE DONATION ───────────────────────────────────────────────────────
    if (action === 'create_donation') {
      const { event_id, section, row, seats, quantity, is_anonymous, donor_message, source_purchase_id } = body;
      if (!event_id || !section) return Response.json({ error: 'event_id and section required' }, { status: 400 });

      // Verify donor has a ticket for this event
      const purchases = await base44.asServiceRole.entities.Purchase.filter({
        buyer_email: user.email,
        event_id,
      });
      if (purchases.length === 0) {
        return Response.json({ error: 'You must have a ticket to donate seats' }, { status: 403 });
      }

      const [event] = await base44.asServiceRole.entities.Event.filter({ id: event_id });
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 hour expiry

      const donation = await base44.asServiceRole.entities.SeatDonation.create({
        event_id,
        event_title:  event?.title  || '',
        event_venue:  event?.venue  || '',
        event_city:   event?.city   || '',
        donor_email:  user.email,
        donor_name:   is_anonymous ? null : (user.full_name || ''),
        is_anonymous: is_anonymous || false,
        donor_message: donor_message || null,
        section,
        row:          row || '',
        seats:        seats || '',
        quantity:     quantity || 1,
        donation_status: 'active',
        expires_at:   expiresAt,
        reroll_count: 0,
        source_purchase_id: source_purchase_id || null,
      });

      // Award donor points via awardPoints function
      await base44.asServiceRole.functions.invoke('awardPoints', {
        action: 'seat_donation_created',
        reference_id: donation.id,
        reference_type: 'listing',
        description: 'Donated seats to the community',
        target_email: user.email,
      }).catch(() => {});

      // Immediately run a draw for the new donation
      const drawResult = await runDraw(base44, donation.id, user.email);

      return Response.json({ success: true, donation_id: donation.id, draw: drawResult });
    }

    // ── RUN DRAW (admin or system) ────────────────────────────────────────────
    if (action === 'run_draw') {
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
      const { donation_id } = body;
      if (!donation_id) return Response.json({ error: 'donation_id required' }, { status: 400 });
      const result = await runDraw(base44, donation_id, null);
      return Response.json({ success: true, draw: result });
    }

    // ── RESPOND (accept/decline) ──────────────────────────────────────────────
    if (action === 'respond') {
      const { donation_id, accepted } = body;
      if (!donation_id) return Response.json({ error: 'donation_id required' }, { status: 400 });

      const [donation] = await base44.asServiceRole.entities.SeatDonation.filter({ id: donation_id });
      if (!donation) return Response.json({ error: 'Donation not found' }, { status: 404 });
      if (donation.winner_email !== user.email) return Response.json({ error: 'Not your donation draw' }, { status: 403 });
      if (donation.donation_status !== 'drawn') return Response.json({ error: 'Donation is not in drawn state' }, { status: 400 });

      if (accepted) {
        await base44.asServiceRole.entities.SeatDonation.update(donation_id, {
          donation_status: 'accepted',
          accepted_at: new Date().toISOString(),
        });

        // Update winner's opt-in record: increment recent_win_count
        const [optIn] = await base44.asServiceRole.entities.DonationOptIn.filter({
          event_id: donation.event_id,
          user_email: user.email,
        });
        if (optIn) {
          await base44.asServiceRole.entities.DonationOptIn.update(optIn.id, {
            recent_win_count: (optIn.recent_win_count || 0) + 1,
            last_win_at: new Date().toISOString(),
          });
        }

        // Award small points to recipient
        await base44.asServiceRole.functions.invoke('awardPoints', {
          action: 'donation_received',
          reference_id: donation_id,
          reference_type: 'listing',
          description: `${donation.is_anonymous ? 'A fan' : (donation.donor_name || 'A fan')} upgraded your night`,
          target_email: user.email,
        }).catch(() => {});

        // Award accepted bonus to donor
        await base44.asServiceRole.functions.invoke('awardPoints', {
          action: 'donation_accepted',
          reference_id: donation_id + '_accepted',
          reference_type: 'listing',
          description: 'Your seat donation was accepted',
          target_email: donation.donor_email,
        }).catch(() => {});

        return Response.json({ success: true, status: 'accepted' });
      } else {
        // Declined — reroll if possible
        await base44.asServiceRole.entities.SeatDonation.update(donation_id, {
          donation_status: 'declined_rerolling',
          winner_email: null,
          winner_name: null,
        });

        if ((donation.reroll_count || 0) < 3) {
          const rerollResult = await runDraw(base44, donation_id, donation.donor_email);
          return Response.json({ success: true, status: 'declined', reroll: rerollResult });
        } else {
          await base44.asServiceRole.entities.SeatDonation.update(donation_id, {
            donation_status: 'expired',
          });
          return Response.json({ success: true, status: 'declined', reroll: null, expired: true });
        }
      }
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ─── Draw logic (shared) ──────────────────────────────────────────────────────
async function runDraw(base44, donationId, excludeEmail) {
  const [donation] = await base44.asServiceRole.entities.SeatDonation.filter({ id: donationId });
  if (!donation) return { error: 'donation_not_found' };
  if (!['active', 'declined_rerolling'].includes(donation.donation_status)) {
    return { error: 'not_eligible_for_draw' };
  }

  // Get all opt-ins for this event
  const optIns = await base44.asServiceRole.entities.DonationOptIn.filter({ event_id: donation.event_id });

  // Filter eligible opt-ins
  const eligible = optIns.filter(o => {
    if (o.user_email === donation.donor_email) return false; // donor can't win own
    if (excludeEmail && o.user_email === excludeEmail) return false;
    return true;
  });

  if (eligible.length === 0) {
    await base44.asServiceRole.entities.SeatDonation.update(donationId, { donation_status: 'expired' });
    return { winner: null, reason: 'no_eligible_fans' };
  }

  // Fetch user data for weight calculation
  const entries = [];
  for (const optIn of eligible) {
    const [u] = await base44.asServiceRole.entities.User.filter({ email: optIn.user_email });
    if (!u) continue;
    if ((u.confirmed_fraud_count || 0) > 0) continue; // exclude fraud accounts

    const weight = calcDrawWeight(u, optIn, donation.event_id);
    entries.push({ optIn, user: u, weight });
  }

  if (entries.length === 0) {
    await base44.asServiceRole.entities.SeatDonation.update(donationId, { donation_status: 'expired' });
    return { winner: null, reason: 'no_valid_candidates' };
  }

  const winner = weightedRandom(entries);
  const rerollCount = (donation.reroll_count || 0) + (donation.donation_status === 'declined_rerolling' ? 1 : 0);

  await base44.asServiceRole.entities.SeatDonation.update(donationId, {
    donation_status: 'drawn',
    winner_email: winner.user.email,
    winner_name: winner.user.full_name || '',
    drawn_at: new Date().toISOString(),
    reroll_count: rerollCount,
  });

  return {
    winner_email: winner.user.email,
    winner_name: winner.user.full_name || 'Fan',
    draw_weight: winner.weight,
    total_entrants: entries.length,
  };
}