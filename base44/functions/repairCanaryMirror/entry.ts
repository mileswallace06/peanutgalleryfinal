/**
 * repairCanaryMirror — repairs pending CanaryMirrorOutbox items.
 *
 * For each pending outbox item:
 *   - If the listing still exists: apply the mirror payload exactly once,
 *     transition status pending→repaired.
 *   - If the listing is deleted: classify as orphaned (quarantine) — the
 *     mirror target is gone and cannot be repaired.
 *
 * Exactly-once: only 'pending' items are processed. Once an item transitions
 * to 'repaired' or 'orphaned', it is never re-processed.
 *
 * Admin-only. Canary infrastructure — not maintenance-gated (canary testing
 * happens during maintenance by design).
 *
 * Body: { outbox_id?: string } — optional single-item repair.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { outbox_id } = body;
    const entities = base44.asServiceRole.entities;

    // Read pending outbox records (optionally filtered by outbox_id)
    let pending;
    if (outbox_id) {
      pending = await entities.CanaryMirrorOutbox.filter({ id: outbox_id, status: 'pending' });
    } else {
      pending = await entities.CanaryMirrorOutbox.filter({ status: 'pending' });
    }

    const results = [];
    for (const item of pending) {
      // Check if listing still exists
      const listings = await entities.Listing.filter({ id: item.listing_id });
      const listing = listings[0];

      if (!listing) {
        // Orphan — listing deleted, mirror target gone (quarantine)
        await entities.CanaryMirrorOutbox.update(item.id, {
          status: 'orphaned',
          orphaned_reason: 'Listing deleted — mirror target gone',
          repair_attempts: (item.repair_attempts || 0) + 1,
        });
        results.push({ outbox_id: item.id, listing_id: item.listing_id, status: 'orphaned' });
        continue;
      }

      // Apply mirror payload (exactly-once: status transitions pending→repaired)
      try {
        await entities.Listing.update(item.listing_id, item.mirror_payload.listing);
        await entities.CanaryMirrorOutbox.update(item.id, {
          status: 'repaired',
          repair_attempts: (item.repair_attempts || 0) + 1,
          repaired_at: new Date().toISOString(),
        });
        results.push({ outbox_id: item.id, listing_id: item.listing_id, status: 'repaired' });
      } catch (e) {
        // Repair failed — leave pending, increment attempts
        await entities.CanaryMirrorOutbox.update(item.id, {
          repair_attempts: (item.repair_attempts || 0) + 1,
        });
        results.push({ outbox_id: item.id, listing_id: item.listing_id, status: 'still_pending', error: (e.message || String(e)).slice(0, 120) });
      }
    }

    return Response.json({ ok: true, processed: results.length, results });
  } catch (error) {
    return Response.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
});