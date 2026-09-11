import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { classifyTMResponse, normalizeTMEvent } from '../../shared/tmResponseHandler.js';
import { buildTMDiscoveryRequest, ongoingCoverage } from '../../shared/tmDiscoveryRequest.js';
/* global AbortController, fetch */

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

const TIMEOUT_MS = 8000;

Deno.serve(async (req) => {
  try {
    createClientFromRequest(req);
    const body = await req.json().catch(() => null);
    const query = buildTMDiscoveryRequest(body);
    if (query.error) return Response.json({ error: query.error }, { status: 400 });

    const apiKey = Deno.env.get('Ticketmaster_consumer_key');
    if (!apiKey) {
      return Response.json({ error: 'tm_api_key_missing' }, { status: 500 });
    }

    const params = query.params;
    params.set('apikey', apiKey);

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
    } catch {
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

    const candidates = classified.events.slice(0, query.limit);
    const events = candidates.map(normalizeTMEvent);
    const coverage = ongoingCoverage(query, data, events.length);
    return Response.json(coverage ? { events, coverage } : { events });
  } catch {
    // Never return raw internal exception messages
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
