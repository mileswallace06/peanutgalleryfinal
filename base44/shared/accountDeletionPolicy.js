/**
 * Conservative, side-effect-free account-deletion policy.
 *
 * Base44 does not provide a transaction spanning all of the entities touched by
 * account removal. The caller must therefore run this policy against a complete
 * read snapshot before making any write and stop on every unknown state.
 */

const TERMINAL_PURCHASE_STATES = new Set(['completed', 'expired']);
const TERMINAL_LISTING_STATES = new Set(['sold', 'cancelled', 'expired']);
const TERMINAL_RESERVATION_STATES = new Set(['sold', 'cancelled', 'expired']);
const ACTIVE_FULFILLMENT_STATES = new Set([
  'awaiting_pg_transfer',
  'transfer_in_progress',
  'issue_reported',
]);
const KNOWN_FULFILLMENT_STATES = new Set([
  ...ACTIVE_FULFILLMENT_STATES,
  'fulfilled',
  'buyer_confirmed',
]);
const ACTIVE_TICKET_CUSTODY_STATES = new Set(['pending', 'received']);
const KNOWN_TICKET_CUSTODY_STATES = new Set([
  'not_received',
  ...ACTIVE_TICKET_CUSTODY_STATES,
  'delivered_to_buyer',
  'returned_to_seller',
  'failed',
  'expired',
]);
const KNOWN_CUSTODY_STATES = new Set(['none', 'pending_pg_verification', 'verified', 'rejected']);

function indexBy(rows, key) {
  return new Map((rows || []).filter(Boolean).map(row => [row?.[key], row]));
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function hasPendingEffects(value) {
  if (!hasValue(value)) return false;
  if (typeof value !== 'string') return true;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed);
  } catch (_) {
    return true;
  }
}

function addBlocker(blockers, code, resource, record) {
  blockers.push({
    code,
    resource,
    record_id: record?.id || record?.purchase_id || record?.listing_id || null,
  });
}

/**
 * Returns a conservative decision. Unknown, contradictory, or incomplete state
 * is a blocker; callers must never interpret it as safe.
 */
export function evaluateAccountDeletion(snapshot = {}) {
  const targetEmail = String(snapshot.targetEmail || '').trim().toLowerCase();
  const purchases = snapshot.purchases || [];
  const purchasePrivates = snapshot.purchasePrivates || [];
  const listings = snapshot.listings || [];
  const listingPrivates = snapshot.listingPrivates || [];
  const unresolvedAlerts = snapshot.unresolvedAlerts || [];
  const ownedListingIds = new Set(snapshot.ownedListingIds || []);

  const purchaseById = indexBy(purchases, 'id');
  const purchasePrivateByPurchaseId = indexBy(purchasePrivates, 'purchase_id');
  const listingById = indexBy(listings, 'id');
  const listingPrivateByListingId = indexBy(listingPrivates, 'listing_id');
  const blockers = [];

  for (const purchase of purchases) {
    const pp = purchasePrivateByPurchaseId.get(purchase.id);
    const isDemo = pp?.is_demo ?? purchase.is_demo;
    const transferStatus = purchase.transfer_status;
    const paymentCaptured = pp?.payment_captured ?? purchase.payment_captured;
    const paymentCaptureFailed = pp?.payment_capture_failed ?? purchase.payment_capture_failed;
    const fulfillmentStatus = pp?.fulfillment_status ?? purchase.fulfillment_status;

    if (!pp) {
      addBlocker(blockers, 'PURCHASE_PRIVATE_MISSING', 'purchase', purchase);
    }
    if (!TERMINAL_PURCHASE_STATES.has(transferStatus)) {
      addBlocker(
        blockers,
        transferStatus === 'disputed' ? 'OPEN_DISPUTE' :
          transferStatus === 'pending_transfer' ? 'ACTIVE_PURCHASE_TRANSFER' : 'UNKNOWN_PURCHASE_STATE',
        'purchase',
        purchase,
      );
    }

    if (paymentCaptureFailed === true) {
      addBlocker(blockers, 'PAYMENT_REQUIRES_REVIEW', 'purchase', purchase);
    }
    if (transferStatus === 'completed' && isDemo !== true && paymentCaptured !== true) {
      addBlocker(blockers, 'COMPLETED_PAYMENT_NOT_VERIFIED', 'purchase', purchase);
    }
    if (transferStatus === 'completed' && isDemo !== true && targetEmail &&
        String(pp?.seller_email ?? purchase.seller_email ?? '').trim().toLowerCase() === targetEmail) {
      // Purchase has no durable seller-payout settlement marker. Do not infer
      // settlement merely from capture/transfer completion.
      addBlocker(blockers, 'SELLER_PAYOUT_SETTLEMENT_UNVERIFIED', 'purchase', purchase);
    }
    if (transferStatus === 'expired' && paymentCaptured === true) {
      // There is no durable refund-status field in the current Purchase schema.
      addBlocker(blockers, 'CAPTURED_PAYMENT_REFUND_UNKNOWN', 'purchase', purchase);
    }
    if (hasValue(fulfillmentStatus)) {
      if (ACTIVE_FULFILLMENT_STATES.has(fulfillmentStatus)) {
        addBlocker(blockers, 'ACTIVE_FULFILLMENT', 'purchase', purchase);
      } else if (!KNOWN_FULFILLMENT_STATES.has(fulfillmentStatus)) {
        addBlocker(blockers, 'UNKNOWN_FULFILLMENT_STATE', 'purchase', purchase);
      }
    }
    if ((pp?.finalization_started_at && !pp?.freeze_finalized_at) ||
        (pp?.frozen_reservation_token && !pp?.freeze_finalized_at)) {
      addBlocker(blockers, 'PAYMENT_FINALIZATION_INCOMPLETE', 'purchase', purchase);
    }
    if ((pp?.auto_review_flagged ?? purchase.auto_review_flagged) === true) {
      addBlocker(blockers, 'PURCHASE_REVIEW_OPEN', 'purchase', purchase);
    }

    if (!purchase.listing_id || !listingById.has(purchase.listing_id)) {
      addBlocker(blockers, 'PURCHASE_LISTING_MISSING', 'purchase', purchase);
    }
  }

  for (const pp of purchasePrivates) {
    if (!pp.purchase_id || !purchaseById.has(pp.purchase_id)) {
      addBlocker(blockers, 'PURCHASE_PRIVATE_ORPHANED', 'purchase_private', pp);
    }
  }

  for (const listingId of ownedListingIds) {
    const listing = listingById.get(listingId);
    if (!listing) {
      addBlocker(blockers, 'OWNED_LISTING_MISSING', 'listing', { id: listingId });
      continue;
    }

    const lp = listingPrivateByListingId.get(listing.id);
    if (!lp) {
      addBlocker(blockers, 'LISTING_PRIVATE_MISSING', 'listing', listing);
    }
    if (!TERMINAL_LISTING_STATES.has(listing.status)) {
      addBlocker(blockers, 'ACTIVE_OR_UNKNOWN_LISTING', 'listing', listing);
    }
    if (listing.status === 'sold' && !purchases.some(purchase => purchase.listing_id === listing.id)) {
      addBlocker(blockers, 'SOLD_LISTING_PURCHASE_MISSING', 'listing', listing);
    }

    const reservationFields = [
      listing.reservation_token,
      listing.reserved_by_email,
      listing.reservation_expires_at,
      lp?.reservation_token,
      lp?.reserved_by_email,
      lp?.reservation_expires_at,
    ];
    if (reservationFields.some(hasValue)) {
      addBlocker(blockers, 'ACTIVE_RESERVATION', 'listing', listing);
    }
    if (hasValue(listing.reservation_mirror_state) &&
        !TERMINAL_RESERVATION_STATES.has(listing.reservation_mirror_state)) {
      addBlocker(blockers, 'NONTERMINAL_RESERVATION_MIRROR', 'listing', listing);
    }
    if (hasValue(lp?.reservation_lifecycle_state) &&
        !TERMINAL_RESERVATION_STATES.has(lp.reservation_lifecycle_state)) {
      addBlocker(blockers, 'NONTERMINAL_RESERVATION_AUTHORITY', 'listing', listing);
    }
    if (hasPendingEffects(lp?.pending_effects_json)) {
      addBlocker(blockers, 'RESERVATION_EFFECTS_PENDING', 'listing', listing);
    }
    if (lp?.checkout_quarantined === true || lp?.recovery_blocked === true) {
      addBlocker(blockers, 'LISTING_REQUIRES_REVIEW', 'listing', listing);
    }

    const ticketCustodyStatus = lp?.ticket_custody_status ?? listing.ticket_custody_status;
    const custodyStatus = lp?.custody_status ?? listing.custody_status;
    if (hasValue(ticketCustodyStatus)) {
      if (ACTIVE_TICKET_CUSTODY_STATES.has(ticketCustodyStatus)) {
        addBlocker(blockers, 'ACTIVE_TICKET_CUSTODY', 'listing', listing);
      } else if (!KNOWN_TICKET_CUSTODY_STATES.has(ticketCustodyStatus)) {
        addBlocker(blockers, 'UNKNOWN_TICKET_CUSTODY', 'listing', listing);
      }
    }
    if (hasValue(custodyStatus)) {
      if (custodyStatus === 'pending_pg_verification') {
        addBlocker(blockers, 'CUSTODY_VERIFICATION_PENDING', 'listing', listing);
      } else if (!KNOWN_CUSTODY_STATES.has(custodyStatus)) {
        addBlocker(blockers, 'UNKNOWN_CUSTODY_STATE', 'listing', listing);
      }
    }
  }

  for (const lp of listingPrivates) {
    if (!lp.listing_id || !listingById.has(lp.listing_id)) {
      addBlocker(blockers, 'LISTING_PRIVATE_ORPHANED', 'listing_private', lp);
    }
  }

  for (const alert of unresolvedAlerts) {
    addBlocker(blockers, 'UNRESOLVED_OPERATIONAL_ALERT', 'admin_alert', alert);
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    retainedListingIds: [...new Set(purchases.map(p => p.listing_id).filter(Boolean))],
  };
}

export async function createAccountPseudonym(email, userId) {
  const source = `${userId || 'unknown'}\u0000${String(email || '').trim().toLowerCase()}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const token = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  return `deleted+${token}@account.invalid`;
}

export class CriticalDeletionError extends Error {
  constructor(step, completedSteps, cause) {
    super('A critical account-removal step failed');
    this.name = 'CriticalDeletionError';
    this.code = 'ACCOUNT_REMOVAL_INCOMPLETE';
    this.step = step;
    this.completedSteps = completedSteps;
    this.cause = cause;
  }
}

/** Runs critical writes in a deterministic order and never masks a failure. */
export async function runCriticalDeletionSteps(steps) {
  const completedSteps = [];
  for (const { name, run } of steps) {
    try {
      await run();
      completedSteps.push(name);
    } catch (error) {
      throw new CriticalDeletionError(name, completedSteps, error);
    }
  }
  return completedSteps;
}
