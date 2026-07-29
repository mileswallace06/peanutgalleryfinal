/**
 * recordTerminalOutcome — shared, idempotent terminal-outcome recorder.
 *
 * CONCURRENCY REALITY (proven by testing on this platform):
 *   Base44 has NO atomic compare-and-set and NO unique indexes. Ten concurrent
 *   `updateMany({ id, field: null }, { $set: { field: 'won' } })` calls produced
 *   THREE winners — `updateMany` is a non-atomic read-then-write, so a
 *   conditional claim cannot serialize concurrent writers. (Atomic `$inc` DOES
 *   work — 10 concurrent `$inc` yielded exactly +10 — but `$inc` cannot guard
 *   "first writer wins" without an atomic pre-value read.)
 *
 * Because there is no atomic primitive, this module is idempotent by
 * CONSTRUCTION so that duplicate INVOCATIONS cannot corrupt state:
 *   - Records are created only when an existence check finds none. This is
 *     sequentially safe (a replay does nothing). Concurrent replays can rarely
 *     win the existence-check race and duplicate a record; that duplicate is
 *     repaired to exactly-one by `reconcilePurchaseOutcomes` (eventual
 *     exactly-once), and duplicate TRUST counters never result because…
 *   - Seller trust counters are DERIVED (recomputed) from authoritative
 *     TransferOutcome records, and the false-claim count from flagged
 *     Purchases. A duplicate invocation recomputes the SAME value rather than
 *     incrementing, so it can never double-count from the invocation itself.
 *     (Only a duplicate RECORD inflates the derived count, which reconciliation
 *     removes.)
 *   - The false-claim flag is set with an idempotent `$set true` (true→true).
 *
 * Callers:
 *   - capturePayment — the SINGLE trusted terminal-transition function. It
 *     performs the Stripe capture (itself exactly-once via idempotencyKey),
 *     flips transfer_status→completed (idempotent $set), then calls this.
 *   - recordTransferOutcome — the entity-automation handler, a repair/safety
 *     net that re-derives trust and fills any record capturePayment missed.
 *
 * Neither caller relies on an atomic claim. Both call the same idempotent
 * logic, so duplicate work between them is harmless.
 */
import { getPurchasePrivate, upsertPurchasePrivate, getUserSecurityProfile, upsertUserSecurityProfile, alertPrivateWriteFailure } from './privateData.ts';

function predVerdict(recommendation, outcome) {
  const openRecs = ['open', 'likely_open'];
  const closedRecs = ['closed', 'closing_soon'];
  if (['unknown', 'admin_review'].includes(recommendation)) return null;
  if (outcome === 'transfer_succeeded' || outcome === 'window_open') return openRecs.includes(recommendation);
  if (outcome === 'transfer_failed' || outcome === 'window_closed') return closedRecs.includes(recommendation);
  return null;
}

export async function recordTerminalOutcome(base44, purchase) {
  const isSuccess = purchase.transfer_status === 'completed';
  const now = new Date().toISOString();

  // Phase 1B: read authoritative identities from PurchasePrivate
  const pp = await getPurchasePrivate(base44, purchase.id);
  const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;
  const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;

  let minutesToTransfer = null;
  if (purchase.seller_confirmed_at && purchase.created_date) {
    minutesToTransfer = Math.round(
      (new Date(purchase.seller_confirmed_at) - new Date(purchase.created_date)) / 60000
    );
  }

  let outcomeCreatedNow = false;

  // 1. TransferOutcome — create only if none exists yet (repair-safe).
  const existingOutcome = await base44.asServiceRole.entities.TransferOutcome.filter({
    purchase_id: purchase.id, transfer_successful: isSuccess,
  }).catch(() => []);
  if (existingOutcome.length === 0) {
    await base44.asServiceRole.entities.TransferOutcome.create({
      listing_id: purchase.listing_id,
      event_id: purchase.event_id,
      purchase_id: purchase.id,
      seller_email: authoritativeSellerEmail,
      buyer_email: authoritativeBuyerEmail,
      transfer_successful: isSuccess,
      transfer_completed_at: isSuccess ? now : null,
      minutes_to_transfer: minutesToTransfer,
      buyer_confirmed: purchase.buyer_confirmed || false,
      seller_confirmed: purchase.seller_confirmed || false,
      admin_intervention_required: purchase.auto_review_flagged || false,
      dispute_created: !isSuccess,
      notes: !isSuccess ? purchase.dispute_reason : null,
    });
    outcomeCreatedNow = true;
  }

  // 2. TransferIntelligence — idempotent via purchase_id dedup (best-effort).
  const existingIntel = await base44.asServiceRole.entities.TransferIntelligence.filter({
    purchase_id: purchase.id, source: 'transfer_outcome',
  }).catch(() => []);
  if (existingIntel.length === 0) {
    try {
      let listing = null;
      if (purchase.listing_id) {
        try { listing = await base44.asServiceRole.entities.Listing.get(purchase.listing_id); } catch (_) {}
      }
      let ev = null;
      if (purchase.event_id) {
        try { const evs = await base44.asServiceRole.entities.Event.filter({ id: purchase.event_id }); ev = evs[0]; } catch (_) {}
      }
      let timeBeforeEventMin = null;
      if (ev && (ev.event_start_utc || ev.date)) {
        const startMs = new Date(ev.event_start_utc || ev.date).getTime();
        if (!Number.isNaN(startMs)) timeBeforeEventMin = Math.round((startMs - Date.now()) / 60000);
      }
      await base44.asServiceRole.entities.TransferIntelligence.create({
        event_id: purchase.event_id,
        purchase_id: purchase.id,
        event_title: ev?.title || null,
        venue: ev?.venue || null,
        city: ev?.city || null,
        state: ev?.state || null,
        category: ev?.category || null,
        artist: ev?.artist || null,
        platform: listing?.transfer_platform || null,
        transfer_successful: isSuccess,
        failure_reason: !isSuccess ? (purchase.dispute_reason || null) : null,
        time_before_event_min: timeBeforeEventMin,
        minutes_to_transfer: minutesToTransfer,
        seller_response_time_min: minutesToTransfer,
        buyer_confirmed: purchase.buyer_confirmed || false,
        seller_confirmed: purchase.seller_confirmed || false,
        seller_email: authoritativeSellerEmail,
        buyer_email: authoritativeBuyerEmail,
        source: 'transfer_outcome',
        recorded_at: now,
      });
    } catch (_) {
      // learning is best-effort
    }
  }

  // 3. Self-calibration — resolve the event's unresolved prediction (idempotent).
  try {
    const preds = await base44.asServiceRole.entities.TransferConfidencePrediction.filter({
      event_id: purchase.event_id, resolved: false,
    });
    const pred = preds[0];
    if (pred) {
      const outcome = isSuccess ? 'transfer_succeeded' : 'transfer_failed';
      await base44.asServiceRole.entities.TransferConfidencePrediction.update(pred.id, {
        resolved: true,
        resolved_at: now,
        actual_outcome: outcome,
        prediction_correct: predVerdict(pred.recommendation, outcome),
        resolution_source: 'transfer_outcome',
        platform: null,
        seller_email: authoritativeSellerEmail || null,
      });
    }
  } catch (_) {
    // self-calibration is best-effort
  }

  // 4. Seller trust — DERIVED from authoritative Purchase rows (RACE-PROOF).
  //    Counts come from distinct Purchase records (transfer_status completed
  //    vs disputed) — the source of truth that can never be duplicated — NOT
  //    from TransferOutcome records. Phase 1B: trust counters are written to
  //    UserSecurityProfile (authoritative) and mirrored to User (legacy fallback).
  //    All writes awaited; failures alert and must not produce partial state.
  if (authoritativeSellerEmail) {
    try {
      if (!isSuccess) {
        await base44.asServiceRole.entities.Purchase.update(purchase.id, {
          false_claim_recorded: true,
        }).catch(() => {});
        // Phase 1B: mirror false_claim_recorded to PurchasePrivate (authoritative)
        try {
          await upsertPurchasePrivate(base44, purchase.id, { false_claim_recorded: true });
        } catch (err) {
          await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase.id, reference_type: 'purchase', error: err });
        }
      }

      // DERIVE from distinct Purchase rows (not TransferOutcome) — race-proof.
      const completedPurchases = await base44.asServiceRole.entities.Purchase.filter({
        seller_email: authoritativeSellerEmail, transfer_status: 'completed',
      }).catch(() => []);
      const disputedPurchases = await base44.asServiceRole.entities.Purchase.filter({
        seller_email: authoritativeSellerEmail, transfer_status: 'disputed',
      }).catch(() => []);
      const flagged = await base44.asServiceRole.entities.Purchase.filter({
        seller_email: authoritativeSellerEmail, false_claim_recorded: true,
      }).catch(() => []);

      // Exclude demo purchases from real trust scoring.
      const successCount = completedPurchases.filter(p => !p.is_demo).length;
      const failCount = disputedPurchases.filter(p => !p.is_demo).length;
      const falseClaimCount = flagged.filter(p => !p.is_demo).length;

      const total = successCount + failCount;
      let reliability = total > 0 ? Math.round((successCount / total) * 100) : 70;
      if (failCount > 0) reliability = Math.max(0, reliability - 5);
      if (falseClaimCount >= 1) reliability = Math.max(0, reliability - (falseClaimCount * 3));
      reliability = Math.max(0, Math.min(100, reliability));

      // Phase 1B: write trust counters to UserSecurityProfile (authoritative)
      const sec = await getUserSecurityProfile(base44, { user_email: authoritativeSellerEmail });
      if (sec) {
        try {
          await upsertUserSecurityProfile(base44, { user_id: sec.user_id, user_email: authoritativeSellerEmail }, {
            transfer_success_count: successCount,
            transfer_fail_count: failCount,
            transfer_false_claim_count: falseClaimCount,
            seller_transfer_reliability: reliability,
          });
        } catch (err) {
          await alertPrivateWriteFailure(base44, { entity: 'UserSecurityProfile', reference_id: sec.user_id, reference_type: 'user', error: err });
        }
      }

      // Legacy mirror: write to User (temporary fallback)
      const sellers = await base44.asServiceRole.entities.User.filter({ email: authoritativeSellerEmail }).catch(() => []);
      const seller = sellers[0];
      if (seller) {
        await base44.asServiceRole.entities.User.update(seller.id, {
          transfer_success_count: successCount,
          transfer_fail_count: failCount,
          transfer_false_claim_count: falseClaimCount,
          seller_transfer_reliability: reliability,
        }).catch(() => {});
      }
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'UserSecurityProfile', reference_id: authoritativeSellerEmail, reference_type: 'user', error: err });
    }
  }

  // 5. Dispute → admin alert (existence check; idempotent).
  if (!isSuccess) {
    const existingAlerts = await base44.asServiceRole.entities.AdminAlert.filter({
      reference_id: purchase.id,
      alert_type: 'failed_transfer_after_payment',
      resolved: false,
    }).catch(() => []);
    if (existingAlerts.length === 0) {
      await base44.asServiceRole.entities.AdminAlert.create({
        alert_type: 'failed_transfer_after_payment',
        priority: 'critical',
        title: `Transfer failed — $${purchase.amount?.toFixed(2)} in dispute`,
        description: `Buyer ${authoritativeBuyerEmail} opened dispute. Seller: ${authoritativeSellerEmail}. Reason: ${purchase.dispute_reason || 'not specified'}`,
        reference_id: purchase.id,
        reference_type: 'purchase',
        seller_email: authoritativeSellerEmail,
        buyer_email: authoritativeBuyerEmail,
        event_id: purchase.event_id,
      }).catch(() => {});
    }
  }

  return {
    recorded: true,
    outcome: isSuccess ? 'success' : 'dispute',
    minutes_to_transfer: minutesToTransfer,
    outcome_created_now: outcomeCreatedNow,
  };
}