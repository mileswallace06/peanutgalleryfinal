import { escapeRegex, normalizeSearch } from './searchNormalize.js';

// Geography is an explicit filter, never inferred from a keyword or a saved GPS fix.
export function createEventSearchRequest(keyword = '', location = null) {
  const cityOverride = location?.city?.trim() || null;
  const ll = cityOverride ? null : location?.ll || null;
  return {
    keyword: keyword.trim().slice(0, 100),
    cityOverride,
    ll,
    locationLabel: cityOverride ? location.label || cityOverride : ll ? 'Near me · 50 miles' : 'All locations',
  };
}

export function buildEventSearchParams({ keyword, cityOverride, ll }) {
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
  } else if (ll) {
    tmParams.latlong = ll;
    tmParams.radius = '50';
    pgQuery.venue_lat = { $ne: null };
    pgQuery.venue_lng = { $ne: null };
  }
  return { tmParams, pgQuery, pgLimit: keyword ? 100 : 200 };
}
