import { createEventSearchRequest } from './eventSearchRequest.js';
import { validCoordinates } from './eventLocation.js';

export function discoveryRequestFromSearch(search) {
  const params = new URLSearchParams(search);
  if (!params.has('browse')) return null;
  const city = (params.get('city') || '').slice(0, 100), state = (params.get('state') || '').slice(0, 2).toUpperCase();
  const ll = validCoordinates(params.get('ll'));
  const area = city ? { city, state, label: [city, state].filter(Boolean).join(', ') } : ll ? { ll, label: 'your location · 50 miles' } : null;
  return { ...createEventSearchRequest(params.get('q') || '', area, params.get('scope') === 'nationwide' ? 'nationwide' : 'local'), sort: params.get('sort') === 'latest' ? 'latest' : 'soonest', includePast: params.get('past') === '1' };
}
export function discoverySearchFromRequest(request) {
  const params = new URLSearchParams({ browse: '1' });
  if (request.keyword) params.set('q', request.keyword);
  if (request.scope === 'nationwide') params.set('scope', 'nationwide');
  if (request.cityOverride) { params.set('city', request.cityOverride); if (request.stateOverride) params.set('state', request.stateOverride); }
  else if (request.ll) params.set('ll', request.ll);
  if (request.sort === 'latest') params.set('sort', 'latest');
  if (request.includePast) params.set('past', '1');
  return `?${params}`;
}
export function requestLocation(request) {
  return request.cityOverride ? { city: request.cityOverride, state: request.stateOverride, label: request.locationLabel }
    : request.ll ? { ll: request.ll, label: request.locationLabel } : null;
}
export function safeDiscoveryReturnTo(value) {
  return typeof value === 'string' && /^\/events(?:\?[^#]*)?$/.test(value) ? value : '/events';
}
const storageKey = search => `pg_events_return_v1:${search}`;
export function saveDiscoveryReturn(search, value, storage = globalThis.sessionStorage) {
  try { storage?.setItem(storageKey(search), JSON.stringify({ ...value, savedAt: Date.now() })); } catch { /* Navigation works without storage. */ }
}
export function readDiscoveryReturn(search, storage = globalThis.sessionStorage) {
  try { const value = JSON.parse(storage?.getItem(storageKey(search)) || 'null'); return value && Date.now() - value.savedAt < 3600000 ? value : null; } catch { return null; }
}
