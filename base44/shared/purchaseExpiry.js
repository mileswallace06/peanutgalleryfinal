import { verifyPaymentRelease } from './paymentRelease.js';
import { verifyCleanupReservation } from './checkoutLogic.js';
import { requireMission1Authority, hashReservationToken } from './mission1Authority.js';

const failure = (code, details = {}) => ({ status: 500, body: { ok: false, code, ...details } });
const tuple = row => Object.fromEntries(['reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'].map(k => [k, row[k] ?? null]));
const one = async (entity, query) => {
  const rows = await entity.filter(query);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('RECORD_MISSING_OR_DUPLICATED');
  return { ...rows[0] };
};
// Complete bounded reads: a default first page is not proof of no obligation.
export async function readCleanupRows(entity, query) {
  const rows = [];
  for (let skip = 0; skip < 10000; skip += 100) {
    const page = await entity.filter(query, 'created_date', 100, skip);
    if (!Array.isArray(page)) throw new Error('CLEANUP_LOOKUP_UNPROVEN');
    rows.push(...page);
    if (page.length < 100) return rows;
  }
  throw new Error('CLEANUP_SCAN_LIMIT_REQUIRES_REVIEW');
}

/** Purchase settlement is authoritative only in Postgres. Base44 is an
 * outbox projection. Legacy Base44 claims are never used as exclusive locks.
 * recover=true permits fenced read-only reconciliation of a dispatched action;
 * it never re-dispatches an ambiguous provider command.
 */
export async function expirePurchaseSafely(deps, purchaseId, { allowRefund = false, sellerExpiry = false, recover = false } = {}) {
  const { entities } = deps;
  let authority, lease, owner;
  try {
    authority = requireMission1Authority(deps);
    let durable = await authority.context(purchaseId);
    if (durable.context?.phase === 'completed') {
      return { status: 200, body: { ok: true, status: 'expired', already_completed: true } };
    }
    if (durable.context?.phase === 'committed') return await finishProjection(deps, authority, durable.context);
    const purchase = await one(entities.Purchase, { id: purchaseId });
    const pp = await one(entities.PurchasePrivate, { purchase_id: purchaseId });
    if (pp.cleanup_claim && !pp.cleanup_completed_at && !deps.legacyWorkersFenced) {
      throw new Error('LEGACY_WORKER_FENCING_REQUIRED');
    }
    if (pp.listing_id !== purchase.listing_id || !pp.reservation_token || !pp.buyer_email) throw new Error('PURCHASE_IDENTITY_UNPROVEN');
    const listing = await one(entities.Listing, { id: pp.listing_id });
    const lp = await one(entities.ListingPrivate, { listing_id: pp.listing_id });
    if (/\[AUTH_CANARY\]/.test(listing.notes || '')) throw new Error('CANARY_AUTHORITY_REQUIRED');
    if (purchase.seller_confirmed || !['pending_transfer', 'expired'].includes(purchase.transfer_status)) throw new Error('FULFILLMENT_REQUIRES_REVIEW');
    const now = (deps.now || Date.now)();
    if (sellerExpiry && (!Number.isFinite(Date.parse(purchase.created_date)) || now - Date.parse(purchase.created_date) < 48 * 3600000)) throw new Error('SELLER_NOT_EXPIRED');
    let snapshot = durable.context?.snapshot;
    if (!snapshot) {
      const effective = listing.status === 'hidden' && lp.checkout_quarantined ? { ...listing, status: 'pending_transfer' } : listing;
      if (!verifyCleanupReservation(effective, lp, pp.reservation_token, pp.buyer_email) ||
          !listing.reservation_revision || listing.reservation_revision !== lp.reservation_revision ||
          (listing.linked_purchase_id && listing.linked_purchase_id !== purchaseId)) throw new Error('RESERVATION_OWNERSHIP_CHANGED');
      if (lp.seller_pause_requested_at || lp.seller_cancel_requested_at) throw new Error('SELLER_INTENT_REQUIRES_REVIEW');
      const pending = await readCleanupRows(entities.Purchase, { listing_id: pp.listing_id, transfer_status: 'pending_transfer' });
      if (pending.some(p => p.id !== purchaseId)) throw new Error('ANOTHER_ACTIVE_PURCHASE');
      snapshot = { ...tuple(listing), token_hash: await hashReservationToken(pp.reservation_token),
        listing_private_id: lp.id, purchase_private_id: pp.id, buyer_email: pp.buyer_email,
        listing_status: listing.status, purchase_id: purchaseId, listing_id: pp.listing_id, payment_intent_id: pp.payment_intent_id };
    }
    owner = crypto.randomUUID();
    lease = await authority.prepare(pp, snapshot, owner, recover);
    if (['committed', 'completed'].includes(lease.context?.phase)) return await finishProjection(deps, authority, lease.context);
    if (!lease.context || lease.owner !== owner || !Number.isSafeInteger(Number(lease.epoch))) throw new Error('CLAIM_NOT_PERSISTED');
    const settlement = await verifyPaymentRelease(deps.stripe, pp.payment_intent_id, {
      allowRefund, readOnly: lease.dispatched,
      beforeAction: kind => authority.dispatch(purchaseId, owner, lease.epoch, kind),
    });
    await deps.hooks?.afterSettlementVerified?.();
    // SQL rechecks authoritative fulfillment and binding under its row lock.
    // These Base44 checks are additional mirror-drift detection, never exclusion.
    const current = await one(entities.Purchase, { id: purchaseId });
    if (current.seller_confirmed || !['pending_transfer', 'expired'].includes(current.transfer_status)) throw new Error('FULFILLMENT_CHANGED');
    const committed = await authority.commit(purchaseId, owner, lease.epoch, settlement);
    await deps.hooks?.afterAuthorityCommit?.();
    return await finishProjection(deps, authority, committed.context);
  } catch (error) {
    let protection;
    if (lease?.context && owner) {
      try {
        protection = await authority.fail(purchaseId, owner, lease.epoch, error.message);
        await deps.projectFailure?.(lease.context);
      }
      catch { /* Claim/evidence remain durable; no false resolution or redispatch. */ }
    }
    return failure(error.message, { purchase_id: purchaseId, block_proven: protection?.block_proven === true, alert_proven: protection?.alert_proven === true });
  }
}

async function finishProjection(deps, authority, context) {
  if (context.phase === 'completed') return { status: 200, body: { ok: true, status: 'expired', already_completed: true } };
  // Settlement is re-read even after commit: a completion marker or alert is
  // not provider evidence. Projection has its own durable retry checkpoint.
  await verifyPaymentRelease(deps.stripe, context.payment_intent_id, { readOnly: true });
  if (!deps.projectRelease) return failure('ORDERED_PROJECTION_REQUIRED', { purchase_id: context.purchase_id });
  const receipt = await deps.projectRelease(context);
  if (receipt?.verified !== true || receipt.operation_id !== context.operation_id || receipt.version !== context.authority_version) {
    return failure('PROJECTION_UNVERIFIED', { purchase_id: context.purchase_id });
  }
  // A request handler may wait for the worker's receipt without possessing
  // worker credentials. Direct acknowledgement is for the trusted worker.
  if ((await authority.context(context.purchase_id)).context?.phase !== 'completed') {
    await authority.acknowledgeProjection(context.purchase_id, context.authority_version);
  }
  return { status: 200, body: { ok: true, status: 'expired', settlement: context.settlement.status } };
}

// Trusted recovery worker/admin service calls this function. It performs no
// fresh refund/cancellation when a previous dispatch has an ambiguous outcome.
// A full refund independently issued by an authorized operator is recognized.
export const reconcilePaymentRelease = (deps, purchaseId) => expirePurchaseSafely(deps, purchaseId, { recover: true });

/** Reservation-only cleanup may not bypass an associated payment workflow. */
export async function assertNoPurchaseForReservation(entities, listing) {
  const purchases = await readCleanupRows(entities.Purchase, { listing_id: listing.id });
  const privateRows = await readCleanupRows(entities.PurchasePrivate, { listing_id: listing.id });
  if (!Array.isArray(purchases) || !Array.isArray(privateRows)) throw new Error('PURCHASE_LOOKUP_UNPROVEN');
  if (purchases.some(p => p.reservation_token === listing.reservation_token || ['pending_transfer', 'disputed', 'completed'].includes(p.transfer_status)) ||
      privateRows.some(p => p.reservation_token === listing.reservation_token)) throw new Error('PAYMENT_BOUND_RESERVATION');
  if (listing.status === 'pending_transfer') throw new Error('PAYMENT_OWNERSHIP_UNPROVEN');
}

// Account deletion must not erase payment ownership/recovery evidence or
// indirectly release inventory while an obligation remains unresolved.
export async function assertNoOpenAccountObligations(entities, email, deps = {}) {
  const seen = new Set();
  for (const field of ['buyer_email', 'seller_email']) {
    const purchases = await readCleanupRows(entities.Purchase, { [field]: email });
    const privateRows = await readCleanupRows(entities.PurchasePrivate, { [field]: email });
    if (purchases.some(p => ['pending_transfer', 'disputed'].includes(p.transfer_status))) throw new Error('OPEN_PAYMENT_OBLIGATIONS');
    const ids = new Set([...purchases.map(p => p.id), ...privateRows.map(pp => pp.purchase_id)]);
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = purchases.find(row => row.id === id);
      const pp = privateRows.find(row => row.purchase_id === id);
      const piId = pp?.payment_intent_id || p?.payment_intent_id;
      if (!piId) {
        if (pp?.cleanup_claim) throw new Error('UNRESOLVED_PAYMENT_OBLIGATION');
        continue;
      }
      if (!p || (pp && pp.listing_id !== p.listing_id) ||
          (pp?.payment_intent_id && p.payment_intent_id && pp.payment_intent_id !== p.payment_intent_id)) throw new Error('HISTORICAL_IDENTITY_UNPROVEN');
      // Completed delivery with captured payment follows the existing settled
      // sale policy. Expired/cancelled purchases require external settlement,
      // including historical rows without any Mission 1 fields.
      const authority = requireMission1Authority(deps);
      const context = await authority.context(id);
      if (context.context && context.context.phase !== 'completed') throw new Error('PAYMENT_RECOVERY_INCOMPLETE');
      if (pp?.cleanup_claim && !pp.cleanup_completed_at && !deps.legacyWorkersFenced) throw new Error('LEGACY_WORKER_FENCING_REQUIRED');
      let proof;
      if (p.transfer_status === 'completed' && (pp?.payment_captured ?? p.payment_captured)) {
        const pi = await deps.stripe.paymentIntents.retrieve(piId);
        if (pi.id !== piId || pi.status !== 'succeeded') throw new Error('HISTORICAL_COMPLETED_PAYMENT_UNVERIFIED');
        proof = { status: 'completed_sale', payment_intent_id: piId, pi_status: pi.status,
          verified_at: new Date().toISOString(), purchase_status: 'completed', payment_captured: true };
      } else {
        proof = await verifyPaymentRelease(deps.stripe, piId, { readOnly: true });
      }
      await authority.recordHistorical(email, id, piId, proof);
    }
  }
  for (const field of ['seller_email', 'reserved_by_email']) {
    const rows = await readCleanupRows(entities.ListingPrivate, { [field]: email });
    if (rows.some(lp => lp.reservation_token || lp.checkout_quarantined || lp.recovery_blocked)) throw new Error('OPEN_RESERVATION_OBLIGATIONS');
  }
  const authority = requireMission1Authority(deps);
  const users = await readCleanupRows(entities.User, { email });
  if (users.length !== 1) throw new Error('ACCOUNT_IDENTITY_UNPROVEN');
  const obligations = await authority.userObligations(users[0].id);
  if (!Array.isArray(obligations) || obligations.length) throw new Error('AUTHORITATIVE_ACCOUNT_OBLIGATIONS');
}
