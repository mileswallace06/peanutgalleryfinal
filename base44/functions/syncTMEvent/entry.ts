/**
 * Upserts a Ticketmaster event into the local Event entity and maintains a
 * normalized Venue record keyed by Ticketmaster's stable venue ID.
 *
 * M0.2: Now generates search_text_normalized for server-side keyword search
 * and preserves venue_lat/venue_lng for near-me geospatial filtering.
 *
 * Body includes provider identity, display metadata, coordinates and the
 * canonical timing fields selected by src/lib/tmEventSyncPayload.js.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveEventHero } from '../../shared/eventHero.js';
import { generateSearchTextNormalized } from '../../shared/searchNormalize.js';
import { coerceCoordinate, normalizeTMEvent } from '../../shared/tmResponseHandler.js';
import { buildTMEventTimingPatch } from '../../shared/tmEventTiming.js';

const TIMEOUT_MS = 8000;
const TM_ID = /^[A-Za-z0-9_-]{1,200}$/;

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

    const requestBody = await req.json().catch(() => ({}));
    const requestedId = requestBody.tm_id;

    if (typeof requestedId !== 'string' || !TM_ID.test(requestedId)) {
      return Response.json({ error: 'valid tm_id is required' }, { status: 400 });
    }

    // Provider-owned fields are never accepted from the phone. Re-fetch the
    // exact Ticketmaster record server-side before any service-role write.
    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    if (!apiKey) return Response.json({ error: 'tm_api_key_missing' }, { status: 500 });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let providerResponse;
    try {
      providerResponse = await fetch(
        `https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(requestedId)}.json?apikey=${encodeURIComponent(apiKey)}&locale=*`,
        { signal: controller.signal },
      );
    } catch (error) {
      clearTimeout(timeout);
      return Response.json({ error: error?.name === 'AbortError' ? 'tm_timeout' : 'tm_fetch_failed' }, { status: error?.name === 'AbortError' ? 504 : 502 });
    }
    clearTimeout(timeout);
    if (providerResponse.status === 404) return Response.json({ error: 'tm_event_not_found' }, { status: 404 });
    if (!providerResponse.ok) return Response.json({ error: 'tm_upstream_error' }, { status: providerResponse.status === 429 ? 429 : 502 });
    const providerJson = await providerResponse.json().catch(() => null);
    if (!providerJson || providerJson.id !== requestedId) return Response.json({ error: 'tm_malformed_response' }, { status: 502 });

    const body = normalizeTMEvent(providerJson);
    const { tm_id, title, venue, city, state, image_url, tm_url, category, tm_venue_id } = body;
    if (!tm_id || !title) return Response.json({ error: 'tm_malformed_response' }, { status: 502 });

    // ── M0.3: Re-validate coordinates before writing ──────────────────────
    // Convert to finite numbers within valid ranges. Invalid/missing/non-finite → null.
    // This is the second validation layer (first is in normalizeTMEvent); defense in depth.
    const venue_lat = coerceCoordinate(body.venue_lat, -90, 90);
    const venue_lng = coerceCoordinate(body.venue_lng, -180, 180);
    const timingPatch = buildTMEventTimingPatch(body);
    const createTiming = Object.fromEntries(
      Object.entries(timingPatch).filter(([, value]) => value !== null)
    );

    // ── Generate normalized search text ──────────────────────────────────
    const searchTextNormalized = generateSearchTextNormalized({
      title, venue, city, state,
    });

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
        const refreshedTiming = buildTMEventTimingPatch(body, canonical);
        await base44.asServiceRole.entities.Event.update(canonical.id, {
          title,
          venue: venue || '',
          city: city || '',
          state: state || '',
          category: category || canonical.category || null,
          image_url: effectiveImage,
          tm_url: tm_url || canonical.tm_url,
          tm_venue_id: tm_venue_id || canonical.tm_venue_id,
          venue_lat: venue_lat ?? canonical.venue_lat,
          venue_lng: venue_lng ?? canonical.venue_lng,
          search_text_normalized: searchTextNormalized,
          hero_image_url: resolveEventHero({ image_url: effectiveImage }, venueRecord) || '',
          ...refreshedTiming,
        });
        return Response.json({ status: 'deduped', id: canonical.id, duplicates_removed: sorted.length - 1 });
      }

      const effectiveImage = image_url || existing[0].image_url || '';
      const refreshedTiming = buildTMEventTimingPatch(body, existing[0]);
      await base44.asServiceRole.entities.Event.update(existing[0].id, {
        title,
        venue: venue || '',
        city: city || '',
        state: state || '',
        category: category || existing[0].category || null,
        image_url: effectiveImage,
        tm_url: tm_url || existing[0].tm_url,
        tm_venue_id: tm_venue_id || existing[0].tm_venue_id,
        venue_lat: venue_lat ?? existing[0].venue_lat,
        venue_lng: venue_lng ?? existing[0].venue_lng,
        search_text_normalized: searchTextNormalized,
        hero_image_url: resolveEventHero({ image_url: effectiveImage }, venueRecord) || '',
        ...refreshedTiming,
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
      search_text_normalized: searchTextNormalized,
      image_url: image_url || '',
      tm_url: tm_url || '',
      category: category || null,
      status: 'upcoming',
      is_beta_live: false,
      tm_venue_id: tm_venue_id || '',
      venue_lat: venue_lat ?? null,
      venue_lng: venue_lng ?? null,
      hero_image_url: resolveEventHero({ image_url: image_url || '' }, venueRecord) || '',
      ...createTiming,
    });

    return Response.json({ status: 'created', id: created.id });
  } catch (_error) {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
