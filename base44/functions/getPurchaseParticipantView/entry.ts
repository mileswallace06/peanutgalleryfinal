/**
 * getPurchaseParticipantView — return an allowlisted purchase view for the
 * calling participant (buyer / seller / admin). Private internals (PI id,
 * fraud, AI) are only included for admins.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const purchase_id = url.searchParams.get('purchase_id');
  if (!purchase_id) return Response.json({ error: 'purchase_id required' }, { status: 400 });

  const rows = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  const p = rows[0];
  if (!p) return Response.json({ error: 'Purchase not found' }, { status: 404 });

  const isBuyer = p.buyer_email === user.email;
  const isSeller = p.seller_email === user.email;
  const isAdmin = user.role === 'admin';
  if (!isBuyer && !isSeller && !isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const base = {
    id: p.id, listing_id: p.listing_id, event_id: p.event_id,
    amount: p.amount, subtotal: p.subtotal, platform_fee: p.platform_fee,
    quantity: p.quantity, transfer_status: p.transfer_status,
    buyer_confirmed: p.buyer_confirmed, seller_confirmed: p.seller_confirmed,
    is_demo: p.is_demo,
  };
  const participantExtra = (isBuyer || isSeller) ? {
    buyer_name: p.buyer_name, seller_payout: p.seller_payout,
  } : {};
  const adminExtra = isAdmin ? {
    buyer_email: p.buyer_email, seller_email: p.seller_email,
    payment_intent_id: p.payment_intent_id, payment_captured: p.payment_captured,
    fraud_risk_score: p.fraud_risk_score, ai_proof_status: p.ai_proof_status,
    admin_override_status: p.admin_override_status,
  } : {};

  return Response.json({ purchase: { ...base, ...participantExtra, ...adminExtra } });
});