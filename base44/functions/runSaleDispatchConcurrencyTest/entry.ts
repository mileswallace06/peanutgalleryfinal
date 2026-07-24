/**
 * runSaleDispatchConcurrencyTest — proves the sale-notification dispatch
 * architecture holds provider calls to <=1 push and <=1 email per logical
 * sale_created notification under 10 concurrent enqueues.
 *
 * It exercises the EXACT enqueue path confirmCheckoutAuthorized uses
 * (enqueueSaleNotification) and the EXACT dispatch path the scheduled
 * dispatcher uses (dispatchSaleNotifications), with raw provider-call
 * counting at the send boundary (notifications.ts counters). Test records
 * use a 'test:' idempotency-key prefix so the production dispatcher never
 * touches them. The seller is a non-registered address so OneSignal/email
 * are called once each but deliver nothing. All test data is cleaned up.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { enqueueSaleNotification, dispatchSaleNotifications } from '../../shared/saleNotification.ts';
import { resetProviderCallCounters, getProviderCallCounters } from '../../shared/notifications.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const u = await base44.auth.me();
    if (u?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
  } catch (_) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ts = Date.now();
  const sellerEmail = `conc-test-seller-${ts}@peanutgallery.store`;
  const buyerEmail = `conc-test-buyer-${ts}@peanutgallery.store`;
  const listing = { section: 'TEST', row: '1' };

  // Create the test purchase FIRST (DB generates the real id), then use that id
  // as the notification reference_id — exactly as confirmCheckoutAuthorized does
  // with the real purchase record.
  const createdP = await base44.asServiceRole.entities.Purchase.create({
    listing_id: 'conc-test-listing',
    event_id: 'conc-test-event',
    seller_email: sellerEmail,
    buyer_email: buyerEmail,
    amount: 1.1, subtotal: 1.0, platform_fee: 0.1, seller_payout: 1.0,
    quantity: 1, is_demo: false,
    seller_push_status: 'pending', seller_email_status: 'pending',
  }).catch((e) => ({ _err: e.message }));
  const pid = createdP.id;
  if (!pid) return Response.json({ error: 'purchase create failed', detail: createdP._err }, { status: 500 });
  const testKey = `test:sale_created:${pid}`;
  const purchase = { id: pid, listing_id: 'conc-test-listing', seller_email: sellerEmail, buyer_email: buyerEmail };

  // ── Phase 1: 10 concurrent enqueues (simulates 10 concurrent confirmCheckoutAuthorized) ──
  resetProviderCallCounters();
  const beforeEnq = getProviderCallCounters();
  await Promise.all(
    Array.from({ length: 10 }, () =>
      enqueueSaleNotification(base44, purchase, listing, { idempotency_key: testKey }).catch((e) => ({ error: e.message }))
    )
  );
  const afterEnq = getProviderCallCounters();

  const created = await base44.asServiceRole.entities.Notification.filter(
    { type: 'sale_created', idempotency_key: testKey }
  ).catch(() => []);

  // ── Phase 2: ONE dispatch run (the scheduled dispatcher's exact logic) ──
  const dispatchRes = await dispatchSaleNotifications(base44, { keys: [testKey] }).catch((e) => ({
    error: e.message,
  }));
  const afterDisp = getProviderCallCounters();

  const final = await base44.asServiceRole.entities.Notification.filter(
    { type: 'sale_created', idempotency_key: testKey }
  ).catch(() => []);
  const byStatus = {};
  for (const n of final) byStatus[n.dispatch_status || 'pending'] = (byStatus[n.dispatch_status || 'pending'] || 0) + 1;
  const [finalPurchase] = await base44.asServiceRole.entities.Purchase.filter({ id: pid }).catch(() => []);

  // ── Cleanup ──
  for (const n of final) {
    await base44.asServiceRole.entities.Notification.delete(n.id).catch(() => {});
  }
  await base44.asServiceRole.entities.Purchase.delete(pid).catch(() => {});

  const enqueuePush = afterEnq.push - beforeEnq.push;
  const enqueueEmail = afterEnq.email - beforeEnq.email;
  const dispatchPush = afterDisp.push - afterEnq.push;
  const dispatchEmail = afterDisp.email - afterEnq.email;

  return Response.json({
    phase1_enqueue: {
      concurrent_enqueues: 10,
      notifications_created: created.length,
      push_provider_calls: enqueuePush,
      email_provider_calls: enqueueEmail,
      expected: { push: 0, email: 0 },
      pass: enqueuePush === 0 && enqueueEmail === 0,
    },
    phase2_dispatch: {
      dispatch_result: dispatchRes,
      push_provider_calls: dispatchPush,
      email_provider_calls: dispatchEmail,
      expected: { push: 1, email: 1 },
      pass: dispatchPush === 1 && dispatchEmail === 1,
    },
    final_record_states: byStatus,
    final_purchase_channel_status: {
      seller_push_status: finalPurchase?.seller_push_status,
      seller_email_status: finalPurchase?.seller_email_status,
    },
    overall_pass: enqueuePush === 0 && enqueueEmail === 0 && dispatchPush === 1 && dispatchEmail === 1,
  });
});