import { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ChevronRight, LocateFixed, X, Clock, RefreshCw } from 'lucide-react';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { getEventLiveStatus, SOON_WINDOW_MINUTES } from '@/lib/eventTiming';
import { getEventUrl } from '@/lib/eventUrl';
import { logNavEvent } from '@/lib/navLogger';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { fetchTMEvents, bustTMCache } from '@/lib/tmCache';
import { useLocationDetect } from '@/hooks/useLocationDetect';
import WhatIsPGOverlay, { shouldShowOverlay } from '@/components/WhatIsPGOverlay';

// ── sessionStorage helpers ────────────────────────────────────────────────
const SS_KEY = 'pg_upgrades_location';
function readSS() {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch { return null; }
}
function writeSS(data) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(data)); } catch {}
}

export default function Upgrades() {
  const _ss = readSS();
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showOverlay, setShowOverlay] = useState(() => shouldShowOverlay());
  const [locationInput, setLocationInput] = useState(_ss?.locationInput || '');
  const [editingLocation, setEditingLocation] = useState(false);

  const [tmError, setTmError] = useState(false);

  const { locationStatus, latlong, latlongRef, locationLabel, locationLabelRef, requestLocation, refreshLocation, setManualCity } = useLocationDetect({
    onSuccess: (ll) => fetchEvents(ll, null),
  });

  const abortRef = useRef(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Restore last manual city on hard refresh.
  // GPS coords are auto-restored by useLocationDetect.
  useEffect(() => {
    const ss = readSS();
    if (ss?.city && ss.city !== 'Near me' && !latlong) {
      setManualCity(ss.city);
      fetchEvents(null, ss.city);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchEvents = useCallback(async (ll, cityOverride, bust = false) => {
    if (!ll && !cityOverride) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setLoading(true);
    setTmError(false);
    const tmParams = { size: 40 };
    if (ll) { tmParams.latlong = ll; tmParams.radius = '50'; }
    else if (cityOverride) { tmParams.city = cityOverride; }

    if (bust) bustTMCache(tmParams);

    try {
      const [localData, { events: tmEventsRaw }] = await Promise.all([
        base44.entities.Event.list('date', 200),
        fetchTMEvents(base44, tmParams),
      ]);

      let pgEvents = localData.filter(e => e.status !== 'ended');

      if (cityOverride && !ll) {
        const q = cityOverride.toLowerCase();
        pgEvents = pgEvents.filter(e =>
          e.city?.toLowerCase().includes(q) ||
          e.state?.toLowerCase().includes(q) ||
          e.venue?.toLowerCase().includes(q)
        );
      }
      if (ll) {
        const tmCities = new Set(tmEventsRaw.map(e => e.city?.toLowerCase()).filter(Boolean));
        if (tmCities.size > 0) {
          pgEvents = pgEvents.filter(e => !e.city || tmCities.has(e.city.toLowerCase()));
        } else {
          pgEvents = [];
        }
      }

      const pgMapped = pgEvents.map(e => ({ ...e, source: 'pg' }));
      const tmEvents = tmEventsRaw.map(e => ({ ...e, id: `tm_${e.tm_id}`, source: 'ticketmaster' }));
      const pgTmIds = new Set(pgMapped.map(e => e.tm_id).filter(Boolean));
      const uniqueTM = tmEvents.filter(e => !pgTmIds.has(e.tm_id));

      if (signal.aborted) return;
      setAllEvents([...pgMapped, ...uniqueTM]);
    } catch (err) {
      if (signal.aborted) return;
      if (err?.response?.status === 429) setTmError(true);
      else console.error(err);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  const handleNearMe = () => {
    setEditingLocation(false);
    requestLocation();
  };

  const nowMs = Date.now();
  const liveEvents = allEvents.filter((e) => {
    const s = getEventLiveStatus(e, nowMs).status;
    return s === 'live';
  });
  const soonEvents = allEvents.filter((e) => {
    const s = getEventLiveStatus(e, nowMs).status;
    return s === 'soon';
  });
  const upcomingEvents = allEvents
    .filter((e) => {
      const s = getEventLiveStatus(e, nowMs).status;
      return s === 'upcoming';
    })
    .sort((a, b) => {
      const aMs = new Date(a.event_start_utc || a.date || 0).getTime();
      const bMs = new Date(b.event_start_utc || b.date || 0).getTime();
      return aMs - bMs;
    });

  const { containerRef, pulling } = usePullToRefresh(() => {
    const ll = latlongRef.current || null;
    const city = !ll && locationLabelRef.current && locationLabelRef.current !== 'Near me' ? locationLabelRef.current : null;
    fetchEvents(ll, city, true);
  });

  return (
    <div ref={containerRef} className="pb-32 transition-transform duration-200">
      {showOverlay && <WhatIsPGOverlay onDismiss={() => setShowOverlay(false)} />}
      {pulling && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ background: 'rgba(0,255,135,0.15)', border: '1px solid rgba(0,255,135,0.3)' }}>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: '#00FF87' }} />
          <span className="text-xs font-semibold" style={{ color: '#00FF87' }}>Refreshing…</span>
        </div>
      )}
      {/* Hero */}
      <div className="relative h-52 overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        <img
          src="https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80"
          alt="Upgrades"
          className="w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.4) 0%, rgba(5,3,12,0.2) 40%, rgba(5,3,12,0.95) 100%)' }} />

        <div className="absolute bottom-5 left-4 right-4">
          <h1 className="font-display text-white mb-1"
            style={{
              fontSize: 'clamp(3rem, 14vw, 5rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.7))'
            }}>
            Upgrades
          </h1>
          <p className="text-sm text-white/60">Buy better seats from fans already inside the venue.</p>
        </div>
      </div>

      {/* Location bar — compact, secondary */}
      <div className="px-4 mt-3 mb-4">
        {editingLocation ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <LocationAutocomplete
                value={locationInput}
                onChange={setLocationInput}
                onSelect={(s) => { setManualCity(s.label); setEditingLocation(false); writeSS({ city: s.label, locationInput: s.label }); fetchEvents(null, s.label); }}
                onSubmit={(val) => { setManualCity(val); setEditingLocation(false); writeSS({ city: val, locationInput: val }); fetchEvents(null, val); }}
                onNearMe={handleNearMe}
                nearMeLoading={locationStatus === 'requesting'}
                autoFocus
              />
              <button type="button" onClick={() => setEditingLocation(false)}
                className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 transition-all active:scale-95"
                style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            {(locationStatus === 'denied' || locationStatus === 'unavailable' || locationStatus === 'timeout') && (
              <p className="text-[11px] px-1 text-muted-foreground">
                {locationStatus === 'denied'
                  ? 'Location blocked — enter your city above.'
                  : locationStatus === 'timeout'
                  ? 'Location timed out — enter your city above.'
                  : "Couldn't detect location — enter your city above."}
              </p>
            )}
          </div>
        ) : !locationLabel ? (
          /* idle — compact two-button row */
          <div className="flex gap-2">
            <button onClick={requestLocation} disabled={locationStatus === 'requesting'}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-60"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              {locationStatus === 'requesting'
                ? <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} />
                : <LocateFixed className="w-3.5 h-3.5 text-muted-foreground" />
              }
              <span className="text-foreground">Near Me</span>
            </button>
            <button onClick={() => { setLocationInput(''); setEditingLocation(true); }}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-foreground">Enter city</span>
            </button>
          </div>
        ) : (
          /* location set — small inline chip */
          <button
            onClick={() => { setLocationInput(locationLabel === 'Near me' ? '' : locationLabel); setEditingLocation(true); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all active:scale-[0.98]"
            style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}
          >
            {locationStatus === 'requesting'
              ? <span className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} />
              : <MapPin className="w-3 h-3 text-muted-foreground" />
            }
            <span className="text-xs text-muted-foreground truncate max-w-[130px]">{locationLabel}</span>
            <span className="text-[10px] text-muted-foreground opacity-60">· change</span>
          </button>
        )}
      </div>

      {/* Rate limit error */}
      {tmError && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-sm font-medium"
          style={{ background: 'rgba(255,140,0,0.1)', border: '1px solid rgba(255,140,0,0.3)', color: '#FF8C00' }}>
          Too many requests right now. Please wait a moment and try again.
        </div>
      )}

      {/* Screen-reader result count announcement */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {!loading && locationLabel && (
          allEvents.length === 0
            ? `No upgrades found near ${locationLabel}`
            : `${allEvents.length} upgrade${allEvents.length !== 1 ? 's' : ''} found near ${locationLabel}`
        )}
      </div>

      {/* Content */}
      <div className="px-4 space-y-8">
        {!loading && locationStatus === 'idle' && !locationLabel && (
          <div className="rounded-3xl overflow-hidden relative" style={{ minHeight: 200 }}>
            <img
              src="https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?w=800&q=70"
              alt="stadium seating"
              className="w-full h-full object-cover absolute inset-0"
              style={{ opacity: 0.15, filter: 'grayscale(20%)' }}
            />
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)' }} />
            <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 py-14 gap-2">
              <LocateFixed className="w-7 h-7 text-muted-foreground opacity-40 mb-1" />
              <p className="font-bold text-foreground text-base">See upgrades near you</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Better seats from fans already inside the venue — available at showtime.
              </p>
            </div>
          </div>
        )}
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden flex animate-pulse" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                <div className="w-20 flex-shrink-0" style={{ minHeight: 80, background: 'hsl(var(--muted))' }} />
                <div className="flex-1 px-4 py-4 space-y-2">
                  <div className="h-3 rounded-full bg-muted w-3/4" />
                  <div className="h-2.5 rounded-full bg-muted w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (locationStatus === 'granted' || locationLabel) && (
          <>
            {/* LIVE NOW */}
            <section>
              <SectionHeader
                dot="red"
                label="Live Now"
                count={liveEvents.length > 0 ? liveEvents.length : null}
              />
              {liveEvents.length === 0 ? (
                <div className="rounded-2xl px-5 py-6 text-center" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <p className="text-sm font-medium text-foreground">No events live right now</p>
                  <p className="text-xs text-muted-foreground mt-1">Upgrades open when a show near you starts.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {liveEvents.map((event) => (
                    <EventCard key={event.id} event={event} mode="live" />
                  ))}
                </div>
              )}
            </section>

            {/* STARTING SOON */}
            {soonEvents.length > 0 && (
              <section>
                <SectionHeader
                  icon={<Clock className="w-3.5 h-3.5" />}
                  label="Starting Soon"
                  count={soonEvents.length}
                  meta={`within ${SOON_WINDOW_MINUTES} min`}
                />
                <div className="space-y-3">
                  {soonEvents.map((event) => (
                    <EventCard key={event.id} event={event} mode="soon" />
                  ))}
                </div>
              </section>
            )}

            {/* UPCOMING */}
            <section>
              <SectionHeader
                icon={<Calendar className="w-3.5 h-3.5" />}
                label="Upcoming Near You"
                count={upcomingEvents.length > 0 ? upcomingEvents.length : null}
              />
              {upcomingEvents.length === 0 ? (
                <div className="rounded-2xl px-5 py-6 text-center" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <p className="text-sm font-medium text-foreground">No upcoming events found</p>
                  <p className="text-xs text-muted-foreground mt-1">New events are added regularly — check back soon.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingEvents.map((event) => (
                    <EventCard key={event.id} event={event} mode="upcoming" />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ dot, icon, label, count, meta }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {dot && <span className="w-2 h-2 rounded-full flex-shrink-0 bg-red-500" />}
      {icon && <span className="text-muted-foreground flex-shrink-0">{icon}</span>}
      <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">{label}</h2>
      {count != null && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium tabular-nums"
          style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
          {count}
        </span>
      )}
      {meta && <span className="text-[10px] text-muted-foreground opacity-60">{meta}</span>}
      <div className="h-px flex-1 bg-border opacity-50" />
    </div>
  );
}

function EventCard({ event, mode }) {
  const isLive = mode === 'live';
  const isSoon = mode === 'soon';
  const navigate = useNavigate();
  const isTM = event.source === 'ticketmaster' || String(event.id || '').startsWith('tm_');
  // Admin check is done server-side; this component doesn't have user context, so just hide debug overlay for non-admins
  // Pass isAdmin from parent if needed — for now disable client-side bypass
  const adminUnlocked = false;

  // For real PG events, use direct link. For TM-only, sync first then navigate.
  const pgId = !isTM ? event.id : null;
  const tmId = event.tm_id || (String(event.id || '').startsWith('tm_') ? String(event.id).replace('tm_', '') : null);
  const hasValidLink = !!(pgId || tmId);

  const [syncing, setSyncing] = useState(false);

  const handleClick = async (e) => {
    if (pgId) {
      // Real PG event — navigate directly
      logNavEvent({ result: 'success', event, sourcePage: 'Upgrades', generatedHref: `/upgrades/${pgId}`, lookupMethod: 'direct_id' });
      navigate(`/upgrades/${pgId}`);
      return;
    }
    if (!tmId) return;
    // TM-only event — sync to DB first to get a real internal ID
    e.preventDefault();
    setSyncing(true);
    try {
      const res = await base44.functions.invoke('syncTMEvent', {
        tm_id: tmId,
        title: event.title,
        venue: event.venue,
        city: event.city,
        state: event.state,
        date: event.date,
        image_url: event.image_url,
        tm_url: event.tm_url,
        category: event.category,
      });
      const internalId = res?.data?.id;
      if (internalId) {
        logNavEvent({ result: 'success', event, sourcePage: 'Upgrades', generatedHref: `/upgrades/${internalId}`, lookupMethod: 'sync_then_navigate' });
        navigate(`/upgrades/${internalId}`);
      } else {
        // Sync returned no id — fall back to TM detail page
        navigate(`/events/tm/${tmId}`);
      }
    } catch {
      navigate(`/events/tm/${tmId}`);
    } finally {
      setSyncing(false);
    }
  };

  const linkLabel = syncing ? 'Loading…' : isLive ? 'Open Live Hub' : isSoon ? 'Get Ready' : 'View Upgrades';

  return (
    <div
      onClick={handleClick}
      className="flex items-center gap-3 rounded-2xl overflow-hidden relative cursor-pointer active:scale-[0.98] transition-transform"
      style={{
        background: 'var(--card)',
        border: isLive ? '1px solid rgba(0,255,135,0.3)' : isSoon ? '1px solid rgba(255,230,0,0.3)' : '1px solid var(--border)',
        boxShadow: isLive ? '0 0 20px rgba(0,255,135,0.08)' : isSoon ? '0 0 20px rgba(255,230,0,0.06)' : 'none',
      }}
    >
      <div className="w-20 h-20 flex-shrink-0 relative overflow-hidden">
        {event.image_url ? (
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover absolute inset-0" />
        ) : (
          <div className="w-full h-full absolute inset-0 flex items-center justify-center bg-muted">
            <Calendar className="w-6 h-6 text-muted-foreground opacity-40" />
          </div>
        )}
        {isLive && (
          <span className="absolute top-1.5 left-1.5 text-[8px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: '#FF2D78', color: '#fff' }}>
            LIVE
          </span>
        )}
      </div>

      <div className="flex-1 py-3 min-w-0">
        <h3 className="font-bold text-foreground text-sm leading-tight line-clamp-1">{event.title}</h3>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
          <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: '#00C8FF' }} />
          <span className="truncate">{event.venue}{event.city ? `, ${event.city}` : ''}</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
          <Calendar className="w-3 h-3 flex-shrink-0" style={{ color: '#BF5FFF' }} />
          <span>{event.date ? format(new Date(event.date), 'EEE, MMM d · h:mm a') : 'TBD'}</span>
        </div>
        {!isLive && !isTM && (
          <span className="mt-1.5 text-[10px] text-muted-foreground">Available at showtime</span>
        )}
      </div>

      <div className="pr-3 flex-shrink-0">
        {hasValidLink ? (
          <button
            onClick={handleClick}
            disabled={syncing}
            className="flex items-center gap-1 px-3 py-2 rounded-xl font-bold text-xs whitespace-nowrap disabled:opacity-60"
            style={isLive
              ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
              : isSoon
              ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }
              : { background: 'hsl(var(--secondary))', color: 'hsl(var(--secondary-foreground))', border: '1px solid hsl(var(--border))' }
            }
          >
            {syncing
              ? <span className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} />
              : null
            }
            {linkLabel} {!syncing && <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="px-3 py-2 rounded-xl text-xs text-muted-foreground opacity-60 whitespace-nowrap">
            Unavailable
          </span>
        )}
      </div>

      {/* Admin debug overlay */}
      {adminUnlocked && (
        <div className="absolute bottom-1 left-[84px] right-20 text-[8px] font-mono leading-tight pointer-events-none"
          style={{ color: 'rgba(255,230,0,0.6)' }}>
          id:{String(event.id||'').slice(0,12)} tm:{String(event.tm_id||'-').slice(0,12)} src:{event.source||'?'} pgId:{pgId||'–'} tmId:{tmId||'–'}
        </div>
      )}
    </div>
  );
}