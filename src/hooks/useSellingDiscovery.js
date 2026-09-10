import { useState, useRef, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useLocationDetect } from './useLocationDetect';
import { createEventSearchRequest } from '@/lib/eventSearchRequest';
import { restoreEventLocation, saveEventLocation, cityFromSuggestion, validCoordinates } from '@/lib/eventLocation';
import { fetchSellingEvents } from '@/lib/sellingEventDiscovery';

export function useSellingDiscovery(initialKeyword = '') {
  const [keyword, setKeyword] = useState(initialKeyword.slice(0, 100));
  const [area, setArea] = useState(null), areaRef = useRef(null);
  const [request, setRequest] = useState(() => createEventSearchRequest(initialKeyword));
  const requestRef = useRef(request);
  const [result, setResult] = useState({ events: [], pgError: false, tmError: false });
  const [loading, setLoading] = useState(false), [restoring, setRestoring] = useState(true);
  const [editingLocation, setEditingLocation] = useState(false), [locationInput, setLocationInput] = useState(''), [cityError, setCityError] = useState('');
  const generation = useRef(0), intent = useRef(0), pendingGPS = useRef(null);
  const load = useCallback(async (next, refresh = false) => {
    const id = ++generation.current;
    requestRef.current = next; setRequest(next);
    const ready = next.scope === 'nationwide' ? !!next.keyword : !!(next.cityOverride || next.ll);
    setResult({ events: [], pgError: false, tmError: false });
    if (!ready) { setLoading(false); return; }
    setLoading(true);
    try { const data = await fetchSellingEvents(base44, next, refresh); if (generation.current === id) setResult(data); }
    catch { if (generation.current === id) setResult({ events: [], pgError: true, tmError: true }); }
    finally { if (generation.current === id) setLoading(false); }
  }, []);
  const run = (text, localArea = areaRef.current, scope = 'local') => {
    intent.current++; pendingGPS.current = null; cancelRequest(); setRestoring(false);
    const next = createEventSearchRequest(text, localArea, scope);
    setKeyword(next.keyword); setCityError('');
    if (scope === 'local' && localArea) { const saved = saveEventLocation(localArea); areaRef.current = saved; setArea(saved); }
    setEditingLocation(scope === 'local' && !localArea);
    load(next);
  };
  const { locationStatus, requestLocation, cancelRequest } = useLocationDetect({ restoreCache: false,
    onSuccess: ll => {
      const pending = pendingGPS.current; if (!pending) return;
      const valid = validCoordinates(ll);
      if (valid) run(pending.keyword, { ll: valid, label: 'your location · 50 miles' });
      else { pendingGPS.current = null; setCityError('Location is unavailable. Choose a city below.'); setEditingLocation(true); }
    },
    onError: status => {
      if (!pendingGPS.current) return; pendingGPS.current = null;
      setCityError(status === 'denied' ? 'Location permission was denied. Choose a city below.' : 'Location is unavailable. Choose a city below.');
      setLocationInput(''); setEditingLocation(true);
    },
  });
  useEffect(() => {
    let cancelled = false; const originalIntent = intent.current;
    restoreEventLocation(base44).then(localArea => {
      if (cancelled || originalIntent !== intent.current) return;
      setRestoring(false);
      if (localArea) { const saved = saveEventLocation(localArea); areaRef.current = saved; setArea(saved); load(createEventSearchRequest(initialKeyword, saved)); }
    }).catch(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; generation.current++; pendingGPS.current = null; };
  }, []);
  const locate = (text = requestRef.current.keyword) => { intent.current++; setRestoring(false); pendingGPS.current = { keyword: text }; setCityError(''); requestLocation(); };
  return { keyword, setKeyword, area, request, result, loading, restoring, editingLocation, locationInput, cityError, locationStatus,
    submit: () => run(keyword), nationwide: () => run(requestRef.current.keyword, null, 'nationwide'),
    nearMe: () => { run(''); if (!areaRef.current) locate(''); }, locate,
    refresh: () => load(requestRef.current, true),
    openLocation: () => { setLocationInput(''); setCityError(''); setEditingLocation(true); },
    closeLocation: () => { pendingGPS.current = null; cancelRequest(); setEditingLocation(false); },
    changeLocationInput: text => { setLocationInput(text); setCityError(''); },
    selectCity: city => { const localArea = cityFromSuggestion(city); if (localArea) run(requestRef.current.keyword, localArea); else setCityError('Choose a city from the suggestions.'); },
    rejectCity: () => setCityError('Choose a city from the suggestions, or use your location.'),
  };
}
