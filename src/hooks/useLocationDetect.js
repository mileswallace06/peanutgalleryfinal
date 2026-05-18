import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Unified location detection hook shared by Events and Upgrades.
 *
 * locationStatus: 'idle' | 'requesting' | 'granted' | 'unavailable' | 'denied' | 'timeout'
 *
 * - 'idle'        → no attempt yet
 * - 'requesting'  → getCurrentPosition in-flight
 * - 'granted'     → success, latlong is populated (or manual city set)
 * - 'unavailable' → code 2 — permission OK but GPS/network can't get a fix
 * - 'timeout'     → code 3 — timed out waiting for a fix
 * - 'denied'      → code 1 — browser/OS explicitly blocked location
 */
export function useLocationDetect({ onSuccess } = {}) {
  const [locationStatus, setLocationStatus] = useState('idle');
  const [latlong, setLatlong] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const latlongRef = useRef('');
  const locationLabelRef = useRef('');

  // Keep onSuccess in a ref so requestLocation never goes stale
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  const setLatlongSync = (val) => { latlongRef.current = val; setLatlong(val); };
  const setLocationLabelSync = (val) => { locationLabelRef.current = val; setLocationLabel(val); };

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      console.warn('[Location] navigator.geolocation not available');
      setLocationStatus('unavailable');
      return;
    }

    console.log('[Location] requesting position…');
    setLocationStatus('requesting');

    // Log current permission state (non-blocking)
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        console.log('[Location] permission state before request:', result.state);
      }).catch(() => {});
    }

    // First attempt: low accuracy, 15s timeout
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        console.log('[Location] success — lat/lng:', ll, '| accuracy:', pos.coords.accuracy, 'm');
        setLatlongSync(ll);
        setLocationLabelSync('Near me');
        setLocationStatus('granted');
        if (onSuccessRef.current) onSuccessRef.current(ll);
      },
      (err) => {
        console.warn('[Location] error — code:', err.code, '| message:', err.message);

        if (err.code === 1) {
          // PERMISSION_DENIED — user or OS blocked it
          setLocationStatus('denied');
        } else if (err.code === 3) {
          // TIMEOUT — try once more with high accuracy disabled and longer timeout
          console.warn('[Location] timeout on first attempt, retrying with relaxed settings…');
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
              console.log('[Location] retry success — lat/lng:', ll);
              setLatlongSync(ll);
              setLocationLabelSync('Near me');
              setLocationStatus('granted');
              if (onSuccessRef.current) onSuccessRef.current(ll);
            },
            (err2) => {
              console.warn('[Location] retry also failed — code:', err2.code, err2.message);
              setLocationStatus(err2.code === 1 ? 'denied' : 'timeout');
            },
            { timeout: 20000, enableHighAccuracy: false, maximumAge: 300000 }
          );
        } else {
          // POSITION_UNAVAILABLE (2)
          setLocationStatus('unavailable');
        }
      },
      { timeout: 15000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  }, []); // no deps — onSuccess accessed via ref

  const setManualCity = useCallback((city) => {
    setLatlongSync('');
    setLocationLabelSync(city);
    setLocationStatus('granted');
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