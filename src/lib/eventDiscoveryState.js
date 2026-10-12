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
export function safeUpgradesReturnTo(value) {
  return typeof value === 'string' && /^\/upgrades(?:\?[^#]*)?$/.test(value) ? value : '/upgrades';
}
export function discoveryBackLink(state, defaultPage = 'events') {
  const fromUpgrades = typeof state?.upgradesReturnTo === 'string' && safeUpgradesReturnTo(state.upgradesReturnTo) === state.upgradesReturnTo;
  const fromEvents = typeof state?.discoveryReturnTo === 'string' && safeDiscoveryReturnTo(state.discoveryReturnTo) === state.discoveryReturnTo;
  const page = fromUpgrades ? 'upgrades' : fromEvents ? 'events' : defaultPage;
  return {
    to: fromUpgrades ? state.upgradesReturnTo : fromEvents ? state.discoveryReturnTo : page === 'upgrades' ? '/upgrades' : '/events',
    state: { restoreDiscoveryEntry: fromUpgrades ? state.upgradesReturnKey : fromEvents ? state.discoveryReturnKey : undefined },
    label: page === 'upgrades' ? 'Upgrades' : 'Events',
  };
}
export function upgradeViewFromSearch(search) {
  return new URLSearchParams(search).get('view') === 'live' ? 'live' : 'upcoming';
}
export function upgradeSearchFromView(search, view) {
  const params = new URLSearchParams(search);
  if (view === 'live') params.set('view', 'live'); else params.delete('view');
  return params.size ? `?${params}` : '';
}
const validEntryKey = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
// Router keys survive Back/Forward and reload. The initial document's default
// key needs its own marker so an unrelated direct visit cannot inherit it.
export function discoveryReturnContext(route, navigationType, history = globalThis.history) {
  let entryKey = validEntryKey(route.key) && route.key !== 'default' ? route.key : null;
  if (!entryKey) {
    entryKey = history?.state?.pgDiscoveryEntry;
    if (!validEntryKey(entryKey)) {
      entryKey = globalThis.crypto?.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try { history?.replaceState({ ...history.state, pgDiscoveryEntry: entryKey }, ''); } catch { /* Browsing still works without history storage. */ }
    }
  }
  const restoreKey = route.state?.restoreDiscoveryEntry;
  const explicitReturn = validEntryKey(restoreKey);
  return { entryKey: explicitReturn ? restoreKey : entryKey, pathname: route.pathname, search: route.search, mayRestore: navigationType === 'POP' || explicitReturn };
}
const storageKey = context => `pg_discovery_return_v2:${context.pathname}:${context.entryKey}`;
export function saveDiscoveryReturn(context, value, storage = globalThis.sessionStorage) {
  try { storage?.setItem(storageKey(context), JSON.stringify({ ...value, pathname: context.pathname, search: context.search, savedAt: Date.now() })); } catch { /* Navigation works without storage. */ }
}
export function clearDiscoveryReturn(context, storage = globalThis.sessionStorage) {
  try { storage?.removeItem(storageKey(context)); } catch { /* Navigation works without storage. */ }
}
export function readDiscoveryReturn(context, storage = globalThis.sessionStorage) {
  if (!context.mayRestore) return null;
  try {
    const value = JSON.parse(storage?.getItem(storageKey(context)) || 'null');
    return value && value.pathname === context.pathname && value.search === context.search && Date.now() - value.savedAt >= 0 && Date.now() - value.savedAt < 3600000 ? value : null;
  } catch { return null; }
}
