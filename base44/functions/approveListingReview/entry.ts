import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503, isProofScanningEnabled, proofScannerUnavailable503 } from '../../shared/maintenance.ts';
import { recordNotification } from '../../shared/notifications.ts';
import { getListingPrivate, upsertListingPrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // 1. Verify authenticated
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ success: false, reason: 'Unauthorized' }, { status: 401 });
    }

    // 2. Verify admin role
    if (user.role !== 'admin') {
      return Response.json({ success: false, reason: 'Forbidden: admin access required' }, { status: 403 });
    }

    if (isMaintenanceActive()) return maintenance503('Listing review is temporarily unavailable for scheduled maintenance.');
    if (!isProofScanningEnabled()) return proofScannerUnavailable503();

    const { listing_id } = await req.json();
    if (!listing_id) {
      return Response.json({ success: false, reason: 'listing_id is required' }, { status: 400 });
    }

    // 3. Fetch listing
    const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
    const listing = listings[0];
    if (!listing) {
      return Response.json({ success: false, reason: 'Listing not found' }, { status: 404 });
    }

    // Phase 1B: read authoritative proof_status + seller_email from ListingPrivate
    const lp = await getListingPrivate(base44, listing.id);
    const authoritativeProofStatus = lp?.proof_status ?? listing.proof_status;
    const authoritativeSellerEmail = lp?.seller_email ?? listing.seller_email;

    if (authoritativeProofStatus !== 'pending_review') {
      return Response.json({ success: false, reason: `Listing is not pending review (current: ${authoritativeProofStatus})` }, { status: 409 });
    }

    // Phase 1B: approve/reject operate ONLY on the current proof asset — an older
    // superseded asset cannot be reviewed accidentally.
    const currentAssetId = lp?.current_proof_asset_id;
    if (!currentAssetId) {
      return Response.json({ success: false, reason: 'No current proof asset. Upload proof before review.' }, { status: 409 });
    }
    const [currentAsset] = await base44.asServiceRole.entities.ProofAsset.filter({ id: currentAssetId }).catch(() => []);
    if (!currentAsset || currentAsset.superseded_by_asset_id) {
      return Response.json({ success: false, reason: 'Current proof asset is superseded or missing. Upload new proof.' }, { status: 409 });
    }

    // 4. Mutate listing (server-side only)
    await base44.asServiceRole.entities.Listing.update(listing_id, {
      proof_status: 'approved',
      status: 'active',
    });
    // Phase 1B: mirror proof_status to ListingPrivate (authoritative)
    try {
      await upsertListingPrivate(base44, listing_id, { proof_status: 'approved' });
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing_id, reference_type: 'listing', error: err });
      return Response.json({ success: false, reason: 'Failed to update private proof record. Please try again.' }, { status: 500 });
    }

    // 5. Audit log
    await base44.asServiceRole.entities.BetaTransferLog.create({
      log_type: 'listing_restored',
      actor_email: user.email,
      actor_role: 'admin',
      listing_id: listing_id,
      before_state: { proof_status: listing.proof_status, status: listing.status },
      after_state: { proof_status: 'approved', status: 'active' },
      notes: `Admin approved listing via Review Queue`,
    });

    // 6. Notify seller (fire-and-forget, shared module — in-process)
    recordNotification(base44, {
      user_email: authoritativeSellerEmail,
      type: 'listing_approved',
      title: 'Listing approved ✅',
      body: `Your listing (Sec ${listing.section}, Row ${listing.row}) is now live and visible to buyers.`,
      reference_id: listing_id,
      reference_type: 'listing',
      action_url: '/my-sales',
    }).catch(err => console.error('[approveListingReview] notify failed:', err?.message));

    return Response.json({ success: true });

  } catch (error) {
    console.error('[approveListingReview] error:', error?.message);
    return Response.json({ success: false, reason: error.message }, { status: 500 });
  }
});