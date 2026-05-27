/**
 * cleanupStaleDonations — scheduled function to expire stale drawn donations.
 *
 * A donation enters `drawn` state when a winner is selected. The winner has
 * 2 minutes (120s) to respond via the UI. If they don't (app closed, network
 * drop, etc.), the donation sits orphaned in `drawn` forever.
 *
 * This function runs every 10 minutes and:
 * 1. Finds all donations in `drawn` state older than 3 minutes (grace buffer)
 * 2. Attempts a reroll if reroll_count < 3
 * 3. Otherwise expires the donation cleanly
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Weighted draw (inlined — no local imports allowed) ───────────────────────
function calcDrawWeight(user, optIn) {
  const pts     = user.peanut_points       || 0;
  const trust   = user.trust_score         || 50;
  const liveAct = user.total_live_upgrades || 0;
  const recentWins = optIn.recent_win_count || 0;
  const lastWinAt  = optIn.last_win_at;

  let weight = Math.sqrt(pts) * 0.6;
  weight += Math.min(trust * 0.15, 14);
  weight += Math.min(liveAct * 3, 15);
  weight = Math.max(weight, 5);

  if (lastWinAt) {
    const daysSinceWin = (Date.now() - new Date(lastWinAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceWin < 30) weight *= Math.max(0.15, daysSinceWin / 30);
  }

  if (recentWins >= 2) weight *= 0.3;
  else if (recentWins === 1) weight *= 0.6;

  weight *= (0.9 + Math.random() * 0.2);
  return Math.max(weight, 0.5);
}

function weightedRandom(entries) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return entries[entries.length - 1];
}

async function rerollOrExpire(base44, donation) {
  const MAX_REROLLS = 3;
  const rerollCount = donation.reroll_count || 0;

  if (rerollCount >= MAX_REROLLS) {
    // Max rerolls hit — expire cleanly
    await base44.asServiceRole.entities.SeatDonation.update(donation.id, {
      donation_status: 'expired',
      winner_email: null,
      winner_name: null,
    });
    return { action: 'expired', donation_id: donation.id };
  }

  // Get eligible opt-ins (exclude donor)
  const optIns = await base44.asServiceRole.entities.DonationOptIn.filter({ event_id: donation.event_id });
  const eligible = optIns.filter(o => o.user_email !== donation.donor_email && o.user_email !== donation.winner_email);

  if (eligible.length === 0) {
    await base44.asServiceRole.entities.SeatDonation.update(donation.id, {
      donation_status: 'expired',
      winner_email: null,
      winner_name: null,
    });
    return { action: 'expired_no_candidates', donation_id: donation.id };
  }

  // Fetch users in parallel
  const userResults = await Promise.all(
    eligible.map(optIn =>
      base44.asServiceRole.entities.User.filter({ email: optIn.user_email })
        .then(([u]) => ({ optIn, user: u }))
        .catch(() => ({ optIn, user: null }))
    )
  );

  const entries = userResults
    .filter(({ user: u }) => u && (u.confirmed_fraud_count || 0) === 0)
    .map(({ optIn, user: u }) => ({ optIn, user: u, weight: calcDrawWeight(u, optIn) }));

  if (entries.length === 0) {
    await base44.asServiceRole.entities.SeatDonation.update(donation.id, {
      donation_status: 'expired',
      winner_email: null,
      winner_name: null,
    });
    return { action: 'expired_no_valid_candidates', donation_id: donation.id };
  }

  const winner = weightedRandom(entries);
  await base44.asServiceRole.entities.SeatDonation.update(donation.id, {
    donation_status: 'drawn',
    winner_email: winner.user.email,
    winner_name: winner.user.full_name || '',
    drawn_at: new Date().toISOString(),
    reroll_count: rerollCount + 1,
  });

  return { action: 'rerolled', donation_id: donation.id, new_winner: winner.user.email };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // This is a scheduled/system function — verify admin or internal call
    const body = await req.json().catch(() => ({}));
    if (body._scheduled !== true) {
      const user = await base44.auth.me();
      if (!user || user.role !== 'admin') {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Find all donations in `drawn` state
    const drawnDonations = await base44.asServiceRole.entities.SeatDonation.filter({
      donation_status: 'drawn',
    });

    if (drawnDonations.length === 0) {
      return Response.json({ success: true, processed: 0, message: 'No stale donations found' });
    }

    // Filter to ones drawn > 3 minutes ago (grace period beyond the 2-min UI timer)
    const STALE_MS = 3 * 60 * 1000;
    const stale = drawnDonations.filter(d => {
      if (!d.drawn_at) return true;
      return (Date.now() - new Date(d.drawn_at).getTime()) > STALE_MS;
    });

    if (stale.length === 0) {
      return Response.json({ success: true, processed: 0, message: 'No stale drawn donations' });
    }

    // Process stale donations — mark as declined_rerolling first, then reroll
    const results = [];
    for (const donation of stale) {
      // Reset to declined_rerolling so rerollOrExpire works correctly
      await base44.asServiceRole.entities.SeatDonation.update(donation.id, {
        donation_status: 'declined_rerolling',
        winner_email: null,
        winner_name: null,
      });
      const result = await rerollOrExpire(base44, { ...donation, donation_status: 'declined_rerolling' });
      results.push(result);
    }

    console.log('[cleanupStaleDonations] processed:', results.length, JSON.stringify(results));
    return Response.json({ success: true, processed: results.length, results });
  } catch (error) {
    console.error('[cleanupStaleDonations] error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});