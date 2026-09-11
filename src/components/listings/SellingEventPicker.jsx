import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, MapPin, LocateFixed, RefreshCw, X, ArrowRight, Clock3 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import EventThumbnail from '@/components/events/EventThumbnail';
import { useSellingDiscovery } from '@/hooks/useSellingDiscovery';
import { useEventClock } from '@/hooks/useEventClock';
import { sellingEventList, sellingEventDate, SELLING_STATUS_LABELS } from '@/lib/sellingEventTiming';
import { resolveSellingEvent } from '@/lib/resolveSellingEvent';

export default function SellingEventPicker({ initialKeyword = '', initialEventId, onSelect }) {
  const search = useSellingDiscovery(initialKeyword);
  const now = useEventClock();
  const [mode, setMode] = useState('all');
  const [selecting, setSelecting] = useState(null), [selectionError, setSelectionError] = useState('');
  const busy = useRef(false), selectionGeneration = useRef(0), retryCandidate = useRef(null);
  const select = useCallback(async event => {
    if (busy.current) return;
    busy.current = true; const id = ++selectionGeneration.current;
    retryCandidate.current = event; setSelecting(typeof event === 'string' ? event : event.id || event.tm_id); setSelectionError('');
    try { const canonical = await resolveSellingEvent(base44, event); if (selectionGeneration.current === id) onSelect(canonical); }
    catch { if (selectionGeneration.current === id) setSelectionError('We could not load this event. Please try again or choose another event.'); }
    finally { if (selectionGeneration.current === id) { busy.current = false; setSelecting(null); } }
  }, [onSelect]);
  useEffect(() => { if (initialEventId) select(initialEventId); }, [initialEventId, select]);
  useEffect(() => () => { selectionGeneration.current++; busy.current = false; }, []);
  const all = sellingEventList(search.result.events, 'all', now);
  const visible = sellingEventList(search.result.events, mode, now);
  const sourceError = search.result.pgError || search.result.tmError;
  const hasArea = search.request.scope === 'nationwide' || !!(search.request.cityOverride || search.request.ll);
  const noLocalMatches = hasArea && search.request.scope === 'local' && search.request.keyword && !search.loading && !sourceError && !search.result.limited && all.length === 0;
  const resetFilter = action => { setMode('all'); action(); };
  return <section aria-label="Choose an event" data-ongoing-window={search.result.ongoingCoverage?.discoveryWindow} data-ongoing-as-of={search.result.ongoingCoverage?.endDateTime} className="space-y-5">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => resetFilter(search.nearMe)} disabled={search.locationStatus === 'requesting'} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-3 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"><LocateFixed className="h-4 w-4" />{search.locationStatus === 'requesting' ? 'Locating…' : 'Near Me'}</button>
      <button type="button" onClick={search.openLocation} aria-expanded={search.editingLocation} aria-controls="selling-location" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3 py-3 text-sm font-bold"><MapPin className="h-4 w-4 text-primary" />Change location</button>
    </div>
    <p data-selling-scope={search.request.scope} className="text-sm text-muted-foreground">{search.request.scope === 'nationwide' ? 'Nationwide results · United States' : search.area ? `Nearby · ${search.area.label}` : 'Choose your local area'}</p>
    {search.editingLocation && <section id="selling-location" aria-label="Selling location" className="rounded-2xl border border-primary/30 bg-card p-4 space-y-3">
      <div className="flex justify-between items-center"><h2 className="font-bold">Choose your local area</h2><button type="button" aria-label="Close location picker" onClick={search.closeLocation} className="min-h-11 min-w-11 flex items-center justify-center"><X className="w-4 h-4" /></button></div>
      <LocationAutocomplete value={search.locationInput} onChange={search.changeLocationInput} onSelect={city => resetFilter(() => search.selectCity(city))} onSubmit={search.rejectCity} autoFocus placeholder="Find a city" />
      {search.cityError && <p role="alert" className="text-sm text-muted-foreground">{search.cityError}</p>}
      <button type="button" disabled={search.locationStatus === 'requesting'} onClick={() => search.locate()} className="min-h-11 font-bold text-sm text-primary disabled:opacity-50">Use my location</button>
    </section>}
    <form role="search" onSubmit={e => { e.preventDefault(); resetFilter(search.submit); e.currentTarget.querySelector('input')?.blur(); }} className="flex gap-2">
      <div className="relative flex-1 min-w-0"><label htmlFor="selling-event-search" className="sr-only">Search events, artists, teams, or venues</label><Search className="pointer-events-none absolute left-3 top-4 h-4 w-4 text-muted-foreground" /><input id="selling-event-search" type="search" value={search.keyword} onChange={e => search.setKeyword(e.target.value)} maxLength={100} autoComplete="off" enterKeyHint="search" placeholder="Artist, event, team or venue" className="w-full min-h-12 rounded-xl border border-border bg-card pl-10 pr-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
      <button type="submit" className="min-h-12 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">Search</button>
    </form>
    <div role="group" aria-label="Event timing" className="grid grid-cols-3 gap-2">{[['all', 'All'], ['live', 'Live Now'], ['upcoming', 'Upcoming']].map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)} className={`min-h-11 rounded-xl border px-2 text-sm font-bold ${mode === key ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-card border-border text-muted-foreground'}`}>{label}</button>)}</div>
    {mode === 'live' && <p className="text-xs leading-relaxed text-muted-foreground rounded-xl border border-border p-3">Live Now includes PG events and a bounded Ticketmaster search of starts in the last 12 hours. Estimated windows are labeled; older or unlisted ongoing events may be missing.</p>}
    <div className="flex items-center justify-between gap-3"><p aria-live="polite" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{search.loading || search.restoring ? 'Finding events…' : `${visible.length} ${visible.length === 1 ? 'event' : 'events'}`}</p><button type="button" onClick={search.refresh} disabled={search.loading || !hasArea} className="inline-flex min-h-11 gap-2 items-center text-sm text-muted-foreground disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${search.loading ? 'animate-spin' : ''}`} />Refresh</button></div>
    {selectionError && <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-4 space-y-2"><p className="text-sm">{selectionError}</p><button type="button" disabled={!!selecting} onClick={() => select(retryCandidate.current)} className="min-h-11 font-bold text-primary">Retry event selection</button></div>}
    {selecting && <p role="status" className="text-sm text-primary">Preparing your event…</p>}
    {sourceError && <div role="alert" className="rounded-2xl border border-orange-400/30 bg-card p-4 space-y-2"><h2 className="font-bold">Some event results are unavailable</h2><p className="text-sm text-muted-foreground">{search.result.rateLimited ? 'Too many requests right now. Please wait a moment.' : search.result.tmOngoingError ? 'Live provider discovery is unavailable. Available PG and upcoming results are shown; live coverage is incomplete.' : 'We could not check every event source. This is not a complete set of local matches.'}</p><button type="button" onClick={search.refresh} className="min-h-11 font-bold text-primary">Retry search</button></div>}
    {(search.loading || search.restoring) && <div role="status" aria-label="Loading events" className="space-y-3">{[1, 2, 3].map(n => <div key={n} className="h-40 rounded-2xl bg-muted animate-pulse" />)}</div>}
    {!search.loading && !search.restoring && !hasArea && <div className="rounded-2xl border border-border bg-card p-5 text-center space-y-3"><MapPin className="w-6 h-6 mx-auto text-primary" /><h2 className="font-bold">Find events near you</h2><p className="text-sm text-muted-foreground">Use your location or choose a city to start browsing.</p><div className="flex flex-wrap justify-center gap-3"><button type="button" onClick={() => search.locate()} className="min-h-11 px-3 font-bold text-primary">Use my location</button><button type="button" onClick={search.openLocation} className="min-h-11 px-3 font-bold">Choose city</button></div></div>}
    {noLocalMatches && <div className="rounded-2xl border border-border bg-card p-5 space-y-3"><h2 className="font-bold">No matches for ‘{search.request.keyword}’ near {search.request.locationLabel}</h2><button type="button" onClick={() => resetFilter(search.nationwide)} className="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground">Search nationwide</button></div>}
    {!search.loading && hasArea && !sourceError && visible.length === 0 && !noLocalMatches && <div className="rounded-2xl border border-border bg-card p-5 space-y-2"><h2 className="font-bold">{mode === 'live' ? 'No live events in these results' : mode === 'upcoming' ? 'No upcoming events in these results' : 'No events found in these results'}</h2><p className="text-sm text-muted-foreground">{mode === 'live' ? 'There may still be upcoming local matches. Check All or Upcoming.' : 'Try another search or change your location.'}</p>{mode !== 'all' && <button type="button" onClick={() => setMode('all')} className="min-h-11 font-bold text-primary">Show all events</button>}</div>}
    {!search.loading && visible.map(({ event, timing }) => <article key={event.tm_id || event.id} data-event-source={event.source} data-provider-id={event.tm_id} className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex gap-4 p-4"><EventThumbnail event={event} className="w-20 h-28 rounded-xl flex-shrink-0" /><div className="min-w-0 space-y-2"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${timing.status.includes('live') ? 'bg-green-400/10 text-green-400' : 'bg-primary/10 text-primary'}`}>{SELLING_STATUS_LABELS[timing.status]}</span><h2 className="font-bold text-base leading-snug break-words">{event.title}</h2><p className="text-sm text-muted-foreground">{event.venue}</p><p className="text-xs text-muted-foreground">{[event.city, event.state].filter(Boolean).join(', ')}</p></div></div>
      <div className="border-t border-border px-4 pb-4 pt-3 space-y-3"><p className="text-xs text-muted-foreground flex items-start gap-2"><Clock3 className="w-4 h-4 flex-shrink-0" />{sellingEventDate(event, now)}</p>{timing.estimatedHours && <p className="text-xs text-muted-foreground">Estimated live window: {timing.estimatedHours} hours after start. Confirm the event is still running.</p>}<button type="button" onClick={() => select(event)} disabled={!!selecting} aria-label={`Select ${event.title}`} className="w-full min-h-11 rounded-xl border border-primary/30 bg-primary/10 text-primary text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40">{selecting === (event.id || event.tm_id) ? 'Preparing…' : 'Select event'}<ArrowRight className="w-4 h-4" /></button></div>
    </article>)}
    {hasArea && <p className="text-xs leading-relaxed text-muted-foreground rounded-xl border border-border p-3">Ticketmaster checks up to 40 starts from the last 12 hours, separately from upcoming results. Estimated live windows do not confirm the event is still running.{search.result.limited ? ' More events may exist beyond the result limits. Refine your search.' : ''}</p>}
  </section>;
}
