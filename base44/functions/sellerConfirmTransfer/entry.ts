/**
 * sellerConfirmTransfer — Narrowly scoped seller confirmation.
 *
 * Verifies the authenticated user is the seller of this purchase, accepts and
 * validates the seller's transfer proof/note, and sets ONLY the seller
 * confirmation fields. Does not capture payment — the buyer confirms
 * separately via capturePayment.
 *
 * P0-01M: Canary-eligible synthetic [AUTH_CANARY] purchases are routed to the
 * authority-backed seller-confirmation canary orchestrator (Postgres authoritative
 * for transfer lifecycle state, Base44 mirror-only). The canary path transitions
 * the authority transfer_state (not_started → in_progress → seller_reported_sent)
 * before any Base44 mirror update. Seller self-report is NEVER labeled as
 * provider-verified delivery.
 *
 * All non-canary traffic and flag-OFF behavior remains identical to the legacy
 * path. The canary route is wired BEFORE the maintenance gate; the legacy path
 * is unchanged.
 *
 * Body: { purchase_id, proof_url?, proof_note? }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { awardPoints, notify } from '../../shared/purchaseNotifications.ts';
import { getPurchasePrivate, upsertPurchasePrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';
import { isCanaryEnabled } from '../../shared/authCanary.js';
import { maybeRouteCanarySellerConfirm } from '../../shared/sellerConfirmTransferCanaryOrchestrator.js';

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

  // ── Fetch purchase + listing for canary eligibility check (before maintenance) ──
  let purchase: any = null;
  try {
    const [p] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
    purchase = p || null;
  } catch (_) {}

  let listing: any = null;
  if (purchase?.listing_id) {
    try {
      const [l] = await base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id });
      listing = l || null;
    } catch (_) {}
  }

  // ── Canary route (synthetic [AUTH_CANARY] listings only) — before maintenance gate ──
  if (listing && purchase) {
    const executorUrl = secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR');

    // Idempotent notification callback — only called after authoritative commitment.
    const sendNotification = async (info: any) => {
      if (info.type === 'seller_reported_sent') {
        const pp = await getPurchasePrivate(base44, purchase.id);
        const buyerEmail = pp?.buyer_email ?? purchase.buyer_email;
        if (buyerEmail) {
          notify(base44, buyerEmail, 'Tickets sent 🚀',
            'Your seller has sent the tickets! Check your email and ticket app (Ticketmaster, SeatGeek, etc.), then confirm receipt in the app to release payment.',
            'tickets_sent', purchase.id);
        }
      }
    };

    const canaryResult = await maybeRouteCanarySellerConfirm({
      base44, user, listing, purchase,
      executorUrl,
      canaryEnabled: isCanaryEnabled(),
      sendNotification,
      body: { proof_url, proof_note },
    });
    if (canaryResult) return Response.json(canaryResult.body, { status: canaryResult.status });
  }

  // ── Legacy path (non-canary traffic + flag-OFF) — unchanged ──────────────
  if (isMaintenanceActive()) return maintenance503('Transfer confirmation is temporarily unavailable for scheduled maintenance.');

  if (!purchase) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  // Phase 1B: read authoritative seller/buyer identity from PurchasePrivate first
  const pp = await getPurchasePrivate(base44, purchase.id);
  const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;

  // Only the seller (or an admin) may confirm the transfer.
  if (authoritativeSellerEmail !== user.email && user.role !== 'admin') {
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
  // Phase 1B: mirror transfer_proof_url + ai_proof_status to PurchasePrivate (authoritative)
  const privateMirror = {};
  if (proof_url && proof_url.trim()) { privateMirror.transfer_proof_url = proof_url.trim(); privateMirror.ai_proof_status = 'pending'; }
  if (Object.keys(privateMirror).length > 0) {
    try {
      await upsertPurchasePrivate(base44, purchase.id, privateMirror);
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
      return Response.json({ error: 'Failed to record transfer proof. Please try again.' }, { status: 500 });
    }
  }

  // Quick fulfillment bonus if seller confirms within 1 hour of purchase.
  const purchasedAt = new Date(purchase.created_date).getTime();
  const hoursElapsed = (Date.now() - purchasedAt) / 3600000;
  if (hoursElapsed <= 1) {
    awardPoints(base44, authoritativeSellerEmail, 'seller_transfer_1hr', purchase.id, 'purchase');
  }

  notify(base44, authoritativeBuyerEmail, 'Tickets sent 🚀', 'Your seller has sent the tickets! Check your email and ticket app (Ticketmaster, SeatGeek, etc.), then confirm receipt in the app to release payment.', 'tickets_sent', purchase.id);

  return Response.json({ status: 'confirmed', seller_confirmed: true });
});