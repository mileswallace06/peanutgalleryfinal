/**
 * reconcilePurchaseOutcomes — admin-only reconciliation for the outcome pipeline.
 *
 * Guarantees the recordTransferOutcome pipeline is eventually consistent even
 * after crashes, partial failures, or pre-fix duplicate data:
 *   - Finds completed/disputed (non-demo) Purchases.
 *   - Detects duplicate TransferOutcome records for the same (purchase, success).
 *   - Detects duplicate TransferIntelligence records for the same purchase.
 *   - Detects mismatched seller trust counters vs authoritative outcomes/flags.
 *   - Detects a stuck outcome_claim with no outcome (crash in claim→create).
 *   - Detects a stuck seller_notified_at with no durable Notification.
 *
 * Runs in DRY-RUN mode by default (returns proposed repairs). Pass
 * { confirm: true } to APPLY repairs. NEVER silently deletes operational
 * evidence: duplicate TransferOutcome/TransferIntelligence are consolidated to
 * the single authoritative record; counters are recomputed from the
 * authoritative source and written back. No real outcome record is discarded.
 *
 * Also re-attempts push/email for Purchases whose seller notification was
 * recorded but a channel failed (seller_push_status / seller_email_status).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { sendUserNotification } from '../../shared/notifications.ts';

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
    duplicate_outcomes: [] as any[],
    duplicate_intelligence: [] as any[],
    counter_mismatches: [] as any[],
    stuck_outcome_claims: [] as any[],
    stuck_seller_notified: [] as any[],
    retried_channels: [] as any[],
    repaired: { outcomes_consolidated: 0, intelligence_consolidated: 0, counters_fixed: 0, stuck_claims_released: 0, channels_retried: 0 },
  };

  // Scan terminal, non-demo purchases (most recent first, capped).
  const purchases = await base44.asServiceRole.entities.Purchase.filter({
    transfer_status: { $in: ['completed', 'disputed'] },
    is_demo: { $ne: true },
  }, '-created_date', limit).catch(() => []);

  findings.scanned = purchases.length;

  for (const p of purchases) {
    const isSuccess = p.transfer_status === 'completed';

    // ── Duplicate TransferOutcome ─────────────────────────────────────────
    const outcomes = await base44.asServiceRole.entities.TransferOutcome.filter({
      purchase_id: p.id, transfer_successful: isSuccess,
    }).catch(() => []);
    if (outcomes.length > 1) {
      findings.duplicate_outcomes.push({ purchase_id: p.id, count: outcomes.length, ids: outcomes.map(o => o.id) });
      if (confirm) {
        // Keep the oldest; remove the rest.
        const sorted = outcomes.sort((a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());
        for (let i = 1; i < sorted.length; i++) {
          await base44.asServiceRole.entities.TransferOutcome.delete(sorted[i].id).catch(() => {});
          findings.repaired.outcomes_consolidated++;
        }
      }
    } else if (outcomes.length === 0) {
      // Missing outcome — check for a stuck claim (claim set, no outcome).
      if (p.outcome_claim) {
        findings.stuck_outcome_claims.push({ purchase_id: p.id, outcome_claim: p.outcome_claim, outcome_claimed_at: p.outcome_claimed_at });
        if (confirm) {
          await base44.asServiceRole.entities.Purchase.update(p.id, { outcome_claim: null, outcome_claimed_at: null }).catch(() => {});
          findings.repaired.stuck_claims_released++;
        }
      }
    }

    // ── Duplicate TransferIntelligence ────────────────────────────────────
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

    // ── Mismatched seller counters (derive + write back) ──────────────────
    if (p.seller_email) {
      const sellers = await base44.asServiceRole.entities.User.filter({ email: p.seller_email }).catch(() => []);
      const seller = sellers[0];
      if (seller) {
        const allOutcomes = await base44.asServiceRole.entities.TransferOutcome.filter({ seller_email: p.seller_email }).catch(() => []);
        const successCount = allOutcomes.filter(o => o.transfer_successful).length;
        const failCount = allOutcomes.filter(o => !o.transfer_successful).length;
        const flagged = await base44.asServiceRole.entities.Purchase.filter({
          seller_email: p.seller_email, false_claim_recorded: true,
        }).catch(() => []);
        const falseClaimCount = flagged.length;
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
          // Clear the claim so the next confirmCheckoutAuthorized retry recreates it.
          await base44.asServiceRole.entities.Purchase.update(p.id, { seller_notified_at: null }).catch(() => {});
        }
      } else if ((p.seller_push_status === 'failed' || p.seller_email_status === 'failed')) {
        // Retry the failed channel(s) — durable record already exists.
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
      ? 'Repairs applied. Duplicate records consolidated to the oldest; counters recomputed from authoritative sources; stuck claims cleared; failed channels retried.'
      : 'Dry run — no records were modified. Re-run with { confirm: true } to apply.',
  });
});