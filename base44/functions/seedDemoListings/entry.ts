import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { upsertListingPrivate } from '../../shared/privateData.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  if (isMaintenanceActive()) return maintenance503('Demo seeding is temporarily unavailable for scheduled maintenance.');

  // Optional: override seller email so the admin can buy their own demo listings for testing
  const body = await req.json().catch(() => ({}));
  const sellerEmail = body.seller_email || user.email;

  // If a seller_email override was provided, verify the user exists
  if (body.seller_email) {
    const users = await base44.asServiceRole.entities.User.filter({ email: body.seller_email });
    if (!users || users.length === 0) {
      return Response.json({ error: `No registered user found with email: ${body.seller_email}` }, { status: 400 });
    }
  }

  const now = new Date();
  const d = (days) => new Date(now.getTime() + days * 86400000).toISOString();

  const events = [
    {
      title: 'Phoenix Suns vs LA Lakers',
      artist: null,
      venue: 'Footprint Center',
      city: 'Phoenix',
      state: 'AZ',
      date: d(1),
      category: 'sports',
      image_url: 'https://images.unsplash.com/photo-1546519638405-a2f83f9b8a4e?w=800',
      status: 'live',
      venue_lat: 33.4457,
      venue_lng: -112.0712,
      geo_radius_meters: 500
    },
    {
      title: 'Taylor Swift – The Eras Tour',
      artist: 'Taylor Swift',
      venue: 'State Farm Stadium',
      city: 'Glendale',
      state: 'AZ',
      date: d(3),
      category: 'concert',
      image_url: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800',
      status: 'upcoming',
      venue_lat: 33.5276,
      venue_lng: -112.2626,
      geo_radius_meters: 500
    },
    {
      title: 'Arizona Coyotes vs Vegas Golden Knights',
      artist: null,
      venue: 'Mullett Arena',
      city: 'Tempe',
      state: 'AZ',
      date: d(7),
      category: 'sports',
      image_url: 'https://images.unsplash.com/photo-1515703407324-5f753afd8be8?w=800',
      status: 'upcoming',
      venue_lat: 33.4260,
      venue_lng: -111.9320,
      geo_radius_meters: 500
    }
  ];

  const createdEvents = [];
  const errors = [];

  for (const evt of events) {
    const created = await base44.asServiceRole.entities.Event.create(evt);
    createdEvents.push(created);
  }

  const listingTemplates = [
    // Event 0 - Suns game (5 listings)
    { eventIdx: 0, section: '118', row: 'G', seats: '12,13', quantity: 2, tier: 'lower', asking_price: 85, original_price: 120 },
    { eventIdx: 0, section: '210', row: 'B', seats: '5', quantity: 1, tier: 'upper', asking_price: 35, original_price: 55 },
    { eventIdx: 0, section: 'Floor A', row: '3', seats: '8,9', quantity: 2, tier: 'floor', asking_price: 220, original_price: 350 },
    { eventIdx: 0, section: '101', row: 'A', seats: '1,2,3', quantity: 3, tier: 'lower', asking_price: 110, original_price: 150 },
    { eventIdx: 0, section: '305', row: 'K', seats: '22', quantity: 1, tier: 'upper', asking_price: 28, original_price: 45 },
    // Event 1 - Taylor Swift (5 listings)
    { eventIdx: 1, section: 'Pit GA', row: 'GA', seats: null, quantity: 1, tier: 'floor', asking_price: 450, original_price: 600 },
    { eventIdx: 1, section: '102', row: 'C', seats: '14,15', quantity: 2, tier: 'lower', asking_price: 180, original_price: 250 },
    { eventIdx: 1, section: '115', row: 'M', seats: '7', quantity: 1, tier: 'lower', asking_price: 140, original_price: 200 },
    { eventIdx: 1, section: '220', row: 'F', seats: '3,4', quantity: 2, tier: 'mid', asking_price: 90, original_price: 130 },
    { eventIdx: 1, section: '401', row: 'P', seats: '11', quantity: 1, tier: 'upper', asking_price: 55, original_price: 85 },
    // Event 2 - Coyotes game (5 listings)
    { eventIdx: 2, section: '103', row: 'E', seats: '9,10', quantity: 2, tier: 'lower', asking_price: 70, original_price: 100 },
    { eventIdx: 2, section: 'Glass', row: 'A', seats: '5', quantity: 1, tier: 'floor', asking_price: 195, original_price: 280 },
    { eventIdx: 2, section: '201', row: 'C', seats: '2,3', quantity: 2, tier: 'mid', asking_price: 50, original_price: 75 },
    { eventIdx: 2, section: '302', row: 'H', seats: '18', quantity: 1, tier: 'upper', asking_price: 30, original_price: 48 },
    { eventIdx: 2, section: '108', row: 'D', seats: '6,7,8', quantity: 3, tier: 'lower', asking_price: 80, original_price: 110 }
  ];

  let listingsCreated = 0;
  for (const t of listingTemplates) {
    const listing = {
      event_id: createdEvents[t.eventIdx].id,
      seller_email: sellerEmail,
      section: t.section,
      row: t.row,
      seats: t.seats || '',
      quantity: t.quantity,
      tier: t.tier,
      asking_price: t.asking_price,
      original_price: t.original_price,
      transfer_method: 'email_transfer',
      proof_status: 'approved',
      status: 'active',
      is_demo_listing: true,
      notes: `[DEMO] Great seats! Willing to move to a lower section. Seller: ${sellerEmail}`
    };
    const createdListing = await base44.asServiceRole.entities.Listing.create(listing);
    // Phase 1B: create ListingPrivate sidecar for each demo listing
    try {
      await upsertListingPrivate(base44, createdListing.id, {
        event_id: createdListing.event_id, seller_email: sellerEmail,
        section: t.section, row: t.row, seats: t.seats || null, quantity: t.quantity,
        proof_status: 'approved', is_demo_listing: true, notes: listing.notes,
        migration_version: 3, migrated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[seedDemoListings] ListingPrivate creation failed for', createdListing.id, err?.message);
    }
    listingsCreated++;
  }

  return Response.json({
    events_created: createdEvents.length,
    listings_created: listingsCreated,
    errors
  });
});