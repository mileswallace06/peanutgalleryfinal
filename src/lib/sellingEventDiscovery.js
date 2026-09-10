import { buildEventSearchParams } from './eventSearchRequest.js';
import { mergeEventSources } from './eventSourceMerger.js';
import { fetchTMEvents, bustTMCache } from './tmCache.js';
import { SELLING_LOOKBACK_HOURS } from './sellingEventTiming.js';
export function sellingPGQueries(request, now = Date.now()) {
  const { pgQuery, pgLimit } = buildEventSearchParams(request);
  const boundary = new Date(now).toISOString();
  const since = new Date(now - SELLING_LOOKBACK_HOURS * 3600000).toISOString();
  return { limit: pgLimit, future: { ...pgQuery, $or: [{ event_start_utc: { $gte: boundary } }, { date: { $gte: boundary } }] }, ongoing: { ...pgQuery, $or: [
    { event_start_utc: { $gte: since, $lt: boundary } }, { date: { $gte: since, $lt: boundary } },
    { event_end_utc: { $gt: boundary } }, { end_date: { $gt: boundary } }, { status: 'live' },
  ] } };
}
export async function fetchSellingEvents(base44, request, refresh = false, now = Date.now()) {
  const { tmParams } = buildEventSearchParams(request);
  const queries = sellingPGQueries(request, now);
  if (refresh) bustTMCache(tmParams);
  const read = async (query, sort) => {
    const rows = await base44.entities.Event.filter(query, sort, queries.limit, 0);
    if (!Array.isArray(rows)) throw new Error('invalid_pg_response');
    return rows;
  };
  const [future, ongoing, tmResult] = await Promise.allSettled([
    read(queries.future, 'date'), read(queries.ongoing, '-date'), fetchTMEvents(base44, tmParams),
  ]);
  const pgRows = [...new Map([future, ongoing].flatMap(result => result.status === 'fulfilled' ? result.value : []).map(e => [e.id, e])).values()];
  const merged = mergeEventSources({ localResult: { status: 'fulfilled', value: pgRows }, tmResult,
    filters: { ...request, now, isAdmin: false, includeStarted: true, tmKeywordApplied: true } });
  return { events: merged.events, pgError: future.status === 'rejected' || ongoing.status === 'rejected', tmError: merged.tmFailed,
    rateLimited: merged.tmError, limited: [future, ongoing].some(r => r.status === 'fulfilled' && r.value.length >= queries.limit) };
}
