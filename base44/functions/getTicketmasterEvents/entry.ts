import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { classifyTMResponse, normalizeTMEvent } from '../../shared/tmResponseHandler.js';

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
const TIMEOUT_MS = 8000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));

    // ── Input validation (before provider contact) ────────────────────────
    const keyword = body.keyword ?? '';
    const city = body.city ?? '';
    const latlong = body.latlong ?? '';
    const radius = body.radius ?? '50';
    const size = body.size ?? 20;

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
    if (isNaN(sizeNum) || sizeNum < 1 || sizeNum > MAX_SIZE) {
      return Response.json({ error: 'invalid_size' }, { status: 400 });
    }

    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    if (!apiKey) {
      return Response.json({ error: 'tm_api_key_missing' }, { status: 500 });
    }

    // Format: 2019-01-01T00:00:00Z
    const now = new Date().toISOString().split('.')[0] + 'Z';

    const params = new URLSearchParams({
      apikey: apiKey,
      size: String(sizeNum),
      sort: 'date,asc',
      startDateTime: now,
      countryCode: 'US',
    });

    if (keyword) params.set('keyword', keyword);
    if (latlong) {
      params.set('latlong', latlong);
      params.set('radius', String(radiusNum));
      params.set('unit', 'miles');
    } else if (city) {
      params.set('city', city);
    }

    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;

    // ── Fetch with AbortController timeout ────────────────────────────────
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return Response.json({ error: 'tm_timeout', upstream_status: 504 }, { status: 504 });
      }
      return Response.json({ error: 'tm_fetch_failed' }, { status: 502 });
    }
    clearTimeout(timeout);

    // ── Parse JSON safely (may throw on malformed response) ──────────────
    let data;
    try {
      data = await res.json();
    } catch (_e) {
      return Response.json({ error: 'malformed_response', upstream_status: res.status }, { status: 502 });
    }

    // ── Classify using the SHARED helper ──────────────────────────────────
    const classified = classifyTMResponse({ ok: res.ok, status: res.status, data });

    if (classified.error) {
      const status = classified.upstream_status === 429 ? 429 : 502;
      return Response.json(
        { error: classified.error, upstream_status: classified.upstream_status },
        { status }
      );
    }

    // 404 with no error = no events found
    if (classified.upstream_status === 404 || classified.events.length === 0) {
      return Response.json({ events: [] });
    }

    const events = classified.events.map(normalizeTMEvent);
    return Response.json({ events });
  } catch (_error) {
    // Never return raw internal exception messages
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});