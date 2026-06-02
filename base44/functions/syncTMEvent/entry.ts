/**
 * Upserts a Ticketmaster event into the local Event entity.
 * Called from the frontend whenever TM events are fetched, so they persist
 * even after Ticketmaster stops returning them post-start.
 *
 * Body: { tm_id, title, venue, city, state, date, image_url, tm_url, category }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { tm_id, title, venue, city, state, date, image_url, tm_url, category } = body;

    if (!tm_id || !title) {
      return Response.json({ error: 'tm_id and title are required' }, { status: 400 });
    }

    // Check if already exists by tm_id
    const existing = await base44.asServiceRole.entities.Event.filter({ tm_id });

    if (existing && existing.length > 0) {
      // DEDUP: if somehow multiple records exist for this tm_id, delete all but the newest
      if (existing.length > 1) {
        const sorted = existing.sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0));
        const canonical = sorted[0];
        // Delete the extra duplicates silently
        for (let i = 1; i < sorted.length; i++) {
          await base44.asServiceRole.entities.Event.delete(sorted[i].id).catch(() => {});
        }
        await base44.asServiceRole.entities.Event.update(canonical.id, {
          image_url: image_url || canonical.image_url,
          tm_url: tm_url || canonical.tm_url,
        });
        return Response.json({ status: 'deduped', id: canonical.id, duplicates_removed: sorted.length - 1 });
      }

      // Normal update
      await base44.asServiceRole.entities.Event.update(existing[0].id, {
        image_url: image_url || existing[0].image_url,
        tm_url: tm_url || existing[0].tm_url,
      });
      return Response.json({ status: 'updated', id: existing[0].id });
    }

    // Create new local record
    const created = await base44.asServiceRole.entities.Event.create({
      tm_id,
      title,
      venue: venue || '',
      city: city || '',
      state: state || '',
      date: date || undefined,
      image_url: image_url || '',
      tm_url: tm_url || '',
      category: category || null,
      status: 'upcoming',
      is_beta_live: false,
    });

    return Response.json({ status: 'created', id: created.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});