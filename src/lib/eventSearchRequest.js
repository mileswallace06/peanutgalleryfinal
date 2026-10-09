import { escapeRegex, normalizeSearch } from './searchNormalize.js';

// The selected local area is retained by the caller when nationwide is requested.
export function createEventSearchRequest(keyword = '', location = null, scope = 'local') {
  const cityOverride = scope === 'nationwide' ? null : location?.city?.trim() || null;
  const ll = scope === 'nationwide' || cityOverride ? null : location?.ll || null;
  return {
    keyword: keyword.trim().slice(0, 100),
    scope,
    cityOverride,
    stateOverride: cityOverride ? location?.state || null : null,
    ll,
    locationLabel: scope === 'nationwide' ? 'Nationwide' : cityOverride ? location.label || cityOverride : ll ? 'your location · 50 miles' : 'Choose location',
  };
}

export function buildEventSearchParams({ keyword, cityOverride, stateOverride, ll }) {
  const tmParams = { size: 40 };
  const pgQuery = {};
  if (keyword) {
    tmParams.keyword = keyword;
    const escaped = escapeRegex(normalizeSearch(keyword));
    if (escaped) pgQuery.search_text_normalized = { $regex: escaped, $options: 'i' };
  }
  if (cityOverride) {
    tmParams.city = cityOverride;
    pgQuery.city = { $regex: `^${escapeRegex(cityOverride)}$`, $options: 'i' };
    if (stateOverride) pgQuery.state = { $regex: `^${escapeRegex(stateOverride)}$`, $options: 'i' };
  } else if (ll) {
    tmParams.latlong = ll;
    tmParams.radius = '50';
    pgQuery.venue_lat = { $ne: null };
    pgQuery.venue_lng = { $ne: null };
  }
  return { tmParams, pgQuery, pgLimit: keyword ? 100 : 200 };
}

export const DISCOVERY_PAGE_SIZE = 40;

export function buildDiscoveryStreams(request, now = Date.now(), selling = false) {
  const { pgQuery, tmParams } = buildEventSearchParams(request);
  const boundary = new Date(now).toISOString();
  const missing = field => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });
  const direction = request.sort === 'latest' ? '-' : '';
  const eligibility = field => request.includePast ? { [field]: { $gt: '' } } : { [field]: { $gte: boundary } };
  const combine = (...clauses) => ({ $and: clauses });
  const streams = {
    canonical: { kind: 'local', field: 'event_start_utc', direction, query: combine(pgQuery, eligibility('event_start_utc')) },
    legacy: { kind: 'local', field: 'date', direction, query: combine(pgQuery, missing('event_start_utc'), eligibility('date')) },
    provider: { kind: 'provider', params: { ...tmParams, page: 0, sort: request.sort || 'soonest', includePast: !!request.includePast, asOf: boundary, ...(request.stateOverride ? { stateCode: request.stateOverride } : {}) } },
  };
  if (selling) {
    const since = new Date(now - 12 * 3600000).toISOString();
    streams.ongoing = { kind: 'local', field: 'date', direction: '-', query: combine(pgQuery, { $or: [
      { event_start_utc: { $gte: since, $lt: boundary } }, { date: { $gte: since, $lt: boundary } },
      { event_end_utc: { $gt: boundary } }, { end_date: { $gt: boundary } }, { status: 'live' },
    ] }) };
    streams.providerOngoing = { kind: 'provider', params: { ...streams.provider.params, discoveryWindow: 'ongoing' } };
  }
  return streams;
}
