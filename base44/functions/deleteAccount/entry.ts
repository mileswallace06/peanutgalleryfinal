import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { getUserPrivate, getUserSecurityProfile } from '../../shared/privateData.ts';
import { createAccountPseudonym, evaluateAccountDeletion, runCriticalDeletionSteps } from '../../shared/accountDeletionPolicy.js';

const READ_LIMIT = 500;

class PreflightReadError extends Error {
  code: string;
  constructor(code = 'ACCOUNT_DELETION_PRECHECK_FAILED') {
    super('Account deletion preflight failed');
    this.code = code;
  }
}

function dedupeBy(rows: any[], key: string) {
  return [...new Map(rows.filter(Boolean).map(row => [row?.[key], row])).values()];
}

async function readRows(entity: any, query: Record<string, unknown>) {
  const rows = await entity.filter(query, '-created_date', READ_LIMIT);
  if (!Array.isArray(rows)) throw new PreflightReadError();
  if (rows.length >= READ_LIMIT) throw new PreflightReadError('ACCOUNT_DELETION_PRECHECK_INCOMPLETE');
  return rows;
}

async function readOne(entity: any, id: string) {
  return (await readRows(entity, { id }))[0] || null;
}

async function collectDeletionSnapshot(sr: any, targetEmail: string) {
  const [buyerPurchases, sellerPurchases, buyerPPs, sellerPPs, sellerListings, sellerLPs, sellerAlerts, buyerAlerts] = await Promise.all([
    readRows(sr.entities.Purchase, { buyer_email: targetEmail }),
    readRows(sr.entities.Purchase, { seller_email: targetEmail }),
    readRows(sr.entities.PurchasePrivate, { buyer_email: targetEmail }),
    readRows(sr.entities.PurchasePrivate, { seller_email: targetEmail }),
    readRows(sr.entities.Listing, { seller_email: targetEmail }),
    readRows(sr.entities.ListingPrivate, { seller_email: targetEmail }),
    readRows(sr.entities.AdminAlert, { seller_email: targetEmail, resolved: false }),
    readRows(sr.entities.AdminAlert, { buyer_email: targetEmail, resolved: false }),
  ]);

  let purchases = dedupeBy([...buyerPurchases, ...sellerPurchases], 'id');
  let purchasePrivates = dedupeBy([...buyerPPs, ...sellerPPs], 'purchase_id');
  let listings = dedupeBy(sellerListings, 'id');
  let listingPrivates = dedupeBy(sellerLPs, 'listing_id');
  const ownedListingIds = new Set([...sellerListings.map((r: any) => r.id), ...sellerLPs.map((r: any) => r.listing_id)].filter(Boolean));

  for (const pp of purchasePrivates) {
    if (pp.purchase_id && !purchases.some((r: any) => r.id === pp.purchase_id)) {
      const row = await readOne(sr.entities.Purchase, pp.purchase_id);
      if (row) purchases.push(row);
    }
  }
  for (const lp of listingPrivates) {
    if (lp.listing_id && !listings.some((r: any) => r.id === lp.listing_id)) {
      const row = await readOne(sr.entities.Listing, lp.listing_id);
      if (row) listings.push(row);
    }
  }
  for (const listingId of ownedListingIds) {
    purchases = dedupeBy([...purchases, ...await readRows(sr.entities.Purchase, { listing_id: listingId })], 'id');
  }
  for (const purchase of purchases) {
    if (!purchasePrivates.some((r: any) => r.purchase_id === purchase.id)) {
      purchasePrivates = dedupeBy([...purchasePrivates, ...await readRows(sr.entities.PurchasePrivate, { purchase_id: purchase.id })], 'purchase_id');
    }
    if (purchase.listing_id && !listings.some((r: any) => r.id === purchase.listing_id)) {
      const row = await readOne(sr.entities.Listing, purchase.listing_id);
      if (row) listings.push(row);
    }
  }
  for (const listingId of ownedListingIds) {
    if (!listingPrivates.some((r: any) => r.listing_id === listingId)) {
      listingPrivates = dedupeBy([...listingPrivates, ...await readRows(sr.entities.ListingPrivate, { listing_id: listingId })], 'listing_id');
    }
  }

  return {
    targetEmail,
    purchases: dedupeBy(purchases, 'id'),
    purchasePrivates: dedupeBy(purchasePrivates, 'purchase_id'),
    listings: dedupeBy(listings, 'id'),
    listingPrivates: dedupeBy(listingPrivates, 'listing_id'),
    unresolvedAlerts: dedupeBy([...sellerAlerts, ...buyerAlerts], 'id'),
    ownedListingIds: [...ownedListingIds],
  };
}

async function updateAndVerify(entity: any, query: Record<string, unknown>, fields: Record<string, unknown>) {
  if ((await readRows(entity, query)).length === 0) return;
  await entity.updateMany(query, { $set: fields });
  if ((await readRows(entity, query)).length > 0) throw new Error('Anonymization verification failed');
}

async function deleteAndVerify(entity: any, query: Record<string, unknown>) {
  if ((await readRows(entity, query)).length === 0) return;
  await entity.deleteMany(query);
  if ((await readRows(entity, query)).length > 0) throw new Error('Deletion verification failed');
}

async function deleteRecordAndVerify(entity: any, id: string) {
  await entity.delete(id);
  if ((await readRows(entity, { id })).length > 0) throw new Error('Record deletion verification failed');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const isAdmin = user.role === 'admin';
    const targetEmail = isAdmin && body?.email ? body.email : user.email;
    if (targetEmail !== user.email && !isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const sr = base44.asServiceRole;
    let snapshot;
    try {
      snapshot = await collectDeletionSnapshot(sr, targetEmail);
    } catch (error) {
      return Response.json({
        error: 'We could not verify that every purchase, payment, transfer, listing, payout, and dispute is settled. Nothing was changed.',
        code: error instanceof PreflightReadError ? error.code : 'ACCOUNT_DELETION_PRECHECK_FAILED',
      }, { status: 503 });
    }

    const decision = evaluateAccountDeletion(snapshot);
    if (!decision.allowed) {
      return Response.json({
        error: 'Account-data removal is blocked until all active listings, purchases, ticket transfers, payments, payouts, reviews, and disputes are resolved.',
        code: 'ACCOUNT_DELETION_BLOCKED_ACTIVE_OBLIGATIONS',
        obligation_codes: [...new Set(decision.blockers.map(item => item.code))],
        obligation_count: decision.blockers.length,
      }, { status: 409 });
    }

    // Every operation above is a read. Mutations begin only after the complete
    // fail-closed decision succeeds.
    const [userPrivate, secProfile, targetUsers] = await Promise.all([
      getUserPrivate(base44, targetEmail),
      getUserSecurityProfile(base44, { user_email: targetEmail }),
      readRows(sr.entities.User, { email: targetEmail }),
    ]);
    const targetUser = targetUsers[0] || null;
    const targetUserId = targetUser?.id || userPrivate?.user_id || null;
    const pseudonym = await createAccountPseudonym(targetEmail, targetUserId);

    const steps = [
      { name: 'purchase_buyer_anonymization', run: () => updateAndVerify(sr.entities.Purchase, { buyer_email: targetEmail }, { buyer_email: pseudonym, buyer_name: 'Deleted account', buyer_phone: null, buyer_lat: null, buyer_lng: null }) },
      { name: 'purchase_seller_anonymization', run: () => updateAndVerify(sr.entities.Purchase, { seller_email: targetEmail }, { seller_email: pseudonym }) },
      { name: 'purchase_private_buyer_anonymization', run: () => updateAndVerify(sr.entities.PurchasePrivate, { buyer_email: targetEmail }, { buyer_email: pseudonym, buyer_name: 'Deleted account', buyer_phone: null, buyer_lat: null, buyer_lng: null, frozen_buyer_email: pseudonym, ai_extracted_recipient: null }) },
      { name: 'purchase_private_seller_anonymization', run: () => updateAndVerify(sr.entities.PurchasePrivate, { seller_email: targetEmail }, { seller_email: pseudonym }) },
      { name: 'listing_anonymization', run: () => updateAndVerify(sr.entities.Listing, { seller_email: targetEmail }, { seller_email: pseudonym }) },
      { name: 'listing_private_anonymization', run: () => updateAndVerify(sr.entities.ListingPrivate, { seller_email: targetEmail }, { seller_email: pseudonym }) },
      { name: 'proof_asset_anonymization', run: () => updateAndVerify(sr.entities.ProofAsset, { owner_email: targetEmail }, { owner_email: pseudonym }) },
      { name: 'transfer_outcome_buyer_anonymization', run: () => updateAndVerify(sr.entities.TransferOutcome, { buyer_email: targetEmail }, { buyer_email: pseudonym }) },
      { name: 'transfer_outcome_seller_anonymization', run: () => updateAndVerify(sr.entities.TransferOutcome, { seller_email: targetEmail }, { seller_email: pseudonym }) },
      { name: 'transfer_intelligence_buyer_anonymization', run: () => updateAndVerify(sr.entities.TransferIntelligence, { buyer_email: targetEmail }, { buyer_email: pseudonym }) },
      { name: 'transfer_intelligence_seller_anonymization', run: () => updateAndVerify(sr.entities.TransferIntelligence, { seller_email: targetEmail }, { seller_email: pseudonym }) },
      { name: 'transfer_verification_anonymization', run: () => updateAndVerify(sr.entities.TransferVerificationLog, { seller_email: targetEmail }, { seller_email: pseudonym }) },
      { name: 'transfer_report_anonymization', run: () => updateAndVerify(sr.entities.TransferReport, { reporter_email: targetEmail }, { reporter_email: pseudonym }) },
      { name: 'transfer_log_anonymization', run: () => updateAndVerify(sr.entities.BetaTransferLog, { actor_email: targetEmail }, { actor_email: pseudonym }) },
      { name: 'points_ledger_anonymization', run: () => updateAndVerify(sr.entities.PointsActivity, { user_email: targetEmail }, { user_email: pseudonym }) },
      { name: 'admin_alert_buyer_anonymization', run: () => updateAndVerify(sr.entities.AdminAlert, { buyer_email: targetEmail }, { buyer_email: pseudonym }) },
      { name: 'admin_alert_seller_anonymization', run: () => updateAndVerify(sr.entities.AdminAlert, { seller_email: targetEmail }, { seller_email: pseudonym }) },
      { name: 'reaction_removal', run: () => sr.entities.FanPost.updateMany({}, { $pull: { 'reactions.fire': targetEmail, 'reactions.eyes': targetEmail, 'reactions.peanut': targetEmail } }) },
      { name: 'notification_removal', run: () => deleteAndVerify(sr.entities.Notification, { user_email: targetEmail }) },
      { name: 'beta_tester_user_removal', run: () => deleteAndVerify(sr.entities.BetaTester, { user_email: targetEmail }) },
      { name: 'beta_tester_email_removal', run: () => deleteAndVerify(sr.entities.BetaTester, { email: targetEmail }) },
      { name: 'navigation_log_removal', run: () => deleteAndVerify(sr.entities.EventNavigationLog, { user_email: targetEmail }) },
      { name: 'fan_post_removal', run: () => deleteAndVerify(sr.entities.FanPost, { author_email: targetEmail }) },
      { name: 'follower_removal', run: () => deleteAndVerify(sr.entities.Follow, { follower_email: targetEmail }) },
      { name: 'following_removal', run: () => deleteAndVerify(sr.entities.Follow, { following_email: targetEmail }) },
      { name: 'bucket_list_removal', run: () => deleteAndVerify(sr.entities.BucketListItem, { user_email: targetEmail }) },
      { name: 'donation_opt_in_removal', run: () => deleteAndVerify(sr.entities.DonationOptIn, { user_email: targetEmail }) },
      ...(targetUserId ? [{ name: 'feedback_removal', run: () => deleteAndVerify(sr.entities.BetaFeedbackEvent, { submitter_user_id: targetUserId }) }] : []),
      ...(targetUser ? [{ name: 'app_user_profile_clear', run: () => sr.entities.User.update(targetUser.id, { bio: null, avatar_url: null, banner_url: null, persona_name: null, persona_style: null, has_seen_onboarding: false, stripe_account_id: null, stripe_onboarding_complete: false, trust_badges: [], achievements: [], referral_code: null, referred_by: null }) }] : []),
      ...(userPrivate?.public_profile_id ? [{ name: 'public_profile_removal', run: async () => { for (const row of await readRows(sr.entities.PublicProfile, { public_profile_id: userPrivate.public_profile_id })) await deleteRecordAndVerify(sr.entities.PublicProfile, row.id); } }] : []),
      ...(secProfile ? [{ name: 'security_profile_removal', run: () => deleteRecordAndVerify(sr.entities.UserSecurityProfile, secProfile.id) }] : []),
      ...(userPrivate ? [{ name: 'private_profile_removal', run: () => deleteRecordAndVerify(sr.entities.UserPrivate, userPrivate.id) }] : []),
    ];

    let completedSteps: string[];
    try {
      completedSteps = await runCriticalDeletionSteps(steps);
    } catch (error: any) {
      console.error('[deleteAccount] critical step failed:', error?.step || 'unknown');
      return Response.json({
        error: 'Account-data removal stopped because a required step could not be verified. Completion was not reported; contact support before retrying.',
        code: 'ACCOUNT_REMOVAL_INCOMPLETE',
        failed_step: error?.step || 'unknown',
        completed_steps: error?.completedSteps || [],
      }, { status: 500 });
    }

    let confirmationEmailSent = false;
    try {
      await base44.integrations.Core.SendEmail({
        to: targetEmail,
        subject: 'Your Peanut Gallery account-data removal was processed',
        body: `Hi there,\n\nYour Peanut Gallery public profile and non-required personal app data were removed as of ${new Date().toISOString()}.\n\nPurchase, sale, payment, payout, transfer, dispute, fraud-prevention, and audit records are retained when required for transaction integrity, legal compliance, security, or dispute handling. Eligible direct identity fields were replaced with a pseudonymous account marker. Transaction-linked listings and proof history were retained so those records remain complete.\n\nBase44 authentication identity removal is not performed by this in-app process. Contact experience@peanutgallery.store if you also need help with the underlying login identity.\n\n— Peanut Gallery Team`,
      });
      confirmationEmailSent = true;
    } catch (_) { /* informational only, after critical completion */ }

    return Response.json({
      success: true,
      status: 'ACCOUNT_APP_DATA_REMOVED_AND_AUDIT_HISTORY_PRESERVED',
      completed_steps: completedSteps,
      confirmation_email_sent: confirmationEmailSent,
      auth_identity_deleted: false,
      financial_and_audit_records_retained: true,
      processed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[deleteAccount] unexpected error class:', error?.constructor?.name || 'Error');
    return Response.json({ error: 'Account-data removal could not be completed. Nothing should be considered complete; contact support.', code: 'ACCOUNT_REMOVAL_FAILED' }, { status: 500 });
  }
});
