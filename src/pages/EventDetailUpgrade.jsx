import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ArrowLeft, Zap } from 'lucide-react';
import ListingCard from '@/components/events/ListingCard';
import PurchaseDialog from '@/components/events/PurchaseDialog';
import TransferWindowBadge from '@/components/events/TransferWindowBadge';
import CommunityTransferReport from '@/components/listings/CommunityTransferReport';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { getTransferWindowInfo } from '@/lib/transferWindow';
import { logNavEvent } from '@/lib/navLogger';
import { motion, AnimatePresence } from 'framer-motion';
import EventModeHeader from '@/components/eventmode/EventModeHeader';
import LiveActivityBar from '@/components/eventmode/LiveActivityBar';
import FlashDropCenter from '@/components/eventmode/FlashDropCenter';
import UpgradeFeed from '@/components/eventmode/UpgradeFeed';
import FanKarmaCard from '@/components/eventmode/FanKarmaCard';
import CreateFlashDropSheet from '@/components/flashdrops/CreateFlashDropSheet';
import EventModePreview from '@/components/eventmode/EventModePreview';

const LIVE_TABS = [
  { id: 'drops', label: '🎁 Flash Drops' },
  { id: 'upgrades', label: '⚡ Upgrades' },
  { id: 'karma', label: '🏆 Fan Karma' },
];

export default function EventDetailUpgrade() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [drops, setDrops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [user, setUser] = useState(null);
  const [transferReports, setTransferReports] = useState([]);
  const [lookupError, setLookupError] = useState(false);
  const [activeTab, setActiveTab] = useState('drops');
  const [sessionCheckins, setSessionCheckins] = useState(0);
  const [showCreateDrop, setShowCreateDrop] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const loadAll = useCallback(async (cancelled = { value: false }) => {
    setLoading(true);
    setLookupError(false);

    const logCtx = { route_param: id, source_page: 'EventDetailUpgrade', ts: new Date().toISOString() };

    try {
      // 1. Direct id lookup
      let events = await base44.entities.Event.filter({ id });
      let lookupMethod = 'direct_id';

      // 2. Fallback: tm_ prefix
      if ((!events || events.length === 0) && id && id.startsWith('tm_')) {
        lookupMethod = 'tm_prefix_strip';
        events = await base44.entities.Event.filter({ tm_id: id.replace('tm_', '') });
      }

      // 3. Fallback: treat id as tm_id directly
      if (!events || events.length === 0) {
        lookupMethod = 'tm_id_field';
        events = await base44.entities.Event.filter({ tm_id: id });
      }

      if (cancelled.value) return;
      const ev = events?.[0] || null;
      setEvent(ev);

      if (!ev) {
        setLookupError(true);
        logNavEvent({ result: 'event_not_found', event: { id, tm_id: id }, sourcePage: 'EventDetailUpgrade', generatedHref: `/upgrades/${id}`, lookupMethod, failureReason: 'All lookup methods exhausted' });
        return;
      }

      logNavEvent({
        result: lookupMethod === 'direct_id' ? 'success' : 'lookup_fallback_success',
        event: ev, sourcePage: 'EventDetailUpgrade', generatedHref: `/upgrades/${id}`, lookupMethod
      });

      const resolvedId = ev.id;
      base44.entities.TransferReport.filter({ event_id: resolvedId }).then(r => { if (!cancelled.value) setTransferReports(r); }).catch(() => {});

      const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
      const timing = getEventLiveStatus(ev);
      const isLive = timing.status === 'live';

      const [rawListings, rawDrops] = await Promise.all([
        base44.entities.Listing.filter({ event_id: resolvedId, status: 'active' }),
        base44.entities.FlashDrop.filter({ event_id: resolvedId }),
      ]);

      if (cancelled.value) return;

      // Listings: all when live or admin, nothing otherwise
      const filtered = adminUnlocked ? rawListings : rawListings.filter(() => isLive);
      const real = filtered.filter(l => !l.notes?.startsWith('[DEMO]'));
      setListings(real.length > 0 ? real : filtered);

      // Drops: active, pending, or recently completed
      const relevantDrops = (rawDrops || []).filter(d =>
        d.status === 'active' ||
        d.status === 'pending' ||
        (d.status === 'winner_selected' && d.winner_selected_at && Date.now() - new Date(d.winner_selected_at) < 300000) ||
        (d.status === 'expired' && d.winner_selected_at && Date.now() - new Date(d.winner_selected_at) < 120000)
      );
      setDrops(relevantDrops);
      setSessionCheckins(c => c + 1);
    } catch (err) {
      if (cancelled.value) return;
      console.error('[EventDetailUpgrade] load error:', err);
      setLookupError(true);
    } finally {
      if (!cancelled.value) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const cancelled = { value: false };
    loadAll(cancelled);
    return () => { cancelled.value = true; };
  }, [loadAll]);

  // Real-time subs (only when live)
  useEffect(() => {
    const unsubDrop = base44.entities.FlashDrop.subscribe(evt => {
      if (evt.data?.event_id === id) loadAll();
    });
    const unsubListing = base44.entities.Listing.subscribe(evt => {
      if (evt.data?.event_id === id) loadAll();
    });
    return () => { unsubDrop(); unsubListing(); };
  }, [id, loadAll]);

  // 15s poll when live
  useEffect(() => {
    if (!event) return;
    const timing = getEventLiveStatus(event);
    if (timing.status !== 'live') return;
    const interval = setInterval(loadAll, 15000);
    return () => clearInterval(interval);
  }, [event, loadAll]);

  if (loading && !event) {
    return (
      <div className="px-4 py-8 space-y-4">
        <div className="h-64 bg-white/5 rounded-3xl animate-pulse" />
        <div className="h-5 w-48 bg-white/5 rounded animate-pulse mt-6" />
        <div className="space-y-4 mt-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-white/5 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!loading && (!event || lookupError)) {
    return (
      <div className="px-4 py-20 text-center space-y-4">
        <p className="text-5xl">🎟️</p>
        <div>
          <p className="font-bold text-foreground text-lg">Event not loaded yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            This event may still be syncing. Try refreshing or go back to browse upgrades.
          </p>
        </div>
        <div className="flex flex-col gap-2 items-center">
          <button
            onClick={() => loadAll()}
            className="px-5 py-2.5 rounded-full font-bold text-sm"
            style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
          >
            Retry
          </button>
          <Link to="/upgrades" className="text-sm text-muted-foreground underline">← Back to Upgrades</Link>
        </div>
      </div>
    );
  }

  const timing = event ? getEventLiveStatus(event) : null;
  const isLive = timing?.status === 'live';
  const isPreEvent = timing && (timing.status === 'upcoming' || timing.status === 'soon');

  // ── PRE-EVENT: show preview ──
  if (isPreEvent) {
    return <EventModePreview event={event} user={user} />;
  }

  // ── LIVE HUB ──
  if (isLive) {
    const handleDropSeats = () => {
      if (!user) { base44.auth.redirectToLogin(); return; }
      setShowCreateDrop(true);
    };

    return (
      <div className="min-h-screen pb-32" style={{ background: 'hsl(var(--background))' }}>
        <EventModeHeader
          event={event}
          eventId={id}
          loading={loading}
          onRefresh={() => loadAll()}
        />

        <div className="px-4 pt-4 space-y-4 max-w-2xl mx-auto">
          <LiveActivityBar drops={drops} listings={listings} />

          {/* Tab nav */}
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            {LIVE_TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all"
                style={activeTab === tab.id
                  ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
                  : { background: 'rgba(255,255,255,0.06)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.1)' }}>
                {tab.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {activeTab === 'drops' && (
                <FlashDropCenter
                  drops={drops}
                  user={user}
                  listings={listings}
                  loading={loading}
                  onDropSeats={handleDropSeats}
                  onWinnerSelected={() => setTimeout(loadAll, 2000)}
                />
              )}

              {activeTab === 'upgrades' && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚡</span>
                      <h2 className="font-black text-sm text-foreground uppercase tracking-wide">Live Upgrades</h2>
                      {listings.length > 0 && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: 'rgba(0,200,255,0.15)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
                          {listings.length}
                        </span>
                      )}
                    </div>
                  </div>
                  <UpgradeFeed listings={listings} eventId={id} loading={loading} />
                </section>
              )}

              {activeTab === 'karma' && (
                <div className="space-y-4">
                  <FanKarmaCard eventId={id} user={user} />
                  <div className="rounded-2xl px-4 py-3 grid grid-cols-2 gap-3"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="text-center">
                      <p className="text-2xl font-black text-foreground">{sessionCheckins}</p>
                      <p className="text-[10px] text-muted-foreground">Times checked tonight</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-black" style={{ color: '#BF5FFF' }}>
                        {drops.filter(d => d.status === 'winner_selected').length}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Drops completed tonight</p>
                    </div>
                  </div>
                  <div className="rounded-2xl px-4 py-3 space-y-2"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wide">How to earn Karma</p>
                    {[
                      { action: 'Create a Flash Drop', pts: '+100', color: '#FFE600' },
                      { action: 'Lower bowl donation', pts: '+250', color: '#FF8C00' },
                      { action: 'Premium seat donation', pts: '+500', color: '#BF5FFF' },
                      { action: 'Winner claims your seat', pts: '+50', color: '#00FF87' },
                      { action: 'Buy an upgrade tonight', pts: '+25', color: '#00C8FF' },
                    ].map(row => (
                      <div key={row.action} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{row.action}</span>
                        <span className="font-black" style={{ color: row.color }}>{row.pts}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* FAB */}
        {activeTab !== 'drops' && (
          <button
            onClick={handleDropSeats}
            className="fixed bottom-24 right-4 z-30 flex items-center gap-2 px-4 py-3 rounded-full font-black text-sm shadow-2xl"
            style={{ background: 'linear-gradient(135deg, #FFE600, #FF8C00)', color: '#000', boxShadow: '0 0 30px rgba(255,230,0,0.35)' }}>
            ⚡ Drop Seats
          </button>
        )}

        {showCreateDrop && event && (
          <CreateFlashDropSheet
            event={event}
            user={user}
            onClose={() => setShowCreateDrop(false)}
            onCreated={() => { setShowCreateDrop(false); setActiveTab('drops'); loadAll(); }}
          />
        )}
      </div>
    );
  }

  // ── POST-EVENT: static upgrade view ──
  const adminUnlocked = sessionStorage.getItem('pg_admin_unlocked') === '1';
  const sorted = [...listings].sort((a, b) => a.asking_price - b.asking_price);
  const cheapest = sorted[0]?.asking_price;
  const transferInfo = getTransferWindowInfo(event);

  return (
    <div className="pb-32">
      {/* Hero */}
      <div className="relative h-72 sm:h-80 overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        {event.image_url ? (
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-white/5 flex items-center justify-center text-7xl">🎫</div>
        )}
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.25) 0%, rgba(5,3,12,0.5) 50%, rgba(5,3,12,0.97) 100%)' }}
        />
        <Link
          to="/upgrades"
          className="absolute top-4 left-4 flex items-center gap-1.5 text-sm font-semibold text-white/80 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)' }}
        >
          <ArrowLeft className="w-4 h-4" /> Upgrades
        </Link>
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-5">
          <h1 className="font-display text-foreground leading-tight mb-2"
            style={{ fontSize: 'clamp(1.8rem, 7vw, 2.8rem)' }}>
            {event.title}
          </h1>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs text-white/70">
              <Calendar className="w-3.5 h-3.5" />
              {(event.event_start_utc || event.date) ? format(new Date(event.event_start_utc || event.date), 'EEEE, MMMM d, yyyy · h:mm a') : 'TBD'}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-white/70">
              <MapPin className="w-3.5 h-3.5" />
              {event.venue}{event.city ? `, ${event.city}` : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-8">
        <div className="mb-3">
          <TransferWindowBadge event={event} expanded showCountdown />
        </div>
        {user && (
          <div className="mb-4">
            <CommunityTransferReport
              event={event}
              userEmail={user.email}
              recentReports={transferReports}
              onSubmitted={() => base44.entities.TransferReport.filter({ event_id: id }).then(setTransferReports).catch(() => {})}
            />
          </div>
        )}
        <div className="mb-5 rounded-2xl px-4 py-3 flex items-start gap-3"
          style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
          <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#00FF87' }} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-bold text-foreground">Location-locked</span> — only fans physically at the venue can buy upgrades. No scalpers, ever.
          </p>
        </div>
        <div className="mb-6">
          <h2 className="font-display text-2xl text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5" style={{ color: '#00FF87' }} />
            Seat Upgrades
            <span className="font-sans text-base font-normal text-muted-foreground">({listings.length})</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Move to better seats from fans at the venue</p>
        </div>

        {listings.length === 0 ? (
          <div className="text-center py-16 glass-card rounded-2xl">
            <p className="text-4xl mb-3">⚡</p>
            <p className="font-bold text-foreground">No upgrades available</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-[220px] mx-auto leading-relaxed">
              Check back — upgrades are listed by fans at the event.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-xs font-semibold text-foreground/80">
                {listings.length} live listing{listings.length !== 1 ? 's' : ''}
              </span>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
                Updated recently
              </span>
            </div>
            {sorted.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                isCheapest={listing.asking_price === cheapest}
                onUpgrade={setSelectedListing}
                mode="upgrade"
                transferWarning={transferInfo.showWarning ? transferInfo.sublabel : null}
              />
            ))}
          </div>
        )}
      </div>

      {selectedListing && (
        <PurchaseDialog
          event={event}
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          mode="upgrade"
        />
      )}
    </div>
  );
}