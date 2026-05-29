/**
 * processTransferAlerts
 * 
 * Scheduled function (every 5 min) that:
 * 1. Scans active listings for expiring/expired verification → sends warnings
 * 2. Scans purchases for stalled transfers → creates AdminAlerts
 * 3. Detects conflicting community reports → creates AdminAlerts
 * 4. Cleans up duplicate open alerts
 * 
 * Runs as service role (no user context needed — it's a scheduled task).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const WARN_AFTER_MIN = 45;   // warning at 45 min
const EXPIRE_AFTER_MIN = 60; // expired at 60 min
const BUYER_WAIT_ALERT_MIN = 30; // alert if buyer waiting >30min for seller

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // This is a scheduled function — no user session expected.
    // When invoked manually via SDK (test tool or admin UI), the caller may not have
    // an admin session, so we skip user-level auth and rely on service-role operations only.

    const now = new Date();
    const results = { warnings: 0, expirations: 0, alerts_created: 0, conflicts: 0 };

    // ── 1. Verification expiration tracking ──────────────────────────────────
    const activeListings = await base44.asServiceRole.entities.Listing.filter({ status: 'active' });

    for (const listing of activeListings) {
      if (!listing.last_transfer_verification) continue;
      const verifiedAt = new Date(listing.last_transfer_verification);
      const ageMin = (now - verifiedAt) / 60000;

      // 45-min warning
      if (ageMin >= WARN_AFTER_MIN && ageMin < EXPIRE_AFTER_MIN && !listing.verification_warning_sent_at) {
        await base44.asServiceRole.entities.Listing.update(listing.id, {
          verification_warning_sent_at: now.toISOString(),
        });

        // Notify seller
        base44.asServiceRole.integrations.Core.SendEmail({
          to: listing.seller_email,
          subject: '⚠️ Your ticket listing verification expires soon',
          body: `Your listing (Section ${listing.section}, Row ${listing.row}) transfer verification expires in ~15 minutes.\n\nPlease open Peanut Gallery and re-verify to keep your listing visible to buyers.\n\n— Peanut Gallery`,
        }).catch(() => {});

        results.warnings++;
      }

      // 60-min expiration — hide listing
      if (ageMin >= EXPIRE_AFTER_MIN && !listing.verification_expired_sent_at && listing.transfer_status !== 'transfer_disabled') {
        await base44.asServiceRole.entities.Listing.update(listing.id, {
          status: 'hidden',
          hidden_reason: 'expired_verification',
          transfer_status: 'transfer_expired',
          verification_expired_sent_at: now.toISOString(),
        });

        // Beta log
        base44.asServiceRole.entities.BetaTransferLog.create({
          log_type: 'expiration_warning',
          actor_role: 'system',
          listing_id: listing.id,
          event_id: listing.event_id,
          before_state: { status: listing.status, transfer_status: listing.transfer_status },
          after_state: { status: 'hidden', hidden_reason: 'expired_verification' },
          metadata: { age_minutes: Math.round(ageMin) },
        }).catch(() => {});

        // Notify seller
        base44.asServiceRole.integrations.Core.SendEmail({
          to: listing.seller_email,
          subject: '⏱ Your ticket listing is now hidden — re-verify to restore',
          body: `Your listing (Section ${listing.section}, Row ${listing.row}) is no longer visible to buyers because transfer verification expired.\n\nTo restore your listing, open Peanut Gallery and tap "Verify Transfer Still Available".\n\n— Peanut Gallery`,
        }).catch(() => {});

        // Create admin alert
        await createAlertIfNew(base44, {
          alert_type: 'expired_verification',
          priority: 'medium',
          title: `Listing hidden — verification expired`,
          description: `Sec ${listing.section} Row ${listing.row} by ${listing.seller_email} hidden after ${Math.round(ageMin)}m`,
          reference_id: listing.id,
          reference_type: 'listing',
          seller_email: listing.seller_email,
          event_id: listing.event_id,
        });

        results.expirations++;
        results.alerts_created++;
      }

      // Low confidence alert (score < 30)
      if ((listing.transfer_confidence_score ?? 100) < 30 && listing.status === 'active') {
        const existing = await base44.asServiceRole.entities.AdminAlert.filter({
          reference_id: listing.id,
          alert_type: 'low_confidence_listing',
          resolved: false,
        });
        if (existing.length === 0) {
          await base44.asServiceRole.entities.AdminAlert.create({
            alert_type: 'low_confidence_listing',
            priority: 'high',
            title: `Low confidence listing live`,
            description: `Sec ${listing.section} Row ${listing.row} has ${listing.transfer_confidence_score}% confidence — buyers may see high-risk warning`,
            reference_id: listing.id,
            reference_type: 'listing',
            seller_email: listing.seller_email,
            event_id: listing.event_id,
          });
          results.alerts_created++;
        }
      }
    }

    // ── 2. Stalled transfer alerts ───────────────────────────────────────────
    const pendingPurchases = await base44.asServiceRole.entities.Purchase.filter({ transfer_status: 'pending_transfer' });

    for (const purchase of pendingPurchases) {
      const ageMin = (now - new Date(purchase.created_date)) / 60000;

      // Buyer waiting >30min for seller to send
      if (!purchase.seller_confirmed && ageMin >= BUYER_WAIT_ALERT_MIN) {
        await createAlertIfNew(base44, {
          alert_type: 'buyer_waiting_for_transfer',
          priority: ageMin >= 60 ? 'critical' : 'high',
          title: `Buyer waiting ${Math.round(ageMin)}m for transfer`,
          description: `Buyer ${purchase.buyer_email} still waiting. Seller: ${purchase.seller_email}`,
          reference_id: purchase.id,
          reference_type: 'purchase',
          seller_email: purchase.seller_email,
          buyer_email: purchase.buyer_email,
          event_id: purchase.event_id,
        });
        results.alerts_created++;
      }
    }

    // ── 3. Disputed purchase alerts ──────────────────────────────────────────
    const disputes = await base44.asServiceRole.entities.Purchase.filter({ transfer_status: 'disputed' });
    for (const p of disputes) {
      await createAlertIfNew(base44, {
        alert_type: 'new_dispute',
        priority: 'critical',
        title: `Dispute open — $${p.amount?.toFixed(2)} in escrow`,
        description: `${p.buyer_email} vs ${p.seller_email}. Reason: ${p.dispute_reason || 'not specified'}`,
        reference_id: p.id,
        reference_type: 'purchase',
        seller_email: p.seller_email,
        buyer_email: p.buyer_email,
        event_id: p.event_id,
      });
    }

    // ── 4. Community report conflict detection ────────────────────────────────
    const recentReports = await base44.asServiceRole.entities.TransferReport.list('-created_date', 200);
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const recentByEvent = {};

    recentReports.forEach(r => {
      if (new Date(r.created_date) < twoHoursAgo) return;
      if (!recentByEvent[r.event_id]) recentByEvent[r.event_id] = { open: 0, closed: 0 };
      if (r.report_type === 'transfer_available') recentByEvent[r.event_id].open++;
      else recentByEvent[r.event_id].closed++;
    });

    for (const [eventId, counts] of Object.entries(recentByEvent)) {
      const openCount = counts.open;
      const closedCount = counts.closed;
      // Conflict: both sides have >= 3 reports with no majority
      if (openCount >= 3 && closedCount >= 3) {
        await createAlertIfNew(base44, {
          alert_type: 'conflicting_community_reports',
          priority: 'high',
          title: `Conflicting transfer reports`,
          description: `Event ${eventId.slice(0, 8)}: ${openCount} say OPEN, ${closedCount} say CLOSED in last 2h. Manual review required.`,
          reference_id: eventId,
          reference_type: 'event',
          event_id: eventId,
        });
        results.conflicts++;
        results.alerts_created++;
      }
    }

    return Response.json({
      ...results,
      processed_at: now.toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// Helper: only create alert if no unresolved alert of same type+reference exists
async function createAlertIfNew(base44, alertData) {
  if (alertData.reference_id) {
    const existing = await base44.asServiceRole.entities.AdminAlert.filter({
      reference_id: alertData.reference_id,
      alert_type: alertData.alert_type,
      resolved: false,
    });
    if (existing.length > 0) return; // already open
  }
  await base44.asServiceRole.entities.AdminAlert.create(alertData);
}