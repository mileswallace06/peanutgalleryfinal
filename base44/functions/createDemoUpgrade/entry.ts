/**
 * createDemoUpgrade — Server-side creation of a simulated demo-upgrade purchase.
 *
 * Demo records never touch real revenue, points, trust, transfer intelligence,
 * or operational analytics:
 *   - amount / subtotal / platform_fee / seller_payout are all 0
 *   - is_demo = true (recordTransferOutcome skips demo purchases)
 *   - no Stripe PaymentIntent is created
 *   - no points are awarded
 *   - purchase analytics already exclude amount === 0 records
 *
 * Body: { listing_id }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertPurchasePrivate, getListingPrivate } from '../../shared/privateData.ts';

const UPGRADE_LISTING_TYPES = ['live_upgrade', 'venue_upgrade'];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isMaintenanceActive()) return maintenance503('Demo upgrades are temporarily unavailable for scheduled maintenance.');

  const { listing_id } = await req.json().catch(() => ({}));
  if (!listing_id) {
    return Response.json({ error: 'listing_id is required' }, { status: 400 });
  }

  const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) {
    return Response.json({ error: 'Listing not found' }, { status: 404 });
  }

  // Only demo upgrade listings are eligible.
  const isDemo = listing.is_demo_listing || (listing.notes || '').startsWith('[DEMO]');
  const isUpgrade = UPGRADE_LISTING_TYPES.includes(listing.listing_type);
  if (!isDemo || !isUpgrade) {
    return Response.json({ error: 'This listing is not a demo upgrade' }, { status: 400 });
  }

  // buyer_email is always the authenticated user.
  const buyerEmail = user.email;

  // Phase 1B: read authoritative seller_email from ListingPrivate
  const lp = await getListingPrivate(base44, listing.id);
  const authoritativeSellerEmail = lp?.seller_email ?? listing.seller_email;

  const purchase = await base44.asServiceRole.entities.Purchase.create({
    listing_id: listing.id,
    event_id: listing.event_id,
    buyer_email: buyerEmail,
    buyer_name: 'Demo User',
    seller_email: authoritativeSellerEmail,
    amount: 0,
    subtotal: 0,
    platform_fee: 0,
    seller_payout: 0,
    quantity: listing.quantity || 1,
    payment_intent_id: null,
    transfer_status: 'completed',
    buyer_confirmed: true,
    seller_confirmed: true,
    payment_captured: false,
    is_demo: true,
  });

  // Phase 1B: create PurchasePrivate sidecar for the demo purchase
  try {
    await upsertPurchasePrivate(base44, purchase.id, {
      listing_id: listing.id, event_id: listing.event_id,
      buyer_email: buyerEmail, seller_email: authoritativeSellerEmail,
      payment_intent_id: null, payment_captured: false, is_demo: true,
      migration_version: 3, migrated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[createDemoUpgrade] PurchasePrivate creation failed for', purchase.id, err?.message);
  }

  return Response.json({ purchase_id: purchase.id });
});