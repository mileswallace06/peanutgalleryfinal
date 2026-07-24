/**
 * syncInventoryOnListingChange — Listing entity-automation handler (update).
 *
 * SECURITY MODEL (automation replay/forgery hardening):
 *   - NEVER trust `data` / `old_data` / status / emails supplied in the request
 *     body. A public caller could POST an entity-shaped body to cause a
 *     service-role write.
 *   - Extract ONLY the entity id from the automation payload, then re-fetch the
 *     authoritative Listing + SeatInventory via service role.
 *   - Compute the desired inventory status from the fetched listing's CURRENT
 *     status. Idempotent: if the inventory already reflects the desired state,
 *     skip the write. Replays and irrelevant updates are no-ops.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));

  // Extract ONLY the entity id — never the record itself.
  const entityId = body?.event?.entity_id || body?.data?.id;
  if (!entityId) return Response.json({ ok: true, skipped: 'no listing id' });

  // Re-fetch the authoritative Listing.
  const fetched = await base44.asServiceRole.entities.Listing.filter({ id: entityId }).catch(() => []);
  const listing = fetched[0];
  if (!listing) return Response.json({ ok: true, skipped: 'listing not found' });

  // Resolve the linked SeatInventory (prefer the stored FK; fall back to lookup).
  let inventoryId = listing.seat_inventory_id;
  if (!inventoryId) {
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

  const inv = (await base44.asServiceRole.entities.SeatInventory.filter({ id: inventoryId }).catch(() => []))[0];
  if (!inv) return Response.json({ ok: true, skipped: 'inventory not found' });

  // Compute the desired inventory state from the authoritative listing status.
  let desiredStatus = inv.inventory_status;
  let desiredIntent = inv.inventory_intent;
  let desiredLinkedListingId = inv.linked_listing_id;
  let desiredLinkedPurchaseId = inv.linked_purchase_id;

  if (['cancelled', 'expired'].includes(listing.status)) {
    desiredStatus = 'available';
    desiredIntent = 'undecided';
    desiredLinkedListingId = null;
  } else if (listing.status === 'sold') {
    desiredStatus = 'transferred';
    desiredLinkedPurchaseId = listing.linked_purchase_id || inv.linked_purchase_id || null;
  } else if (listing.status === 'pending_transfer') {
    desiredStatus = 'reserved_for_purchase';
  } else if (listing.status === 'hidden') {
    desiredStatus = 'available';
    desiredIntent = 'undecided';
  }

  // Idempotent: only write if something actually changes. Replays/irrelevant
  // updates that leave the inventory unchanged are no-ops.
  const unchanged =
    desiredStatus === inv.inventory_status &&
    desiredIntent === inv.inventory_intent &&
    desiredLinkedListingId === inv.linked_listing_id &&
    desiredLinkedPurchaseId === inv.linked_purchase_id;
  if (unchanged) return Response.json({ ok: true, skipped: 'inventory already matches listing status' });

  const update = { inventory_status: desiredStatus };
  if (desiredIntent !== inv.inventory_intent) update.inventory_intent = desiredIntent;
  if (desiredLinkedListingId !== inv.linked_listing_id) update.linked_listing_id = desiredLinkedListingId;
  if (desiredLinkedPurchaseId !== inv.linked_purchase_id) update.linked_purchase_id = desiredLinkedPurchaseId;

  await base44.asServiceRole.entities.SeatInventory.update(inventoryId, update).catch(err =>
    console.error('[syncInventoryOnListingChange] update failed', entityId, err?.message)
  );

  return Response.json({ ok: true, listing_id: listing.id, new_inventory_status: desiredStatus });
});