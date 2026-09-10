const LOCATION_KEY = 'pg_events_local_area_v1';
const GPS_TTL = 60 * 60 * 1000;

export function validCoordinates(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (parts.length !== 2 || parts.some(p => !p.trim())) return null;
  const [lat, lng] = parts.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? `${lat},${lng}` : null;
}

// Only city-picker suggestions reach this boundary. Free text is never a city.
export function cityFromSuggestion(value) {
  if (!value || typeof value.city !== 'string' || !/^[A-Z]{2}$/.test(value.state || '') || (value.country && value.country !== 'US')) return null;
  const city = value.city.trim();
  if (!city || city.length > 100) return null;
  return { city, state: value.state, label: `${city}, ${value.state}` };
}

function readJSON(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}

export function saveEventLocation(location, storage = localStorage, now = Date.now()) {
  const saved = { ...location, validated: true, savedAt: location.savedAt || now };
  try { storage.setItem(LOCATION_KEY, JSON.stringify(saved)); } catch { /* Browsing still works without storage. */ }
  return saved;
}

export async function restoreEventLocation(base44, storage = localStorage, now = Date.now()) {
  const saved = readJSON(storage, LOCATION_KEY);
  if (saved?.validated && saved.city) return cityFromSuggestion(saved);
  const freshGPS = value => {
    const ll = validCoordinates(value?.ll || value?.latlong);
    const ts = value?.savedAt || value?.ts;
    return ll && Number.isFinite(ts) && now >= ts && now - ts < GPS_TTL ? { ll, label: 'your location · 50 miles', savedAt: ts } : null;
  };
  if (saved?.validated) {
    // Do not silently fall back to an older city when a selected GPS fix expires.
    return freshGPS(saved);
  }
  const gps = freshGPS(readJSON(storage, 'pg_location_cache'));
  if (gps) return gps;
  const recent = readJSON(storage, 'pg_recent_cities');
  const candidate = cityFromSuggestion(Array.isArray(recent) ? recent[0] : null);
  if (!candidate) return null;
  // Migrate a previously selected city only after the existing city service
  // confirms it. Never restore the old unvalidated sessionStorage city string.
  try {
    const response = await base44.functions.invoke('suggestCities', { keyword: candidate.city });
    const match = response?.data?.cities?.find(c => c.city?.toLowerCase() === candidate.city.toLowerCase() && c.state === candidate.state);
    return cityFromSuggestion(match);
  } catch { return null; }
}
