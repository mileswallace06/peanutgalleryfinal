import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getTicketmasterEvents — fetches events from the Ticketmaster Discovery API.
 *
 * M0.1 CORRECTIONS:
 *  - Checks res.ok before parsing.
 *  - Propagates upstream 429 as 429 (not 500) so the frontend can distinguish
 *    rate-limiting from server errors.
 *  - Propagates upstream 5xx as 502 (bad gateway).
 *  - Handles malformed JSON (res.json() throws) → 502.
 *  - Never returns an error as { events: [] } with status 200 — errors are
 *    always non-2xx so the frontend .catch path fires and does NOT cache.
 *  - 404 from TM = no events found, returns { events: [] } with 200.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const keyword = body.keyword || '';
    const size = body.size || 20;
    const latlong = body.latlong || ''; // e.g. "33.4484,-112.0740"
    const radius = body.radius || '50'; // miles
    const city = body.city || ''; // city name or zip

    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    if (!apiKey) {
      return Response.json({ error: 'tm_api_key_missing' }, { status: 500 });
    }

    // Format: 2019-01-01T00:00:00Z
    const now = new Date().toISOString().split('.')[0] + 'Z';

    const params = new URLSearchParams({
      apikey: apiKey,
      size: String(size),
      sort: 'date,asc',
      startDateTime: now,
      countryCode: 'US',
    });

    if (keyword) params.set('keyword', keyword);
    if (latlong) {
      params.set('latlong', latlong);
      params.set('radius', String(radius));
      params.set('unit', 'miles');
    } else if (city) {
      params.set('city', city);
    }

    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
    const res = await fetch(url);

    // ── Check res.ok before parsing ──────────────────────────────────────
    if (!res.ok) {
      if (res.status === 429) {
        return Response.json({ error: 'rate_limited', upstream_status: 429 }, { status: 429 });
      }
      if (res.status === 404) {
        // 404 = no events found, not an error
        return Response.json({ events: [] });
      }
      return Response.json(
        { error: 'upstream_error', upstream_status: res.status },
        { status: 502 }
      );
    }

    // ── Parse JSON safely (may throw on malformed response) ──────────────
    let data;
    try {
      data = await res.json();
    } catch (_e) {
      return Response.json({ error: 'malformed_response', upstream_status: res.status }, { status: 502 });
    }

    const rawEvents = data?._embedded?.events || [];

    const events = rawEvents.map((e: any) => {
      const venue = e._embedded?.venues?.[0];
      const image = e.images?.find((i: any) => i.ratio === '16_9' && i.width >= 640) || e.images?.[0];
      const dateInfo = e.dates?.start;

      return {
        tm_id: e.id,
        title: e.name,
        tm_venue_id: venue?.id || '',
        date: dateInfo?.dateTime || (dateInfo?.localDate ? `${dateInfo.localDate}T${dateInfo.localTime || '00:00:00'}` : null),
        venue: venue?.name || '',
        city: venue?.city?.name || '',
        state: venue?.state?.stateCode || '',
        image_url: image?.url || '',
        tm_url: e.url || '',
        source: 'ticketmaster',
      };
    });

    return Response.json({ events });
  } catch (error) {
    return Response.json({ error: 'internal_error', message: error.message }, { status: 500 });
  }
});