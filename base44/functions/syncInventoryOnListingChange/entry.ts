/**
 * syncInventoryOnListingChange
 * Automation trigger: Listing entity update
 * When a listing's status changes to cancelled/sold/expired/hidden,
 * release the corresponding SeatInventory back to 'available' or 'transferred'.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));

  const { event, data: listing, old_data: oldListing } = body;
  if (!listing) return Response.json({ ok: true, skipped: 'no listing data' });

  // Only act on status changes
  if (listing.status === oldListing?.status) return Response.json({ ok: true, skipped: 'status unchanged' });

  // Find linked SeatInventory
  let inventoryId = listing.seat_inventory_id;
  if (!inventoryId) {
    // Fallback: look up by owner+event+section
    const all = await base44.asServiceRole.entities.SeatInventory.filter({
      owner_email: listing.seller_email,
      event_id: listing.event_id,
    }).catch(() => []);
    const match = all.find(inv =>
      inv.section?.toLowerCase() === listing.section?.toLowerCase() &&
      inv.linked_listing_id === listing.id
    );
    inventoryId = match?.id;
  }

  if (!inventoryId) return Response.json({ ok: true, skipped: 'no inventory record found' });

  const terminalStatuses = ['cancelled', 'expired'];
  const soldStatus = 'sold';

  if (terminalStatuses.includes(listing.status)) {
    await base44.asServiceRole.entities.SeatInventory.update(inventoryId, {
      inventory_status: 'available',
      inventory_intent: 'undecided',
      linked_listing_id: null,
    });
  } else if (listing.status === soldStatus) {
    await base44.asServiceRole.entities.SeatInventory.update(inventoryId, {
      inventory_status: 'transferred',
      linked_purchase_id: listing.linked_purchase_id || null,
    });
  } else if (listing.status === 'pending_transfer') {
    await base44.asServiceRole.entities.SeatInventory.update(inventoryId, {
      inventory_status: 'reserved_for_purchase',
    });
  } else if (listing.status === 'hidden') {
    // Listing hidden (e.g. expired verification) — release SeatInventory so the
    // seller can re-list, flash-drop, or donate without a manual admin intervention.
    await base44.asServiceRole.entities.SeatInventory.update(inventoryId, {
      inventory_status: 'available',
      inventory_intent: 'undecided',
    });
  }

  return Response.json({ ok: true, listing_id: listing.id, new_inventory_status: listing.status });
});