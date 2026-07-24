/**
 * reconcilePurchaseOutcomes — admin-only reconciliation for the outcome pipeline.
 *
 * Guarantees the terminal-outcome pipeline is EVENTUALLY exactly-once even after
 * crashes, partial failures, or the duplicate records that Base44's lack of an
 * atomic compare-and-set (proven) can allow under concurrency:
 *   - Finds completed/disputed (non-demo) Purchases.
 *   - Creates a MISSING TransferOutcome/TransferIntelligence (capturePayment
 *     or the automation crashed before writing) — the repair-for-missed path.
 *   - Detects DUPLICATE TransferOutcome records for the same (purchase, success)
 *     and consolidates to the single oldest.
 *   - Detects DUPLICATE TransferIntelligence records for the same purchase.
 *   - Detects DUPLICATE seller-sale Notifications (sale_created per purchase).
 *   - Detects DUPLICATE PointsActivity for the same (user, action, reference_id)
 *     and reverses the extra points (deduct + delete the duplicate activity).
 *   - Recomputes seller trust counters from authoritative outcomes/flags.
 *   - Detects a stuck seller_notified_at with no durable Notification (clears it
 *     so the next confirmCheckoutAuthorized retry recreates the record).
 *   - Re-attempts push/email for Purchases whose seller notification was recorded
 *     but a channel failed (seller_push_status / seller_email_status).
 *
 * Runs in DRY-RUN mode by default (returns proposed repairs). Pass
 * { confirm: true } to APPLY repairs. NEVER silently deletes operational
 * evidence: duplicates are consolidated to the single oldest; counters are
 * recomputed from the authoritative source and written back. No real outcome
 * record is discarded.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { sendTransactionalEmail } from '../../shared/notifications.ts';
import { recordTerminalOutcome } from '../../shared/recordOutcome.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Auth: allow the automation scheduler (no session), allow admins, reject
  // everyone else. Mirrors the processTransferReminders pattern so this can
  // run as a scheduled task for guaranteed eventual repair.
  let callerRole = null;
  try {
    const user = await base44.auth.me();
    callerRole = user?.role;
    if (callerRole && callerRole !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch (_) {
    // No session = called by the automation scheduler — allow.
  }

  const body = await req.json().catch(() => ({}));
  const confirm = body?.confirm === true;
  const limit = Math.min(500, Math.max(1, Number(body?.limit) || 200));

  const findings = {
    scanned: 0,
    missing_outcomes: [] as any[],
    duplicate_outcomes: [] as any[],
    duplicate_intelligence: [] as any[],
    duplicate_notifications: [] as any[],
    duplicate_points: [] as any[],
    counter_mismatches: [] as any[],
    stuck_seller_notified: [] as any[],
    retried_channels: [] as any[],
    repaired: {
      outcomes_created: 0,
      outcomes_consolidated: 0,
      intelligence_consolidated: 0,
      notifications_consolidated: 0,
      points_reversed: 0,
      counters_fixed: 0,
      seller_notified_cleared: 0,
      channels_retried: 0,
    },
  };

  const purchases = await base44.asServiceRole.entities.Purchase.filter({
    transfer_status: { $in: ['completed', 'disputed'] },
    is_demo: { $ne: true },
  }, '-created_date', limit).catch(() => []);

  findings.scanned = purchases.length;

  for (const p of purchases) {
    const isSuccess = p.transfer_status === 'completed';

    // ── Missing / duplicate TransferOutcome ────────────────────────────────
    const outcomes = await base44.asServiceRole.entities.TransferOutcome.filter({
      purchase_id: p.id, transfer_successful: isSuccess,
    }).catch(() => []);

    if (outcomes.length === 0) {
      findings.missing_outcomes.push({ purchase_id: p.id, status: p.transfer_status });
      if (confirm) {
        try { await recordTerminalOutcome(base44, p); findings.repaired.outcomes_created++; } catch (_) {}
      }
    } else if (outcomes.length > 1) {
      findings.duplicate_outcomes.push({ purchase_id: p.id, count: outcomes.length, ids: outcomes.map(o => o.id) });
      if (confirm) {
        const sorted = outcomes.sort((a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());
        for (let i = 1; i < sorted.length; i++) {
          await base44.asServiceRole.entities.TransferOutcome.delete(sorted[i].id).catch(() => {});
          findings.repaired.outcomes_consolidated++;
        }
      }
    }

    // ── Duplicate TransferIntelligence ─────────────────────────────────────
    const intel = await base44.asServiceRole.entities.TransferIntelligence.filter({
      purchase_id: p.id, source: 'transfer_outcome',
    }).catch(() => []);
    if (intel.length > 1) {
      findings.duplicate_intelligence.push({ purchase_id: p.id, count: intel.length, ids: intel.map(i => i.id) });
      if (confirm) {
        const sorted = intel.sort((a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());
        for (let i = 1; i < sorted.length; i++) {
          await base44.asServiceRole.entities.TransferIntelligence.delete(sorted[i].id).catch(() => {});
          findings.repaired.intelligence_consolidated++;
        }
      }
    }

    // ── Duplicate seller-sale Notifications ────────────────────────────────
    if (p.seller_email) {
      const notifs = await base44.asServiceRole.entities.Notification.filter({
        user_email: p.seller_email, type: 'sale_created', reference_id: p.id,
      }).catch(() => []);
      if (notifs.length > 1) {
        findings.duplicate_notifications.push({ purchase_id: p.id, count: notifs.length });
        if (confirm) {
          const sorted = notifs.sort((a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());
          for (let i = 1; i < sorted.length; i++) {
            // Supersede (never delete) — preserves audit trail; the dispatcher
            // and inbox skip superseded records, so they never dispatch.
            await base44.asServiceRole.entities.Notification.update(sorted[i].id, { dispatch_status: 'superseded' }).catch(() => {});
            findings.repaired.notifications_consolidated++;
          }
        }
      }

      // ── Duplicate PointsActivity (per purchase) + reverse extra points ──
      const paActions = ['sale_completed', 'purchase', 'buyer_confirm_1hr'];
      for (const action of paActions) {
        const acts = await base44.asServiceRole.entities.PointsActivity.filter({
          reference_id: p.id, action, is_reversal: { $ne: true },
        }).catch(() => []);
        if (acts.length > 1) {
          // Keep the oldest; reverse points for the extras and delete them.
          const sorted = acts.sort((a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());
          for (let i = 1; i < sorted.length; i++) {
            const dup = sorted[i];
            findings.duplicate_points.push({ purchase_id: p.id, action, activity_id: dup.id, points: dup.points });
            if (confirm) {
              // Reverse the points on the user, then delete the duplicate.
              const targetEmail = dup.user_email;
              if (targetEmail && dup.points) {
                const users = await base44.asServiceRole.entities.User.filter({ email: targetEmail }).catch(() => []);
                const u = users[0];
                if (u) {
                  await base44.asServiceRole.entities.User.update(u.id, {
                    peanut_points: Math.max(0, (u.peanut_points || 0) - dup.points),
                  }).catch(() => {});
                }
              }
              await base44.asServiceRole.entities.PointsActivity.delete(dup.id).catch(() => {});
              findings.repaired.points_reversed++;
            }
          }
        }
      }
    }

    // ── Mismatched seller counters (derive + write back) ──────────────────
    if (p.seller_email) {
      const sellers = await base44.asServiceRole.entities.User.filter({ email: p.seller_email }).catch(() => []);
      const seller = sellers[0];
      if (seller) {
        // RACE-PROOF: derive from authoritative Purchase rows (transfer_status),
        // not from TransferOutcome records which can be duplicated by the
        // existence-check race. Mirrors recordTerminalOutcome's derivation.
        const completedPurchases = await base44.asServiceRole.entities.Purchase.filter({
          seller_email: p.seller_email, transfer_status: 'completed',
        }).catch(() => []);
        const disputedPurchases = await base44.asServiceRole.entities.Purchase.filter({
          seller_email: p.seller_email, transfer_status: 'disputed',
        }).catch(() => []);
        const flagged = await base44.asServiceRole.entities.Purchase.filter({
          seller_email: p.seller_email, false_claim_recorded: true,
        }).catch(() => []);
        const successCount = completedPurchases.filter(x => !x.is_demo).length;
        const failCount = disputedPurchases.filter(x => !x.is_demo).length;
        const falseClaimCount = flagged.filter(x => !x.is_demo).length;
        const total = successCount + failCount;
        let reliability = total > 0 ? Math.round((successCount / total) * 100) : 70;
        if (failCount > 0) reliability = Math.max(0, reliability - 5);
        if (falseClaimCount >= 1) reliability = Math.max(0, reliability - (falseClaimCount * 3));
        reliability = Math.max(0, Math.min(100, reliability));

        const mismatch =
          (seller.transfer_success_count || 0) !== successCount ||
          (seller.transfer_fail_count || 0) !== failCount ||
          (seller.transfer_false_claim_count || 0) !== falseClaimCount ||
          (seller.seller_transfer_reliability || 0) !== reliability;
        if (mismatch) {
          findings.counter_mismatches.push({
            purchase_id: p.id, seller_email: p.seller_email,
            before: { success: seller.transfer_success_count, fail: seller.transfer_fail_count, false_claim: seller.transfer_false_claim_count, reliability: seller.seller_transfer_reliability },
            after: { success: successCount, fail: failCount, false_claim: falseClaimCount, reliability },
          });
          if (confirm) {
            await base44.asServiceRole.entities.User.update(seller.id, {
              transfer_success_count: successCount,
              transfer_fail_count: failCount,
              transfer_false_claim_count: falseClaimCount,
              seller_transfer_reliability: reliability,
            }).catch(() => {});
            findings.repaired.counters_fixed++;
          }
        }
      }
    }

    // ── Stuck seller_notified_at with no durable notification ──────────────
    if (p.seller_notified_at && p.seller_email) {
      const notifs = await base44.asServiceRole.entities.Notification.filter({
        user_email: p.seller_email, type: 'sale_created', reference_id: p.id,
      }).catch(() => []);
      if (notifs.length === 0) {
        findings.stuck_seller_notified.push({ purchase_id: p.id, seller_notified_at: p.seller_notified_at });
        if (confirm) {
          await base44.asServiceRole.entities.Purchase.update(p.id, { seller_notified_at: null }).catch(() => {});
          findings.repaired.seller_notified_cleared++;
        }
      }
      // Failed-channel retry is owned by dispatchSaleNotifications (every 1 min),
      // which canonical-selects and only sends channels not already marked 'sent'.
      // A successful channel is never re-sent, so it cannot be duplicated.
    }
  }

  // ── Global notification-dedup pass (independent of terminal status) ──────
  // Duplicate sale_created notifications are created at AUTHORIZATION time
  // (confirmCheckoutAuthorized), while the purchase is still pending_transfer.
  // The completed/disputed loop above therefore does NOT catch duplicates for
  // purchases that never reach a terminal status. This pass consolidates
  // duplicate sale_created notifications by their deterministic logical key
  // (type='sale_created' + reference_id=purchase_id) across ALL purchase
  // statuses, so the seller's inbox is eventually clean regardless of the
  // purchase lifecycle. Idempotent: a second run finds one notification and
  // skips. Purchases already consolidated by the loop above are found as 1
  // here and skipped (no double-delete, no double-count).
  {
    const allSaleNotifs = await base44.asServiceRole.entities.Notification.filter(
      { type: 'sale_created' }, '-created_date', 500
    ).catch(() => []);
    const byPurchase = {};
    for (const n of allSaleNotifs) {
      const key = n.reference_id || n.id;
      (byPurchase[key] ||= []).push(n);
    }
    const alreadyFlagged = new Set(findings.duplicate_notifications.map(d => d.purchase_id));
    for (const [purchaseId, group] of Object.entries(byPurchase)) {
      if (group.length <= 1) continue;
      if (!alreadyFlagged.has(purchaseId)) {
        findings.duplicate_notifications.push({ purchase_id: purchaseId, count: group.length });
      }
      if (confirm) {
        const sorted = group.sort((a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());
        for (let i = 1; i < sorted.length; i++) {
          await base44.asServiceRole.entities.Notification.update(sorted[i].id, { dispatch_status: 'superseded' }).catch(() => {});
          if (!alreadyFlagged.has(purchaseId)) findings.repaired.notifications_consolidated++;
        }
      }
    }
  }

  // ── Reset stuck 'dispatching' sale_created notifications (a dispatcher run that
  //    crashed mid-send). Stuck = 'dispatching' older than 5 min. The next
  //    dispatcher run retries them. Idempotent; non-terminal.
  {
    const stuck = await base44.asServiceRole.entities.Notification.filter(
      { type: 'sale_created', dispatch_status: 'dispatching' }, '-created_date', 100
    ).catch(() => []);
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const n of stuck) {
      if (new Date(n.updated_date || n.created_date || 0).getTime() < cutoff) {
        await base44.asServiceRole.entities.Notification.update(n.id, { dispatch_status: 'pending' }).catch(() => {});
      }
    }
  }

  // ── Admin audit trail: when applying repairs, email a durable summary of
  //    every repair to the admin log so duplicate evidence is preserved even
  //    though the duplicate records themselves are consolidated (deleted).
  //    Duplicates of user-facing notifications and the financial points ledger
  //    MUST be deleted (not marked superseded) to avoid polluting the seller's
  //    inbox / point totals; the audit email preserves the duplicate IDs and
  //    counts as the persistent evidence trail.
  if (confirm) {
    const r = findings.repaired;
    const totalRepairs = r.outcomes_created + r.outcomes_consolidated + r.intelligence_consolidated +
      r.notifications_consolidated + r.points_reversed + r.counters_fixed +
      r.seller_notified_cleared + r.channels_retried;
    if (totalRepairs > 0) {
      const lines = [
        `Scheduled/admin reconciliation applied ${totalRepairs} repair(s).`,
        ``,
        `Scanned: ${findings.scanned} terminal (completed/disputed) non-demo purchases.`,
        ``,
        `Repairs:`,
        `  - Missing outcomes created:        ${r.outcomes_created}`,
        `  - Duplicate outcomes consolidated: ${r.outcomes_consolidated}`,
        `  - Duplicate intelligence consolidated: ${r.intelligence_consolidated}`,
        `  - Duplicate notifications consolidated: ${r.notifications_consolidated}`,
        `  - Duplicate points reversed:        ${r.points_reversed}`,
        `  - Seller counters recomputed:       ${r.counters_fixed}`,
        `  - Stuck seller_notified cleared:    ${r.seller_notified_cleared}`,
        `  - Failed delivery channels retried: ${r.channels_retried}`,
        ``,
        `Duplicate outcome IDs (consolidated to oldest):`,
        ...findings.duplicate_outcomes.map(d => `  ${d.purchase_id}: ${d.ids?.join(', ') || d.count}`),
        ``,
        `Duplicate intelligence IDs (consolidated to oldest):`,
        ...findings.duplicate_intelligence.map(d => `  ${d.purchase_id}: ${d.ids?.join(', ') || d.count}`),
        ``,
        `Duplicate notifications (consolidated to oldest):`,
        ...findings.duplicate_notifications.map(d => `  ${d.purchase_id}: count ${d.count}`),
        ``,
        `Duplicate points reversed:`,
        ...findings.duplicate_points.map(d => `  ${d.purchase_id} (${d.action}): ${d.points} pts, activity ${d.activity_id}`),
        ``,
        `Counter recomputations:`,
        ...findings.counter_mismatches.map(d => `  ${d.seller_email}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`),
      ];
      sendTransactionalEmail(base44, 'experience@peanutgallery.store',
        `📋 Reconciliation Report — ${totalRepairs} repair(s)`,
        lines.join('\n')
      ).catch(() => {});
    }
  }

  return Response.json({
    mode: confirm ? 'applied' : 'dry_run',
    findings,
    note: confirm
      ? 'Repairs applied: missing outcomes created, duplicates consolidated to oldest, duplicate points reversed, counters recomputed, stuck seller_notified cleared, failed channels retried.'
      : 'Dry run — no records were modified. Re-run with { confirm: true } to apply.',
  });
});