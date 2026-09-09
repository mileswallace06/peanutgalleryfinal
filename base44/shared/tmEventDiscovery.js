/* global fetch, AbortController */
import { classifyTMResponse, normalizeTMEvent } from './tmResponseHandler.js';
import { getEventDiscoveryStatus } from './eventDiscoveryTiming.js';

// A separate recent-start budget preserves the entire requested future budget.
export const ONGOING_LOOKBACK_HOURS = 24;
export const RECENT_RESULT_LIMIT = 200;
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function discoverTMEvents({ apiKey, keyword, city, latlong, radius, size, includeOngoing = false },
  { fetchImpl = fetch, now = Date.now(), timeoutMs = 8000 } = {}) {
  async function query(recent) {
    const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
    const params = url.searchParams;
    params.set('apikey', apiKey);
    params.set('countryCode', 'US');
    params.set('size', String(recent ? RECENT_RESULT_LIMIT : size));
    params.set('sort', recent ? 'date,desc' : 'date,asc');
    params.set('startDateTime', iso(recent ? now - ONGOING_LOOKBACK_HOURS * 3600000 : now));
    // Ticketmaster endDateTime bounds event START times, not ticket-sale ends.
    if (recent) params.set('endDateTime', iso(now));
    if (keyword) params.set('keyword', keyword);
    if (latlong) {
      params.set('latlong', latlong);
      params.set('radius', String(radius));
      params.set('unit', 'miles');
    } else if (city) params.set('city', city);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url.toString(), { signal: controller.signal });
      let data;
      try { data = await res.json(); }
      catch { return { error: controller.signal.aborted ? 'tm_timeout' : 'malformed_response', status: controller.signal.aborted ? 504 : 502 }; }
      const classified = classifyTMResponse({ ok: res.ok, status: res.status, data });
      if (classified.error) return { error: classified.error, status: res.status === 429 ? 429 : 502 };
      if (!Array.isArray(classified.events)) return { error: 'malformed_response', status: 502 };
      const events = classified.events.map(normalizeTMEvent);
      return { events: recent ? events.filter(e => getEventDiscoveryStatus(e, now).status === 'live') : events };
    } catch {
      return { error: controller.signal.aborted ? 'tm_timeout' : 'tm_fetch_failed', status: controller.signal.aborted ? 504 : 502 };
    } finally { clearTimeout(timer); }
  }
  const results = await Promise.all(includeOngoing ? [query(false), query(true)] : [query(false)]);
  const failures = results.filter(r => r.error);
  if (failures.length === results.length) {
    const failure = failures.find(r => r.status === 429) || failures[0];
    return { status: failure.status, body: { error: failure.error, upstream_status: failure.status } };
  }
  const events = [...new Map(results.flatMap(r => r.events || []).map(e => [e.tm_id, e])).values()];
  return { status: 200, body: { events, ...(failures.length ? { partial: true, warnings: failures.map(r => r.error) } : {}) } };
}
