import { useState, useRef, useCallback, useEffect } from 'react';
import { validCoordinates } from '../lib/eventLocation.js';

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
    if (!validCoordinates(latlong) || !Number.isFinite(ts) || ts > Date.now()) return null;
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

export function useLocationDetect({ onSuccess, onError, restoreCache = true, retryOnTimeout = true } = {}) {
  const [locationStatus, setLocationStatus] = useState('idle');
  const [latlong, setLatlong] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const latlongRef = useRef('');
  const locationLabelRef = useRef('');
  const didRestoreCache = useRef(false);
  const requestId = useRef(0);
  const requesting = useRef(false);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => () => { requestId.current++; }, []);

  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  const setLatlongSync = (val) => { latlongRef.current = val; setLatlong(val); };
  const setLocationLabelSync = (val) => { locationLabelRef.current = val; setLocationLabel(val); };

  // Restore cached GPS location on mount (once only)
  useEffect(() => {
    if (didRestoreCache.current || !restoreCache) return;
    didRestoreCache.current = true;

    const cached = readLocationCache();
    if (cached) {
      setLatlongSync(cached.latlong);
      setLocationLabelSync(cached.label || 'Near me');
      setLocationStatus('granted');
      // Fire onSuccess so the page re-fetches with the cached coords
      if (onSuccessRef.current) onSuccessRef.current(cached.latlong);
    }
  }, []);

  const requestLocation = useCallback(() => {
    if (requesting.current) return;
    const id = ++requestId.current;
    if (!navigator.geolocation) {
      setLocationStatus('unavailable');
      onErrorRef.current?.('unavailable');
      return;
    }
    requesting.current = true;
    setLocationStatus('requesting');
    const fail = status => {
      if (id !== requestId.current) return;
      requesting.current = false;
      setLocationStatus(status);
      if (status === 'denied') clearLocationCache();
      onErrorRef.current?.(status);
    };
    const succeed = pos => {
      if (id !== requestId.current) return;
      const ll = validCoordinates(`${pos?.coords?.latitude},${pos?.coords?.longitude}`);
      if (!ll) { fail('unavailable'); return; }
      requesting.current = false;
      setLatlongSync(ll);
      setLocationLabelSync('Near me');
      setLocationStatus('granted');
      writeLocationCache(ll, 'Near me');
      onSuccessRef.current?.(ll);
    };
    const statusFor = error => error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable';
    try {
      navigator.geolocation.getCurrentPosition(succeed, error => {
        if (id !== requestId.current) return;
        if (error?.code === 3 && retryOnTimeout) {
          try {
            navigator.geolocation.getCurrentPosition(succeed, error2 => fail(statusFor(error2)),
              { timeout: 20000, enableHighAccuracy: false, maximumAge: 300000 });
          } catch { fail('unavailable'); }
        } else fail(statusFor(error));
      }, { timeout: 15000, enableHighAccuracy: false, maximumAge: 60000 });
    } catch { fail('unavailable'); }
  }, [retryOnTimeout]);

  const cancelRequest = useCallback(() => {
    requestId.current++;
    requesting.current = false;
    setLocationStatus('idle');
  }, []);

  const setManualCity = useCallback((city) => {
    requestId.current++;
    requesting.current = false;
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
    requestId.current++;
    requesting.current = false;
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
    cancelRequest,
    refreshLocation,
    setManualCity,
    reset,
  };
}
