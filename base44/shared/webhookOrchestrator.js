/**
 * webhookOrchestrator.js — Dependency-injected Stripe webhook handler.
 *
 * 7C.9B: Fixed payment_succeeded, payment_failed, dispute, and payout handlers.
 *
 * deps = {
 *   entities: { Listing, ListingPrivate, Purchase, PurchasePrivate,
 *               User, UserSecurityProfile, AdminAlert, Notification },
 *   stripe: StripeClient,
 *   now: () => number,
 *   isMaintenanceActive?: () => boolean,
 * }
 * Returns: { status, body }
 *
 * KEY PRINCIPLES:
 *   1. Purchase resolution through PurchasePrivate FIRST — no legacy fallback.
 *   2. payment_succeeded: retrieve live PI, require succeeded, verify exact
 *      metadata + amount + currency + destination, invoke reconcileCapturedPayment.
 *   3. payment_failed: retrieve PI, if captured/capture-ready skip, cancel with
 *      idempotency key, re-retrieve and require canceled, only then expire.
 *      Quarantine listing. Preserve newer/split-brain reservations.
 *   4. charge.dispute.created: mirror dispute_reason to PP BEFORE Purchase.
 *   5. payout.failed: use event.account (top-level), not data.destination.
 *   6. Required alert persistence failures return non-2xx.
 *   7. No inline push/email — all notifications queued via webhookNotifications.
 */
import { isFailClosed } from './checkoutLogic.js';
import {
  getPurchasePrivate, upsertPurchasePrivate,
  getListingPrivate,
  getUserSecurityProfile,
  alertPrivateWriteFailure,
  quarantineListing,
} from './orchestratorHelpers.js';
import { reconcileCapturedPayment } from './captureReconciliation.js';
import { enqueueWebhookNotification, enqueueWebhookAdminAlert } from './webhookNotifications.js';

function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}

// ── Purchase resolution through PurchasePrivate ────────────────────────────
async function resolvePurchaseByPI(deps, piId) {
  const ppRows = await deps.entities.PurchasePrivate.filter({ payment_intent_id: piId });
  if (ppRows.length === 0) return { error: 'NO_PURCHASE_PRIVATE', httpStatus: 200 };
  if (ppRows.length > 1) return { error: 'MULTIPLE_PURCHASE_PRIVATE', httpStatus: 500 };
  const pp = ppRows[0];
  if (!pp.purchase_id) return { error: 'PP_MISSING_PURCHASE_ID', httpStatus: 500 };

  const [purchase] = await deps.entities.Purchase.filter({ id: pp.purchase_id });
  if (!purchase) return { error: 'PURCHASE_NOT_FOUND', httpStatus: 500 };

  if (pp.payment_intent_id !== piId || purchase.payment_intent_id !== piId) {
    return { error: 'PI_ID_MISMATCH', httpStatus: 500 };
  }
  if (pp.listing_id !== purchase.listing_id) return { error: 'LISTING_ID_MISMATCH', httpStatus: 500 };
  if (pp.buyer_email !== purchase.buyer_email) return { error: 'BUYER_EMAIL_MISMATCH', httpStatus: 500 };
  if (pp.reservation_token !== purchase.reservation_token) return { error: 'RESERVATION_TOKEN_MISMATCH', httpStatus: 500 };

  return { purchase, pp };
}

// ── Verify live PI metadata against PP ──────────────────────────────────────
function verifyPIMetadata(pi, purchase, pp) {
  const md = pi.metadata || {};
  if (!md.purchase_id || md.purchase_id !== purchase.id) return false;
  if (!md.listing_id || md.listing_id !== pp.listing_id) return false;
  if (!md.buyer_email || md.buyer_email !== pp.buyer_email) return false;
  if (!md.seller_email || md.seller_email !== pp.seller_email) return false;
  if (!md.reservation_token || md.reservation_token !== pp.reservation_token) return false;
  return true;
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

  // ── 1. Retrieve the live PI ────────────────────────────────────────────────
  let pi;
  try {
    pi = await deps.stripe.paymentIntents.retrieve(piId);
  } catch (err) {
    return { status: 500, body: { error: 'PI_RETRIEVE_FAILED' } };
  }

  // ── 2. Verify exact PI metadata ────────────────────────────────────────────
  if (!verifyPIMetadata(pi, purchase, pp)) {
    return { status: 200, body: { received: true, skipped: 'metadata_mismatch' } };
  }

  // ── 3. If PI is capture-ready or already captured, do NOT expire ──────────
  if (pp.payment_captured === true) {
    return { status: 200, body: { received: true, skipped: 'already_captured' } };
  }
  if (['requires_capture', 'processing', 'succeeded'].includes(pi.status)) {
    return { status: 200, body: { received: true, skipped: 'pi_in_capture_state', pi_status: pi.status } };
  }

  // ── 4. Only process if still pending_transfer ─────────────────────────────
  if (purchase.transfer_status !== 'pending_transfer') {
    return { status: 200, body: { received: true, skipped: 'not_pending' } };
  }

  // ── 5. For cancelable failed statuses, cancel PI with idempotency key ─────
  if (pi.status === 'requires_payment_method' || pi.status === 'requires_action') {
    let cancelVerified = false;
    try {
      const canceled = await deps.stripe.paymentIntents.cancel(piId, {
        idempotencyKey: `cancel-${piId}-${eventId}`,
      });
      cancelVerified = canceled.status === 'canceled';
    } catch (err) {
      try {
        const retrieved = await deps.stripe.paymentIntents.retrieve(piId);
        cancelVerified = retrieved.status === 'canceled';
      } catch (_) { cancelVerified = false; }
    }

    // ── 6. Re-retrieve and require status === 'canceled' ──────────────────────
    if (!cancelVerified) {
      try {
        await enqueueWebhookAdminAlert(deps, {
          idempotency_key: `webhook:cancel_failed:${eventId}`,
          title: `PI cancel failed — ${piId}`,
          description: `Cancel could not be verified. PI: ${piId}. Purchase: ${purchase.id}. Manual cancellation required.`,
          reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
        });
      } catch (alertErr) {
        return { status: 500, body: { error: 'CANCEL_AND_ALERT_FAILED' } };
      }
      return { status: 500, body: { error: 'CANCEL_NOT_VERIFIED' } };
    }
  }

  // ── 7. Verify current Listing + ListingPrivate ownership ───────────────────
  const [listing] = await deps.entities.Listing.filter({ id: purchase.listing_id });
  const lp = await getListingPrivate(deps, purchase.listing_id);
  if (!listing || !lp) {
    return { status: 500, body: { error: 'LISTING_OR_LP_NOT_FOUND' } };
  }

  // ── 8. Modify listing only when Listing and LP both match PP ───────────────
  const tokenMatch = lp.reservation_token === pp.reservation_token && listing.reservation_token === pp.reservation_token;
  const buyerMatch = lp.reserved_by_email === pp.buyer_email && listing.reserved_by_email === pp.buyer_email;
  const lpExpiry = lp.reservation_expires_at ? new Date(lp.reservation_expires_at).getTime() : 0;
  const listingExpiry = listing.reservation_expires_at ? new Date(listing.reservation_expires_at).getTime() : 0;
  const expiryMatch = lpExpiry === listingExpiry;

  if (!tokenMatch || !buyerMatch || !expiryMatch) {
    // ── 9. Newer or split-brain reservation — preserve it ─────────────────────
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:split_brain:${eventId}`,
        title: `Split-brain reservation preserved — ${purchase.listing_id}`,
        description: `payment_failed for PI ${piId} but Listing/LP reservation differs from PP. Token match: ${tokenMatch}, buyer match: ${buyerMatch}, expiry match: ${expiryMatch}. Newer reservation preserved. Manual review required.`,
        reference_id: purchase.listing_id, reference_type: 'listing', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
    }
    // Still expire the Purchase since cancellation was verified
    try {
      await deps.entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
    } catch (err) {
      return { status: 500, body: { error: 'PURCHASE_EXPIRY_FAILED' } };
    }
    return { status: 200, body: { received: true, expired: true, split_brain_preserved: true } };
  }

  // ── 10. Quarantine rather than activate the listing ────────────────────────
  const qResult = await quarantineListing(deps, purchase.listing_id,
    `Webhook payment_failed. PI: ${piId}. Event: ${eventId}.`, purchase.id, piId);
  if (!qResult.quarantined) {
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:quarantine_failed:${eventId}`,
        title: `Quarantine failed — ${purchase.listing_id}`,
        description: `Quarantine write failed for payment_failed. PI: ${piId}. Purchase: ${purchase.id}. Manual resolution required.`,
        reference_id: purchase.listing_id, reference_type: 'listing', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
    }
    return { status: 500, body: { error: 'QUARANTINE_FAILED' } };
  }

  // ── 11. Quarantine succeeded — expire the Purchase ─────────────────────────
  try {
    await deps.entities.Purchase.update(purchase.id, { transfer_status: 'expired' });
  } catch (err) {
    return { status: 500, body: { error: 'PURCHASE_EXPIRY_FAILED' } };
  }

  // ── 12. Queue buyer in-app notification (no external push/email) ────────────
  const notifKey = `webhook:payment_failed:${eventId}`;
  try {
    await enqueueWebhookNotification(deps, {
      idempotency_key: notifKey,
      user_email: pp.buyer_email,
      type: 'transfer_rejected',
      title: 'Payment failed',
      body: 'Your payment could not be processed. Please try again or use a different card.',
      reference_id: purchase.id,
      reference_type: 'purchase',
    });
  } catch (err) { /* notification failure must not break the webhook */ }

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

  // ── 1. Retrieve the live PaymentIntent from Stripe ─────────────────────────
  let pi;
  try {
    pi = await deps.stripe.paymentIntents.retrieve(piId);
  } catch (err) {
    return { status: 500, body: { error: 'PI_RETRIEVE_FAILED' } };
  }

  // ── 2. Require status === 'succeeded' ──────────────────────────────────────
  if (pi.status !== 'succeeded') {
    return { status: 200, body: { received: true, skipped: 'pi_not_succeeded', pi_status: pi.status } };
  }

  // ── 3. Verify exact metadata against PurchasePrivate ───────────────────────
  if (!verifyPIMetadata(pi, purchase, pp)) {
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:succeeded_mismatch:${eventId}`,
        title: `Succeeded event metadata mismatch — ${piId}`,
        description: `PI ${piId} succeeded but metadata does not match PP for purchase ${purchase.id}. No financial-state writes performed. Manual review required.`,
        reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
    }
    return { status: 200, body: { received: true, skipped: 'metadata_mismatch' } };
  }

  // ── 4. Verify amount, currency, and exact destination ─────────────────────
  const expectedSubtotal = Math.round((purchase.subtotal || 0) * 100) / 100;
  const expectedFee = calcPlatformFee(expectedSubtotal);
  const expectedTotal = Math.round((expectedSubtotal + expectedFee) * 100) / 100;
  const expectedCents = Math.round(expectedTotal * 100);
  if (pi.amount !== expectedCents || (pi.currency || 'usd') !== 'usd') {
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:succeeded_amount:${eventId}`,
        title: `Succeeded event amount mismatch — ${piId}`,
        description: `PI amount ${pi.amount} vs expected ${expectedCents}. Purchase: ${purchase.id}. No writes performed.`,
        reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
    }
    return { status: 200, body: { received: true, skipped: 'amount_mismatch' } };
  }

  // Verify destination
  const sellerSec = await getUserSecurityProfile(deps, { user_email: pp.seller_email });
  if (!sellerSec || !sellerSec.stripe_account_id) {
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:succeeded_no_dest:${eventId}`,
        title: `Succeeded event — no seller Stripe account — ${piId}`,
        description: `Purchase ${purchase.id} succeeded but seller has no stripe_account_id. Manual review required.`,
        reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
    }
    return { status: 200, body: { received: true, skipped: 'no_seller_account' } };
  }
  if (!pi.transfer_data?.destination || pi.transfer_data.destination !== sellerSec.stripe_account_id) {
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:succeeded_dest_mismatch:${eventId}`,
        title: `Succeeded event destination mismatch — ${piId}`,
        description: `PI destination ${pi.transfer_data?.destination} vs seller account ${sellerSec.stripe_account_id}. Purchase: ${purchase.id}. No writes performed.`,
        reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
    }
    return { status: 200, body: { received: true, skipped: 'destination_mismatch' } };
  }

  // ── 5. Invoke the captured-payment reconciliation state machine ─────────────
  const result = await reconcileCapturedPayment(deps, purchase, pp, pi);

  // ── 6. Return non-2xx on any failure ───────────────────────────────────────
  if (!result.ok) {
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:succeeded_reconcile:${eventId}`,
        title: `Reconciliation failed at step ${result.step} — ${purchase.id}`,
        description: `PI ${piId} succeeded but reconciliation failed at step: ${result.step}. Error: ${result.error}. Retry will converge. Manual review if persists.`,
        reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'RECONCILE_AND_ALERT_FAILED' } };
    }
    return { status: 500, body: { error: 'RECONCILE_FAILED', step: result.step } };
  }

  return { status: 200, body: { received: true, captured: true } };
}

// ── charge.dispute.created ──────────────────────────────────────────────────
async function handleDisputeCreated(deps, eventId, data) {
  const piId = data.payment_intent;
  const resolution = await resolvePurchaseByPI(deps, piId);
  if (resolution.error) {
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:dispute:${eventId}`,
        title: `Stripe Dispute — unknown PI ${piId}`,
        description: `Dispute ID: ${data.id}. Reason: ${data.reason || 'unknown'}. PI: ${piId}.`,
        reference_id: piId, reference_type: 'purchase', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
    }
    return { status: 200, body: { received: true, error: resolution.error } };
  }
  const { purchase, pp } = resolution;

  if (pp.is_demo === true || purchase.is_demo) {
    return { status: 200, body: { received: true, skipped: 'demo' } };
  }

  const disputeReason = data.reason || 'chargeback';

  // ── Mirror dispute_reason to PurchasePrivate BEFORE Purchase ────────────────
  try {
    await upsertPurchasePrivate(deps, purchase.id, { dispute_reason: disputeReason });
  } catch (err) {
    await alertPrivateWriteFailure(deps, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
    return { status: 500, body: { error: 'PP_DISPUTE_MIRROR_FAILED' } };
  }

  // Update Purchase status
  try {
    await deps.entities.Purchase.update(purchase.id, {
      transfer_status: 'disputed',
      dispute_reason: disputeReason,
    });
  } catch (err) {
    return { status: 500, body: { error: 'PURCHASE_UPDATE_FAILED' } };
  }

  // Queue admin alert
  try {
    await enqueueWebhookAdminAlert(deps, {
      idempotency_key: `webhook:dispute:${eventId}`,
      title: `Stripe Dispute Created — ${pp.buyer_email}`,
      description: `Buyer: ${pp.buyer_email}. Reason: ${disputeReason}. Dispute ID: ${data.id}. PI: ${piId}.`,
      reference_id: purchase.id, reference_type: 'purchase', priority: 'critical',
    });
  } catch (alertErr) {
    return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
  }

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

  try {
    await enqueueWebhookAdminAlert(deps, {
      idempotency_key: `webhook:refund:${eventId}`,
      title: `Stripe Refund — ${pp.buyer_email}`,
      description: `Buyer: ${pp.buyer_email}. Amount: $${(data.amount_refunded / 100).toFixed(2)}. PI: ${piId}.`,
      reference_id: purchase.id, reference_type: 'purchase', priority: 'high',
    });
  } catch (alertErr) {
    return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
  }

  return { status: 200, body: { received: true } };
}

// ── payout.failed / transfer.failed ────────────────────────────────────────
// Uses event.account (top-level) — NOT data.destination or source_transaction
async function handlePayoutFailed(deps, eventId, type, data, eventAccount) {
  const accountId = eventAccount;

  if (!accountId) {
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:${type}:${eventId}`,
        title: `Stripe ${type} — no account ID`,
        description: `Event has no top-level account. Amount: ${data.amount ? '$' + (data.amount / 100).toFixed(2) : 'unknown'}. Reason: ${data.failure_message || 'unknown'}.`,
        reference_id: eventId, reference_type: 'user', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
    }
    return { status: 200, body: { received: true, skipped: 'no_account' } };
  }

  const secRows = await deps.entities.UserSecurityProfile.filter({ stripe_account_id: accountId }).catch(() => []);
  const sec = secRows[0];
  if (!sec) {
    try {
      await enqueueWebhookAdminAlert(deps, {
        idempotency_key: `webhook:${type}:${eventId}`,
        title: `Stripe ${type} — unknown account ${accountId}`,
        description: `Account: ${accountId}. Amount: ${data.amount ? '$' + (data.amount / 100).toFixed(2) : 'unknown'}. Reason: ${data.failure_message || 'unknown'}.`,
        reference_id: accountId, reference_type: 'user', priority: 'critical',
      });
    } catch (alertErr) {
      return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
    }
    return { status: 200, body: { received: true } };
  }

  // Queue seller in-app notification (no external push/email)
  try {
    await enqueueWebhookNotification(deps, {
      idempotency_key: `webhook:${type}:${eventId}`,
      user_email: sec.user_email,
      type: 'admin_message',
      title: type === 'payout.failed' ? 'Payout failed ⚠️' : 'Transfer issue ⚠️',
      body: 'There was a problem with your payout. Please check your Stripe account and update your bank details.',
      reference_id: null, reference_type: null,
    });
  } catch (err) { /* notification failure must not break the webhook */ }

  // Queue admin alert
  try {
    await enqueueWebhookAdminAlert(deps, {
      idempotency_key: `webhook:${type}:${eventId}`,
      title: `Stripe ${type} — ${sec.user_email}`,
      description: `Seller: ${sec.user_email}. Account: ${accountId}. Amount: ${data.amount ? '$' + (data.amount / 100).toFixed(2) : 'unknown'}. Reason: ${data.failure_message || data.failure_code || 'unknown'}.`,
      reference_id: sec.user_id, reference_type: 'user', priority: 'high',
    });
  } catch (alertErr) {
    return { status: 500, body: { error: 'ALERT_PERSISTENCE_FAILED' } };
  }

  return { status: 200, body: { received: true } };
}

// ── Main entry point ────────────────────────────────────────────────────────
export async function runStripeWebhook(deps, event) {
  const type = event.type;
  const data = event.data?.object;
  const eventId = event.id;
  const eventAccount = event.account;

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
      return await handlePayoutFailed(deps, eventId, type, data, eventAccount);
    }

    return { status: 200, body: { received: true } };
  } catch (err) {
    return { status: 500, body: { error: err.message } };
  }
}