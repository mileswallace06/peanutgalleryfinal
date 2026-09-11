import { buildEventSearchParams } from './eventSearchRequest.js';
import { mergeEventSources } from './eventSourceMerger.js';
import { fetchTMEvents, bustTMCache } from './tmCache.js';
import { SELLING_LOOKBACK_HOURS, withProviderTiming, applyProviderTiming } from './sellingEventTiming.js';
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
  const ongoingParams = { ...tmParams, discoveryWindow: 'ongoing' };
  if (refresh) { bustTMCache(tmParams); bustTMCache(ongoingParams); }
  const read = async (query, sort) => {
    const rows = await base44.entities.Event.filter(query, sort, queries.limit, 0);
    if (!Array.isArray(rows)) throw new Error('invalid_pg_response');
    return rows;
  };
  const [future, ongoing, tmFuture, tmOngoing] = await Promise.allSettled([
    read(queries.future, 'date'), read(queries.ongoing, '-date'), fetchTMEvents(base44, tmParams), fetchTMEvents(base44, ongoingParams),
  ]);
  const pgRows = [...new Map([future, ongoing].flatMap(result => result.status === 'fulfilled' ? result.value : []).map(e => [e.id, e])).values()];
  const providerResults = [tmFuture, tmOngoing];
  const providerEvents = providerResults.flatMap(r => r.status === 'fulfilled' ? r.value.events.map(withProviderTiming) : []);
  const providerById = new Map(providerEvents.map(e => [e.tm_id, e]));
  const enrichedPG = pgRows.map(e => {
    const current = e.tm_id && providerById.get(e.tm_id);
    return current ? { ...applyProviderTiming(e, current._providerTiming), _providerTiming: current._providerTiming } : e;
  });
  const tmResult = { status: 'fulfilled', value: { events: [...providerById.values()] } };
  const merged = mergeEventSources({ localResult: { status: 'fulfilled', value: enrichedPG }, tmResult,
    filters: { ...request, now, isAdmin: false, includeStarted: true, tmKeywordApplied: true } });
  return { events: merged.events, pgError: future.status === 'rejected' || ongoing.status === 'rejected', tmError: providerResults.some(r => r.status === 'rejected'),
    tmOngoingError: tmOngoing.status === 'rejected', ongoingCoverage: tmOngoing.status === 'fulfilled' ? tmOngoing.value.coverage : null,
    rateLimited: providerResults.some(r => r.status === 'rejected' && (r.reason?.response?.status || r.reason?.status) === 429), limited: [future, ongoing].some(r => r.status === 'fulfilled' && r.value.length >= queries.limit) || (tmOngoing.status === 'fulfilled' && tmOngoing.value.coverage?.truncated) };
}
