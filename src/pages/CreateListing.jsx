import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle, Upload, Zap, Search, Star } from 'lucide-react';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { fetchTMEvents } from '@/lib/tmCache';
import { isAdmin as checkIsAdmin } from '@/lib/isAdmin';
import NotificationPermissionPrompt from '@/components/NotificationPermissionPrompt';

const STEPS = ['Event', 'Seats', 'Price', 'Done'];

function StepBar({ current }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.slice(0, 3).map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center gap-1 flex-1">
            <div className="flex items-center gap-1.5 flex-1">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                style={{
                  background: done ? '#00FF87' : active ? 'rgba(191,95,255,0.3)' : 'hsl(var(--muted))',
                  color: done ? '#0D0B14' : active ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                  border: active ? '1px solid rgba(191,95,255,0.5)' : done ? 'none' : '1px solid hsl(var(--border))',
                  boxShadow: active ? '0 0 10px rgba(191,95,255,0.4)' : 'none',
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className="text-[11px] font-semibold"
                style={{ color: active ? 'hsl(var(--foreground))' : done ? '#00FF87' : 'hsl(var(--muted-foreground))' }}
              >
                {label}
              </span>
            </div>
            {i < 2 && (
              <div
                className="h-px flex-1 mx-1"
                style={{ background: done ? '#00FF8740' : 'hsl(var(--border))' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const inputClass = `w-full px-4 py-3.5 rounded-2xl text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40`;
const inputStyle = {
  background: 'hsl(var(--input))',
  border: '1px solid hsl(var(--border))',
};

export default function CreateListing() {
  const [searchParams] = useSearchParams();
  const preselectedEventId = searchParams.get('event_id');

  const [step, setStep] = useState(preselectedEventId ? 1 : 0);
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [user, setUser] = useState(null);
  const [eventTab, setEventTab] = useState('recommended');
  const [tmQuery, setTmQuery] = useState('');
  const [tmResults, setTmResults] = useState([]);
  const [tmLoading, setTmLoading] = useState(false);
  const [tmSearched, setTmSearched] = useState(false);
  const tmLastSearchRef = useRef(0);
  const [tmRateLimited, setTmRateLimited] = useState(false);
  // For TM events, store the selected event object (not just id)
  const [selectedTmEvent, setSelectedTmEvent] = useState(null);
  const [selectingTmId, setSelectingTmId] = useState(null);
  // Recommended events (same logic as Upgrades)
  const [allRecEvents, setAllRecEvents] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [recLocationDenied, setRecLocationDenied] = useState(false);
  const _recSS = (() => { try { return JSON.parse(sessionStorage.getItem('pg_upgrades_location') || 'null'); } catch { return null; } })();
  const [recCityInput, setRecCityInput] = useState(_recSS?.locationInput || '');
  const [recCitySubmitted, setRecCitySubmitted] = useState(false);

  const [listingMode, setListingMode] = useState('standard'); // 'standard' | 'instant'
  const [pgTransferProofUrl, setPgTransferProofUrl] = useState('');
  const [pgTransferNotes, setPgTransferNotes] = useState('');
  const [uploadingPgProof, setUploadingPgProof] = useState(false);

  const [form, setForm] = useState({
    event_id: preselectedEventId || '',
    section: '',
    row: '',
    seats: '',
    quantity: '1',
    tier: '',
    asking_price: '',
    original_price: '',
    transfer_method: 'email_transfer',
    proof_url: '',
  });

  useEffect(() => {
    base44.auth.me({ fresh: true }).catch(() => base44.auth.me()).then(setUser).catch(() => {});
    base44.entities.Event.filter({ status: 'upcoming' })
      .then(res => setEvents(res.filter(e => e.status !== 'ended')))
      .catch(console.error)
      .finally(() => setLoadingEvents(false));

    // Fetch recommended events using geo or city
    setNearbyLoading(true);
    const loadRecommended = (ll, cityOverride) => {
      // Require at least one location signal — no national blind fetch
      const tmParams = { size: 40 };
      if (ll) {
        tmParams.latlong = ll;
        tmParams.radius = '50';
      } else if (cityOverride) {
        tmParams.city = cityOverride;
      } else {
        // No location available — show empty with prompt
        setNearbyLoading(false);
        setRecLocationDenied(true);
        return;
      }

      Promise.all([
        base44.entities.Event.list('date', 200),
        fetchTMEvents(base44, tmParams).catch(() => ({ events: [] })),
      ]).then(([localData, { events: tmEventsRaw }]) => {
        let pgEvents = localData.filter(e => e.status !== 'ended');

        if (cityOverride) {
          // City mode: filter PG events by city name
          const q = cityOverride.toLowerCase();
          pgEvents = pgEvents.filter(e =>
            e.city?.toLowerCase().includes(q) ||
            e.venue?.toLowerCase().includes(q)
          );
        }
        // For geo mode: only filter PG events by TM cities if TM returned results
        if (ll && tmEventsRaw.length > 0) {
          const tmCities = new Set(tmEventsRaw.map(e => e.city?.toLowerCase()).filter(Boolean));
          if (tmCities.size > 0) {
            pgEvents = pgEvents.filter(e => !e.city || tmCities.has(e.city.toLowerCase()));
          }
        }

        const pgMapped = pgEvents.map(e => ({ ...e, source: 'pg' }));
        const tmEvents = tmEventsRaw.map(e => ({ ...e, id: `tm_${e.tm_id}`, source: 'ticketmaster' }));
        const pgTmIds = new Set(pgMapped.map(e => e.tm_id).filter(Boolean));
        const uniqueTM = tmEvents.filter(e => !pgTmIds.has(e.tm_id));
        setAllRecEvents([...pgMapped, ...uniqueTM]);
      }).catch(console.error).finally(() => setNearbyLoading(false));
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRecLocationDenied(false);
        loadRecommended(`${pos.coords.latitude},${pos.coords.longitude}`, null);
      },
      () => {
        // Geo denied — try saved city from sessionStorage before showing prompt
        const savedCity = _recSS?.city;
        if (savedCity) {
          setRecCitySubmitted(true);
          loadRecommended(null, savedCity);
        } else {
          setNearbyLoading(false);
          setRecLocationDenied(true);
        }
      },
      { timeout: 15000, enableHighAccuracy: false, maximumAge: 300000 }
    );

    // Store loadRecommended for city fallback
    window.__pgLoadRecommended = loadRecommended;
  }, []);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleProofUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingProof(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    set('proof_url', file_url);
    setUploadingProof(false);
  };

  const handlePgProofUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingPgProof(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setPgTransferProofUrl(file_url);
    setUploadingPgProof(false);
  };

  const handleSubmit = async () => {
    setSubmitting(true);

    if (listingMode === 'instant') {
      // Instant listing: create directly with pending_pg_verification status
      const listing = await base44.entities.Listing.create({
        event_id: form.event_id,
        seller_email: user?.email,
        section: form.section,
        row: form.row,
        seats: form.seats || undefined,
        quantity: parseInt(form.quantity) || 1,
        tier: form.tier || undefined,
        asking_price: parseFloat(form.asking_price),
        original_price: form.original_price ? parseFloat(form.original_price) : undefined,
        transfer_method: form.transfer_method,
        proof_url: form.proof_url || undefined,
        listing_mode: 'instant',
        custody_status: 'pending_pg_verification',
        status: 'pending_verification',
        proof_status: 'pending_review',
        pg_transfer_proof_url: pgTransferProofUrl || undefined,
        pg_transfer_notes: pgTransferNotes || undefined,
        notes: isAdminUser ? '[TEST]' : undefined,
      });
      setFlagged(false);
    } else {
      const res = await base44.functions.invoke('submitListing', {
        event_id: form.event_id,
        section: form.section,
        row: form.row,
        seats: form.seats || undefined,
        quantity: parseInt(form.quantity) || 1,
        tier: form.tier || undefined,
        asking_price: parseFloat(form.asking_price),
        original_price: form.original_price ? parseFloat(form.original_price) : undefined,
        transfer_method: form.transfer_method,
        proof_url: form.proof_url || undefined,
        is_test: isAdminUser,
      });
      setFlagged(res.data.flagged);
    }

    setSubmitting(false);
    setDone(true);
  };

  const handleTmSearch = async () => {
    if (!tmQuery.trim()) return;
    // Rate limit: enforce 2s cooldown between searches
    const now = Date.now();
    if (now - tmLastSearchRef.current < 2000) return;
    tmLastSearchRef.current = now;
    setTmLoading(true);
    setTmSearched(true);
    setTmRateLimited(false);
    try {
      const { events } = await fetchTMEvents(base44, { keyword: tmQuery });
      setTmResults(events);
    } catch (err) {
      if (err?.response?.status === 429) {
        setTmRateLimited(true);
        setTmResults([]);
      }
    } finally {
      setTmLoading(false);
    }
  };

  const handleSelectTmEvent = async (tmEvent) => {
    setSelectingTmId(tmEvent.tm_id);
    let localEvent;
    const existing = await base44.entities.Event.filter({ tm_id: tmEvent.tm_id });
    if (existing.length > 0) {
      localEvent = existing[0];
    } else {
      localEvent = await base44.entities.Event.create({
        title: tmEvent.title,
        venue: tmEvent.venue,
        city: tmEvent.city,
        date: tmEvent.date,
        image_url: tmEvent.image_url,
        tm_id: tmEvent.tm_id,
        tm_url: tmEvent.tm_url,
        status: 'upcoming',
      });
    }
    setSelectedTmEvent(localEvent);
    set('event_id', localEvent.id);
    setSelectingTmId(null);
    setStep(1);
  };

  const selectedEvent = events.find(e => e.id === form.event_id) || selectedTmEvent;

  // ── Onboarding gate ───────────────────────────────────────────────────────
  const isAdminUser = checkIsAdmin(user);
  const onboardingComplete =
    isAdminUser ||
    user?.stripe_onboarding_complete === true ||
    user?.stripe_onboarding_complete === 'true';

  if (user && !onboardingComplete) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 flex flex-col items-center text-center gap-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(255,140,0,0.12)', border: '1px solid rgba(255,140,0,0.3)' }}>
          <span className="text-3xl">🏦</span>
        </div>
        <div>
          <h2 className="font-display text-3xl mb-2" style={{ color: '#FF8C00' }}>Payout Account Required</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            To list tickets on Peanut Gallery, you need to connect your bank account via Stripe. It takes under 2 minutes.
          </p>
        </div>
        <Link
          to="/sell"
          className="w-full flex items-center justify-center gap-2 py-4 rounded-full font-black text-sm"
          style={{ background: 'linear-gradient(135deg, #FF8C00, #FF2D78)', color: '#fff', boxShadow: '0 0 18px rgba(255,140,0,0.25)' }}
        >
          Set Up Payouts →
        </Link>
        <Link to="/sell" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Sell
        </Link>
      </div>
    );
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (done) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        {isAdminUser && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black mb-4 dark:text-[#FFE600] text-[#7a6000]"
            style={{ background: 'rgba(255,200,80,0.12)', border: '1px solid rgba(255,200,80,0.3)' }}>
            🧪 Test Listing
          </div>
        )}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: 'rgba(0,255,135,0.12)', border: '1px solid rgba(0,255,135,0.3)', boxShadow: '0 0 32px rgba(0,255,135,0.2)' }}
        >
          <CheckCircle className="w-10 h-10" style={{ color: '#00FF87' }} />
        </div>
        <h1 className="font-display text-4xl mb-2 dark:[filter:none] [filter:brightness(0.45)_saturate(1.5)]" style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          {listingMode === 'instant' ? 'Pending Custody Verification' : flagged ? 'Pending Verification' : 'Listing Live'}
        </h1>
        <p className="text-muted-foreground text-sm mb-1 mt-2">
          {listingMode === 'instant'
            ? 'We received your transfer submission. Once our team verifies custody, your listing will go live with the Instant Transfer badge.'
            : flagged ? 'Your listing is being reviewed and will go live shortly.'
            : 'Your listing is now live and visible to buyers.'}
        </p>
        <p className="text-xs mb-8 dark:opacity-70" style={{ color: listingMode === 'instant' ? '#006080' : flagged ? '#a07000' : '#007a3d' }}>
          {listingMode === 'instant' ? 'Usually verified within hours.' : flagged ? 'Usually approved within minutes.' : 'Buyers can see it right now ⚡'}
        </p>
        <div className="flex flex-col gap-3">
          <Link
            to="/my-sales"
            className="inline-flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm"
            style={{ background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14', boxShadow: '0 0 18px rgba(0,232,122,0.22)' }}
          >
            View My Listings
          </Link>
          <button
            onClick={() => {
              setDone(false); setStep(0);
              setForm({ event_id: '', section: '', row: '', seats: '', quantity: '1', tier: '', asking_price: '', original_price: '', transfer_method: 'email_transfer', proof_url: '' });
              setSelectedTmEvent(null); setTmResults([]); setTmQuery(''); setTmSearched(false); setSelectingTmId(null);
            }}
            className="inline-flex items-center justify-center gap-2 py-3 rounded-full font-semibold text-sm"
            style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
          >
            List Another
          </button>
        </div>
        {/* Prompt for push notifications after successful listing */}
        <NotificationPermissionPrompt trigger="listing" />
      </div>
    );
  }

  const canNext0 = !!form.event_id;
  const canNext1 = !!form.section && !!form.row;
  const canSubmit = !!form.asking_price && parseFloat(form.asking_price) > 0
    && (listingMode === 'standard' || pgTransferProofUrl || pgTransferNotes.trim());

  return (
    <div className="max-w-lg mx-auto px-4 py-8" style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top))', paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
      <Link to="/my-sales" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-3xl" style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Sell Tickets
        </h1>
        <p className="text-xs text-muted-foreground mt-1">3 quick steps · under a minute</p>
      </div>

      <StepBar current={step} />

      {/* ── Step 0: Pick Event ── */}
      {step === 0 && (
        <div className="space-y-3">
          {/* Tabs */}
          <div className="flex rounded-2xl p-1 gap-1" style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
            <button
              onClick={() => setEventTab('recommended')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all"
              style={{
                background: eventTab === 'recommended' ? 'rgba(191,95,255,0.2)' : 'transparent',
                color: eventTab === 'recommended' ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                border: eventTab === 'recommended' ? '1px solid rgba(191,95,255,0.35)' : '1px solid transparent',
              }}
            >
              <Star className="w-3 h-3" /> Recommended
            </button>
            <button
              onClick={() => setEventTab('search')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all"
              style={{
                background: eventTab === 'search' ? 'rgba(191,95,255,0.2)' : 'transparent',
                color: eventTab === 'search' ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                border: eventTab === 'search' ? '1px solid rgba(191,95,255,0.35)' : '1px solid transparent',
              }}
            >
              <Search className="w-3 h-3" /> Search
            </button>
          </div>

          {/* Recommended Tab — same logic as Upgrades */}
          {eventTab === 'recommended' && (
            <div className="space-y-4">
              {/* City fallback when geo is denied */}
              {recLocationDenied && !recCitySubmitted && (
                <LocationAutocomplete
                  value={recCityInput}
                  onChange={setRecCityInput}
                  placeholder="Enter your city…"
                  onSelect={(s) => {
                    setRecCitySubmitted(true);
                    setNearbyLoading(true);
                    setRecLocationDenied(false);
                    window.__pgLoadRecommended?.(null, s.label);
                  }}
                  onSubmit={(val) => {
                    setRecCitySubmitted(true);
                    setNearbyLoading(true);
                    setRecLocationDenied(false);
                    window.__pgLoadRecommended?.(null, val);
                  }}
                />
              )}

              {nearbyLoading ? (
                <>{[1,2,3].map(i => <div key={i} className="h-14 rounded-2xl animate-pulse bg-muted" />)}</>
              ) : recLocationDenied ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-2xl">📍</p>
                  <p className="text-sm text-muted-foreground">Enter your city above to see nearby events</p>
                </div>
              ) : (() => {
                const nowMs = Date.now();
                const liveEvs = allRecEvents.filter(e => getEventLiveStatus(e, nowMs).status === 'live');
                const soonEvs = allRecEvents.filter(e => getEventLiveStatus(e, nowMs).status === 'soon');
                const upcomingEvs = allRecEvents
                  .filter(e => getEventLiveStatus(e, nowMs).status === 'upcoming')
                  .sort((a, b) => new Date(a.event_start_utc || a.date || 0) - new Date(b.event_start_utc || b.date || 0));

                const renderEvent = (ev) => {
                  const isTM = ev.source === 'ticketmaster' || String(ev.id || '').startsWith('tm_');
                  const key = ev.tm_id || ev.id;
                  const isSelected = (isTM ? selectingTmId === ev.tm_id : form.event_id === ev.id);
                  return (
                    <button
                      key={key}
                      onClick={() => isTM ? handleSelectTmEvent(ev) : (set('event_id', ev.id), setSelectedTmEvent(null))}
                      disabled={!!selectingTmId}
                      className="w-full text-left px-4 py-3 rounded-2xl transition-all flex items-center gap-3 disabled:opacity-60"
                      style={{
                        background: isSelected ? 'rgba(191,95,255,0.12)' : 'hsl(var(--card))',
                        border: isSelected ? '1px solid rgba(191,95,255,0.4)' : '1px solid hsl(var(--border))',
                      }}
                    >
                      {ev.image_url && <img src={ev.image_url} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm text-foreground truncate">{ev.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {ev.venue}{ev.city ? `, ${ev.city}` : ''}
                          {ev.date && <> · {new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
                        </div>
                      </div>
                      {isSelected && isTM && <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                    </button>
                  );
                };

                return (
                  <>
                    {liveEvs.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black tracking-widest uppercase mb-2 flex items-center gap-1.5" style={{ color: '#FF2D78' }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" /> Live Now
                        </p>
                        <div className="space-y-2">{liveEvs.map(renderEvent)}</div>
                      </div>
                    )}
                    {soonEvs.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black tracking-widest uppercase mb-2 dark:text-[#FFE600] text-[#7a6000]">⚡ Starting Soon</p>
                        <div className="space-y-2">{soonEvs.map(renderEvent)}</div>
                      </div>
                    )}
                    {upcomingEvs.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black tracking-widest uppercase mb-2" style={{ color: '#BF5FFF' }}>Upcoming Near You</p>
                        <div className="space-y-2">{upcomingEvs.map(renderEvent)}</div>
                      </div>
                    )}
                    {liveEvs.length === 0 && soonEvs.length === 0 && upcomingEvs.length === 0 && (
                      <div className="text-center py-8 space-y-2">
                        <p className="text-sm text-muted-foreground">No events found nearby.</p>
                        <button onClick={() => setEventTab('search')} className="text-xs font-bold" style={{ color: '#BF5FFF' }}>Search for your event →</button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* Search Tab */}
          {eventTab === 'search' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={tmQuery}
                    onChange={e => setTmQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleTmSearch()}
                    placeholder="Artist, team, or event name…"
                    className="w-full pl-9 pr-4 py-3 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))' }}
                  />
                </div>
                <button
                  onClick={handleTmSearch}
                  disabled={tmLoading || !tmQuery.trim()}
                  className="px-4 py-3 rounded-2xl font-bold text-sm transition-all disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff' }}
                >
                  {tmLoading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : 'Go'}
                </button>
              </div>

              {tmLoading && (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-14 rounded-2xl animate-pulse bg-muted" />)}
                </div>
              )}

              {!tmLoading && tmSearched && tmResults.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {tmRateLimited ? 'Too many requests — please wait a moment and try again.' : 'No events found. Try a different search.'}
                </p>
              )}

              {!tmLoading && tmResults.map(ev => (
                <button
                  key={ev.tm_id}
                  onClick={() => handleSelectTmEvent(ev)}
                  disabled={!!selectingTmId}
                  className="w-full text-left px-4 py-3.5 rounded-2xl transition-all flex items-center gap-3 disabled:opacity-60"
                  style={{
                    background: selectingTmId === ev.tm_id ? 'rgba(191,95,255,0.12)' : 'hsl(var(--card))',
                    border: selectingTmId === ev.tm_id ? '1px solid rgba(191,95,255,0.4)' : '1px solid hsl(var(--border))',
                    boxShadow: selectingTmId === ev.tm_id ? '0 0 16px rgba(191,95,255,0.15)' : 'none',
                  }}
                >
                  {ev.image_url && <img src={ev.image_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm text-foreground truncate">{ev.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {ev.venue}{ev.city ? `, ${ev.city}` : ''}
                      {ev.date && <> · {new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
                    </div>
                  </div>
                  {selectingTmId === ev.tm_id && (
                    <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Step 1: Seat Info ── */}
      {step === 1 && (
        <div className="space-y-4">
          {selectedEvent && (
            <div className="px-4 py-2.5 rounded-2xl text-xs text-muted-foreground mb-1"
              style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
              🎫 {selectedEvent.title}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Section *</label>
              <input type="text" value={form.section} onChange={e => set('section', e.target.value)}
                placeholder="118" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Row *</label>
              <input type="text" value={form.row} onChange={e => set('row', e.target.value)}
                placeholder="G" className={inputClass} style={inputStyle} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Seats</label>
              <div className="flex gap-2">
                {[1,2,3,4,5,6].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set('quantity', String(n))}
                    className="flex-1 py-3 rounded-xl text-xs font-bold transition-all"
                    style={{
                      background: form.quantity === String(n) ? 'rgba(191,95,255,0.15)' : 'hsl(var(--muted))',
                      border: form.quantity === String(n) ? '1px solid rgba(191,95,255,0.4)' : '1px solid hsl(var(--border))',
                      color: form.quantity === String(n) ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Seat #s <span className="opacity-50">(optional)</span></label>
              <input type="text" value={form.seats} onChange={e => set('seats', e.target.value)}
                placeholder="4, 5" className={inputClass} style={inputStyle} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-2">Level <span className="opacity-50">(optional)</span></label>
            <div className="grid grid-cols-4 gap-2">
              {['floor','lower','mid','upper'].map(t => (
                <button key={t} type="button" onClick={() => set('tier', form.tier === t ? '' : t)}
                  className="py-2.5 rounded-xl text-xs font-bold capitalize transition-all"
                  style={{
                    background: form.tier === t ? 'rgba(191,95,255,0.15)' : 'hsl(var(--muted))',
                    border: form.tier === t ? '1px solid rgba(191,95,255,0.4)' : '1px solid hsl(var(--border))',
                    color: form.tier === t ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Price & Proof ── */}
      {step === 2 && (
        <div className="space-y-5">

          {/* Listing mode selector */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wide">Listing Type</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setListingMode('standard')}
                className="p-4 rounded-2xl text-left transition-all"
                style={{
                  background: listingMode === 'standard' ? 'rgba(191,95,255,0.08)' : 'hsl(var(--card))',
                  border: listingMode === 'standard' ? '1px solid rgba(191,95,255,0.35)' : '1px solid hsl(var(--border))',
                }}
              >
                <div className="font-bold text-sm text-foreground mb-1">📋 Standard</div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">You transfer to buyer after sale. You must be available.</div>
              </button>
              <button
                type="button"
                onClick={() => setListingMode('instant')}
                className="p-4 rounded-2xl text-left transition-all"
                style={{
                  background: listingMode === 'instant' ? 'rgba(0,200,255,0.08)' : 'hsl(var(--card))',
                  border: listingMode === 'instant' ? '1px solid rgba(0,200,255,0.35)' : '1px solid hsl(var(--border))',
                }}
              >
                <div className="font-bold text-sm flex items-center gap-1.5" style={{ color: listingMode === 'instant' ? '#00C8FF' : 'hsl(var(--foreground))' }}>
                  ⚡ Instant Transfer
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed mt-1">Transfer ticket to PG now. Buyers get it instantly. You don't need to be online.</div>
              </button>
            </div>
          </div>

          {/* Instant mode explainer + proof */}
          {listingMode === 'instant' && (
            <div className="rounded-2xl p-4 space-y-4"
              style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.25)' }}>
              <div className="text-sm font-semibold" style={{ color: '#00C8FF' }}>How Instant Transfer works</div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-start gap-2"><span style={{ color: '#00C8FF' }}>1.</span><span>Transfer your ticket to <strong style={{ color: 'hsl(var(--foreground))' }}>experience@peanutgallery.com</strong> now via Ticketmaster, SeatGeek, or email.</span></div>
                <div className="flex items-start gap-2"><span style={{ color: '#00C8FF' }}>2.</span><span>Upload proof of transfer below. Our team verifies custody (usually within hours).</span></div>
                <div className="flex items-start gap-2"><span style={{ color: '#00C8FF' }}>3.</span><span>Once verified, your listing goes live with the <strong style={{ color: '#00C8FF' }}>⚡ Instant Transfer</strong> badge. Buyers receive tickets via PG-managed transfer.</span></div>
              </div>

              {/* PG transfer proof upload */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">
                  Upload transfer confirmation screenshot <span style={{ color: '#FF2D78' }}>*</span>
                </label>
                {pgTransferProofUrl ? (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                    style={{ background: 'rgba(0,200,255,0.08)', border: '1px solid rgba(0,200,255,0.25)' }}>
                    <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#00C8FF' }} />
                    <span className="text-sm font-semibold" style={{ color: '#00C8FF' }}>Proof uploaded ✓</span>
                    <button onClick={() => setPgTransferProofUrl('')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Remove</button>
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-6 cursor-pointer ${uploadingPgProof ? 'opacity-70' : ''}`}
                    style={{ border: '1.5px dashed rgba(0,200,255,0.35)', background: 'rgba(0,200,255,0.04)' }}>
                    {uploadingPgProof
                      ? <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: '#00C8FF' }} />
                      : <Upload className="w-5 h-5" style={{ color: '#00C8FF' }} />}
                    <span className="text-xs text-muted-foreground">{uploadingPgProof ? 'Uploading…' : 'Tap to upload transfer screenshot'}</span>
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={handlePgProofUpload} disabled={uploadingPgProof} />
                  </label>
                )}
              </div>

              {/* Transfer notes */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">
                  Transfer notes <span className="opacity-50 font-normal">(optional if screenshot provided)</span>
                </label>
                <textarea
                  value={pgTransferNotes}
                  onChange={e => setPgTransferNotes(e.target.value)}
                  placeholder="e.g. Transferred via Ticketmaster to experience@peanutgallery.com at 3:45 PM"
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  style={{ background: 'rgba(0,200,255,0.05)', border: '1px solid rgba(0,200,255,0.2)' }}
                />
              </div>
            </div>
          )}

          {/* Price — visual hero */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Set your price per ticket</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-2xl" style={{ color: '#00FF87' }}>$</span>
              <input
                type="number" min="1" step="1"
                value={form.asking_price}
                onChange={e => set('asking_price', e.target.value)}
                placeholder="0"
                className="w-full pl-10 pr-4 rounded-2xl font-black focus:outline-none focus:ring-2 focus:ring-primary/40"
                style={{
                  fontSize: 'clamp(2rem, 10vw, 2.8rem)',
                  paddingTop: '1rem', paddingBottom: '1rem',
                  background: 'rgba(0,255,135,0.05)',
                  border: '1px solid rgba(0,255,135,0.25)',
                  color: 'hsl(var(--foreground))',
                  letterSpacing: '-0.02em',
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">Buyers see the total at checkout.</p>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Face value <span className="opacity-50">(optional · shows savings badge)</span></label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">$</span>
              <input type="number" min="1" step="1" value={form.original_price}
                onChange={e => set('original_price', e.target.value)}
                placeholder="0" className={`${inputClass} pl-8`} style={inputStyle} />
            </div>
          </div>

          {/* Proof upload */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">
              Ticket screenshot or PDF <span className="opacity-50">(optional · earns Verified badge)</span>
            </label>
            {form.proof_url ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                style={{ background: 'rgba(0,255,135,0.08)', border: '1px solid rgba(0,255,135,0.25)' }}>
                <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#00FF87' }} />
                <span className="text-sm font-semibold" style={{ color: '#00FF87' }}>Uploaded ✓</span>
                <button onClick={() => set('proof_url', '')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Remove</button>
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-6 cursor-pointer transition-all ${uploadingProof ? 'opacity-70' : ''}`}
                style={{ border: '1.5px dashed hsl(var(--border))', background: 'hsl(var(--muted))' }}>
                {uploadingProof
                  ? <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  : <Upload className="w-5 h-5 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">{uploadingProof ? 'Uploading…' : 'Tap to upload'}</span>
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleProofUpload} disabled={uploadingProof} />
              </label>
            )}
          </div>

          {/* Transfer method */}
          <div>
            <label className="block text-xs text-muted-foreground mb-2">How will you transfer?</label>
            <div className="space-y-2">
              {[
                { value: 'email_transfer', label: '📧 Email Transfer' },
                { value: 'platform_transfer', label: '📲 Mobile Ticket Transfer' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => set('transfer_method', opt.value)}
                  className="w-full text-left px-4 py-3.5 rounded-2xl transition-all"
                  style={{
                    background: form.transfer_method === opt.value ? 'rgba(191,95,255,0.1)' : 'hsl(var(--card))',
                    border: form.transfer_method === opt.value ? '1px solid rgba(191,95,255,0.35)' : '1px solid hsl(var(--border))',
                    color: form.transfer_method === opt.value ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                  }}
                >
                  <span className="text-sm font-semibold">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pt-4 flex gap-3 max-w-lg mx-auto"
        style={{ background: 'linear-gradient(to top, hsl(var(--background)) 60%, transparent)', paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}>
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            className="flex items-center gap-1.5 px-5 py-3 rounded-full text-sm font-semibold transition-colors"
            style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        {step < 2 && (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={(step === 0 && !canNext0) || (step === 1 && !canNext1)}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-30"
            style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff', boxShadow: '0 0 18px rgba(191,95,255,0.25)' }}
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        )}
        {step === 2 && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting || uploadingProof}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-30"
            style={{ background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14', boxShadow: '0 0 18px rgba(0,232,122,0.22)' }}
          >
            {submitting
              ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Listing…</>
              : <><Zap className="w-4 h-4" /> List My Tickets</>
            }
          </button>
        )}
      </div>
    </div>
  );
}