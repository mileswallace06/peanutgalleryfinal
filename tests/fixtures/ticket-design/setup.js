// Fixture-local browser state. Never imported by the production entry.
const params = new URLSearchParams(location.search);
localStorage.setItem('pg_onboarded', '1');
localStorage.setItem('pg_what_is_pg_seen_v2', '1');
localStorage.setItem('pg_theme', params.get('theme') === 'dark' ? 'dark' : 'light');
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
localStorage.setItem('pg_events_local_area_v1', JSON.stringify({ validated: true, city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' }));
localStorage.setItem('pg_location_cache', JSON.stringify({ latlong: '33.4484,-112.0740', label: 'Phoenix, AZ', ts: Date.now() }));
sessionStorage.setItem('pg_upgrades_location', JSON.stringify({ city: 'Phoenix', locationInput: 'Phoenix' }));
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
  getCurrentPosition(success) { queueMicrotask(() => success({ coords: { latitude: 33.4484, longitude: -112.0740, accuracy: 10 }, timestamp: Date.now() })); },
  watchPosition() { throw new Error('Visual review: geolocation watch is not supported'); },
  clearWatch() {},
} });
// Only development module/asset reads may use fetch. All app SDK access is aliased.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const target = new URL(typeof input === 'string' ? input : input.url, location.href);
  const method = (init?.method || input?.method || 'GET').toUpperCase();
  if (target.origin === location.origin && ['GET', 'HEAD'].includes(method) && /^\/(src\/|tests\/fixtures\/|node_modules\/|@vite\/|@fs\/|@id\/|@react-refresh|assets\/)/.test(target.pathname)) return nativeFetch(input, init);
  return Promise.reject(new Error(`Visual review blocked network request: ${method} ${target.origin}${target.pathname}`));
};
XMLHttpRequest.prototype.open = function () { throw new Error('Visual review blocks XMLHttpRequest; add an explicit fixture API stub'); };
if (navigator.sendBeacon) navigator.sendBeacon = () => false;
