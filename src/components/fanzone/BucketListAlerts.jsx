import { useEffect, useRef, useState } from 'react';
import { Bell, Check, Loader2, MapPin, Search, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import './bucket-list-alerts.css';

const validLocation = value => typeof value?.latitude === 'number' && Number.isFinite(value.latitude) && typeof value?.longitude === 'number' && Number.isFinite(value.longitude);

export default function BucketListAlerts({ following }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [serviceActive, setServiceActive] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [radius, setRadius] = useState(25);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const requestVersion = useRef(0);
  const saveLock = useRef(false);
  const hasAttractions = following.some(item => item.type !== 'venue');

  const loadPreferences = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await base44.functions.invoke('manageDiscoveryAlerts', { action: 'get_preferences' });
      const prefs = result?.data;
      if (!prefs || prefs.error || typeof prefs.enabled !== 'boolean') throw new Error('Preferences unavailable');
      setEnabled(prefs.enabled);
      setServiceActive(prefs.service_active === true);
      setSelected(validLocation(prefs) ? prefs : null);
      setCityQuery(validLocation(prefs) ? prefs.city_label || '' : '');
      setRadius([10, 25, 50, 100].includes(prefs.radius_miles) ? prefs.radius_miles : 25);
      setConsent(prefs.location_consent === true);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadPreferences(); return () => { requestVersion.current++; }; }, []);

  useEffect(() => {
    let active = true;
    const keyword = cityQuery.trim();
    setSuggestions([]);
    if (selected || keyword.length < 2) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const result = await base44.functions.invoke('suggestCities', { keyword });
        if (result?.data?.error) throw new Error('City search unavailable');
        if (active) setSuggestions(Array.isArray(result?.data?.cities) ? result.data.cities : []);
      } catch { if (active) setError('City search is unavailable. Please try again.'); }
      finally { if (active) setSearching(false); }
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [cityQuery, selected]);

  const selectCity = async city => {
    const version = ++requestVersion.current;
    setResolving(true);
    setSuggestions([]);
    setError('');
    setStatus('');
    try {
      const result = await base44.functions.invoke('manageDiscoveryAlerts', { action: 'resolve_city', city: city.city, state: city.state });
      if (!validLocation(result?.data) || !result.data.city_label || result.data.error) throw new Error('Location unavailable');
      if (version !== requestVersion.current) return;
      setSelected(result.data);
      setCityQuery(result.data.city_label);
      setConsent(false);
    } catch { if (version === requestVersion.current) setError('We couldn’t find an event area for that city. Try another city.'); }
    finally { if (version === requestVersion.current) setResolving(false); }
  };
  const save = async event => {
    event.preventDefault();
    if (saveLock.current) return;
    if (enabled && hasAttractions && (!selected || !consent)) {
      setError('Choose a city and confirm its use for nearby artist and team alerts.');
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setError('');
    setStatus('');
    const useLocation = Boolean(enabled && selected && consent);
    try {
      const result = await base44.functions.invoke('manageDiscoveryAlerts', {
        action: 'set_preferences', enabled, location_consent: useLocation,
        city_label: useLocation ? selected.city_label : null,
        latitude: useLocation ? selected.latitude : null,
        longitude: useLocation ? selected.longitude : null,
        radius_miles: useLocation ? radius : null,
      });
      if (!result?.data || result.data.error || result.data.enabled !== enabled) throw new Error('Save not confirmed');
      if (!useLocation) { setSelected(null); setCityQuery(''); setConsent(false); }
      setServiceActive(result.data.service_active === true);
      setStatus(enabled ? result.data.service_active === true ? 'Event alerts are on. Find them in your Notifications inbox.' : 'Preferences saved. Event alerts are not active yet.' : 'Event alerts are off. Your bucket list is still saved.');
    } catch { setError('We couldn’t save your alert settings. Please try again.'); }
    finally { saveLock.current = false; setSaving(false); }
  };

  if (loading) return <p className="pg-bucket-status" role="status">Loading alert settings…</p>;
  if (loadError) return <div className="pg-bucket-problem"><p role="alert">Event alert settings aren’t available right now.</p><button type="button" onClick={loadPreferences}>Try again</button></div>;
  return <form className="pg-bucket-alerts" onSubmit={save}>
    <div className="pg-bucket-alert-heading"><Bell size={20} aria-hidden="true" /><h3>Don’t miss your next live moment.</h3></div>
    <p className="pg-bucket-note">Get in-app alerts when matching upcoming events are found. Artists and teams use your chosen area; saved venues cover events at that venue.</p>
    {!serviceActive && <p className="pg-bucket-alert-notice" role="status">Event alerts are not active yet. You can save your preferences now.</p>}
    {!following.length && <p className="pg-bucket-alert-notice">Add an artist, team or venue to your list to start receiving matching alerts.</p>}
    <fieldset disabled={saving || resolving}>
      <label className="pg-bucket-alert-toggle"><span><strong>In-app event alerts</strong><small>Updates in your Notifications inbox.</small></span><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setStatus(''); }} /></label>
      {enabled && <div className="pg-bucket-alert-area">
        <label htmlFor="bucket-alert-city" className="pg-bucket-alert-label">Area for artists & teams <span>{hasAttractions ? 'Required' : 'Optional for venues'}</span></label>
        <div className="pg-bucket-search-field">
          <Search size={17} aria-hidden="true" />
          <input id="bucket-alert-city" type="text" autoComplete="off" placeholder="Search a city" value={cityQuery} onChange={event => { requestVersion.current++; setCityQuery(event.target.value); setSelected(null); setConsent(false); setError(''); setStatus(''); }} />
          {searching || resolving ? <span className="pg-bucket-search-spinner"><Loader2 size={17} className="animate-spin" /></span> : cityQuery && <button type="button" aria-label="Clear alert city" onClick={() => { requestVersion.current++; setCityQuery(''); setSelected(null); setConsent(false); }}><X size={17} /></button>}
        </div>
        {!!suggestions.length && <div className="pg-bucket-city-results" aria-label="City suggestions">{suggestions.map(city => <button key={city.label} type="button" onClick={() => selectCity(city)}><MapPin size={16} aria-hidden="true" />{city.label}</button>)}</div>}
        {!selected && !searching && !resolving && cityQuery.trim().length >= 2 && !suggestions.length && <p className="pg-bucket-note">No matching cities. Try another city name.</p>}
        {selected && <>
          <p className="pg-bucket-alert-location"><MapPin size={16} aria-hidden="true" /><span>{selected.city_label}</span><Check size={15} aria-hidden="true" /></p>
          <label className="pg-bucket-radius-label" htmlFor="bucket-alert-radius">Search radius<select id="bucket-alert-radius" value={radius} onChange={event => { setRadius(Number(event.target.value)); setStatus(''); }}>{[10, 25, 50, 100].map(miles => <option key={miles} value={miles}>{miles} miles</option>)}</select></label>
          <p className="pg-bucket-note">Distance is measured from this city’s event venue area, not your device location.</p>
          <label className="pg-bucket-alert-consent"><input type="checkbox" checked={consent} onChange={event => { setConsent(event.target.checked); setStatus(''); }} /><span>Save this area and radius for my artist and team alerts.</span></label>
        </>}
        <p className="pg-bucket-alert-privacy">Your device location isn’t requested. Venue alerts follow the venue itself.</p>
      </div>}
      <button type="submit" className="pg-bucket-primary" disabled={enabled && hasAttractions && (!selected || !consent)}>{saving ? <><Loader2 size={17} className="animate-spin" /> Saving…</> : 'Save alert settings'}</button>
    </fieldset>
    {error && <p className="pg-bucket-problem" role="alert">{error}</p>}
    {status && <p className="pg-bucket-status" role="status">{status}</p>}
    <p className="pg-bucket-alert-privacy">Alerts cover recently discovered events in Peanut Gallery. You can turn them off here anytime.</p>
  </form>;
}
