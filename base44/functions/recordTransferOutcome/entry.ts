/**
 * recordTransferOutcome
 * 
 * Triggered by Purchase entity automation on status changes to 'completed' or 'disputed'.
 * Records a TransferOutcome and updates the seller's reliability score.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

        // If dispute, increment false claim count (buyer won = seller made false transfer claim)
        const newFalseClaimCount = !isSuccess ? falseClaims + 1 : falseClaims;

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