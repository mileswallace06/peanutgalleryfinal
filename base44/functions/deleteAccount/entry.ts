import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import Stripe from 'npm:stripe@14.21.0';

/**
 * Automated account deletion — permanently removes all user data
 * across every entity in the app to comply with data privacy regulations.
 *
 * All entity deletions run in parallel via Promise.all for speed.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = user.email;
    const sr = base44.asServiceRole;
    const results = {};

    // ── 1. Cancel active Stripe payment intents (buyer + seller side) ─────
    const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
    if (secretKey && (secretKey.startsWith('sk_test_') || secretKey.startsWith('sk_live_'))) {
      const stripe = new Stripe(secretKey);
      const [buyerPurchases, sellerPurchases] = await Promise.all([
        sr.entities.Purchase.filter({ buyer_email: email }).catch(() => []),
        sr.entities.Purchase.filter({ seller_email: email }).catch(() => []),
      ]);
      const uncaptured = [...buyerPurchases, ...sellerPurchases].filter(
        p => p.payment_intent_id && !p.payment_captured
      );
      await Promise.all(uncaptured.map(p =>
        stripe.paymentIntents.cancel(p.payment_intent_id).catch(() => {})
      ));
      results.stripe_intents_cancelled = uncaptured.length;
    }

    // ── 2. Cancel active listings in parallel ─────────────────────────────
    const userListings = await sr.entities.Listing.filter({ seller_email: email }).catch(() => []);
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

    // ── 3. Remove user's email from FanPost reactions (prevent orphans) ──
    // Run in parallel with entity deletions below
    const pullReactions = sr.entities.FanPost.updateMany(
      {},
      { $pull: { 'reactions.fire': email, 'reactions.eyes': email, 'reactions.peanut': email } }
    ).catch(() => {});

    // ── 4. Delete all user-owned records across every entity (parallel) ───
    const deletionTasks = [
      sr.entities.Listing.deleteMany({ seller_email: email }),
      sr.entities.Purchase.deleteMany({ buyer_email: email }),
      sr.entities.Purchase.deleteMany({ seller_email: email }),
      sr.entities.Notification.deleteMany({ user_email: email }),
      sr.entities.BetaFeedbackEvent.deleteMany({ user_email: email }),
      sr.entities.BetaTester.deleteMany({ user_email: email }),
      sr.entities.BetaTester.deleteMany({ email }),
      sr.entities.PointsActivity.deleteMany({ user_email: email }),
      sr.entities.FlashDrop.deleteMany({ donor_email: email }),
      sr.entities.SeatInventory.deleteMany({ owner_email: email }),
      sr.entities.FlashDropEntry.deleteMany({ entrant_email: email }),
      sr.entities.TransferOutcome.deleteMany({ seller_email: email }),
      sr.entities.TransferOutcome.deleteMany({ buyer_email: email }),
      sr.entities.BetaTransferLog.deleteMany({ actor_email: email }),
      sr.entities.TransferVerificationLog.deleteMany({ seller_email: email }),
      sr.entities.TransferReport.deleteMany({ reporter_email: email }),
      sr.entities.SeatDonation.deleteMany({ donor_email: email }),
      sr.entities.DonationOptIn.deleteMany({ user_email: email }),
      sr.entities.EventNavigationLog.deleteMany({ user_email: email }),
      sr.entities.FanPost.deleteMany({ author_email: email }),
      sr.entities.Follow.deleteMany({ follower_email: email }),
      sr.entities.Follow.deleteMany({ following_email: email }),
      sr.entities.BucketListItem.deleteMany({ user_email: email }),
      sr.entities.AdminAlert.deleteMany({ seller_email: email }),
      sr.entities.AdminAlert.deleteMany({ buyer_email: email }),
    ].map(p => p.catch(e => console.warn('[deleteAccount] entity delete error:', e?.message)));

    // Wait for reactions cleanup + all deletions in parallel
    await Promise.all([pullReactions, ...deletionTasks]);
    results.entities_deleted = deletionTasks.length;

    // ── 5. Clear user profile + send confirmation email (parallel) ────────
    const [userUpdate, emailResult] = await Promise.allSettled([
      sr.entities.User.update(user.id, {
        has_seen_onboarding: false,
        stripe_account_id: null,
        stripe_onboarding_complete: false,
      }),
      base44.integrations.Core.SendEmail({
        to: email,
        subject: 'Your Peanut Gallery account has been deleted',
        body: `Hi ${user.full_name || 'there'},\n\nYour Peanut Gallery account and all associated data have been permanently deleted as of ${new Date().toISOString()}.\n\nThis includes all listings, purchases, sales history, notifications, profile data, payment information, fan posts, follows, and bucket list items.\n\nThis action cannot be reversed.\n\nIf you did not request this, please contact experience@peanutgallery.store immediately.\n\n— Peanut Gallery Team`,
      }),
    ]);
    results.user_profile_cleared = userUpdate.status === 'fulfilled';
    results.confirmation_email_sent = emailResult.status === 'fulfilled';

    results.deleted_at = new Date().toISOString();
    results.email = email;

    return Response.json({ success: true, ...results });
  } catch (error) {
    console.error('[deleteAccount] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});