// Fixture-local browser state. Never imported by the production entry.
const params = new URLSearchParams(location.search);
localStorage.setItem('pg_onboarded', '1');
localStorage.setItem('pg_what_is_pg_seen_v2', '1');
localStorage.setItem('pg_theme', params.get('theme') === 'dark' ? 'dark' : 'light');
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
localStorage.setItem('pg_events_local_area_v1', JSON.stringify({ validated: true, city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' }));
localStorage.setItem('pg_location_cache', JSON.stringify({ latlong: '33.4484,-112.0740', label: 'Phoenix, AZ', ts: Date.now() }));
sessionStorage.setItem('pg_upgrades_location', JSON.stringify({ city: 'Phoenix', locationInput: 'Phoenix' }));
const locationMode = params.get('locationMode') || 'success';
window.fixtureGeoCalls = 0;
if (params.has('locationMode')) {
  localStorage.removeItem('pg_location_cache');
  localStorage.removeItem('pg_events_local_area_v1');
  localStorage.removeItem('pg_fan_location_v1');
}
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: locationMode === 'unavailable' ? undefined : {
  getCurrentPosition(success, failure) {
    window.fixtureGeoCalls++;
    queueMicrotask(() => ['denied', 'timeout', 'none'].includes(locationMode)
      ? failure?.({ code: locationMode === 'timeout' ? 3 : 1, message: 'Fictional location failure' })
      : success({ coords: { latitude: 33.4484, longitude: -112.0740, accuracy: 10 }, timestamp: Date.now() }));
  },
  watchPosition() { throw new Error('Visual review: geolocation watch is not supported'); },
  clearWatch() {},
} });
// Only the exact policy script is substituted. No provider code or production policy is fetched.
const appendHead = document.head.appendChild.bind(document.head);
document.head.appendChild = node => {
  if (node.id !== 'usercentrics-ppg' || node.src !== 'https://policygenerator.usercentrics.eu/api/privacy-policy') return appendHead(node);
  node.removeAttribute('src');
  const appended = appendHead(node);
  setTimeout(() => {
    if (!node.isConnected) return;
    if (params.get('policyState') === 'error') { node.dispatchEvent(new Event('error')); return; }
    const target = document.querySelector('.uc-privacy-policy');
    if (target) target.innerHTML = `<h1>Privacy Policy</h1><p>Fictional policy content for isolated layout testing only.</p><p><a href="#providers">Service providers</a> · <a href="#privacy-rights">Your rights</a></p><h2 id="providers">Service providers</h2><table><thead><tr><th>Provider</th><th>Purpose</th><th>Data categories</th><th>Storage period</th><th>Location and contact</th></tr></thead><tbody>${Array.from({length: 12}, (_, i) => `<tr><td>Fictional Provider ${i+1}</td><td>Local fixture accessibility verification</td><td>Fictional identifiers and preferences</td><td>Fixture session only</td><td>Example City — <a href="https://example.invalid/privacy">https://example.invalid/privacy</a></td></tr>`).join('')}</tbody></table><h2 id="privacy-rights">Your rights</h2><p>This is a non-production test document.</p>`;
    if (target && params.get('policyStages') === '1') {
      const heading = target.querySelector('#privacy-rights');
      const paragraph = heading.nextElementSibling;
      heading.remove();
      paragraph.remove();
      // Model a hosted provider adding a later fragment in a separate update.
      // This is controlled fixture latency, not a browser assertion delay.
      setTimeout(() => {
        if (!node.isConnected || !target.isConnected) return;
        target.append(heading, paragraph);
      }, 80);
    }
    node.dispatchEvent(new Event('load'));
  }, Number(params.get('policyDelay')) || 30);
  return appended;
};
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
