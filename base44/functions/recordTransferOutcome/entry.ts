/**
 * recordTransferOutcome
 * 
 * Triggered by Purchase entity automation on status changes to 'completed' or 'disputed'.
 * Records a TransferOutcome and updates the seller's reliability score.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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
    const body = await req.json();

    const { event, data: purchase, old_data } = body;
    if (!purchase) return Response.json({ skipped: 'no data' });

    const newStatus = purchase.transfer_status;
    const oldStatus = old_data?.transfer_status;

    // Only act on transitions TO completed or disputed
    if (newStatus === oldStatus) return Response.json({ skipped: 'no status change' });
    if (!['completed', 'disputed'].includes(newStatus)) return Response.json({ skipped: 'not a terminal status' });

    // Demo purchases never affect real revenue, trust, or transfer intelligence.
    if (purchase.is_demo === true) return Response.json({ skipped: 'demo purchase' });

    const isSuccess = newStatus === 'completed';
    const now = new Date().toISOString();

    // Compute minutes to transfer
    let minutesToTransfer = null;
    if (purchase.seller_confirmed_at && purchase.created_date) {
      minutesToTransfer = Math.round(
        (new Date(purchase.seller_confirmed_at) - new Date(purchase.created_date)) / 60000
      );
    }

    // Create TransferOutcome record
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

    // Learning: feed the Transfer Confidence Engine with this outcome so it
    // can learn venue / platform transfer trends over time.
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

    // Self-calibration: resolve the event's active confidence prediction with this outcome.
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
          platform: listing?.transfer_platform || null,
          seller_email: purchase.seller_email || null,
        });
      }
    } catch (_) {
      // self-calibration is best-effort
    }

    // Beta log
    base44.asServiceRole.entities.BetaTransferLog.create({
      log_type: isSuccess ? 'transfer_complete' : 'transfer_failed',
      actor_role: 'system',
      listing_id: purchase.listing_id,
      purchase_id: purchase.id,
      event_id: purchase.event_id,
      before_state: { transfer_status: oldStatus },
      after_state: { transfer_status: newStatus },
      metadata: { minutes_to_transfer: minutesToTransfer, seller: purchase.seller_email },
    }).catch(() => {});

    // Update seller reliability score
    if (purchase.seller_email) {
      const sellers = await base44.asServiceRole.entities.User.filter({ email: purchase.seller_email });
      const seller = sellers[0];
      if (seller) {
        const successCount = (seller.transfer_success_count || 0) + (isSuccess ? 1 : 0);
        const failCount = (seller.transfer_fail_count || 0) + (!isSuccess ? 1 : 0);
        const total = successCount + failCount;

        // Weighted reliability: recent failures weigh more
        let reliability = total > 0 ? Math.round((successCount / total) * 100) : 70;

        // Penalty for disputes
        if (!isSuccess) reliability = Math.max(0, reliability - 5);
        // Clamp
        reliability = Math.max(0, Math.min(100, reliability));

        // Factor in false claim count for reliability penalty
        const falseClaims = seller.transfer_false_claim_count || 0;
        if (falseClaims >= 1) reliability = Math.max(0, reliability - (falseClaims * 3));

        // If dispute, strike false claim ONLY if not already recorded for this purchase
        // (AI rejection or admin override may have already set false_claim_recorded = true)
        let newFalseClaimCount = falseClaims;
        if (!isSuccess && !purchase.false_claim_recorded) {
          await base44.asServiceRole.entities.Purchase.update(purchase.id, { false_claim_recorded: true }).catch(() => {});
          newFalseClaimCount = falseClaims + 1;
        }

        await base44.asServiceRole.entities.User.update(seller.id, {
          transfer_success_count: successCount,
          transfer_fail_count: failCount,
          seller_transfer_reliability: reliability,
          transfer_false_claim_count: newFalseClaimCount,
        });
      }
    }

    // If disputed → create admin alert
    if (!isSuccess) {
      const existing = await base44.asServiceRole.entities.AdminAlert.filter({
        reference_id: purchase.id,
        alert_type: 'failed_transfer_after_payment',
        resolved: false,
      });
      if (existing.length === 0) {
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
        });
      }
    }

    return Response.json({ recorded: true, outcome: isSuccess ? 'success' : 'dispute', minutes_to_transfer: minutesToTransfer });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});