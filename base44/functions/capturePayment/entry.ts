import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

// Fire-and-forget points award helper — never throws
async function awardPoints(base44, userEmail, action, referenceId, referenceType) {
  try {
    await base44.asServiceRole.functions.invoke('awardPoints', {
      _internal_service_call: true,
      action,
      reference_id: referenceId,
      reference_type: referenceType,
      target_email: userEmail,
    });
  } catch (err) {
    console.error('[capturePayment] awardPoints failed for', userEmail, '|', err?.message);
  }
}

// Fire-and-forget notification helper — never throws
async function notify(base44, userEmail, title, body, type, purchaseId) {
  try {
    await base44.asServiceRole.functions.invoke('sendUserNotification', {
      user_email: userEmail,
      title,
      body,
      type,
      purchase_id: purchaseId,
    });
  } catch (err) {
    console.error('[capturePayment] notify failed to', userEmail, '|', err?.message);
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const { purchase_id, confirming_role, optimistic_id } = await req.json();

  if (!purchase_id || !confirming_role) {
    return Response.json({ error: 'purchase_id and confirming_role are required' }, { status: 400 });
  }

  const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  const purchase = purchases[0];
  if (!purchase) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  if (purchase.transfer_status === 'completed') {
    return Response.json({ status: 'already_completed' });
  }

  if (purchase.transfer_status === 'disputed') {
    return Response.json({ error: 'Cannot capture payment on a disputed purchase' }, { status: 409 });
  }

  // FRAUD-3: Block buyer confirmation before seller has confirmed
  if (confirming_role === 'buyer' && !purchase.seller_confirmed) {
    return Response.json({ error: 'Cannot confirm receipt before seller confirms transfer' }, { status: 409 });
  }

  // RISK-3: Server-side proof validation — seller must provide proof before confirming
  if (confirming_role === 'seller') {
    const hasProof = (purchase.transfer_proof_url && purchase.transfer_proof_url.trim()) ||
                     (purchase.transfer_notes && purchase.transfer_notes.trim());
    if (!hasProof) {
      return Response.json({ error: 'Please upload a screenshot or add a transfer note before confirming.' }, { status: 400 });
    }
  }

  // CRITICAL-3: Block point awards on self-purchase (alt-account farming)
  const isSelfPurchase = purchase.seller_email === purchase.buyer_email;
  if (isSelfPurchase) {
    console.warn('[capturePayment] SELF-PURCHASE DETECTED — blocking point awards:', {
      seller: purchase.seller_email,
      buyer: purchase.buyer_email,
      purchase_id: purchase.id,
    });
  }

  // Update the confirming party
  const update = {};
  if (confirming_role === 'seller') {
    if (purchase.seller_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Not authorized as seller' }, { status: 403 });
    }
    update.seller_confirmed = true;
  } else if (confirming_role === 'buyer') {
    if (purchase.buyer_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Not authorized as buyer' }, { status: 403 });
    }
    update.buyer_confirmed = true;
  } else {
    return Response.json({ error: 'confirming_role must be buyer or seller' }, { status: 400 });
  }

  await base44.asServiceRole.entities.Purchase.update(purchase.id, update);

  const updatedBuyerConfirmed = confirming_role === 'buyer' ? true : purchase.buyer_confirmed;
  const updatedSellerConfirmed = confirming_role === 'seller' ? true : purchase.seller_confirmed;

  if (updatedBuyerConfirmed && updatedSellerConfirmed) {
    // CRITICAL-6: Atomic capture guard — re-fetch before capturing
    const [freshPurchase] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase.id });
    if (freshPurchase?.payment_captured === true || freshPurchase?.transfer_status === 'completed') {
      return Response.json({ status: 'already_completed' });
    }

    // HIGH-D: Attempt Stripe capture FIRST, then mark DB complete
    const pi = await stripe.paymentIntents.retrieve(purchase.payment_intent_id);
    if (pi.status === 'requires_capture') {
      try {
        await stripe.paymentIntents.capture(purchase.payment_intent_id, {
          idempotencyKey: `capture-${purchase.id}`,
        });
      } catch (stripeErr) {
        console.error('[capturePayment] Stripe capture FAILED:', purchase.id, stripeErr?.message);
        // Mark as capture failed so admin can review and retry
        await base44.asServiceRole.entities.Purchase.update(purchase.id, {
          payment_capture_failed: true,
        }).catch(() => {});
        // Notify admin
        base44.asServiceRole.functions.invoke('sendNotificationEmail', {
          to: 'experience@peanutgallery.store',
          subject: `🚨 Stripe Capture Failed — Purchase ${purchase.id}`,
          body: `Stripe payment capture failed.\n\nPurchase: ${purchase.id}\nBuyer: ${purchase.buyer_email}\nSeller: ${purchase.seller_email}\nAmount: $${purchase.amount?.toFixed(2)}\nError: ${stripeErr?.message}\n\nReview and retry capture in Stripe dashboard.`,
        }).catch(() => {});
        return Response.json({ error: 'Payment capture failed. Our team has been notified.' }, { status: 500 });
      }
    } else if (pi.status !== 'succeeded') {
      console.warn('[capturePayment] PI in unexpected state:', pi.status, purchase.payment_intent_id);
    }

    // Stripe capture succeeded — now mark DB complete
    await base44.asServiceRole.entities.Purchase.update(purchase.id, {
      transfer_status: 'completed',
      payment_captured: true,
      payment_capture_failed: false,
    });

    // Clear listing reservation and mark sold
    await base44.asServiceRole.entities.Listing.update(purchase.listing_id, {
      status: 'sold',
      reservation_token: null,
      reservation_expires_at: null,
      reserved_by_email: null,
    }).catch(() => {});

    // Award points only if not a self-purchase
    if (!isSelfPurchase) {
      awardPoints(base44, purchase.seller_email, 'sale_completed', purchase.id, 'purchase');
      awardPoints(base44, purchase.buyer_email, 'purchase', purchase.id, 'purchase');
    }

    notify(base44, purchase.seller_email, 'Sale complete 💸', 'Your payout is processing. Stripe deposits typically take 2–7 business days. First-time payouts may take up to 14 days.', 'sale_complete', purchase.id);

    return Response.json({ status: 'completed', payment_captured: true, optimistic_id: optimistic_id });
  }

  // ── Mid-flow: seller just confirmed transfer ──────────────────────────────
  if (confirming_role === 'seller') {
    await base44.asServiceRole.entities.Purchase.update(purchase.id, {
      seller_confirmed_at: new Date().toISOString(),
    });
    // Quick fulfillment bonus: if seller confirms within 4 hours of purchase
    const purchasedAt = new Date(purchase.created_date).getTime();
    const hoursElapsed = (Date.now() - purchasedAt) / 3600000;
    if (hoursElapsed <= 4) {
      awardPoints(base44, purchase.seller_email, 'quick_seller_fulfill', purchase.id, 'purchase');
    }
    notify(base44, purchase.buyer_email, 'Tickets sent 🚀', 'Check your ticket app or email, then confirm receipt.', 'tickets_sent', purchase.id);
  }

  // Quick buyer confirm bonus
  if (confirming_role === 'buyer' && purchase.seller_confirmed_at) {
    const sentAt = new Date(purchase.seller_confirmed_at).getTime();
    const hoursElapsed = (Date.now() - sentAt) / 3600000;
    if (hoursElapsed <= 2) {
      awardPoints(base44, purchase.buyer_email, 'quick_buyer_confirm', purchase.id, 'purchase');
    }
  }

  return Response.json({
    status: 'confirmed',
    buyer_confirmed: updatedBuyerConfirmed,
    seller_confirmed: updatedSellerConfirmed,
    optimistic_id: optimistic_id
  });
});