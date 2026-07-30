import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive } from '../../shared/maintenance.ts';
import { getUserPrivate, getUserSecurityProfile } from '../../shared/privateData.ts';

/**
 * Automated account deletion — permanently removes all user data
 * across every entity in the app to comply with data privacy regulations.
 *
 * Phase 1B cutover:
 *   - UserSecurityProfile is authoritative for Stripe/trust/security fields
 *   - UserPrivate + PublicProfile are deleted safely
 *   - Owned ProofAssets / private sidecars are removed
 *   - Financial/audit records (Purchase, TransferOutcome, TransferIntelligence)
 *     are ANONYMIZED (not deleted) to preserve compliance trails
 *   - Admin can specify a target email; non-admins can only delete their own account
 *   - Idempotent: safe to call multiple times
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    // Admin can specify a target email; non-admins can only delete their own account
    const isAdmin = user.role === 'admin';
    const targetEmail = isAdmin && body?.email ? body.email : user.email;

    // Never delete another user's data — verify caller is the owner or an admin
    if (targetEmail !== user.email && !isAdmin) {
      return Response.json({ error: 'Forbidden: can only delete your own account' }, { status: 403 });
    }

    const sr = base44.asServiceRole;
    const results = {};

    // Phase 1B: use private records to identify everything owned by the account
    const userPrivate = await getUserPrivate(base44, targetEmail);
    const secProfile = await getUserSecurityProfile(base44, { user_email: targetEmail });
    const publicProfileId = userPrivate?.public_profile_id || null;

    // Look up target User record (for clearing custom fields)
    const targetUsers = await sr.entities.User.filter({ email: targetEmail }).catch(() => []);
    const targetUserId = targetUsers[0]?.id || null;

    // ── 1. Cancel active Stripe payment intents (maintenance-gated) ──────
    if (!isMaintenanceActive()) {
      const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
      if (secretKey && (secretKey.startsWith('sk_test_') || secretKey.startsWith('sk_live_'))) {
        const stripe = new Stripe(secretKey);
        const [buyerPurchases, sellerPurchases] = await Promise.all([
          sr.entities.Purchase.filter({ buyer_email: targetEmail }).catch(() => []),
          sr.entities.Purchase.filter({ seller_email: targetEmail }).catch(() => []),
        ]);
        const uncaptured = [...buyerPurchases, ...sellerPurchases].filter(
          p => p.payment_intent_id && !p.payment_captured
        );
        await Promise.all(uncaptured.map(p =>
          stripe.paymentIntents.cancel(p.payment_intent_id).catch(() => {})
        ));
        results.stripe_intents_cancelled = uncaptured.length;
      }
    } else {
      results.stripe_intents_cancelled = 0;
    }

    // ── 2. Cancel active listings ─────────────────────────────────────────
    const userListings = await sr.entities.Listing.filter({ seller_email: targetEmail }).catch(() => []);
    const activeListings = userListings.filter(l =>
      ['active', 'pending_transfer', 'pending_payout_setup', 'pending_verification'].includes(l.status)
    );
    await Promise.all(activeListings.map(l =>
      sr.entities.Listing.update(l.id, {
        status: 'cancelled',
        reservation_token: null,
        reservation_expires_at: null,
        reserved_by_email: null,
      }).catch(() => {})
    ));
    results.listings_cancelled = activeListings.length;

    // ── 3. Remove user's email from FanPost reactions ────────────────────
    const pullReactions = sr.entities.FanPost.updateMany(
      {},
      { $pull: { 'reactions.fire': targetEmail, 'reactions.eyes': targetEmail, 'reactions.peanut': targetEmail } }
    ).catch(() => {});

    // ── 4. Anonymize financial/audit records (preserve for compliance) ────
    const anonymizeTasks = [
      sr.entities.Purchase.updateMany({ buyer_email: targetEmail }, { $set: { buyer_email: 'deleted@account.local', buyer_phone: null } }).catch(() => {}),
      sr.entities.Purchase.updateMany({ seller_email: targetEmail }, { $set: { seller_email: 'deleted@account.local' } }).catch(() => {}),
      sr.entities.TransferOutcome.updateMany({ seller_email: targetEmail }, { $set: { seller_email: 'deleted@account.local' } }).catch(() => {}),
      sr.entities.TransferOutcome.updateMany({ buyer_email: targetEmail }, { $set: { buyer_email: 'deleted@account.local' } }).catch(() => {}),
      sr.entities.TransferIntelligence.updateMany({ seller_email: targetEmail }, { $set: { seller_email: 'deleted@account.local' } }).catch(() => {}),
      sr.entities.TransferIntelligence.updateMany({ buyer_email: targetEmail }, { $set: { buyer_email: 'deleted@account.local' } }).catch(() => {}),
    ];

    // ── 5. Delete user-owned records (non-financial) ─────────────────────
    const deletionTasks = [
      sr.entities.Listing.deleteMany({ seller_email: targetEmail }),
      sr.entities.Notification.deleteMany({ user_email: targetEmail }),
      sr.entities.BetaFeedbackEvent.deleteMany({ user_email: targetEmail }),
      sr.entities.BetaTester.deleteMany({ user_email: targetEmail }),
      sr.entities.BetaTester.deleteMany({ email: targetEmail }),
      sr.entities.PointsActivity.deleteMany({ user_email: targetEmail }),
      sr.entities.FlashDrop.deleteMany({ donor_email: targetEmail }),
      sr.entities.SeatInventory.deleteMany({ owner_email: targetEmail }),
      sr.entities.FlashDropEntry.deleteMany({ entrant_email: targetEmail }),
      sr.entities.BetaTransferLog.deleteMany({ actor_email: targetEmail }),
      sr.entities.TransferVerificationLog.deleteMany({ seller_email: targetEmail }),
      sr.entities.TransferReport.deleteMany({ reporter_email: targetEmail }),
      sr.entities.SeatDonation.deleteMany({ donor_email: targetEmail }),
      sr.entities.DonationOptIn.deleteMany({ user_email: targetEmail }),
      sr.entities.EventNavigationLog.deleteMany({ user_email: targetEmail }),
      sr.entities.FanPost.deleteMany({ author_email: targetEmail }),
      sr.entities.Follow.deleteMany({ follower_email: targetEmail }),
      sr.entities.Follow.deleteMany({ following_email: targetEmail }),
      sr.entities.BucketListItem.deleteMany({ user_email: targetEmail }),
      sr.entities.AdminAlert.deleteMany({ seller_email: targetEmail }),
      sr.entities.AdminAlert.deleteMany({ buyer_email: targetEmail }),
    ].map(p => p.catch(e => console.warn('[deleteAccount] entity delete error:', e?.message)));

    // ── 6. Phase 1B: delete private sidecar entities ─────────────────────
    const privateDeletions = [
      // ListingPrivate: delete all private records owned by this seller
      (async () => {
        const lps = await sr.entities.ListingPrivate.filter({ seller_email: targetEmail }).catch(() => []);
        await Promise.all(lps.map(lp => sr.entities.ListingPrivate.delete(lp.id).catch(() => {})));
      })(),
      // PurchasePrivate: delete all private records for this buyer/seller
      sr.entities.PurchasePrivate.deleteMany({ buyer_email: targetEmail }).catch(() => {}),
      sr.entities.PurchasePrivate.deleteMany({ seller_email: targetEmail }).catch(() => {}),
      // ProofAsset: remove owned assets
      sr.entities.ProofAsset.deleteMany({ owner_email: targetEmail }).catch(() => {}),
      // UserSecurityProfile: delete
      (async () => {
        if (secProfile) await sr.entities.UserSecurityProfile.delete(secProfile.id).catch(() => {});
      })(),
      // UserPrivate: delete
      (async () => {
        if (userPrivate) await sr.entities.UserPrivate.delete(userPrivate.id).catch(() => {});
      })(),
      // PublicProfile: delete
      (async () => {
        if (publicProfileId) {
          const pubRows = await sr.entities.PublicProfile.filter({ public_profile_id: publicProfileId }).catch(() => []);
          await Promise.all(pubRows.map(p => sr.entities.PublicProfile.delete(p.id).catch(() => {})));
        }
      })(),
    ];

    await Promise.all([pullReactions, ...deletionTasks, ...privateDeletions, ...anonymizeTasks]);
    results.entities_deleted = deletionTasks.length;
    results.private_records_removed = privateDeletions.length;
    results.financial_records_anonymized = anonymizeTasks.length;

    // ── 7. Clear user profile fields + send confirmation email ────────────
    const [userUpdate, emailResult] = await Promise.allSettled([
      targetUserId
        ? sr.entities.User.update(targetUserId, {
            has_seen_onboarding: false,
            stripe_account_id: null,
            stripe_onboarding_complete: false,
          })
        : Promise.resolve(),
      base44.integrations.Core.SendEmail({
        to: targetEmail,
        subject: 'Your Peanut Gallery account has been deleted',
        body: `Hi there,\n\nYour Peanut Gallery account and all associated data have been permanently deleted as of ${new Date().toISOString()}.\n\nThis includes all listings, notifications, profile data, fan posts, follows, and bucket list items. Financial/audit records have been anonymized but retained for compliance.\n\nThis action cannot be reversed.\n\nIf you did not request this, please contact experience@peanutgallery.store immediately.\n\n— Peanut Gallery Team`,
      }),
    ]);
    results.user_profile_cleared = userUpdate.status === 'fulfilled';
    results.confirmation_email_sent = emailResult.status === 'fulfilled';

    results.deleted_at = new Date().toISOString();
    results.email = targetEmail;

    return Response.json({ success: true, ...results });
  } catch (error) {
    console.error('[deleteAccount] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});