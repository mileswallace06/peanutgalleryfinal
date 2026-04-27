import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Returns { flagged: bool, reason: string|null }
async function checkSuspicious(base44, sellerEmail, askingPrice) {
  const [purchases, allListings, sellerUsers] = await Promise.all([
    base44.asServiceRole.entities.Purchase.filter({ seller_email: sellerEmail }),
    base44.asServiceRole.entities.Listing.filter({ seller_email: sellerEmail }),
    base44.asServiceRole.entities.User.filter({ email: sellerEmail }),
  ]);

  const seller = sellerUsers[0];

  // Strike-based flag (disputes or admin-assigned strikes)
  if (seller && (seller.strike_count || 0) > 0) {
    return { flagged: true, reason: `Seller has ${seller.strike_count} strike(s)` };
  }

  // Prior disputes
  const disputed = purchases.filter(p => p.transfer_status === 'disputed');
  if (disputed.length > 0) {
    return { flagged: true, reason: `Seller has ${disputed.length} prior dispute(s)` };
  }

  // Repeated cancellations (3+ expired without seller action)
  const expired = purchases.filter(p => p.transfer_status === 'expired' && !p.seller_confirmed);
  if (expired.length >= 3) {
    return { flagged: true, reason: `Seller has ${expired.length} failed transfers` };
  }

  // Spam: more than 10 active listings at once
  const activeListings = allListings.filter(l => l.status === 'active');
  if (activeListings.length >= 10) {
    return { flagged: true, reason: `Seller has ${activeListings.length} active listings (possible spam)` };
  }

  // Unrealistic pricing: asking_price > $2000/ticket
  if (askingPrice > 2000) {
    return { flagged: true, reason: `Asking price $${askingPrice} is unusually high` };
  }

  return { flagged: false, reason: null };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const askingPrice = parseFloat(body.asking_price) || 0;

  const { flagged, reason } = await checkSuspicious(base44, user.email, askingPrice);

  const listing = await base44.entities.Listing.create({
    event_id: body.event_id,
    seller_email: user.email,
    section: body.section,
    row: body.row,
    seats: body.seats || undefined,
    quantity: body.quantity || 1,
    tier: body.tier || undefined,
    asking_price: askingPrice,
    original_price: body.original_price || undefined,
    transfer_method: body.transfer_method || 'email_transfer',
    proof_url: body.proof_url || undefined,
    proof_status: flagged ? 'pending_review' : 'approved',
    proof_rejection_reason: flagged ? reason : undefined,
    status: 'active',
  });

  return Response.json({ listing, flagged, flag_reason: reason });
});