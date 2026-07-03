/**
 * scanTransferWindows — "Transfer Window Agent" (Transfer Confidence Engine)
 * --------------------------------------------------------------------
 * Scheduled function (runs every 30 min) that continuously scores each event
 * with DIRECTIONAL confidence:
 *   transfer_open_confidence_score   — confidence 0-100 transfers are OPEN
 *   transfer_closed_confidence_score — confidence 0-100 transfers are CLOSED
 *   transfer_confidence_recommendation — open | closing_soon | closed | unknown | admin_review
 *
 * A high score always explains what we are confident about. The two scores are
 * independent evidence measures (both can be low = unknown, both high = conflict
 * → admin_review).
 *
 * Confidence signals (combined, strongest first):
 *   1. Manual admin verification (manually_verified_open/closed) — overrides
 *      everything; pins open=100/closed=0 or open=0/closed=100.
 *   2. Official partner data (Ticketmaster / AXS / SeatGeek / MLB / venue
 *      integrations) + an explicit transfer_window_closes_at.
 *   3. Community reports (TransferReport) — recency-weighted.
 *   4. Historical marketplace data (TransferIntelligence) — venue-level
 *      transfer success rate, learned automatically from completed outcomes.
 *   5. Time-based inference — weakest; fills gaps (distance from event start).
 *
 * Decision logic:
 *   closed >= 90                       → closed       (hide, disable upgrades, Closed badge)
 *   closed 70-89                       → closing_soon (no hide; warn sellers/buyers; flag admin review)
 *   open >= 80 AND closed < 70         → open         (active; Available badge)
 *   open < 40 AND closed < 40          → unknown      (no hide; keep monitoring)
 *   otherwise (conflicting/ambiguous) → admin_review (no hide; flag admin review)
 *
 * Writes are throttled to meaningful changes to bound DB load. Listing takedowns
 * and notifications fire only on a recommendation transition.
 *
 * Runs as service role. Scheduled invocations (no interactive session) are
 * allowed; interactive non-admin calls are blocked.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const TM_ENRICH_CAP = 5;
const FETCH_TIMEOUT_MS = 8000;
const CLOSED_ACTION_CAP = 30;
const TRUSTED_SOURCES = new Set(['manual_admin', 'ticketmaster', 'seatgeek', 'axs', 'mlb']);
const SCORE_WRITE_DELTA = 5;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * Compute directional confidence scores + recommendation.
 * Returns { open, closed, recommendation, reason, status, eligibility, action, override }.
 */
function computeConfidence(ev, startMs, ctx, nowMs) {
  // 1. Manual admin override — authoritative, beats everything.
  if (ev.transfer_window_status === 'manually_verified_closed') {
    return { open: 0, closed: 100, recommendation: 'closed', reason: 'Admin verified closed (manual override)', status: 'manually_verified_closed', eligibility: 'not_eligible', action: 'none', override: true };
  }
  if (ev.transfer_window_status === 'manually_verified_open') {
    return { open: 100, closed: 0, recommendation: 'open', reason: 'Admin verified open (manual override)', status: 'manually_verified_open', eligibility: 'eligible', action: 'none', override: true };
  }

  const reasons = [];
  const source = ev.transfer_window_source;
  const isTrusted = !!source && TRUSTED_SOURCES.has(source);
  const closesAtMs = ev.transfer_window_closes_at ? new Date(ev.transfer_window_closes_at).getTime() : null;

  // 5. Time-based inference (weakest — fills gaps). open + closed <= ~100.
  let closed, open;
  if (startMs === null) {
    closed = 30; open = 30; reasons.push('No start time (neutral)');
  } else {
    const minSince = (nowMs - startMs) / 60000;
    const minBefore = -minSince;
    if (minSince >= 90) { closed = 90; open = 8; reasons.push('95+ min after start'); }
    else if (minSince >= 30) { closed = 72; open = 15; reasons.push(`${Math.round(minSince)} min after start`); }
    else if (minSince >= 0) { closed = 45; open = 35; reasons.push('event in progress (<30 min)'); }
    else if (minBefore >= 1440) { closed = 6; open = 85; reasons.push(`${Math.round(minBefore / 60)} h before start`); }
    else if (minBefore >= 120) { closed = 18; open = 60; reasons.push(`${Math.round(minBefore)} min before start`); }
    else { closed = 30; open = 45; reasons.push(`${Math.round(minBefore)} min before start`); }
  }

  // 2. Explicit transfer_window_closes_at (stronger than time alone)
  if (closesAtMs !== null) {
    if (nowMs >= closesAtMs) {
      const eventStarted = startMs !== null && nowMs >= startMs;
      if (eventStarted) { closed = Math.max(closed, 92); open = Math.min(open, 6); reasons.push('close time passed, event started'); }
      else if (isTrusted) { closed = Math.max(closed, 92); open = Math.min(open, 6); reasons.push(`official close time passed (${source})`); }
      else { closed = Math.max(closed, 72); open = Math.min(open, 20); reasons.push('inferred close time passed (unverified, pre-start)'); }
    } else {
      const minToClose = (closesAtMs - nowMs) / 60000;
      if (minToClose < 30) { closed = Math.max(closed, 68); open = Math.min(open, 30); reasons.push(`window closes in ~${Math.round(minToClose)} min`); }
      else { open = Math.max(open, 78); closed = Math.min(closed, 18); reasons.push(`window open, closes in ~${Math.round(minToClose)} min`); }
    }
  }

  // 3. Community reports (TransferReport) — recency weighted over 24h.
  // unavailable pushes closed up; available pushes open up. Conflicting reports
  // can raise BOTH → admin_review.
  const evReports = ctx.reportsByEvent[ev.id] || [];
  if (evReports.length) {
    let netClosed = 0, netOpen = 0, unavail = 0, avail = 0;
    for (const r of evReports) {
      const ageH = (nowMs - new Date(r.created_date).getTime()) / 3600000;
      if (ageH > 24) continue;
      const w = Math.max(0.2, 1 - ageH / 24);
      if (r.report_type === 'transfer_unavailable') { netClosed += w * 15; unavail++; }
      else if (r.report_type === 'transfer_available') { netOpen += w * 15; avail++; }
    }
    closed = clamp(closed + netClosed, 0, 100);
    open = clamp(open + netOpen, 0, 100);
    reasons.push(`Community: ${unavail} unavailable / ${avail} available`);
  }

  // 4. Historical marketplace data (TransferIntelligence) — venue success rate.
  // High historical success → more confident OPEN (and less closed).
  const vs = ev.venue ? ctx.venueStats[ev.venue] : null;
  if (vs && vs.total >= 3) {
    const successPct = (vs.success / vs.total) * 100;
    const adj = Math.round((successPct - 50) * 0.4); // -20..+20
    open = clamp(open + adj, 0, 100);
    closed = clamp(closed - adj, 0, 100);
    reasons.push(`History: ${Math.round(successPct)}% success at ${ev.venue} (${vs.total} transfers)`);
  }

  // Official partner with no explicit close → presume open before start
  if (isTrusted && closesAtMs === null && startMs !== null && nowMs < startMs) {
    open = Math.max(open, 70);
    closed = Math.min(closed, 20);
    reasons.push(`official source (${source}) — window presumed open`);
  }

  closed = clamp(Math.round(closed), 0, 100);
  open = clamp(Math.round(open), 0, 100);

  // Recommendation — directional decision logic
  let recommendation, status, eligibility, action;
  if (closed >= 90) { recommendation = 'closed'; status = 'closed'; eligibility = 'not_eligible'; action = 'hide'; }
  else if (closed >= 70 && open >= 70) { recommendation = 'admin_review'; status = 'unknown'; eligibility = 'limited'; action = 'review'; }
  else if (closed >= 70) { recommendation = 'closing_soon'; status = 'closing_soon'; eligibility = 'limited'; action = 'warn'; }
  else if (open >= 80) { recommendation = 'open'; status = 'open'; eligibility = 'eligible'; action = 'none'; }
  else if (open < 40 && closed < 40) { recommendation = 'unknown'; status = 'unknown'; eligibility = 'unknown'; action = 'none'; }
  else { recommendation = 'admin_review'; status = 'unknown'; eligibility = 'limited'; action = 'review'; }

  return { open, closed, recommendation, reason: reasons.join(' · '), status, eligibility, action, override: false };
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
    const results = { scanned: 0, enriched: 0, scored: 0, closed: 0, closing_soon: 0, admin_review: 0, listings_hidden: 0, alerts: 0 };

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
    const reviewTasks = [];
    let hidePushed = 0;
    for (const ev of events) {
      const startMs = ev.event_start_utc ? new Date(ev.event_start_utc).getTime()
        : ev.date ? new Date(ev.date).getTime() : null;
      const c = computeConfidence(ev, startMs, ctx, nowMs);

      const prevRec = ev.transfer_confidence_recommendation ?? null;
      const tierChanged = !c.override && prevRec !== c.recommendation;

      const update = {
        id: ev.id,
        transfer_open_confidence_score: c.open,
        transfer_closed_confidence_score: c.closed,
        transfer_confidence_recommendation: c.recommendation,
        transfer_confidence_reason: c.reason,
        transfer_confidence_last_updated: now.toISOString(),
      } as Record<string, unknown>;
      if (tierChanged) {
        update.transfer_window_status = c.status;
        update.upgrade_eligibility_status = c.eligibility;
        update.transfer_window_confidence = Math.max(c.open, c.closed);
        update.last_transfer_check_at = now.toISOString();
        update.transfer_window_source = ev.transfer_window_source || 'inferred';
      }

      // Throttle writes to meaningful changes (bound DB load across 500+ events)
      const prevOpen = ev.transfer_open_confidence_score ?? null;
      const prevClosed = ev.transfer_closed_confidence_score ?? null;
      const openDelta = prevOpen === null ? 999 : Math.abs(prevOpen - c.open);
      const closedDelta = prevClosed === null ? 999 : Math.abs(prevClosed - c.closed);
      const lastUpd = ev.transfer_confidence_last_updated ? new Date(ev.transfer_confidence_last_updated).getTime() : 0;
      const stale = (nowMs - lastUpd) > STALE_AFTER_MS;
      if (tierChanged || openDelta >= SCORE_WRITE_DELTA || closedDelta >= SCORE_WRITE_DELTA || prevOpen === null || prevClosed === null || stale) {
        pendingUpdates.push(update);
        results.scored++;
      }

      if (tierChanged) {
        if (c.recommendation === 'closed' && hidePushed < CLOSED_ACTION_CAP) {
          hideTasks.push({ ev });
          hidePushed++;
        } else if (c.recommendation === 'closing_soon') {
          warnTasks.push({ ev });
        } else if (c.recommendation === 'admin_review') {
          reviewTasks.push({ ev });
        }
      }
    }

    // ── 4. Persist confidence (bulk, chunked at 500) ────────────────────────
    for (let i = 0; i < pendingUpdates.length; i += 500) {
      await svc.entities.Event.bulkUpdate(pendingUpdates.slice(i, i + 500)).catch(() => {});
    }

    // ── 5. Closed actions (hide listings + notify + alert) ─────────────────
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
              body: `Your listing(s) for "${ev.title || 'this event'}" have been automatically hidden because the ticket transfer window has closed (closed-confidence ${ev.transfer_closed_confidence_score ?? '—'}/100).\n\nBuyers can no longer purchase these seats as upgrades.\n\nIf you believe this is an error (e.g. transfers are still available), contact Peanut Gallery support.\n\n— Peanut Gallery`,
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
        description: `Event "${ev.title || ev.id}" closed-confidence reached the closed threshold. Active listings hidden so buyers can't purchase unavailable upgrades.`,
        reference_id: ev.id,
        reference_type: 'event',
        event_id: ev.id,
      });
      results.alerts++;
    }

    // ── 6. Closing-soon actions (in-app seller/buyer notice + flag admin) ──
    for (const { ev } of warnTasks) {
      results.closing_soon++;
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
      await createAlertIfNew(svc, {
        alert_type: 'admin_action_required',
        priority: 'low',
        title: `Transfers may close soon — review window`,
        description: `Event "${ev.title || ev.id}" closed-confidence is 70-89. Listings left active; sellers warned. Monitor and verify manually if needed.`,
        reference_id: ev.id,
        reference_type: 'event',
        event_id: ev.id,
      });
      results.alerts++;
    }

    // ── 7. Admin-review actions (conflicting/ambiguous — flag for review) ─
    for (const { ev } of reviewTasks) {
      results.admin_review++;
      await createAlertIfNew(svc, {
        alert_type: 'admin_action_required',
        priority: 'medium',
        title: `Conflicting transfer signals — manual review needed`,
        description: `Event "${ev.title || ev.id}" has ambiguous/conflicting transfer signals (open ${ev.transfer_open_confidence_score ?? '—'} / closed ${ev.transfer_closed_confidence_score ?? '—'}). Listings left active. Verify the window status manually and apply an override if needed.`,
        reference_id: ev.id,
        reference_type: 'event',
        event_id: ev.id,
      });
      results.alerts++;
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