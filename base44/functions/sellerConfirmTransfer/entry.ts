/**
 * sellerConfirmTransfer — Narrowly scoped seller confirmation.
 *
 * Verifies the authenticated user is the seller of this purchase, accepts and
 * validates the seller's transfer proof/note, and sets ONLY the seller
 * confirmation fields. Does not capture payment — the buyer confirms
 * separately via capturePayment.
 *
 * Body: { purchase_id, proof_url?, proof_note? }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { awardPoints, notify } from '../../shared/purchaseNotifications.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { purchase_id, proof_url, proof_note } = await req.json().catch(() => ({}));
  if (!purchase_id) {
    return Response.json({ error: 'purchase_id is required' }, { status: 400 });
  }

  const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  const purchase = purchases[0];
  if (!purchase) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  // Only the seller (or an admin) may confirm the transfer.
  if (purchase.seller_email !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized as seller' }, { status: 403 });
  }

  // Only pending purchases can be confirmed.
  if (purchase.transfer_status !== 'pending_transfer') {
    return Response.json({ error: `Cannot confirm a ${purchase.transfer_status} purchase` }, { status: 409 });
  }

  // Seller must provide proof (a screenshot or a transfer note).
  const hasProof = (proof_url && proof_url.trim()) || (proof_note && proof_note.trim());
  if (!hasProof) {
    return Response.json({ error: 'Please upload a screenshot or add a transfer note before confirming.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const update = {
    seller_confirmed: true,
    seller_confirmed_at: now,
  };
  if (proof_url && proof_url.trim()) {
    update.transfer_proof_url = proof_url.trim();
    update.ai_proof_status = 'pending';
  }
  if (proof_note && proof_note.trim()) {
    update.transfer_notes = proof_note.trim();
  }

  await base44.asServiceRole.entities.Purchase.update(purchase.id, update);

  // Quick fulfillment bonus if seller confirms within 1 hour of purchase.
  const purchasedAt = new Date(purchase.created_date).getTime();
  const hoursElapsed = (Date.now() - purchasedAt) / 3600000;
  if (hoursElapsed <= 1) {
    awardPoints(base44, purchase.seller_email, 'seller_transfer_1hr', purchase.id, 'purchase');
  }

  notify(base44, purchase.buyer_email, 'Tickets sent 🚀', 'Your seller has sent the tickets! Check your email and ticket app (Ticketmaster, SeatGeek, etc.), then confirm receipt in the app to release payment.', 'tickets_sent', purchase.id);

  return Response.json({ status: 'confirmed', seller_confirmed: true });
});