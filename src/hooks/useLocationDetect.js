import { useState, useRef, useCallback } from 'react';

/**
 * Unified location detection hook shared by Events and Upgrades.
 *
 * locationStatus: 'idle' | 'requesting' | 'granted' | 'unavailable' | 'denied'
 *
 * - 'idle'        → no attempt yet
 * - 'requesting'  → getCurrentPosition in-flight
 * - 'granted'     → success, latlong is populated
 * - 'unavailable' → code 2/3 — permission OK but no fix
 * - 'denied'      → code 1 — browser/OS blocked location
 */
export function useLocationDetect({ onSuccess } = {}) {
  const [locationStatus, setLocationStatus] = useState('idle');
  const [latlong, setLatlong] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const latlongRef = useRef('');
  const locationLabelRef = useRef('');

  const setLatlongSync = (val) => { latlongRef.current = val; setLatlong(val); };
  const setLocationLabelSync = (val) => { locationLabelRef.current = val; setLocationLabel(val); };

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus('unavailable');
      return;
    }

    setLocationStatus('requesting');

    // Check permissions API first if available (non-blocking — just for logging)
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        console.log('[Location] permission state:', result.state);
      }).catch(() => {});
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        setLatlongSync(ll);
        setLocationLabelSync('Near me');
        setLocationStatus('granted');
        if (onSuccess) onSuccess(ll);
      },
      (err) => {
        console.warn('[Location] error code:', err.code, err.message);
        if (err.code === 1) {
          // PERMISSION_DENIED
          setLocationStatus('denied');
        } else {
          // POSITION_UNAVAILABLE (2) or TIMEOUT (3)
          setLocationStatus('unavailable');
        }
      },
      { timeout: 10000, enableHighAccuracy: false, maximumAge: 0 }
    );
  }, [onSuccess]);

  const setManualCity = useCallback((city) => {
    setLatlongSync('');
    setLocationLabelSync(city);
    setLocationStatus('granted'); // treat manual city entry as "we have a location"
  }, []);

  const reset = useCallback(() => {
    setLatlongSync('');
    setLocationLabelSync('');
    setLocationStatus('idle');
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
    setManualCity,
    reset,
  };
}