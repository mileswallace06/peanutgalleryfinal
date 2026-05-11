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
      // Already saved — update image/url in case they changed
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
      date: date || null,
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