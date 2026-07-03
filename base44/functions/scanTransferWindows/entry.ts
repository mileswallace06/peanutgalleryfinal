/**
 * scanTransferWindows — "Transfer Window Agent" (Transfer Confidence Engine)
 * --------------------------------------------------------------------
 * Scheduled function (runs every 30 min) that continuously scores how
 * confident Peanut Gallery is that each event's ticket transfer window is
 * CLOSED (transfers unavailable). The score (0-100) is the single source of
 * truth for transfer badges, listing visibility, and live upgrade eligibility.
 *
 * Confidence signals (combined, strongest first):
 *   1. Manual admin verification (manually_verified_open/closed) — overrides
 *      everything else. Score is pinned to 0 (open) or 100 (closed).
 *   2. Official partner data (Ticketmaster / AXS / SeatGeek / MLB / venue
 *      integrations) + an explicit transfer_window_closes_at.
 *   3. Community reports (TransferReport) — recency-weighted net signal.
 *   4. Historical marketplace data (TransferIntelligence) — venue-level
 *      transfer success rate, learned automatically from completed outcomes.
 *   5. Time-based inference — weakest; fills gaps when no stronger evidence
 *      exists (distance from event start).
 *
 * Decision thresholds (confidence that the window is CLOSED):
 *   90-100  closed        — hide listings, disable live upgrades, Closed badge
 *   70-89   closing_soon  — do NOT hide; warn sellers/buyers; "may close soon"
 *   40-69   open          — leave active; informational badge; keep monitoring
 *   0-39    unknown       — leave active; keep gathering evidence
 *
 * Every event gets transfer_confidence_score, transfer_confidence_reason,
 * and transfer_confidence_last_updated refreshed each run (writes are
 * throttled to meaningful changes to bound DB load). Listing takedowns and
 * notifications fire only on a transition into the closed/closing_soon tier.
 *
 * Runs as service role. Scheduled invocations (no interactive session) are
 * allowed; interactive non-admin calls are blocked.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const TRANSFER_CLOSES_AFTER_START_MIN = 90;
const TM_ENRICH_CAP = 5;
const FETCH_TIMEOUT_MS = 8000;
const CLOSED_ACTION_CAP = 30;
// Sources authoritative enough to justify a hard close before the event starts.
const TRUSTED_SOURCES = new Set(['manual_admin', 'ticketmaster', 'seatgeek', 'axs', 'mlb']);
// Write an event's confidence only when the score moved by this much, the
// status tier changed, or the last update is older than this window.
const SCORE_WRITE_DELTA = 5;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * Compute a 0-100 confidence score that the transfer window is CLOSED
 * (transfers unavailable). Returns { score, reason, status, eligibility, action, override }.
 */
function computeConfidence(ev, startMs, ctx, nowMs) {
  // 1. Manual admin override — authoritative, beats everything.
  if (ev.transfer_window_status === 'manually_verified_closed') {
    return { score: 100, reason: 'Admin verified closed (manual override)', status: 'manually_verified_closed', eligibility: 'not_eligible', action: 'none', override: true };
  }
  if (ev.transfer_window_status === 'manually_verified_open') {
    return { score: 0, reason: 'Admin verified open (manual override)', status: 'manually_verified_open', eligibility: 'eligible', action: 'none', override: true };
  }

  const reasons = [];
  const source = ev.transfer_window_source;
  const isTrusted = !!source && TRUSTED_SOURCES.has(source);
  const closesAtMs = ev.transfer_window_closes_at ? new Date(ev.transfer_window_closes_at).getTime() : null;

  // 5. Time-based inference (weakest — fills gaps)
  let score;
  if (startMs === null) {
    score = 50;
    reasons.push('No start time (neutral)');
  } else {
    const minSince = (nowMs - startMs) / 60000;
    const minBefore = -minSince;
    if (minSince >= 90) { score = 95; reasons.push('95+ min after start'); }
    else if (minSince >= 30) { score = 78; reasons.push(`${Math.round(minSince)} min after start`); }
    else if (minSince >= 0) { score = 55; reasons.push('event in progress (<30 min)'); }
    else if (minBefore >= 1440) { score = 5; reasons.push(`${Math.round(minBefore / 60)} h before start`); }
    else if (minBefore >= 120) { score = 18; reasons.push(`${Math.round(minBefore)} min before start`); }
    else { score = 30; reasons.push(`${Math.round(minBefore)} min before start`); }
  }

  // 2. Explicit transfer_window_closes_at (stronger than time alone)
  if (closesAtMs !== null) {
    if (nowMs >= closesAtMs) {
      const eventStarted = startMs !== null && nowMs >= startMs;
      if (eventStarted) { score = Math.max(score, 92); reasons.push('close time passed, event started'); }
      else if (isTrusted) { score = Math.max(score, 92); reasons.push(`official close time passed (${source})`); }
      else { score = Math.max(score, 72); reasons.push('inferred close time passed (unverified, pre-start)'); }
    } else {
      const minToClose = (closesAtMs - nowMs) / 60000;
      if (minToClose < 30) { score = Math.max(score, 70); reasons.push(`window closes in ~${Math.round(minToClose)} min`); }
      else { score = Math.min(score, 20); reasons.push(`window open, closes in ~${Math.round(minToClose)} min`); }
    }
  }

  // 3. Community reports (TransferReport) — recency weighted over 24h
  const evReports = ctx.reportsByEvent[ev.id] || [];
  if (evReports.length) {
    let net = 0, unavail = 0, avail = 0;
    for (const r of evReports) {
      const ageH = (nowMs - new Date(r.created_date).getTime()) / 3600000;
      if (ageH > 24) continue;
      const w = Math.max(0.2, 1 - ageH / 24);
      if (r.report_type === 'transfer_unavailable') { net += w * 15; unavail++; }
      else if (r.report_type === 'transfer_available') { net -= w * 15; avail++; }
    }
    score = clamp(score + net, 0, 100);
    reasons.push(`Community: ${unavail} unavailable / ${avail} available (${net >= 0 ? '+' : ''}${Math.round(net)})`);
  }

  // 4. Historical marketplace data (TransferIntelligence) — venue success rate
  const vs = ev.venue ? ctx.venueStats[ev.venue] : null;
  if (vs && vs.total >= 3) {
    const failRate = vs.fail / vs.total;
    const adj = Math.round((failRate - 0.3) * 40);
    score = clamp(score + adj, 0, 100);
    const successPct = Math.round((vs.success / vs.total) * 100);
    reasons.push(`History: ${successPct}% success at ${ev.venue} (${vs.total} transfers, ${adj >= 0 ? '+' : ''}${adj})`);
  }

  // Official partner with no explicit close → presume open before start
  if (isTrusted && closesAtMs === null && startMs !== null && nowMs < startMs) {
    score = Math.min(score, 25);
    reasons.push(`official source (${source}) — window presumed open`);
  }

  score = clamp(Math.round(score), 0, 100);

  // Tier → status + eligibility + action
  let status, eligibility, action;
  if (score >= 90) { status = 'closed'; eligibility = 'not_eligible'; action = 'hide'; }
  else if (score >= 70) { status = 'closing_soon'; eligibility = 'limited'; action = 'warn'; }
  else if (score >= 40) { status = 'open'; eligibility = 'unknown'; action = 'info'; }
  else { status = 'unknown'; eligibility = 'unknown'; action = 'none'; }

  return { score, reason: reasons.join(' · '), status, eligibility, action, override: false };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth: scheduled runs resolve a system principal that may not be admin,
    // so only block genuine interactive non-admin calls.
    try {
      const isInteractive = await base44.auth.isAuthenticated();
      if (isInteractive) {
        const caller = await base44.auth.me();
        if (caller && caller.role !== 'admin') {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    } catch (_) {
      // No resolvable session (scheduled run) — allow
    }

    const now = new Date();
    const nowMs = now.getTime();
    const svc = base44.asServiceRole;
    const results = { scanned: 0, enriched: 0, scored: 0, closed: 0, warned: 0, listings_hidden: 0, alerts: 0 };

    const [upcoming, live] = await Promise.all([
      svc.entities.Event.filter({ status: 'upcoming' }, 'event_start_utc', 500),
      svc.entities.Event.filter({ status: 'live' }, 'event_start_utc', 500),
    ]);
    const events = [...upcoming, ...live];
    results.scanned = events.length;

    // ── 1. Enrich events missing a canonical UTC start time from TM ─────────
    const toEnrich = events
      .filter(e => e.tm_id && !e.event_start_utc && !e.date)
      .slice(0, TM_ENRICH_CAP);
    const tmKey = Deno.env.get('Ticketmaster_consumer_key');
    for (const ev of toEnrich) {
      if (!tmKey) break;
      try {
        const url = `https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(ev.tm_id)}.json?apikey=${tmKey}&locale=*`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        let res;
        try {
          res = await fetch(url, { signal: ctrl.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) continue;
        const d = await res.json();
        const startUtc = d?.dates?.start?.dateTime || null;
        const venue = d?._embedded?.venues?.[0];
        const tz = venue?.timezone || null;
        if (startUtc) {
          const update = { event_start_utc: startUtc } as Record<string, unknown>;
          if (tz) update.venue_timezone = tz;
          await svc.entities.Event.update(ev.id, update).catch(() => {});
          ev.event_start_utc = startUtc;
          if (tz) ev.venue_timezone = tz;
          results.enriched++;
        }
      } catch (_) {
        // skip this event on any fetch error
      }
    }

    // ── 2. Load confidence signals (batched once, grouped in memory) ────────
    const [reports, intel] = await Promise.all([
      svc.entities.TransferReport.list('-created_date', 500).catch(() => []),
      svc.entities.TransferIntelligence.list('-created_date', 500).catch(() => []),
    ]);
    const reportsByEvent = {};
    for (const r of reports) {
      if (!r.event_id) continue;
      (reportsByEvent[r.event_id] ||= []).push(r);
    }
    const venueStats = {};
    for (const i of intel) {
      if (!i.venue) continue;
      const v = venueStats[i.venue] ||= { success: 0, fail: 0, total: 0 };
      v.total++;
      if (i.transfer_successful) v.success++; else v.fail++;
    }
    const ctx = { reportsByEvent, venueStats };

    // ── 3. Score every event + collect transition actions ──────────────────
    const pendingUpdates = [];
    const hideTasks = [];
    const warnTasks = [];
    let hidePushed = 0;
    for (const ev of events) {
      const startMs = ev.event_start_utc ? new Date(ev.event_start_utc).getTime()
        : ev.date ? new Date(ev.date).getTime() : null;
      const c = computeConfidence(ev, startMs, ctx, nowMs);

      const prevStatus = ev.transfer_window_status;
      const tierChanged = !c.override && prevStatus !== c.status;

      const update = {
        id: ev.id,
        transfer_confidence_score: c.score,
        transfer_confidence_reason: c.reason,
        transfer_confidence_last_updated: now.toISOString(),
      } as Record<string, unknown>;
      if (tierChanged) {
        update.transfer_window_status = c.status;
        update.upgrade_eligibility_status = c.eligibility;
        update.transfer_window_confidence = c.score;
        update.last_transfer_check_at = now.toISOString();
        update.transfer_window_source = ev.transfer_window_source || 'inferred';
      }

      // Throttle writes to meaningful changes (bound DB load across 500+ events)
      const prevScore = ev.transfer_confidence_score ?? null;
      const scoreDelta = prevScore === null ? 999 : Math.abs(prevScore - c.score);
      const lastUpd = ev.transfer_confidence_last_updated ? new Date(ev.transfer_confidence_last_updated).getTime() : 0;
      const stale = (nowMs - lastUpd) > STALE_AFTER_MS;
      if (tierChanged || scoreDelta >= SCORE_WRITE_DELTA || prevScore === null || stale) {
        pendingUpdates.push(update);
        results.scored++;
      }

      if (tierChanged) {
        if (c.status === 'closed' && hidePushed < CLOSED_ACTION_CAP) {
          hideTasks.push({ ev });
          hidePushed++;
        } else if (c.status === 'closing_soon') {
          warnTasks.push({ ev });
        }
      }
    }

    // ── 4. Persist confidence (bulk, chunked at 500) ────────────────────────
    for (let i = 0; i < pendingUpdates.length; i += 500) {
      await svc.entities.Event.bulkUpdate(pendingUpdates.slice(i, i + 500)).catch(() => {});
    }

    // ── 5. Hard-close actions (hide listings + notify + alert) ─────────────
    for (const { ev } of hideTasks) {
      results.closed++;
      try {
        const activeListings = await svc.entities.Listing.filter({ event_id: ev.id, status: 'active' }, '-created_date', 500);
        if (activeListings.length > 0) {
          await svc.entities.Listing.updateMany(
            { event_id: ev.id, status: 'active' },
            { $set: { status: 'hidden', hidden_reason: 'transfer_disabled', transfer_status: 'transfer_disabled' } },
          );
          results.listings_hidden += activeListings.length;
          const sellers = new Set(activeListings.map(l => l.seller_email).filter(Boolean));
          for (const email of sellers) {
            svc.integrations.Core.SendEmail({
              to: email,
              subject: '🚫 Your listing was hidden — ticket transfer window closed',
              body: `Your listing(s) for "${ev.title || 'this event'}" have been automatically hidden because the ticket transfer window has closed (confidence ${ev.transfer_confidence_score ?? '—'}/100).\n\nBuyers can no longer purchase these seats as upgrades.\n\nIf you believe this is an error (e.g. transfers are still available), contact Peanut Gallery support.\n\n— Peanut Gallery`,
            }).catch(() => {});
            svc.entities.Notification.create({
              user_email: email,
              type: 'listing_hidden',
              title: 'Listing hidden — transfer window closed',
              body: `Your listing(s) for "${ev.title || 'this event'}" were hidden because the ticket transfer window has closed.`,
              reference_id: ev.id,
              reference_type: 'event',
              icon: '🚫',
            }).catch(() => {});
          }
        }
      } catch (_) {
        // listing takedown best-effort
      }
      await createAlertIfNew(svc, {
        alert_type: 'transfer_disabled_active_listing',
        priority: 'high',
        title: `Transfer window closed — listings auto-hidden`,
        description: `Event "${ev.title || ev.id}" transfer confidence reached the closed threshold. Active listings hidden so buyers can't purchase unavailable upgrades.`,
        reference_id: ev.id,
        reference_type: 'event',
        event_id: ev.id,
      });
      results.alerts++;
    }

    // ── 6. Soft-warn actions (in-app seller notice, no hide) ───────────────
    for (const { ev } of warnTasks) {
      results.warned++;
      try {
        const activeListings = await svc.entities.Listing.filter({ event_id: ev.id, status: 'active' }, '-created_date', 200);
        const sellers = new Set(activeListings.map(l => l.seller_email).filter(Boolean));
        for (const email of sellers) {
          svc.entities.Notification.create({
            user_email: email,
            type: 'admin_message',
            title: 'Transfers may close soon',
            body: `Ticket transfers for "${ev.title || 'your event'}" may close soon. Please complete any pending transfers promptly.`,
            reference_id: ev.id,
            reference_type: 'event',
            icon: '⚠️',
          }).catch(() => {});
        }
      } catch (_) {
        // best-effort
      }
    }

    return Response.json({
      ...results,
      processed_at: now.toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// Helper: only create an alert if no unresolved alert of the same type+reference exists
async function createAlertIfNew(svc, alertData) {
  try {
    if (alertData.reference_id) {
      const existing = await svc.entities.AdminAlert.filter({
        reference_id: alertData.reference_id,
        alert_type: alertData.alert_type,
        resolved: false,
      });
      if (existing.length > 0) return;
    }
    await svc.entities.AdminAlert.create(alertData);
  } catch (_) {
    // best-effort
  }
}