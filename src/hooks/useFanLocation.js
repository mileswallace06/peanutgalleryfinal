import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useLocationDetect } from './useLocationDetect';
import { cityFromSuggestion, restoreEventLocation, sameEventLocation, saveEventLocation, subscribeEventLocation, validCoordinates } from '@/lib/eventLocation';

// Use the same validated browsing market as Events/Upgrades, without requesting
// permission on mount or when the Near Me tab is selected.
export function useFanLocation() {
  const [area, setArea] = useState(null);
  const areaRef = useRef(null);
  const intent = useRef(0);
  const applyArea = next => { areaRef.current = next; setArea(next); };
  const { locationStatus, requestLocation, cancelRequest } = useLocationDetect({
    restoreCache: false,
    retryOnTimeout: false,
    onSuccess: value => {
      const ll = validCoordinates(value);
      if (ll) applyArea(saveEventLocation({ ll, label: 'your location · 80 km' }));
    },
  });
  useEffect(() => {
    let active = true;
    const currentIntent = intent.current;
    restoreEventLocation(base44).then(saved => {
      if (active && currentIntent === intent.current && saved) applyArea(saved);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => subscribeEventLocation(saved => {
    if (sameEventLocation(saved, areaRef.current)) return;
    intent.current++;
    cancelRequest();
    applyArea(saved);
  }), [cancelRequest]);
  const chooseCity = suggestion => {
    const city = cityFromSuggestion(suggestion);
    if (!city) return false;
    intent.current++;
    cancelRequest();
    applyArea(saveEventLocation(city));
    return true;
  };
  const enableLocation = () => {
    intent.current++;
    requestLocation();
  };
  return { area, locationStatus, chooseCity, enableLocation };
}
