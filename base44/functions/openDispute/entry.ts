/**
 * openDispute — Narrowly scoped buyer dispute.
 *
 * Verifies the authenticated user is the buyer of this purchase, sets the
 * dispute state and reason, and notifies the buyer, seller, and support.
 * The recordTransferOutcome automation handles TransferOutcome + AdminAlert
 * creation on the transition to 'disputed'.
 *
 * Body: { purchase_id, reason }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { recordNotification, sendTransactionalEmail } from '../../shared/notifications.ts';
import { getPurchasePrivate, upsertPurchasePrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isMaintenanceActive()) return maintenance503('Disputes are temporarily unavailable for scheduled maintenance.');

  const { purchase_id, reason } = await req.json().catch(() => ({}));
  if (!purchase_id) {
    return Response.json({ error: 'purchase_id is required' }, { status: 400 });
  }

  const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  const purchase = purchases[0];
  if (!purchase) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  // Phase 1B: read authoritative buyer/seller identity from PurchasePrivate first
  const pp = await getPurchasePrivate(base44, purchase.id);
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
  const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;

  // Only the buyer (or an admin) may open a dispute.
  if (authoritativeBuyerEmail !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Not authorized as buyer' }, { status: 403 });
  }

  // Terminal purchases cannot be re-disputed.
  if (purchase.transfer_status === 'completed') {
    return Response.json({ error: 'Cannot dispute a completed purchase' }, { status: 409 });
  }
  if (purchase.transfer_status === 'disputed') {
    return Response.json({ status: 'already_disputed' });
  }

  const disputeReason = (reason || 'Buyer opened a dispute').slice(0, 1000);

  await base44.asServiceRole.entities.Purchase.update(purchase.id, {
    transfer_status: 'disputed',
    dispute_reason: disputeReason,
  });
  // Phase 1B: mirror dispute_reason to PurchasePrivate (authoritative private destination)
  try {
    await upsertPurchasePrivate(base44, purchase.id, { dispute_reason: disputeReason });
  } catch (err) {
    await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return Response.json({ error: 'Failed to record dispute. Please try again.' }, { status: 500 });
  }

  // Notify buyer, seller, and support — fire-and-forget via shared module (in-process).
  recordNotification(base44, {
    user_email: authoritativeBuyerEmail,
    type: 'dispute_opened',
    title: 'Dispute submitted ⚖️',
    body: `Your dispute has been received. Our team will review and resolve it promptly. Reason: ${disputeReason}`,
    reference_id: purchase.id,
    reference_type: 'purchase',
    action_url: `/purchase/${purchase.id}`,
  }).catch(() => {});
  recordNotification(base44, {
    user_email: authoritativeSellerEmail,
    type: 'dispute_opened',
    title: 'Buyer opened a dispute ⚖️',
    body: `The buyer disputed this transaction. Reason: ${disputeReason}. Our team will review and reach out.`,
    reference_id: purchase.id,
    reference_type: 'purchase',
    action_url: `/purchase/${purchase.id}`,
  }).catch(() => {});
  sendTransactionalEmail(base44, 'experience@peanutgallery.store',
    `⚠️ Dispute opened — Purchase ${purchase.id}`,
    `A dispute has been opened on Peanut Gallery.\n\nPurchase ID: ${purchase.id}\nBuyer: ${authoritativeBuyerEmail}\nSeller: ${authoritativeSellerEmail}\nAmount: $${purchase.amount?.toFixed(2)}\nReason: ${disputeReason}\n\nReview in the admin panel and resolve promptly.\n\n— Peanut Gallery`
  ).catch(err => console.error('[openDispute] email notify failed:', err?.message));

  return Response.json({ status: 'disputed' });
});