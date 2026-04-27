import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // Count completed sales for this seller
  const completedPurchases = await base44.asServiceRole.entities.Purchase.filter({
    seller_email: user.email,
    transfer_status: 'completed',
  });

  const completedCount = completedPurchases.length;
  const isAutoApproved = completedCount >= 3;

  const listing = await base44.entities.Listing.create({
    event_id: body.event_id,
    seller_email: user.email,
    section: body.section,
    row: body.row,
    seats: body.seats || undefined,
    quantity: body.quantity || 1,
    tier: body.tier || undefined,
    asking_price: body.asking_price,
    original_price: body.original_price || undefined,
    transfer_method: body.transfer_method || 'email_transfer',
    proof_url: body.proof_url || undefined,
    proof_status: isAutoApproved ? 'approved' : 'pending_review',
    status: 'active',
  });

  return Response.json({ listing, auto_approved: isAutoApproved, completed_sales: completedCount });
});