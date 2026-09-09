import { discoverTMEvents } from '../../shared/tmEventDiscovery.js';

/**
 * getTicketmasterEvents — fetches events from the Ticketmaster Discovery API.
 *
 * M0.2 CORRECTIONS:
 *  - Uses the SHARED tmResponseHandler (not an inline copy).
 *  - Validates body fields before provider contact (reject objects/arrays,
 *    cap keyword/city length, cap size, validate lat/lng/radius ranges).
 *  - AbortController timeout (8s) — never hang on a slow upstream.
 *  - Never returns raw internal exception messages.
 *  - Preserves 429 and safe 502 classifications.
 *  - 404 from TM = no events found, returns { events: [] } with 200.
 *  - Malformed JSON (res.json() throws) → 502.
 */

const MAX_KEYWORD_LEN = 100;
const MAX_CITY_LEN = 100;
const MAX_SIZE = 200;

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));

    // ── Input validation (before provider contact) ────────────────────────
    const keyword = body.keyword ?? '';
    const city = body.city ?? '';
    const latlong = body.latlong ?? '';
    const radius = body.radius ?? '50';
    const size = body.size ?? 20;
    const includeOngoing = body.includeOngoing ?? false;
    if (typeof includeOngoing !== 'boolean') return Response.json({ error: 'invalid_include_ongoing' }, { status: 400 });

    if (typeof keyword !== 'string' || (keyword && keyword.length > MAX_KEYWORD_LEN)) {
      return Response.json({ error: 'invalid_keyword' }, { status: 400 });
    }
    if (typeof city !== 'string' || (city && city.length > MAX_CITY_LEN)) {
      return Response.json({ error: 'invalid_city' }, { status: 400 });
    }
    if (typeof latlong !== 'string') {
      return Response.json({ error: 'invalid_latlong' }, { status: 400 });
    }
    if (latlong) {
      const parts = latlong.split(',');
      if (parts.length !== 2) return Response.json({ error: 'invalid_latlong' }, { status: 400 });
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return Response.json({ error: 'invalid_latlong' }, { status: 400 });
      }
    }
    const radiusNum = Number(radius);
    if (isNaN(radiusNum) || radiusNum < 1 || radiusNum > 500) {
      return Response.json({ error: 'invalid_radius' }, { status: 400 });
    }
    const sizeNum = Number(size);
    if (!Number.isInteger(sizeNum) || sizeNum < 1 || sizeNum > MAX_SIZE) {
      return Response.json({ error: 'invalid_size' }, { status: 400 });
    }

    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    if (!apiKey) {
      return Response.json({ error: 'tm_api_key_missing' }, { status: 500 });
    }

    const result = await discoverTMEvents({ apiKey, keyword, city, latlong, radius: radiusNum, size: sizeNum, includeOngoing });
    return Response.json(result.body, { status: result.status });
  } catch (_error) {
    // Never return raw internal exception messages
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});