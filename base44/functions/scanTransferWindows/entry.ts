/**
 * scanTransferWindows — "Transfer Intelligence Engine"
 * --------------------------------------------------------------------
 * Scheduled function (every 30 min). Continuously scores each event with
 * DIRECTIONAL, EXPLAINABLE, STABLE, FRESHNESS-AWARE confidence:
 *
 *   transfer_open_confidence_score     — confidence 0-100 transfers are OPEN
 *   transfer_closed_confidence_score   — confidence 0-100 transfers are CLOSED
 *   transfer_confidence_recommendation — open | likely_open | closing_soon | closed | unknown | admin_review
 *   transfer_confidence_evidence       — per-source signed contributions (Explainable AI)
 *   transfer_confidence_momentum       — movement applied this scan (stability)
 *
 * Architecture: a set of pluggable EVIDENCE CONTRIBUTORS, each producing a
 * signed contribution toward open/closed. Adding a future source (AXS API,
 * verified-seller program, ML predictions…) is just another contributor +
 * evidence key — the scoring architecture does not change.
 *
 * Contributor weights (highest → lowest):
 *   official_partner       1.0   (authoritative — bypasses momentum)
 *   manual_verification    1.0   (authoritative — pins scores)
 *   historical_success     0.8
 *   historical_failures    0.8
 *   venue_patterns         0.5
 *   platform_patterns      0.5
 *   community_reports_*   0.5   (freshness-decayed + stability-damped)
 *   seller_history         0.5   (pluggable, data source TBD)
 *   buyer_history          0.5   (pluggable, data source TBD)
 *   time_inference         0.3/0.6 (gap-filler; weakest; damped when stronger evidence exists)
 *
 * Stability features:
 *   - Momentum: non-authoritative scores move ≤15 pts/scan toward the new prediction.
 *   - Freshness: community reports decay (1h→100%, 6h→85%, 24h→60%, 48h→20%, 72h→0);
 *     historical data decays by season (≤90d→100%, ≤1y→90%, ≤2y→70%, older→40%).
 *   - Stability: community impact is damped by venue evidence volume
 *     (1 report among 5000 transfers barely moves the score).
 *   - Recommendation: conflicting evidence → admin_review (never aggressive auto-action).
 *
 * Runs as service role. Scheduled invocations (no interactive session) are
 * allowed; interactive non-admin calls are blocked.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const TM_ENRICH_CAP = 5;
const FETCH_TIMEOUT_MS = 8000;
const CLOSED_ACTION_CAP = 30;
const WARN_ACTION_CAP = 30;
const REVIEW_ACTION_CAP = 30;
const PRED_CREATE_CAP = 150;
const TRUSTED_SOURCES = new Set(['manual_admin', 'ticketmaster', 'seatgeek', 'axs', 'mlb']);
const SCORE_WRITE_DELTA = 4;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const MOMENTUM_LIMIT = 15;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function round1(n) { return Math.round(n); }

// Evidence freshness decay ────────────────────────────────────────────────
// Community reports: 0-1h 100%, 6h 85%, 24h 60%, 48h 20%, 72h+ ignored.
function communityDecay(ageH) {
  if (ageH <= 1) return 1.0;
  if (ageH <= 6) return 1.0 - 0.15 * (ageH - 1) / 5;
  if (ageH <= 24) return 0.85 - 0.25 * (ageH - 6) / 18;
  if (ageH <= 48) return 0.60 - 0.40 * (ageH - 24) / 24;
  if (ageH <= 72) return 0.20 - 0.20 * (ageH - 48) / 24;
  return 0;
}
// Historical data: newest season 100%, prev 90%, 2 seasons 70%, >3 seasons 40%.
function historyDecay(ageDays) {
  if (ageDays <= 90) return 1.0;
  if (ageDays <= 365) return 0.9;
  if (ageDays <= 730) return 0.7;
  return 0.4;
}

/**
 * Compute directional, explainable confidence.
 * Returns { open, closed, rawOpen, rawClosed, recommendation, status, eligibility,
 *           action, override, evidence, momentum, reason }.
 *
 * `evidence` is a flat map of source → signed contribution to OPEN confidence
 * (positive supports open, negative supports closed).
 */
function computeConfidence(ev, ctx, nowMs) {
  const evidence = {
    official_partner: 0, manual_verification: 0,
    historical_success: 0, historical_failures: 0,
    community_reports_positive: 0, community_reports_negative: 0,
    time_inference: 0, venue_patterns: 0, platform_patterns: 0,
    seller_history: 0, buyer_history: 0,
  };
  const reasons = [];

  // ── 1. Manual admin verification (authoritative, pins scores) ──────────
  if (ev.transfer_window_status === 'manually_verified_closed') {
    evidence.manual_verification = -100;
    return { open: 0, closed: 100, rawOpen: 0, rawClosed: 100, recommendation: 'closed',
      reason: 'Admin verified closed (manual override)', status: 'manually_verified_closed',
      eligibility: 'not_eligible', action: 'none', override: true, evidence,
      momentum: { open: null, closed: null, bypassed: true } };
  }
  if (ev.transfer_window_status === 'manually_verified_open') {
    evidence.manual_verification = 100;
    return { open: 100, closed: 0, rawOpen: 100, rawClosed: 0, recommendation: 'open',
      reason: 'Admin verified open (manual override)', status: 'manually_verified_open',
      eligibility: 'eligible', action: 'none', override: true, evidence,
      momentum: { open: null, closed: null, bypassed: true } };
  }

  let open = 30;       // neutral base
  let closed = 30;
  const wm = ctx.weights || {};
  const wmult = (k) => (wm[k] == null ? 1 : wm[k]);
  let authoritative = false;
  let strongEvidence = false;   // official or historical data present
  let communityPos = 0, communityNeg = 0;

  const source = ev.transfer_window_source;
  const isTrusted = !!source && TRUSTED_SOURCES.has(source);
  const closesAtMs = ev.transfer_window_closes_at ? new Date(ev.transfer_window_closes_at).getTime() : null;
  const startMs = ev.event_start_utc ? new Date(ev.event_start_utc).getTime()
    : ev.date ? new Date(ev.date).getTime() : null;
  const eventStarted = startMs !== null && nowMs >= startMs;

  // ── 2. Official partner data (weight 1.0, authoritative) ────────────────
  if (closesAtMs !== null) {
    if (nowMs >= closesAtMs) {
      if (eventStarted || isTrusted) {
        open -= 56; closed += 62;
        evidence.official_partner = -56;
        authoritative = true; strongEvidence = true;
        reasons.push(eventStarted ? 'official close passed (event started)' : `official close passed (${source})`);
      } else {
        open -= 30; closed += 42;
        evidence.official_partner = -30;
        reasons.push('inferred close passed (unverified, pre-start)');
      }
    } else {
      const minToClose = (closesAtMs - nowMs) / 60000;
      if (minToClose < 30) {
        open -= 10; closed += 38;
        evidence.official_partner = -10;
        authoritative = isTrusted;
        if (isTrusted) strongEvidence = true;
        reasons.push(`official window closes in ~${Math.round(minToClose)} min`);
      } else {
        open += 48; closed -= 18;
        evidence.official_partner = 48;
        authoritative = isTrusted;
        if (isTrusted) strongEvidence = true;
        reasons.push(`official window open, closes in ~${Math.round(minToClose)} min`);
      }
    }
  } else if (isTrusted && startMs !== null && !eventStarted) {
    // Official source, no explicit close time, pre-start → presume open.
    open += 40; closed -= 10;
    evidence.official_partner = 40;
    authoritative = true; strongEvidence = true;
    reasons.push(`official source (${source}) — presumed open`);
  }

  // ── 3. Historical marketplace data (venue) — weight 0.8, season-decayed ──
  const vs = ev.venue ? ctx.venueStats[ev.venue] : null;
  if (vs && vs.decTotal >= 3) {
    const successRate = vs.decTotal > 0 ? vs.decSuccess / vs.decTotal : 0.5;
    const successLift = Math.max(0, (successRate - 0.5) * 50) * 0.8 * wmult('historical');
    const failureDrag = Math.min(0, (successRate - 0.5) * 50) * 0.8 * wmult('historical'); // negative when successRate<0.5
    open += successLift + failureDrag;
    closed -= (successLift + failureDrag) * 0.6;
    evidence.historical_success = round1(successLift);
    evidence.historical_failures = round1(failureDrag);
    strongEvidence = true;
    reasons.push(`History ${Math.round(successRate * 100)}% success at ${ev.venue} (${vs.total} transfers)`);
  }

  // ── 4. Venue pattern learning (weight 0.5) — venue tendency, established venues only
  if (vs && vs.decTotal >= 10) {
    const successRate = vs.decTotal > 0 ? vs.decSuccess / vs.decTotal : 0.5;
    const dir = (successRate - 0.5) * 20 * 0.5 * wmult('venue_patterns');
    open += dir; closed -= dir * 0.6;
    evidence.venue_patterns = round1(dir);
  }

  // ── 5. Platform pattern learning (weight 0.5) ───────────────────────────
  const platformKey = ev.transfer_platform || null; // Event has no platform field; contributors may set later
  const ps = platformKey ? ctx.platformStats[platformKey] : null;
  if (ps && ps.decTotal >= 5) {
    const successRate = ps.decTotal > 0 ? ps.decSuccess / ps.decTotal : 0.5;
    const dir = (successRate - 0.5) * 20 * 0.5 * wmult('platform_patterns');
    open += dir; closed -= dir * 0.6;
    evidence.platform_patterns = round1(dir);
  }

  // ── 6. Community reports (weight 0.5, freshness-decayed, stability-damped)
  const evReports = ctx.reportsByEvent[ev.id] || [];
  if (evReports.length) {
    let posW = 0, negW = 0, posCount = 0, negCount = 0;
    for (const r of evReports) {
      const ageH = (nowMs - new Date(r.created_date).getTime()) / 3600000;
      const d = communityDecay(ageH);
      if (d === 0) continue;
      if (r.report_type === 'transfer_unavailable') { negW += d; negCount++; }
      else if (r.report_type === 'transfer_available') { posW += d; posCount++; }
    }
    communityPos = posCount; communityNeg = negCount;
    // Stability: damp community by venue evidence volume.
    const venueVol = vs ? vs.decTotal : 0;
    const stability = 1 / (1 + venueVol / 200);
    const w = 0.5 * stability * wmult('community');
    const posOpen = posW * 15 * w;
    const negClosed = negW * 15 * w;
    open += posOpen - negW * 5 * w;
    closed += negClosed - posW * 5 * w;
    evidence.community_reports_positive = round1(posOpen);
    evidence.community_reports_negative = round1(-negClosed);
    if (posCount + negCount > 0) {
      reasons.push(`Community ${posCount} available / ${negCount} unavailable`);
    }
  }

  // ── 7. Seller history & buyer history (pluggable, data source TBD) ─────
  // Registered contributors for future wiring (verified-seller program, buyer reports).
  evidence.seller_history = 0;
  evidence.buyer_history = 0;

  // ── 8. Time inference (gap-filler, lowest weight) ───────────────────────
  if (startMs !== null) {
    const minSince = (nowMs - startMs) / 60000;
    const minBefore = -minSince;
    let openDir, closedDir, weight;
    if (eventStarted) {
      // Post-start time is a meaningful real-world signal.
      weight = 0.6;
      if (minSince >= 90) { openDir = -60; closedDir = 70; }
      else if (minSince >= 30) { openDir = -40; closedDir = 55; }
      else { openDir = -15; closedDir = 25; }
    } else {
      // Pre-start time is a weak gap-filler; damp when stronger evidence exists.
      weight = 0.3 * (strongEvidence ? 0.5 : 1);
      if (minBefore >= 1440) { openDir = 55; closedDir = -40; }
      else if (minBefore >= 120) { openDir = 30; closedDir = -18; }
      else { openDir = 15; closedDir = -5; }
    }
    const tw = weight * wmult('time');
    open += openDir * tw;
    closed += closedDir * tw;
    evidence.time_inference = round1(openDir * tw);
    reasons.push(eventStarted
      ? `Time: ${Math.round(minSince)} min after start`
      : `Time: ${Math.round(minBefore)} min before start`);
  } else {
    reasons.push('No start time');
  }

  // ── Raw scores ─────────────────────────────────────────────────────────
  const rawOpen = clamp(round1(open), 0, 100);
  const rawClosed = clamp(round1(closed), 0, 100);

  // ── Momentum: limit movement unless authoritative ────────────────────────
  const prevOpen = ev.transfer_open_confidence_score ?? null;
  const prevClosed = ev.transfer_closed_confidence_score ?? null;
  let finalOpen, finalClosed;
  if (authoritative || prevOpen === null || prevClosed === null) {
    finalOpen = rawOpen; finalClosed = rawClosed;
  } else {
    finalOpen = clamp(prevOpen + clamp(rawOpen - prevOpen, -MOMENTUM_LIMIT, MOMENTUM_LIMIT), 0, 100);
    finalClosed = clamp(prevClosed + clamp(rawClosed - prevClosed, -MOMENTUM_LIMIT, MOMENTUM_LIMIT), 0, 100);
  }
  const momentum = {
    open: (prevOpen === null) ? null : round1(finalOpen - prevOpen),
    closed: (prevClosed === null) ? null : round1(finalClosed - prevClosed),
    bypassed: authoritative,
  };

  // ── Conflict detection (unstable evidence) ─────────────────────────────
  const conflict = (communityPos >= 2 && communityNeg >= 2);

  // ── Recommendation: confidence + stability ─────────────────────────────
  let recommendation, status, eligibility, action;
  if (finalClosed >= 90) {
    recommendation = 'closed'; status = 'closed'; eligibility = 'not_eligible'; action = 'hide';
  } else if (finalClosed >= 70) {
    recommendation = 'closing_soon'; status = 'closing_soon'; eligibility = 'limited'; action = 'warn';
  } else if (conflict) {
    recommendation = 'admin_review'; status = 'unknown'; eligibility = 'limited'; action = 'review';
  } else if (finalOpen >= 80 && strongEvidence) {
    recommendation = 'open'; status = 'open'; eligibility = 'eligible'; action = 'none';
  } else if (finalOpen >= 60) {
    recommendation = 'likely_open'; status = 'open'; eligibility = 'eligible'; action = 'none';
  } else if (finalOpen < 40 && finalClosed < 40) {
    recommendation = 'unknown'; status = 'unknown'; eligibility = 'unknown'; action = 'none';
  } else {
    recommendation = 'admin_review'; status = 'unknown'; eligibility = 'limited'; action = 'review';
  }

  return {
    open: finalOpen, closed: finalClosed, rawOpen, rawClosed,
    recommendation, status, eligibility, action, override: false,
    evidence, momentum, reason: reasons.join(' · '),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

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

    // ── 2. Load evidence signals (batched once, grouped + decayed) ────────
    const [reports, intel] = await Promise.all([
      svc.entities.TransferReport.list('-created_date', 500).catch(() => []),
      svc.entities.TransferIntelligence.list('-created_date', 500).catch(() => []),
    ]);
    const reportsByEvent = {};
    for (const r of reports) {
      if (!r.event_id) continue;
      (reportsByEvent[r.event_id] ||= []).push(r);
    }
    // Venue + platform stats with season freshness decay.
    const venueStats = {};
    const platformStats = {};
    for (const i of intel) {
      const ts = i.recorded_at || i.created_date;
      const ageDays = ts ? (nowMs - new Date(ts).getTime()) / 86400000 : 9999;
      const d = historyDecay(ageDays);
      if (i.venue) {
        const v = venueStats[i.venue] ||= { success: 0, fail: 0, total: 0, decSuccess: 0, decTotal: 0 };
        v.total++; v.decTotal += d;
        if (i.transfer_successful) { v.success++; v.decSuccess += d; } else v.fail++;
      }
      if (i.platform) {
        const p = platformStats[i.platform] ||= { success: 0, fail: 0, total: 0, decSuccess: 0, decTotal: 0 };
        p.total++; p.decTotal += d;
        if (i.transfer_successful) { p.success++; p.decSuccess += d; } else p.fail++;
      }
    }
    // Load self-calibrated evidence weights (multipliers) from the calibration singleton.
    let weights = { historical: 1, venue_patterns: 1, platform_patterns: 1, community: 1, time: 1 };
    try {
      const calib = (await svc.entities.ConfidenceCalibration.list('-last_calibrated_at', 1))[0];
      if (calib?.source_weights) {
        for (const k of Object.keys(weights)) {
          const m = calib.source_weights[k]?.multiplier;
          if (typeof m === 'number' && m > 0) weights[k] = m;
        }
      }
    } catch (_) { /* calibration not yet initialized */ }
    const ctx = { reportsByEvent, venueStats, platformStats, weights };

    // ── 3. Score every event + collect transition actions ─────────────────
    const pendingUpdates = [];
    const predCreate = [];
    const predUpdate = [];
    const activePredByEvent = {};
    try {
      const activePreds = await svc.entities.TransferConfidencePrediction.filter({ resolved: false }, '-predicted_at', 2000);
      for (const p of activePreds) if (p.event_id) activePredByEvent[p.event_id] = p;
    } catch (_) { /* entity may not exist yet */ }
    const hideTasks = [];
    const warnTasks = [];
    const reviewTasks = [];
    let hidePushed = 0;
    let warnPushed = 0;
    let reviewPushed = 0;
    for (const ev of events) {
      const c = computeConfidence(ev, ctx, nowMs);

      const prevRec = ev.transfer_confidence_recommendation ?? null;
      const tierChanged = !c.override && prevRec !== c.recommendation;

      const update = {
        id: ev.id,
        transfer_open_confidence_score: c.open,
        transfer_closed_confidence_score: c.closed,
        transfer_confidence_recommendation: c.recommendation,
        transfer_confidence_evidence: c.evidence,
        transfer_confidence_momentum: c.momentum,
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
      const willWrite = tierChanged || openDelta >= SCORE_WRITE_DELTA || closedDelta >= SCORE_WRITE_DELTA || prevOpen === null || prevClosed === null || stale;
      if (willWrite) {
        pendingUpdates.push(update);
        results.scored++;
      }
      // Self-calibration: every live-relevant event gets an active prediction (created
      // once on first observation, refreshed only on meaningful score change thereafter).
      // Only events within the active window (next 7 days / started within 24h) can
      // produce outcomes, so stale past events are skipped to bound write volume.
      const evStart = ev.event_start_utc ? new Date(ev.event_start_utc).getTime() : (ev.date ? new Date(ev.date).getTime() : null);
      const liveRelevant = evStart !== null && evStart <= nowMs + 7 * 86400000 && evStart >= nowMs - 24 * 3600000;
      const pf = {
        event_id: ev.id, event_title: ev.title, venue: ev.venue, city: ev.city,
        state: ev.state, category: ev.category, artist: ev.artist,
        recommendation: c.recommendation, open_confidence: c.open,
        closed_confidence: c.closed, evidence: c.evidence, predicted_at: now.toISOString(),
      } as Record<string, unknown>;
      const existingPred = activePredByEvent[ev.id];
      if (existingPred) { if (willWrite) predUpdate.push({ id: existingPred.id, ...pf }); }
      else if (liveRelevant && predCreate.length < PRED_CREATE_CAP) predCreate.push(pf);

      if (tierChanged) {
        if (c.recommendation === 'closed' && hidePushed < CLOSED_ACTION_CAP) {
          hideTasks.push({ ev });
          hidePushed++;
        } else if (c.recommendation === 'closing_soon' && warnPushed < WARN_ACTION_CAP) {
          warnTasks.push({ ev });
          warnPushed++;
        } else if (c.recommendation === 'admin_review' && reviewPushed < REVIEW_ACTION_CAP) {
          reviewTasks.push({ ev });
          reviewPushed++;
        }
      }
    }

    // ── 4. Persist confidence (bulk, chunked at 500) ────────────────────────
    for (let i = 0; i < pendingUpdates.length; i += 500) {
      await svc.entities.Event.bulkUpdate(pendingUpdates.slice(i, i + 500)).catch(() => {});
    }
    // Persist confidence predictions (self-calibration training data).
    for (let i = 0; i < predCreate.length; i += 500) {
      await svc.entities.TransferConfidencePrediction.bulkCreate(predCreate.slice(i, i + 500)).catch(() => {});
    }
    for (let i = 0; i < predUpdate.length; i += 500) {
      await svc.entities.TransferConfidencePrediction.bulkUpdate(predUpdate.slice(i, i + 500)).catch(() => {});
    }
    results.predictions_written = predCreate.length + predUpdate.length;

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
              body: `Your listing(s) for "${ev.title || 'this event'}" have been automatically hidden because the ticket transfer window has closed (closed-confidence ${ev.transfer_closed_confidence_score ?? '—'}/100).\n\nBuyers can no longer purchase these seats as upgrades.\n\nIf you believe this is an error, contact Peanut Gallery support.\n\n— Peanut Gallery`,
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
        description: `Event "${ev.title || ev.id}" closed-confidence is 70-89. Listings left active; sellers warned. Verify manually if needed.`,
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
        description: `Event "${ev.title || ev.id}" has ambiguous/conflicting transfer signals (open ${ev.transfer_open_confidence_score ?? '—'} / closed ${ev.transfer_closed_confidence_score ?? '—'}). Listings left active. Verify and override if needed.`,
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