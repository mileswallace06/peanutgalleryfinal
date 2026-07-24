/**
 * recordTransferOutcome — Purchase entity-automation handler (update).
 *
 * CONCURRENCY MODEL (DB-enforced exactly-once per terminal outcome):
 *   - NEVER trust `data` / `old_data` / emails / status in the request body.
 *     Extract ONLY the entity id, then re-fetch the authoritative Purchase.
 *   - An ATOMIC CLAIM (DB compare-and-set on Purchase.outcome_claim) guarantees
 *     that exactly one concurrent invocation per (purchase, terminal-status)
 *     proceeds. Losers exit before creating ANY record or changing ANY counter.
 *     This is enforced by MongoDB document-level atomicity — not a racy
 *     read-then-write existence check.
 *   - A claim older than 10 minutes is reclaimable (self-healing after a
 *     crash). Each dependent record is also guarded by an existence check so a
 *     reclaim finishes missing work WITHOUT duplicating completed work.
 *   - Seller trust counters are DERIVED from authoritative TransferOutcome
 *     records (and false-claim count from flagged Purchases) — a pure recompute,
 *     so a duplicate invocation can never double-increment them.
 *   - The false-claim strike uses an atomic compare-and-set (claimFlag) so AI
 *   - rejection, admin rejection, and dispute each strike a purchase at most once.
 *   - Demo purchases are skipped entirely.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { claimOnce, claimFlag } from '../../shared/atomicClaim.ts';

// Map a (recommendation, outcome) pair to a correctness verdict for self-calibration.
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
    const body = await req.json().catch(() => ({}));

    // Extract ONLY the entity id — never the record itself.
    const entityId = body?.event?.entity_id || body?.data?.id;
    if (!entityId) return Response.json({ skipped: 'no entity id' });

    // Re-fetch the authoritative Purchase.
    const fetched = await base44.asServiceRole.entities.Purchase.filter({ id: entityId }).catch(() => []);
    const purchase = fetched[0];
    if (!purchase) return Response.json({ skipped: 'purchase not found' });

    // Demo purchases never affect real revenue, trust, or transfer intelligence.
    if (purchase.is_demo === true) return Response.json({ skipped: 'demo purchase' });

    const newStatus = purchase.transfer_status;
    // Only act on terminal statuses.
    if (!['completed', 'disputed'].includes(newStatus)) {
      return Response.json({ skipped: 'not a terminal status' });
    }

    const isSuccess = newStatus === 'completed';

    // ── ATOMIC CLAIM: exactly one concurrent invocation per (purchase, status).
    const { won } = await claimOnce(base44, 'Purchase', purchase.id, 'outcome_claim', 'outcome_claimed_at', 10);
    if (!won) {
      // Determine whether the work is already done vs. a concurrent owner.
      const existing = await base44.asServiceRole.entities.TransferOutcome.filter({
        purchase_id: purchase.id, transfer_successful: isSuccess,
      }).catch(() => []);
      if (existing.length > 0) return Response.json({ skipped: 'already processed (outcome exists)' });
      return Response.json({ skipped: 'outcome claim held by concurrent invocation' });
    }

    const now = new Date().toISOString();

    // Compute minutes to transfer from the authoritative record.
    let minutesToTransfer = null;
    if (purchase.seller_confirmed_at && purchase.created_date) {
      minutesToTransfer = Math.round(
        (new Date(purchase.seller_confirmed_at) - new Date(purchase.created_date)) / 60000
      );
    }

    let struckFalseClaim = false;

    // 1. TransferOutcome — existence check guards reclaim-after-partial-failure.
    const existingOutcome = await base44.asServiceRole.entities.TransferOutcome.filter({
      purchase_id: purchase.id, transfer_successful: isSuccess,
    }).catch(() => []);
    const outcomeCreatedNow = existingOutcome.length === 0;
    if (outcomeCreatedNow) {
      await base44.asServiceRole.entities.TransferOutcome.create({
        listing_id: purchase.listing_id,
        event_id: purchase.event_id,
        purchase_id: purchase.id,
        seller_email: purchase.seller_email,
        buyer_email: purchase.buyer_email,
        transfer_successful: isSuccess,
        transfer_completed_at: isSuccess ? now : null,
        minutes_to_transfer: minutesToTransfer,
        buyer_confirmed: purchase.buyer_confirmed || false,
        seller_confirmed: purchase.seller_confirmed || false,
        admin_intervention_required: purchase.auto_review_flagged || false,
        dispute_created: !isSuccess,
        notes: !isSuccess ? purchase.dispute_reason : null,
      });
    }

    // 2. TransferIntelligence — idempotent via purchase_id dedup.
    const existingIntel = await base44.asServiceRole.entities.TransferIntelligence.filter({
      purchase_id: purchase.id, source: 'transfer_outcome',
    }).catch(() => []);
    if (existingIntel.length === 0) {
      try {
        let listing = null;
        if (purchase.listing_id) {
          try { listing = await base44.asServiceRole.entities.Listing.get(purchase.listing_id); } catch (_) {}
        }
        let ev = null;
        if (purchase.event_id) {
          try { const evs = await base44.asServiceRole.entities.Event.filter({ id: purchase.event_id }); ev = evs[0]; } catch (_) {}
        }
        let timeBeforeEventMin = null;
        if (ev && (ev.event_start_utc || ev.date)) {
          const startMs = new Date(ev.event_start_utc || ev.date).getTime();
          if (!Number.isNaN(startMs)) timeBeforeEventMin = Math.round((startMs - Date.now()) / 60000);
        }
        await base44.asServiceRole.entities.TransferIntelligence.create({
          event_id: purchase.event_id,
          purchase_id: purchase.id,
          event_title: ev?.title || null,
          venue: ev?.venue || null,
          city: ev?.city || null,
          state: ev?.state || null,
          category: ev?.category || null,
          artist: ev?.artist || null,
          platform: listing?.transfer_platform || null,
          transfer_successful: isSuccess,
          failure_reason: !isSuccess ? (purchase.dispute_reason || null) : null,
          time_before_event_min: timeBeforeEventMin,
          minutes_to_transfer: minutesToTransfer,
          seller_response_time_min: minutesToTransfer,
          buyer_confirmed: purchase.buyer_confirmed || false,
          seller_confirmed: purchase.seller_confirmed || false,
          seller_email: purchase.seller_email,
          buyer_email: purchase.buyer_email,
          source: 'transfer_outcome',
          recorded_at: now,
        });
      } catch (_) {
        // learning is best-effort
      }
    }

    // 3. Self-calibration: resolve the event's active prediction (idempotent).
    try {
      const preds = await base44.asServiceRole.entities.TransferConfidencePrediction.filter({ event_id: purchase.event_id, resolved: false });
      const pred = preds[0];
      if (pred) {
        const outcome = isSuccess ? 'transfer_succeeded' : 'transfer_failed';
        await base44.asServiceRole.entities.TransferConfidencePrediction.update(pred.id, {
          resolved: true,
          resolved_at: now,
          actual_outcome: outcome,
          prediction_correct: predVerdict(pred.recommendation, outcome),
          resolution_source: 'transfer_outcome',
          platform: null,
          seller_email: purchase.seller_email || null,
        });
      }
    } catch (_) {
      // self-calibration is best-effort
    }

    // 4. Beta log (best-effort; the claim serializes so no concurrent dup).
    base44.asServiceRole.entities.BetaTransferLog.create({
      log_type: isSuccess ? 'transfer_complete' : 'transfer_failed',
      actor_role: 'system',
      listing_id: purchase.listing_id,
      purchase_id: purchase.id,
      event_id: purchase.event_id,
      before_state: { transfer_status: null },
      after_state: { transfer_status: newStatus },
      metadata: { minutes_to_transfer: minutesToTransfer, seller: purchase.seller_email },
    }).catch(() => {});

    // 5. Seller trust — DERIVED from authoritative records (idempotent recompute).
    if (purchase.seller_email) {
      try {
        const sellers = await base44.asServiceRole.entities.User.filter({ email: purchase.seller_email });
        const seller = sellers[0];
        if (seller) {
          // Atomic exactly-once false-claim strike for disputes.
          if (!isSuccess) {
            struckFalseClaim = await claimFlag(base44, 'Purchase', purchase.id, 'false_claim_recorded');
          }
          // Derive success/fail counts from this seller's authoritative outcomes.
          const outcomes = await base44.asServiceRole.entities.TransferOutcome.filter({ seller_email: purchase.seller_email }).catch(() => []);
          const successCount = outcomes.filter(o => o.transfer_successful).length;
          const failCount = outcomes.filter(o => !o.transfer_successful).length;
          // Derive false-claim count from flagged purchases (idempotent).
          const flagged = await base44.asServiceRole.entities.Purchase.filter({
            seller_email: purchase.seller_email, false_claim_recorded: true,
          }).catch(() => []);
          const falseClaimCount = flagged.length;

          const total = successCount + failCount;
          let reliability = total > 0 ? Math.round((successCount / total) * 100) : 70;
          if (failCount > 0) reliability = Math.max(0, reliability - 5);
          if (falseClaimCount >= 1) reliability = Math.max(0, reliability - (falseClaimCount * 3));
          reliability = Math.max(0, Math.min(100, reliability));

          await base44.asServiceRole.entities.User.update(seller.id, {
            transfer_success_count: successCount,
            transfer_fail_count: failCount,
            transfer_false_claim_count: falseClaimCount,
            seller_transfer_reliability: reliability,
          });
        }
      } catch (_) {
        // trust update is best-effort
      }
    }

    // 6. Dispute → admin alert (idempotent against existing unresolved alert).
    if (!isSuccess) {
      const existingAlerts = await base44.asServiceRole.entities.AdminAlert.filter({
        reference_id: purchase.id,
        alert_type: 'failed_transfer_after_payment',
        resolved: false,
      }).catch(() => []);
      if (existingAlerts.length === 0) {
        await base44.asServiceRole.entities.AdminAlert.create({
          alert_type: 'failed_transfer_after_payment',
          priority: 'critical',
          title: `Transfer failed — $${purchase.amount?.toFixed(2)} in dispute`,
          description: `Buyer ${purchase.buyer_email} opened dispute. Seller: ${purchase.seller_email}. Reason: ${purchase.dispute_reason || 'not specified'}`,
          reference_id: purchase.id,
          reference_type: 'purchase',
          seller_email: purchase.seller_email,
          buyer_email: purchase.buyer_email,
          event_id: purchase.event_id,
        }).catch(() => {});
      }
    }

    return Response.json({
      recorded: true,
      outcome: isSuccess ? 'success' : 'dispute',
      minutes_to_transfer: minutesToTransfer,
      outcome_created_now: outcomeCreatedNow,
      struck_false_claim: struckFalseClaim,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});