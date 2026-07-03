/**
 * scanTransferWindows  — "Transfer Window Agent" (background scanner)
 * --------------------------------------------------------------------
 * Scheduled function (runs every 30 min) that continuously monitors events
 * for ticket-transfer-window closure and automatically takes down listings
 * once the window has closed.
 *
 * What it does:
 *   1. Enriches upcoming Ticketmaster-sourced events that are missing a
 *      canonical UTC start time by fetching event details from the TM
 *      Discovery API (capped per run to respect rate limits).
 *   2. For each upcoming/live event, decides whether the transfer window
 *      should be considered CLOSED:
 *        - Admin override (manually_verified_open / manually_verified_closed)
 *          is always respected and never auto-changed.
 *        - If an explicit transfer_window_closes_at has passed → closed.
 *        - If the event started more than TRANSFER_CLOSES_AFTER_START_MIN
 *          minutes ago → closed (transfers are virtually always shut by then).
 *   3. On a newly-closed window:
 *        - Marks the Event transfer_window_status = 'closed',
 *          upgrade_eligibility_status = 'not_eligible'.
 *        - Hides all active listings on that event (status = 'hidden',
 *          hidden_reason = 'transfer_disabled', transfer_status =
 *          'transfer_disabled') so buyers can no longer purchase unusable
 *          upgrades.
 *        - Notifies each affected seller (email + in-app Notification).
 *        - Creates a single AdminAlert per event.
 *
 * NOTE: Ticketmaster's public Discovery API does not expose a per-event
 * transfer-window end time, so closure is inferred from the event start time
 * plus any explicit closes_at set by admins/community reports. This is the
 * same inference the app already surfaces to users; here we persist it and
 * act on it.
 *
 * Runs as service role. Scheduled invocations (no interactive session) are
 * allowed; interactive non-admin calls are blocked.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const TRANSFER_CLOSES_AFTER_START_MIN = 90; // transfers virtually always closed 90 min after start
const TM_ENRICH_CAP = 5;                   // max TM detail fetches per run (rate-limit safety)
const FETCH_TIMEOUT_MS = 8000;              // per TM fetch timeout
const CLOSED_ACTION_CAP = 30;               // max newly-closed events acted on per run

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
    const results = { scanned: 0, enriched: 0, closed: 0, listings_hidden: 0, alerts: 0 };

    // Load upcoming + live events (skip ended). Two filter calls keep it simple.
    const [upcoming, live] = await Promise.all([
      svc.entities.Event.filter({ status: 'upcoming' }, 'event_start_utc', 500),
      svc.entities.Event.filter({ status: 'live' }, 'event_start_utc', 500),
    ]);
    const events = [...upcoming, ...live];
    results.scanned = events.length;

    // ── 1. Enrich events missing a canonical UTC start time from TM ─────────
    // Only enrich events truly missing timing — TM events synced via the
    // browse flow already carry `date`, which is a sufficient start-time
    // fallback for the close inference. Fetching TM detail is slow, so we
    // only do it when we have no start time at all.
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
          ev.event_start_utc = startUtc; // keep in-memory copy current for step 2
          if (tz) ev.venue_timezone = tz;
          results.enriched++;
        }
      } catch (_) {
        // skip this event on any fetch error
      }
    }

    // ── 2. Detect closed transfer windows + act ───────────────────────────
    for (const ev of events) {
      const startMs = ev.event_start_utc ? new Date(ev.event_start_utc).getTime()
        : ev.date ? new Date(ev.date).getTime() : null;
      if (!startMs) continue; // can't evaluate without a start time

      // Respect admin overrides — never auto-change these.
      const override = ev.transfer_window_status === 'manually_verified_open'
        || ev.transfer_window_status === 'manually_verified_closed';
      if (override) continue;

      const closesAtMs = ev.transfer_window_closes_at
        ? new Date(ev.transfer_window_closes_at).getTime() : null;

      const closedByExplicitWindow = closesAtMs !== null && nowMs >= closesAtMs;
      const closedByElapsed = nowMs >= startMs + TRANSFER_CLOSES_AFTER_START_MIN * 60 * 1000;

      if (!closedByExplicitWindow && !closedByElapsed) continue;
      if (ev.transfer_window_status === 'closed') continue; // already closed
      if (results.closed >= CLOSED_ACTION_CAP) continue; // bound work per run

      // Mark event closed
      await svc.entities.Event.update(ev.id, {
        transfer_window_status: 'closed',
        upgrade_eligibility_status: 'not_eligible',
        last_transfer_check_at: now.toISOString(),
        transfer_window_source: ev.transfer_window_source || 'inferred',
        transfer_window_confidence: closesAtMs ? 80 : 70,
      }).catch(() => {});
      results.closed++;

      // Hide active listings on this event (bulk update for efficiency)
      try {
        const activeListings = await svc.entities.Listing.filter({ event_id: ev.id, status: 'active' }, '-created_date', 500);
        if (activeListings.length > 0) {
          await svc.entities.Listing.updateMany(
            { event_id: ev.id, status: 'active' },
            { $set: { status: 'hidden', hidden_reason: 'transfer_disabled', transfer_status: 'transfer_disabled' } },
          );
          results.listings_hidden += activeListings.length;

          // Notify each affected seller (email + in-app notification), fire-and-forget
          const sellers = new Set(activeListings.map(l => l.seller_email).filter(Boolean));
          for (const email of sellers) {
            svc.integrations.Core.SendEmail({
              to: email,
              subject: '🚫 Your listing was hidden — ticket transfer window closed',
              body: `Your listing(s) for "${ev.title || 'this event'}" have been automatically hidden because the official ticket transfer window has closed.\n\nBuyers can no longer purchase these seats as upgrades.\n\nIf you believe this is an error (e.g. transfers are still available), contact Peanut Gallery support.\n\n— Peanut Gallery`,
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

      // One admin alert per newly-closed event
      await createAlertIfNew(svc, {
        alert_type: 'transfer_disabled_active_listing',
        priority: 'high',
        title: `Transfer window closed — listings auto-hidden`,
        description: `Event "${ev.title || ev.id}" transfer window closed. Active listings hidden so buyers can't purchase unavailable upgrades.`,
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