import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const DEMO_TEMPLATES = [
  { section: 'Floor A', row: '1', seats: '1,2', asking_price: 149, tier: 'floor', upgrade_instructions: 'Go to Gate A and show this screen to the usher.' },
  { section: 'Floor B', row: '2', seats: '3,4', asking_price: 129, tier: 'floor', upgrade_instructions: 'Go to Gate B and show this screen.' },
  { section: 'Lower 101', row: 'C', seats: '5,6', asking_price: 89, tier: 'lower', upgrade_instructions: 'Show this confirmation at Section 101 entry.' },
  { section: 'Lower 105', row: 'D', seats: '7,8', asking_price: 75, tier: 'lower', upgrade_instructions: 'Go to Section 105 and show this screen.' },
  { section: 'Mid 201', row: 'F', seats: '9,10', asking_price: 55, tier: 'mid', upgrade_instructions: 'Present at mid-level usher station.' },
];

// Only target demo venue_upgrade listings created by this system
const isDemoUpgrade = (l) =>
  l.listing_type === 'venue_upgrade' &&
  l.is_demo_listing === true &&
  l.inventory_source === 'pg_demo' &&
  (l.notes || '').startsWith('[DEMO]');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { action, event_id } = await req.json();

    if (!event_id) {
      return Response.json({ error: 'event_id is required' }, { status: 400 });
    }

    const events = await base44.asServiceRole.entities.Event.filter({ id: event_id });
    if (!events[0]) {
      return Response.json({ error: 'Event not found' }, { status: 404 });
    }
    const event = events[0];

    // Fetch all demo listings for this event
    const existing = await base44.asServiceRole.entities.Listing.filter({ event_id, is_demo_listing: true });
    const demoUpgrades = existing.filter(isDemoUpgrade);

    // PAUSE: hide all active demo venue_upgrade listings
    if (action === 'pause') {
      const active = demoUpgrades.filter(l => l.status === 'active');
      await Promise.all(active.map(l =>
        base44.asServiceRole.entities.Listing.update(l.id, { status: 'hidden', hidden_reason: 'admin_disabled' })
      ));
      return Response.json({ success: true, action: 'paused', count: active.length });
    }

    // RESET: delete all demo venue_upgrade listings for this event
    if (action === 'reset') {
      await Promise.all(demoUpgrades.map(l =>
        base44.asServiceRole.entities.Listing.delete(l.id)
      ));
      return Response.json({ success: true, action: 'reset', deleted: demoUpgrades.length });
    }

    // RELEASE (default): re-activate paused ones, or create fresh
    if (demoUpgrades.length > 0) {
      const paused = demoUpgrades.filter(l => l.status === 'hidden');
      await Promise.all(paused.map(l =>
        base44.asServiceRole.entities.Listing.update(l.id, { status: 'active', hidden_reason: null })
      ));
      return Response.json({ success: true, action: 'reactivated', count: paused.length, total: demoUpgrades.length });
    }

    const created = await Promise.all(DEMO_TEMPLATES.map(tpl =>
      base44.asServiceRole.entities.Listing.create({
        event_id,
        seller_email: user.email,
        section: tpl.section,
        row: tpl.row,
        seats: tpl.seats,
        quantity: 2,
        tier: tpl.tier,
        asking_price: tpl.asking_price,
        listing_type: 'venue_upgrade',
        inventory_source: 'pg_demo',
        is_demo_listing: true,
        requires_existing_ticket: true,
        requires_location: true,
        location_requirement: 'inside_venue',
        proof_status: 'approved',
        status: 'active',
        notes: '[DEMO] Venue-released live upgrade',
        upgrade_instructions: tpl.upgrade_instructions,
        transfer_method: 'in_person',
      })
    ));

    return Response.json({ success: true, action: 'released', created: created.length, event_title: event.title });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});