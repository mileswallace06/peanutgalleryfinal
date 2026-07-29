/**
 * getPurchaseParticipantView — return an allowlisted purchase view for the
 * calling participant (buyer / seller / admin). Private internals (PI id,
 * fraud, AI) are only included for admins.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { getPurchasePrivate } from '../../shared/privateData.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const purchase_id = body?.purchase_id;
  if (!purchase_id) return Response.json({ error: 'purchase_id required' }, { status: 400 });

  const rows = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  const p = rows[0];
  if (!p) return Response.json({ error: 'Purchase not found' }, { status: 404 });

  // Phase 1B: read authoritative buyer/seller identity from PurchasePrivate
  const pp = await getPurchasePrivate(base44, p.id);
  const authoritativeBuyerEmail = pp?.buyer_email ?? p.buyer_email;
  const authoritativeSellerEmail = pp?.seller_email ?? p.seller_email;

  const isBuyer = authoritativeBuyerEmail === user.email;
  const isSeller = authoritativeSellerEmail === user.email;
  const isAdmin = user.role === 'admin';
  if (!isBuyer && !isSeller && !isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  // ── Strict role-specific allowlists ──────────────────────────────────────
  // Never expose: emails, reservation tokens, payment IDs, proof storage
  // details, fraud data, or private notes — to any role in the participant view.
  // Buyers: no seller payout/internal fields. Sellers: no buyer PII/location.

  const base = {
    id: p.id, listing_id: p.listing_id, event_id: p.event_id,
    amount: p.amount, quantity: p.quantity, transfer_status: p.transfer_status,
    buyer_confirmed: p.buyer_confirmed, seller_confirmed: p.seller_confirmed,
    is_demo: p.is_demo,
  };

  // Seller sees their payout but NOT buyer PII (buyer_name, phone, lat, lng)
  const sellerExtra = isSeller ? {
    seller_payout: p.seller_payout,
  } : {};

  // Admin sees financial breakdown but NOT payment_intent_id, emails, or fraud data
  // (fraud data lives in dedicated admin panels — AIVerificationQueue, AdminCommandCenter)
  const adminExtra = isAdmin ? {
    subtotal: p.subtotal, platform_fee: p.platform_fee, seller_payout: p.seller_payout,
    payment_captured: p.payment_captured,
  } : {};

  return Response.json({ purchase: { ...base, ...sellerExtra, ...adminExtra } });
});