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
      seller_email: purchase.seller_email,
      buyer_email: purchase.buyer_email,
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
        seller_email: purchase.seller_email,
        buyer_email: purchase.buyer_email,
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
        seller_email: purchase.seller_email || null,
      });
    }
  } catch (_) {
    // self-calibration is best-effort
  }

  // 4. Seller trust — DERIVED from authoritative records (idempotent recompute).
  //    The false-claim flag is an idempotent $set; the false-claim count is
  //    derived from flagged purchases. A duplicate invocation cannot
  //    double-count: it recomputes the same totals.
  if (purchase.seller_email) {
    try {
      if (!isSuccess) {
        await base44.asServiceRole.entities.Purchase.update(purchase.id, {
          false_claim_recorded: true,
        }).catch(() => {});
      }
      const sellers = await base44.asServiceRole.entities.User.filter({ email: purchase.seller_email });
      const seller = sellers[0];
      if (seller) {
        const outcomes = await base44.asServiceRole.entities.TransferOutcome.filter({
          seller_email: purchase.seller_email,
        }).catch(() => []);
        const successCount = outcomes.filter(o => o.transfer_successful).length;
        const failCount = outcomes.filter(o => !o.transfer_successful).length;
        const flagged = await base44.asServiceRole.entities.Purchase.filter({
          seller_email: purchase.seller_email, false_claim_recorded: true,
        }).catch(() => []);
        const falseClaimCount = flagged.length;

        const total = successCount + failCount;
        let reliability = total > 0 ? Math.round((successCount / total) * 100) : 70;
        if (failCount > 0) reliability = Math.max(0, reliability - 5);
        if (falseClaimCount >= 1) reliability = Math.max(0, reliability - (falseClaimCount * 3));
        reliability = Math.max(0, Math.min(100, reliability));

        await base44.asServiceRole.entities.User.update(seller.id, {
          transfer_success_count: successCount,
          transfer_fail_count: failCount,
          transfer_false_claim_count: falseClaimCount,
          seller_transfer_reliability: reliability,
        });
      }
    } catch (_) {
      // trust update is best-effort
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
        description: `Buyer ${purchase.buyer_email} opened dispute. Seller: ${purchase.seller_email}. Reason: ${purchase.dispute_reason || 'not specified'}`,
        reference_id: purchase.id,
        reference_type: 'purchase',
        seller_email: purchase.seller_email,
        buyer_email: purchase.buyer_email,
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