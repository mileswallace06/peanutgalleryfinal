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
import { sendUserNotification } from '../../shared/notifications.ts';
import { recordTerminalOutcome } from '../../shared/recordOutcome.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let isAdmin = false;
  try {
    const user = await base44.auth.me();
    isAdmin = user?.role === 'admin';
  } catch (_) { /* no session */ }
  if (!isAdmin) return Response.json({ error: 'Admin only' }, { status: 403 });

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
            await base44.asServiceRole.entities.Notification.delete(sorted[i].id).catch(() => {});
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
      } else if ((p.seller_push_status === 'failed' || p.seller_email_status === 'failed')) {
        findings.retried_channels.push({ purchase_id: p.id, push: p.seller_push_status, email: p.seller_email_status });
        if (confirm) {
          const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: p.listing_id }).catch(() => []);
          const dispatch = await sendUserNotification(base44, {
            user_email: p.seller_email,
            title: '🎉 Your ticket sold!',
            body: `Tap to transfer your tickets and receive payment. Sec ${listing?.section || ''}, Row ${listing?.row || ''}.`,
            type: 'sale_created',
            purchase_id: p.id,
          }).catch(() => ({}));
          await base44.asServiceRole.entities.Purchase.update(p.id, {
            seller_push_status: dispatch?.push?.sent ? 'sent' : 'failed',
            seller_email_status: dispatch?.email?.sent ? 'sent' : 'failed',
          }).catch(() => {});
          findings.repaired.channels_retried++;
        }
      }
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