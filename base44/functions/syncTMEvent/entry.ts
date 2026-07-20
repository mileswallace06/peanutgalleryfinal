/**
 * Upserts a Ticketmaster event into the local Event entity and maintains a
 * normalized Venue record keyed by Ticketmaster's stable venue ID.
 *
 * Body: { tm_id, title, venue, city, state, date, image_url, tm_url, category, tm_venue_id }
 *
 * - Captures tm_venue_id (the permanent relationship — venue names can change).
 * - Auto-creates/updates a Venue row by tm_venue_id.
 * - Resolves and stores Event.hero_image_url using the shared hero resolver:
 *     TM event artwork → Venue hero_image → '' (UI renders GeneratedHero).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveEventHero } from '../../shared/eventHero.js';

const CATEGORY_TO_IDENTITY = {
  concert: 'concert',
  sports: 'sports',
  theater: 'theater',
  comedy: 'comedy',
  other: 'other',
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { tm_id, title, venue, city, state, date, image_url, tm_url, category, tm_venue_id } = body;

    if (!tm_id || !title) {
      return Response.json({ error: 'tm_id and title are required' }, { status: 400 });
    }

    // ── Upsert Venue by Ticketmaster's stable venue ID ──────────────────────
    let venueRecord = null;
    if (tm_venue_id) {
      const existingVenues = await base44.asServiceRole.entities.Venue.filter({ tm_venue_id }).catch(() => []);
      if (existingVenues && existingVenues.length > 0) {
        venueRecord = existingVenues[0];
        // Backfill lightweight metadata only when missing — never overwrite
        // admin-owned fields (hero_image, identity_type).
        const fill = {};
        if (venue && !venueRecord.name) fill.name = venue;
        if (city && !venueRecord.city) fill.city = city;
        if (state && !venueRecord.state) fill.state = state;
        if (Object.keys(fill).length) {
          await base44.asServiceRole.entities.Venue.update(venueRecord.id, fill).catch(() => {});
        }
      } else {
        venueRecord = await base44.asServiceRole.entities.Venue.create({
          tm_venue_id,
          name: venue || '',
          city: city || '',
          state: state || '',
          hero_image: '',
          identity_type: CATEGORY_TO_IDENTITY[category] || 'other',
        }).catch(() => null);
      }
    }

    // ── Check for an existing Event by tm_id ───────────────────────────────
    const existing = await base44.asServiceRole.entities.Event.filter({ tm_id });

    if (existing && existing.length > 0) {
      // DEDUP: keep the newest, delete extras
      if (existing.length > 1) {
        const sorted = existing.sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0));
        const canonical = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          await base44.asServiceRole.entities.Event.delete(sorted[i].id).catch(() => {});
        }
        const effectiveImage = image_url || canonical.image_url || '';
        await base44.asServiceRole.entities.Event.update(canonical.id, {
          image_url: effectiveImage,
          tm_url: tm_url || canonical.tm_url,
          tm_venue_id: tm_venue_id || canonical.tm_venue_id,
          hero_image_url: resolveEventHero({ image_url: effectiveImage }, venueRecord) || '',
        });
        return Response.json({ status: 'deduped', id: canonical.id, duplicates_removed: sorted.length - 1 });
      }

      const effectiveImage = image_url || existing[0].image_url || '';
      await base44.asServiceRole.entities.Event.update(existing[0].id, {
        image_url: effectiveImage,
        tm_url: tm_url || existing[0].tm_url,
        tm_venue_id: tm_venue_id || existing[0].tm_venue_id,
        hero_image_url: resolveEventHero({ image_url: effectiveImage }, venueRecord) || '',
      });
      return Response.json({ status: 'updated', id: existing[0].id });
    }

    // ── Create new local Event ─────────────────────────────────────────────
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
      tm_venue_id: tm_venue_id || '',
      hero_image_url: resolveEventHero({ image_url: image_url || '' }, venueRecord) || '',
    });

    return Response.json({ status: 'created', id: created.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});