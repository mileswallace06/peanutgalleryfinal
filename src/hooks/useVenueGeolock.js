import { useState, useEffect } from 'react';

// Returns { status: 'checking' | 'allowed' | 'blocked', reason }
// status='allowed' only if: admin bypass OR (real GPS confirms at/near venue AND IP is not a known VPN/datacenter)

const VENUE_RADIUS_KM = 5; // max distance from venue to be considered "at the show"

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Check IP via ipapi.co (free, no key needed, flags proxy/vpn/hosting)
async function checkIpReputation() {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    // If the IP is from a known hosting/datacenter provider → likely VPN
    // ipapi.co returns org field, e.g. "AS14061 DigitalOcean, LLC"
    const org = (data.org || '').toLowerCase();
    const vpnKeywords = [
      'hosting', 'datacenter', 'data center', 'digitalocean', 'amazon', 'google',
      'microsoft', 'linode', 'vultr', 'ovh', 'hetzner', 'vpn', 'proxy', 'tor',
      'cloudflare', 'fastly', 'akamai', 'cdn', 'server', 'colocation', 'colo',
    ];
    const isVpn = vpnKeywords.some(kw => org.includes(kw));
    return { isVpn, city: data.city, region: data.region, country: data.country_code };
  } catch {
    // If IP check fails, don't block — GPS is the primary check
    return { isVpn: false, city: null };
  }
}

// Get high-accuracy GPS position
function getGpsPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no_geolocation'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    });
  });
}

export default function useVenueGeolock({ venueLat, venueLng, venueCity, venueState }) {
  const [status, setStatus] = useState('checking'); // 'checking' | 'allowed' | 'blocked'
  const [reason, setReason] = useState('');
  const [distanceKm, setDistanceKm] = useState(null);

  useEffect(() => {
    const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
    if (adminUnlocked) {
      setStatus('allowed');
      setReason('admin');
      return;
    }

    let cancelled = false;

    async function run() {
      // 1. IP reputation check (runs in parallel with GPS)
      const ipPromise = checkIpReputation();

      // 2. GPS check
      let gpsPos = null;
      try {
        gpsPos = await getGpsPosition();
      } catch (err) {
        if (cancelled) return;
        // If GPS denied/unavailable, block
        setStatus('blocked');
        setReason('gps_denied');
        return;
      }

      if (cancelled) return;

      const ipResult = await ipPromise;

      if (cancelled) return;

      // 3. VPN/datacenter IP block
      if (ipResult.isVpn) {
        setStatus('blocked');
        setReason('vpn_detected');
        return;
      }

      const userLat = gpsPos.coords.latitude;
      const userLng = gpsPos.coords.longitude;
      const accuracy = gpsPos.coords.accuracy; // meters

      // 4. If venue has explicit coords, do precise distance check
      if (venueLat && venueLng) {
        const km = haversineKm(userLat, userLng, venueLat, venueLng);
        setDistanceKm(Math.round(km * 10) / 10);
        // Allow a buffer for GPS accuracy (convert to km)
        const effectiveKm = Math.max(0, km - accuracy / 1000);
        if (effectiveKm > VENUE_RADIUS_KM) {
          setStatus('blocked');
          setReason(`too_far:${Math.round(km * 10) / 10}`);
          return;
        }
      } else if (venueCity) {
        // Fallback: cross-reference GPS city against venue city using IP city
        // We already have the GPS coords — use reverse geocode via nominatim
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${userLat}&lon=${userLng}&format=json`,
            { headers: { 'Accept-Language': 'en' }, signal: AbortSignal.timeout(6000) }
          );
          const geoData = await geoRes.json();
          const gpsCity = (geoData.address?.city || geoData.address?.town || geoData.address?.village || '').toLowerCase();
          const gpsState = (geoData.address?.state || '').toLowerCase();
          const targetCity = venueCity.toLowerCase();
          const targetState = (venueState || '').toLowerCase();

          // Must match city OR be in the same state and close enough
          const cityMatch = gpsCity.includes(targetCity) || targetCity.includes(gpsCity);
          const stateMatch = targetState && gpsState.includes(targetState.slice(0, 4));

          if (!cityMatch && !stateMatch) {
            setStatus('blocked');
            setReason('wrong_city');
            return;
          }
        } catch {
          // Geocode failed — fall back to allowing if GPS was acquired (we can't verify city)
        }
      }

      setStatus('allowed');
      setReason('gps_confirmed');
    }

    run().catch(() => {
      if (!cancelled) {
        setStatus('blocked');
        setReason('error');
      }
    });

    return () => { cancelled = true; };
  }, [venueLat, venueLng, venueCity, venueState]);

  return { status, reason, distanceKm };
}