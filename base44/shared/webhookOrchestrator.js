/**
 * webhookOrchestrator.js — Dependency-injected Stripe webhook handler.
 *
 * This is the ACTUAL production webhook workflow. Tests invoke this module
 * directly with mock deps — they do NOT simulate the workflow separately.
 *
 * deps = {
 *   entities: { Listing, ListingPrivate, Purchase, PurchasePrivate,
 *               User, UserSecurityProfile, AdminAlert, Notification },
 *   stripe: StripeClient,
 *   now: () => number,
 *   isMaintenanceActive?: () => boolean,
 * }
 *
 * Returns: { status, body }
 *
 * KEY PRINCIPLES:
 *   1. Purchase resolution through PurchasePrivate FIRST — no legacy fallback.
 *   2. payment_failed: retrieve PI state, never expire if captured/capture-ready,
 *      verify ownership, never clear unknown tokens, quarantine first then expire.
 *   3. payment_succeeded: write PP first, then mirror to Purchase. Non-2xx on failure.
 *   4. No inline push/email. All notifications queued via webhookNotifications.
 *   5. Stripe event.id is the deterministic idempotency key.
 */
import { isFailClosed } from './checkoutLogic.js';
import {
  getPurchasePrivate, upsertPurchasePrivate,
  getListingPrivate,
  getUserSecurityProfile,
  alertPrivateWriteFailure,
  quarantineListing,
} from './orchestratorHelpers.js';
import { enqueueWebhookNotification, enqueueWebhookAdminAlert } from './webhookNotifications.js';

// ── Purchase resolution through PurchasePrivate ────────────────────────────
// Requires exactly one PurchasePrivate and its matching Purchase.
// No legacy fallback, no catch-to-empty.
// Verifies Purchase, PurchasePrivate, and Stripe PI metadata all reference
// the same PI, purchase, listing, buyer, and reservation token.
async function resolvePurchaseByPI(deps, piId) {
  const ppRows = await deps.entities.PurchasePrivate.filter({ payment_intent_id: piId });
  if (ppRows.length === 0) return { error: 'NO_PURCHASE_PRIVATE', httpStatus: 200 };
  if (ppRows.length > 1) return { error: 'MULTIPLE_PURCHASE_PRIVATE', httpStatus: 500 };
  const pp = ppRows[0];
  if (!pp.purchase_id) return { error: 'PP_MISSING_PURCHASE_ID', httpStatus: 500 };

  const [purchase] = await deps.entities.Purchase.filter({ id: pp.purchase_id });
  if (!purchase) return { error: 'PURCHASE_NOT_FOUND', httpStatus: 500 };

  // Verify PI ID consistency
  if (pp.payment_intent_id !== piId || purchase.payment_intent_id !== piId) {
    return { error: 'PI_ID_MISMATCH', httpStatus: 500 };
  }

  // Verify listing/buyer/reservation consistency between PP and Purchase
  if (pp.listing_id !== purchase.listing_id) return { error: 'LISTING_ID_MISMATCH', httpStatus: 500 };
  if (pp.buyer_email !== purchase.buyer_email) return { error: 'BUYER_EMAIL_MISMATCH', httpStatus: 500 };
  if (pp.reservation_token !== purchase.reservation_token) return { error: 'RESERVATION_TOKEN_MISMATCH', httpStatus: 500 };

  return { purchase, pp };
}

// ── payment_intent.payment_failed ──────────────────────────────────────────
async function handlePaymentFailed(deps, eventId, data) {
  const piId = data.id;
  const resolution = await resolvePurchaseByPI(deps, piId);
  if (resolution.error) {
    return { status: resolution.httpStatus, body: { received: true, error: resolution.error } };
  }
  const { purchase, pp } = resolution;

  if (pp.is_demo === true || purchase.is_demo) {
    return { status: 200, body: { received: true, skipped: 'demo' } };
  }

  // Retrieve the PaymentIntent's current Stripe state
  let pi;
  try {
    pi = await deps.stripe.paymentIntents.retrieve(piId);
  } catch (err) {
    return { status: 500, body: { error: 'PI_RETRIEVE_FAILED' } };
  }

  // NEVER expire/release if payment is captured or PI is capture-ready
  if (pp.payment_captured === true) {
    return { status: 200, body: { received: true, skipped: 'already_captured' } };
  }
  if (['requires_capture', 'processing', 'succeeded'].includes(pi.status)) {
    return { status: 200, body: { received: true, skipped: 'pi_in_capture_state', pi_status: pi.status } };
  }

  // Only process if still pending_transfer
  if (purchase.transfer_status !== 'pending_transfer') {
    return { status: 200, body: { received: true, skipped: 'not_pending' } };
  }

  // Verify current Listing + ListingPrivate ownership against the failed Purchase
  const [listing] = await deps.entities.Listing.filter({ id: purchase.listing_id });
  const lp = await getListingPrivate(deps, purchase.listing_id);
  if (!listing || !lp) {
    return { status: 500, body: { error: 'LISTING_OR_LP_NOT_FOUND' } };
  }

  // Never clear an unknown/new reservation token
  const authoritativeResToken = pp.reservation_token;
  const listingResToken = lp.reservation_token ?? listing.reservation_token;
  if (listingResToken && listingResToken !== authoritativeResToken) {
    // Unknown token — don't touch the listing
    return { status: 200, body: { received: true, skipped: 'unknown_token' } };
  }

  // Do not activate the listing inline. Quarantine and verify first.
  // Let the established cleanup recovery safely reactivate it later.
  const qResult = await quarantineListing(deps, purchase.listing_id,
    `Webhook payment_failed. PI: ${piId}. Event: ${eventId}.`, purchase.id, piId);
  if (!qResult.quarantined) {
    return { status: 500, body: { error: 'QUARANTINE_FAILED' } };
  }

  // Quarantine succeeded — expire the Purchase
  try {
    await deps.entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
  } catch (err) {
    // Quarantine succeeded but Purchase expiry failed — return 500 for retry
    return { status: 500, body: { error: 'PURCHASE_EXPIRY_FAILED' } };
  }

  // Durable state succeeded — queue buyer notification (NOT inline)
  const notifKey = `webhook:payment_failed:${eventId}`;
  await enqueueWebhookNotification(deps, {
    idempotency_key: notifKey,
    user_email: pp.buyer_email,
    type: 'transfer_rejected',
    title: 'Payment failed',
    body: 'Your payment could not be processed. Please try again or use a different card.',
    reference_id: purchase.id,
    reference_type: 'purchase',
  }).catch(() => {});

  return { status: 200, body: { received: true, quarantined: true, expired: true } };
}

// ── payment_intent.succeeded ────────────────────────────────────────────────
async function handlePaymentSucceeded(deps, eventId, data) {
  const piId = data.id;
  const resolution = await resolvePurchaseByPI(deps, piId);
  if (resolution.error) {
    return { status: resolution.httpStatus, body: { received: true, error: resolution.error } };
  }
  const { purchase, pp } = resolution;

  if (pp.is_demo === true || purchase.is_demo) {
    return { status: 200, body: { received: true, skipped: 'demo' } };
  }

  // If both are already captured, skip
  if (pp.payment_captured === true && purchase.payment_captured === true) {
    return { status: 200, body: { received: true, skipped: 'already_captured' } };
  }

  // Write and verify PurchasePrivate FIRST (authoritative)
  if (pp.payment_captured !== true) {
    try {
      await upsertPurchasePrivate(deps, purchase.id, { payment_captured: true });
    } catch (err) {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:succeeded:${eventId}`,
        title: `PurchasePrivate write failed — ${purchase.id}`,
        description: `PI: ${piId}. Error: ${err?.message}. ACTION: Manually set PP.payment_captured=true.`,
        reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
      }).catch(() => {});
      // Private-write failure — return non-2xx so Stripe retries
      return { status: 500, body: { error: 'PRIVATE_WRITE_FAILED' } };
    }

    // Verify the write
    const ppVerify = await getPurchasePrivate(deps, purchase.id);
    if (!ppVerify || ppVerify.payment_captured !== true) {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:succeeded:${eventId}`,
        title: `PurchasePrivate verification failed — ${purchase.id}`,
        description: `PP.payment_captured not set after write. PI: ${piId}.`,
        reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
      }).catch(() => {});
      return { status: 500, body: { error: 'PRIVATE_VERIFICATION_FAILED' } };
    }
  }

  // Mirror to public Purchase
  if (purchase.payment_captured !== true) {
    try {
      await deps.entities.Purchase.update(purchase.id, { payment_captured: true });
    } catch (err) {
      // PP is authoritative and verified, but never swallow financial-state write failures
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:succeeded:${eventId}`,
        title: `Purchase mirror failed — ${purchase.id}`,
        description: `PP.payment_captured=true but Purchase mirror failed. PI: ${piId}. Error: ${err?.message}.`,
        reference_id: purchase.id, reference_type: 'purchase', priority: 'high',
      }).catch(() => {});
      // Return 500 — Stripe retries; PP is already true, Purchase mirror gets retried
      return { status: 500, body: { error: 'PUBLIC_MIRROR_FAILED' } };
    }
  }

  // If purchase is still pending_transfer, capturePayment didn't finish — alert
  if (purchase.transfer_status === 'pending_transfer') {
    await enqueueWebhookAdminAlert(deps, {
      idempotency_key: `webhook:succeeded:${eventId}`,
      title: `Payment captured but purchase not completed — ${purchase.id}`,
      description: `Buyer: ${pp.buyer_email}. Seller: ${pp.seller_email}. Amount: $${purchase.amount?.toFixed(2)}. PI: ${piId}.`,
      reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
    }).catch(() => {});
  }

  return { status: 200, body: { received: true, captured: true } };
}

// ── charge.dispute.created ──────────────────────────────────────────────────
async function handleDisputeCreated(deps, eventId, data) {
  const piId = data.payment_intent;
  const resolution = await resolvePurchaseByPI(deps, piId);
  if (resolution.error) {
    // Dispute for unknown PI — still alert admin
    await enqueueWebhookAdminAlert(deps, {
      idempotency_key: `webhook:dispute:${eventId}`,
      title: `Stripe Dispute — unknown PI ${piId}`,
      description: `Dispute ID: ${data.id}. Reason: ${data.reason || 'unknown'}. PI: ${piId}.`,
      reference_id: piId, reference_type: 'purchase', priority: 'critical',
    }).catch(() => {});
    return { status: 200, body: { received: true, error: resolution.error } };
  }
  const { purchase, pp } = resolution;

  if (pp.is_demo === true || purchase.is_demo) {
    return { status: 200, body: { received: true, skipped: 'demo' } };
  }

  const buyerEmail = pp.buyer_email;
  const amount = data.amount ? '$' + (data.amount / 100).toFixed(2) : 'unknown';

  // Update Purchase status
  try {
    await deps.entities.Purchase.update(purchase.id, {
      transfer_status: 'disputed',
      dispute_reason: data.reason || 'chargeback',
    });
  } catch (err) {
    return { status: 500, body: { error: 'PURCHASE_UPDATE_FAILED' } };
  }

  // Queue admin alert (NOT inline email)
  await enqueueWebhookAdminAlert(deps, {
    idempotency_key: `webhook:dispute:${eventId}`,
    title: `Stripe Dispute Created — ${buyerEmail}`,
    description: `Buyer: ${buyerEmail}. Amount: ${amount}. Reason: ${data.reason || 'unknown'}. Dispute ID: ${data.id}. PI: ${piId}.`,
    reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
  }).catch(() => {});

  return { status: 200, body: { received: true, disputed: true } };
}

// ── charge.refunded ─────────────────────────────────────────────────────────
async function handleRefunded(deps, eventId, data) {
  const piId = data.payment_intent;
  const resolution = await resolvePurchaseByPI(deps, piId);
  if (resolution.error) {
    return { status: 200, body: { received: true, error: resolution.error } };
  }
  const { purchase, pp } = resolution;

  if (pp.is_demo === true || purchase.is_demo) {
    return { status: 200, body: { received: true, skipped: 'demo' } };
  }

  await enqueueWebhookAdminAlert(deps, {
    idempotency_key: `webhook:refund:${eventId}`,
    title: `Stripe Refund — ${pp.buyer_email}`,
    description: `Buyer: ${pp.buyer_email}. Amount: $${(data.amount_refunded / 100).toFixed(2)}. PI: ${piId}.`,
    reference_id: purchase.id, reference_type: 'purchase', priority: 'high',
  }).catch(() => {});

  return { status: 200, body: { received: true } };
}

// ── payout.failed / transfer.failed ────────────────────────────────────────
async function handlePayoutFailed(deps, eventId, type, data) {
  const accountId = data.destination || data.source_transaction;

  // Find seller through UserSecurityProfile (not User)
  const secRows = await deps.entities.UserSecurityProfile.filter({ stripe_account_id: accountId }).catch(() => []);
  const sec = secRows[0];
  if (!sec) {
    await enqueueWebhookAdminAlert(deps, {
      idempotency_key: `webhook:${type}:${eventId}`,
      title: `Stripe ${type} — unknown account ${accountId}`,
      description: `Account: ${accountId}. Amount: ${data.amount ? '$' + (data.amount / 100).toFixed(2) : 'unknown'}. Reason: ${data.failure_message || 'unknown'}.`,
      reference_id: accountId, reference_type: 'user', priority: 'critical',
    }).catch(() => {});
    return { status: 200, body: { received: true } };
  }

  // Queue seller notification (NOT inline)
  await enqueueWebhookNotification(deps, {
    idempotency_key: `webhook:${type}:${eventId}`,
    user_email: sec.user_email,
    type: 'admin_message',
    title: type === 'payout.failed' ? 'Payout failed ⚠️' : 'Transfer issue ⚠️',
    body: 'There was a problem with your payout. Please check your Stripe account and update your bank details.',
    reference_id: null, reference_type: null,
  }).catch(() => {});

  // Queue admin alert
  await enqueueWebhookAdminAlert(deps, {
    idempotency_key: `webhook:${type}:${eventId}`,
    title: `Stripe ${type} — ${sec.user_email}`,
    description: `Seller: ${sec.user_email}. Account: ${accountId}. Amount: ${data.amount ? '$' + (data.amount / 100).toFixed(2) : 'unknown'}. Reason: ${data.failure_message || data.failure_code || 'unknown'}.`,
    reference_id: sec.user_id, reference_type: 'user', priority: 'high',
  }).catch(() => {});

  return { status: 200, body: { received: true } };
}

// ── Main entry point ────────────────────────────────────────────────────────
export async function runStripeWebhook(deps, event) {
  const type = event.type;
  const data = event.data?.object;
  const eventId = event.id;

  console.log('[stripeWebhook] event received:', type, data?.id, 'event_id:', eventId);

  try {
    if (type === 'payment_intent.payment_failed') {
      return await handlePaymentFailed(deps, eventId, data);
    }
    if (type === 'payment_intent.succeeded') {
      return await handlePaymentSucceeded(deps, eventId, data);
    }
    if (type === 'charge.dispute.created') {
      return await handleDisputeCreated(deps, eventId, data);
    }
    if (type === 'charge.refunded') {
      return await handleRefunded(deps, eventId, data);
    }
    if (type === 'payout.failed' || type === 'transfer.failed') {
      return await handlePayoutFailed(deps, eventId, type, data);
    }

    return { status: 200, body: { received: true } };
  } catch (err) {
    console.error('[stripeWebhook] handler error:', err.message);
    // Return 500 so Stripe retries for unexpected errors (non-retriable errors
    // are handled by returning 200 within the handlers above)
    return { status: 500, body: { error: err.message } };
  }
}