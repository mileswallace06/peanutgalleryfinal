import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
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

    const { listing_id, reason } = await req.json();
    if (!listing_id) {
      return Response.json({ success: false, reason: 'listing_id is required' }, { status: 400 });
    }
    if (!reason || !reason.trim()) {
      return Response.json({ success: false, reason: 'A rejection reason is required' }, { status: 400 });
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

    // 4. Mutate listing (server-side only)
    await base44.asServiceRole.entities.Listing.update(listing_id, {
      proof_status: 'rejected',
      status: 'hidden',
      hidden_reason: 'admin_disabled',
      proof_rejection_reason: reason.trim(),
    });
    // Phase 1B: mirror proof_status + proof_rejection_reason to ListingPrivate (authoritative)
    try {
      await upsertListingPrivate(base44, listing_id, { proof_status: 'rejected', proof_rejection_reason: reason.trim() });
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'ListingPrivate', reference_id: listing_id, reference_type: 'listing', error: err });
      return Response.json({ success: false, reason: 'Failed to update private proof record. Please try again.' }, { status: 500 });
    }

    // 5. Audit log
    await base44.asServiceRole.entities.BetaTransferLog.create({
      log_type: 'listing_hidden',
      actor_email: user.email,
      actor_role: 'admin',
      listing_id: listing_id,
      before_state: { proof_status: listing.proof_status, status: listing.status },
      after_state: { proof_status: 'rejected', status: 'hidden', hidden_reason: 'admin_disabled' },
      notes: `Admin rejected listing. Reason: ${reason.trim()}`,
    });

    // 6. Notify seller (fire-and-forget, shared module — in-process)
    recordNotification(base44, {
      user_email: authoritativeSellerEmail,
      type: 'listing_rejected',
      title: 'Listing not approved',
      body: `Your listing (Sec ${listing.section}, Row ${listing.row}) was not approved. Reason: ${reason.trim()}`,
      reference_id: listing_id,
      reference_type: 'listing',
      action_url: '/my-sales',
    }).catch(err => console.error('[rejectListingReview] notify failed:', err?.message));

    return Response.json({ success: true });

  } catch (error) {
    console.error('[rejectListingReview] error:', error?.message);
    return Response.json({ success: false, reason: error.message }, { status: 500 });
  }
});