/**
 * adminOverrideAIVerification — Service-role safe admin override for AI verification decisions.
 *
 * Replaces direct entity writes from the frontend for AI override actions.
 * Ensures audit trail is always written regardless of frontend auth state or RLS policies.
 *
 * SAFETY: Only admins can call this. Never touches Stripe or financial state.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const { purchase_id, action, reason } = await req.json();

    if (!purchase_id || !action || !reason?.trim()) {
      return Response.json({ error: 'purchase_id, action, and reason are required' }, { status: 400 });
    }

    const VALID_ACTIONS = ['approved', 'rejected', 'escalated', 'marked_fraudulent'];
    if (!VALID_ACTIONS.includes(action)) {
      return Response.json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` }, { status: 400 });
    }

    // Fetch purchase to confirm it exists
    const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id }).catch(() => []);
    const purchase = purchases[0];
    if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });

    const now = new Date().toISOString();

    const updatePayload = {
      admin_override_status: action,
      admin_override_reason: reason.trim(),
      admin_override_by: user.email,
      admin_override_at: now,
    };

    // Adjust ai_proof_status to reflect the override decision
    if (action === 'approved') {
      updatePayload.ai_proof_status = 'verified_high_confidence';
    } else if (action === 'rejected' || action === 'marked_fraudulent') {
      updatePayload.ai_proof_status = 'rejected_suspicious';
      updatePayload.auto_review_flagged = true;
      updatePayload.auto_review_flagged_at = now;
    }
    // 'escalated' leaves ai_proof_status unchanged — it stays in human review queue

    await base44.asServiceRole.entities.Purchase.update(purchase_id, updatePayload);

    // ── Increment transfer_false_claim_count when admin explicitly rejects/marks fraudulent
    // Deduped: only one strike per purchase regardless of AI rejection or buyer dispute
    if ((action === 'rejected' || action === 'marked_fraudulent') && purchase.seller_email && !purchase.false_claim_recorded) {
      await base44.asServiceRole.entities.Purchase.update(purchase_id, { false_claim_recorded: true }).catch(() => {});
      const sellers = await base44.asServiceRole.entities.User.filter({ email: purchase.seller_email }).catch(() => []);
      const seller = sellers[0];
      if (seller) {
        await base44.asServiceRole.entities.User.update(seller.id, {
          transfer_false_claim_count: (seller.transfer_false_claim_count || 0) + 1,
        }).catch(() => {});
      }
    }

    console.log(`[adminOverrideAIVerification] override applied — purchase=${purchase_id} action=${action} by=${user.email}`);

    return Response.json({
      success: true,
      purchase_id,
      action,
      admin_override_by: user.email,
      admin_override_at: now,
    });

  } catch (error) {
    console.error('[adminOverrideAIVerification] error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});