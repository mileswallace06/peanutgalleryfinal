import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Unified location detection hook shared by Events and Upgrades.
 *
 * Persists GPS location in localStorage with a 60-minute TTL so users
 * don't have to re-grant location on every page visit.
 *
 * locationStatus: 'idle' | 'requesting' | 'granted' | 'unavailable' | 'denied' | 'timeout'
 */

const CACHE_KEY = 'pg_location_cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

function readLocationCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { latlong, label, ts } = JSON.parse(raw);
    if (!latlong || !ts) return null;
    if (Date.now() - ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return { latlong, label };
  } catch {
    return null;
  }
}

function writeLocationCache(latlong, label) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ latlong, label, ts: Date.now() }));
  } catch {}
}

function clearLocationCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

export function useLocationDetect({ onSuccess } = {}) {
  const [locationStatus, setLocationStatus] = useState('idle');
  const [latlong, setLatlong] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const latlongRef = useRef('');
  const locationLabelRef = useRef('');
  const didRestoreCache = useRef(false);

  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  const setLatlongSync = (val) => { latlongRef.current = val; setLatlong(val); };
  const setLocationLabelSync = (val) => { locationLabelRef.current = val; setLocationLabel(val); };

  // Restore cached GPS location on mount (once only)
  useEffect(() => {
    if (didRestoreCache.current) return;
    didRestoreCache.current = true;

    const cached = readLocationCache();
    if (cached) {
      setLatlongSync(cached.latlong);
      setLocationLabelSync(cached.label || 'Near me');
      setLocationStatus('granted');
      // Fire onSuccess so the page re-fetches with the cached coords
      if (onSuccessRef.current) onSuccessRef.current(cached.latlong);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus('unavailable');
      return;
    }

    setLocationStatus('requesting');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        setLatlongSync(ll);
        setLocationLabelSync('Near me');
        setLocationStatus('granted');
        writeLocationCache(ll, 'Near me');
        if (onSuccessRef.current) onSuccessRef.current(ll);
      },
      (err) => {
        if (err.code === 1) {
          setLocationStatus('denied');
          clearLocationCache();
        } else if (err.code === 3) {
          // Retry with relaxed settings
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
              setLatlongSync(ll);
              setLocationLabelSync('Near me');
              setLocationStatus('granted');
              writeLocationCache(ll, 'Near me');
              if (onSuccessRef.current) onSuccessRef.current(ll);
            },
            (err2) => {
              setLocationStatus(err2.code === 1 ? 'denied' : 'timeout');
              if (err2.code === 1) clearLocationCache();
            },
            { timeout: 20000, enableHighAccuracy: false, maximumAge: 300000 }
          );
        } else {
          setLocationStatus('unavailable');
        }
      },
      { timeout: 15000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  }, []);

  const setManualCity = useCallback((city) => {
    setLatlongSync('');
    setLocationLabelSync(city);
    setLocationStatus('granted');
    // Don't cache manual cities in the GPS cache — they're already in sessionStorage via SS_KEY
  }, []);

  // Refreshes GPS — clears cache first so we get a fresh fix
  const refreshLocation = useCallback(() => {
    clearLocationCache();
    requestLocation();
  }, [requestLocation]);

  const reset = useCallback(() => {
    setLatlongSync('');
    setLocationLabelSync('');
    setLocationStatus('idle');
    clearLocationCache();
  }, []);

  return {
    locationStatus,
    latlong,
    latlongRef,
    locationLabel,
    locationLabelRef,
    setLocationLabelSync,
    setLatlongSync,
    requestLocation,
    refreshLocation,
    setManualCity,
    reset,
  };
}