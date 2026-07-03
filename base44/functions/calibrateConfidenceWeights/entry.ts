/**
 * calibrateConfidenceWeights — self-calibration for the Transfer Intelligence Engine.
 *
 * 1. Resolves pending predictions whose ground truth is now known:
 *    - Admin manual overrides (manually_verified_open/closed) → window_open/window_closed.
 *    (Transfer success/failure outcomes are resolved immediately by recordTransferOutcome.)
 * 2. Computes prediction accuracy across dimensions:
 *    overall, venue, platform, event type (category), artist, seller, recommendation tier.
 * 3. Computes per-evidence-source bias (over-optimistic vs over-pessimistic) and
 *    auto-tunes each adjustable source's weight multiplier:
 *      newMult = clamp(prevMult * (1 - 0.5 * bias), 0.3, 2.0)
 *    A source that consistently points "open" when reality is "closed" (positive bias)
 *    has its weight reduced; one that under-estimates gets increased.
 *    Requires >= 5 samples per source to adjust.
 * 4. Upserts the ConfidenceCalibration singleton (read by scanTransferWindows at each scan).
 *
 * Scheduled hourly. Admin-only when invoked interactively.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ADJUSTABLE = ['historical', 'venue_patterns', 'platform_patterns', 'community', 'time'];
const BASE_WEIGHTS = { official_partner: 1.0, manual_verification: 1.0, historical: 0.8, venue_patterns: 0.5, platform_patterns: 0.5, community: 0.5, time: 0.3 };
const MIN_SAMPLES = 5;
const BIAS_K = 0.5;
const MULT_MIN = 0.3;
const MULT_MAX = 2.0;

// Map a (recommendation, actual outcome) pair to a correctness verdict.
// null = neutral (unknown/admin_review predictions, or non-directional outcomes).
function predVerdict(recommendation, outcome) {
  const openRecs = ['open', 'likely_open'];
  const closedRecs = ['closed', 'closing_soon'];
  if (['unknown', 'admin_review'].includes(recommendation)) return null;
  if (outcome === 'transfer_succeeded' || outcome === 'window_open') return openRecs.includes(recommendation);
  if (outcome === 'transfer_failed' || outcome === 'window_closed') return closedRecs.includes(recommendation);
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try {
      const interactive = await base44.auth.isAuthenticated();
      if (interactive) {
        const u = await base44.auth.me();
        if (u && u.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } catch (_) { /* scheduled run — no session */ }
    const svc = base44.asServiceRole;
    const nowIso = new Date().toISOString();

    // ── 1. Resolve admin-override predictions ────────────────────────────
    const [openEv, closedEv] = await Promise.all([
      svc.entities.Event.filter({ transfer_window_status: 'manually_verified_open' }, 'event_start_utc', 200).catch(() => []),
      svc.entities.Event.filter({ transfer_window_status: 'manually_verified_closed' }, 'event_start_utc', 200).catch(() => []),
    ]);
    let resolvedNow = 0;
    for (const ev of [...openEv, ...closedEv]) {
      try {
        const preds = await svc.entities.TransferConfidencePrediction.filter({ event_id: ev.id, resolved: false });
        const pred = preds[0];
        if (pred) {
          const outcome = ev.transfer_window_status === 'manually_verified_open' ? 'window_open' : 'window_closed';
          await svc.entities.TransferConfidencePrediction.update(pred.id, {
            resolved: true,
            resolved_at: nowIso,
            actual_outcome: outcome,
            prediction_correct: predVerdict(pred.recommendation, outcome),
            resolution_source: 'admin_override',
          });
          resolvedNow++;
        }
      } catch (_) { /* best-effort */ }
    }

    // ── 2. Load all resolved predictions ───────────────────────────────────
    const resolved = await svc.entities.TransferConfidencePrediction.filter({ resolved: true }, 'resolved_at', 2000).catch(() => []);

    // ── 3. Accuracy metrics + per-source bias ──────────────────────────────
    let totalCorrect = 0, totalIncorrect = 0;
    const accVenue = {}, accPlatform = {}, accCategory = {}, accArtist = {}, accSeller = {}, accRec = {};
    const sourceStats = {};
    for (const k of ADJUSTABLE) sourceStats[k] = { hits: 0, misses: 0, openOver: 0, closedOver: 0 };

    const bump = (map, k, v) => {
      if (!k || (v !== true && v !== false)) return;
      const e = map[k] ||= { correct: 0, incorrect: 0 };
      if (v === true) e.correct++; else e.incorrect++;
    };

    for (const p of resolved) {
      const v = p.prediction_correct;
      if (v === true) totalCorrect++;
      else if (v === false) totalIncorrect++;
      bump(accVenue, p.venue, v);
      bump(accPlatform, p.platform, v);
      bump(accCategory, p.category, v);
      bump(accArtist, p.artist, v);
      bump(accSeller, p.seller_email, v);
      bump(accRec, p.recommendation, v);

      // Per-source bias: only directional verdicts with a directional outcome.
      if (v === true || v === false) {
        const realityOpen = (p.actual_outcome === 'transfer_succeeded' || p.actual_outcome === 'window_open');
        const realityClosed = (p.actual_outcome === 'transfer_failed' || p.actual_outcome === 'window_closed');
        if (!realityOpen && !realityClosed) continue;
        const ev = p.evidence || {};
        for (const k of ADJUSTABLE) {
          const val = ev[k];
          if (typeof val !== 'number' || Math.abs(val) < 1) continue;
          const s = sourceStats[k];
          const sourceOpen = val > 0;
          const correct = (sourceOpen && realityOpen) || (!sourceOpen && realityClosed);
          if (correct) s.hits++;
          else {
            s.misses++;
            if (sourceOpen && realityClosed) s.openOver++;
            else if (!sourceOpen && realityOpen) s.closedOver++;
          }
        }
      }
    }

    const finalize = (map) => {
      const out = {};
      for (const [k, e] of Object.entries(map)) {
        const tot = e.correct + e.incorrect;
        if (tot === 0) continue;
        out[k] = { correct: e.correct, incorrect: e.incorrect, accuracy: Math.round((e.correct / tot) * 100), samples: tot };
      }
      return out;
    };

    const overall = (totalCorrect + totalIncorrect) > 0 ? Math.round((totalCorrect / (totalCorrect + totalIncorrect)) * 100) : null;

    // ── 4. Auto-tune adjustable source multipliers ────────────────────────
    const existing = (await svc.entities.ConfidenceCalibration.list('-last_calibrated_at', 1))[0];
    const prevWeights = existing?.source_weights || {};
    const source_weights = {};
    for (const k of ADJUSTABLE) {
      const s = sourceStats[k];
      const samples = s.hits + s.misses;
      const accuracy = samples > 0 ? s.hits / samples : null;
      const bias = samples > 0 ? (s.openOver - s.closedOver) / samples : 0;
      const prevMult = prevWeights[k]?.multiplier ?? 1;
      let mult = prevMult;
      if (samples >= MIN_SAMPLES) {
        mult = prevMult * (1 - BIAS_K * bias);
        mult = Math.max(MULT_MIN, Math.min(MULT_MAX, mult));
      }
      source_weights[k] = {
        baseWeight: BASE_WEIGHTS[k],
        multiplier: Math.round(mult * 1000) / 1000,
        samples,
        hits: s.hits,
        misses: s.misses,
        accuracy: accuracy == null ? null : Math.round(accuracy * 100),
        bias: Math.round(bias * 100) / 100,
      };
    }

    const payload = {
      total_resolved: resolved.length,
      total_with_verdict: totalCorrect + totalIncorrect,
      overall_accuracy: overall,
      accuracy_by_venue: finalize(accVenue),
      accuracy_by_platform: finalize(accPlatform),
      accuracy_by_category: finalize(accCategory),
      accuracy_by_artist: finalize(accArtist),
      accuracy_by_seller: finalize(accSeller),
      accuracy_by_recommendation: finalize(accRec),
      source_weights,
      resolved_this_run: resolvedNow,
      last_calibrated_at: nowIso,
    };

    if (existing) await svc.entities.ConfidenceCalibration.update(existing.id, payload);
    else await svc.entities.ConfidenceCalibration.create(payload);

    return Response.json(payload);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});