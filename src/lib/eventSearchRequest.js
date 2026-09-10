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
