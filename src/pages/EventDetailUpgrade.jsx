import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { MapPin, Calendar, ArrowLeft, Zap, Bell, Star } from 'lucide-react';
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
import LiveHubExplainer from '@/components/eventmode/LiveHubExplainer';
import FlashDropExplainer from '@/components/eventmode/FlashDropExplainer';

const TABS = [
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
  const [debugInfo, setDebugInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('drops');
  const [sessionCheckins, setSessionCheckins] = useState(0);
  const [showCreateDrop, setShowCreateDrop] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const loadAll = useCallback(async (cancelled = { value: false }) => {
    setLoading(true);
    setLookupError(false);

    try {
      // 1. Direct id lookup
      let events = await base44.entities.Event.filter({ id });
      let lookupMethod = 'direct_id';

      // 2. tm_ prefix strip
      if ((!events || events.length === 0) && id && id.startsWith('tm_')) {
        lookupMethod = 'tm_prefix_strip';
        events = await base44.entities.Event.filter({ tm_id: id.replace('tm_', '') });
      }

      // 3. Treat id as tm_id directly
      if (!events || events.length === 0) {
        lookupMethod = 'tm_id_field';
        events = await base44.entities.Event.filter({ tm_id: id });
      }

      // 4. Last resort: syncTMEvent — ONLY if id looks like a real TM id (NOT a UUID)
      // A UUID contains hyphens; TM IDs are alphanumeric with no hyphens
      const looksLikeTmId = !id.includes('-') && /^[A-Za-z0-9]{10,25}$/.test(id);
      if ((!events || events.length === 0) && looksLikeTmId) {
        const tmId = id.startsWith('tm_') ? id.replace('tm_', '') : id;
        lookupMethod = 'sync_fallback';
        console.info('[EventDetailUpgrade] sync_fallback for TM-style id:', tmId);
        try {
          const syncRes = await base44.functions.invoke('syncTMEvent', { tm_id: tmId });
          const syncedId = syncRes?.data?.id;
          if (syncedId && syncedId !== id) {
            events = await base44.entities.Event.filter({ id: syncedId });
            window.history.replaceState(null, '', `/upgrades/${syncedId}`);
          }
        } catch {
          // sync failed — fall through to error
        }
      } else if ((!events || events.length === 0) && !looksLikeTmId) {
        console.warn('[EventDetailUpgrade] UUID-style id not found in DB — skipping syncTMEvent to prevent corruption:', id);
      }

      if (cancelled.value) return;
      const ev = events?.[0] || null;
      setEvent(ev);

      if (!ev) {
        setLookupError(true);
        setDebugInfo({ routeParam: id, lookupMethod });
        logNavEvent({ result: 'event_not_found', event: { id, tm_id: id }, sourcePage: 'EventDetailUpgrade', generatedHref: `/upgrades/${id}`, lookupMethod, failureReason: 'All lookup methods including sync exhausted' });
        return;
      }

      logNavEvent({ result: lookupMethod === 'direct_id' ? 'success' : 'lookup_fallback_success', event: ev, sourcePage: 'EventDetailUpgrade', generatedHref: `/upgrades/${id}`, lookupMethod });

      const resolvedId = ev.id;
      base44.entities.TransferReport.filter({ event_id: resolvedId }).then(r => { if (!cancelled.value) setTransferReports(r); }).catch(() => {});

      const adminUnlocked = false; // real check done post-load using user state
      const timing = getEventLiveStatus(ev);
      const isLive = timing.status === 'live';

      const [rawListings, rawDrops] = await Promise.all([
        base44.entities.Listing.filter({ event_id: resolvedId, status: 'active' }),
        base44.entities.FlashDrop.filter({ event_id: resolvedId }),
      ]);

      if (cancelled.value) return;

      // Show listings when live or admin; show all for non-live preview too
      const filtered = (adminUnlocked || !isLive) ? rawListings : rawListings.filter(() => isLive);
      const real = filtered.filter(l => !l.notes?.startsWith('[DEMO]'));
      setListings(real.length > 0 ? real : filtered);

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

  // Real-time subs
  useEffect(() => {
    const unsubDrop = base44.entities.FlashDrop.subscribe(evt => { if (evt.data?.event_id === id) loadAll(); });
    const unsubListing = base44.entities.Listing.subscribe(evt => { if (evt.data?.event_id === id) loadAll(); });
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
    const tmFallbackId = id.startsWith('tm_') ? id.replace('tm_', '') : id;
    return (
      <div className="px-4 py-16 space-y-4">
        <div className="text-center">
          <p className="text-5xl mb-3">🎟️</p>
          <p className="font-bold text-foreground text-lg">Event not found</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            We couldn't load this event. Try viewing it on Ticketmaster or go back.
          </p>
        </div>
        <div className="flex flex-col gap-2 items-center">
          <button onClick={() => loadAll()} className="px-5 py-2.5 rounded-full font-bold text-sm" style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>Retry</button>
          <Link to={`/events/tm/${tmFallbackId}`} className="text-sm text-muted-foreground underline">View on Ticketmaster page →</Link>
          <Link to="/upgrades" className="text-sm text-muted-foreground underline">← Back to Upgrades</Link>
        </div>
        {/* Debug info — admin only */}
        {sessionStorage.getItem('pg_admin_unlocked') === '1' && (
          <div className="mt-6 rounded-xl p-4 text-left space-y-1 font-mono text-[10px]"
            style={{ background: 'rgba(255,230,0,0.06)', border: '1px solid rgba(255,230,0,0.2)', color: 'rgba(255,230,0,0.8)' }}>
            <p className="font-black text-[11px] mb-2">🔍 Debug Info (Admin)</p>
            <p>Route param (id): {id}</p>
            <p>TM id attempted: {tmFallbackId}</p>
            <p>Last lookup method: {debugInfo?.lookupMethod || 'unknown'}</p>
          </div>
        )}
      </div>
    );
  }

  const timing = event ? getEventLiveStatus(event) : null;
  const isLive = timing?.status === 'live';
  const isUpcoming = timing?.status === 'upcoming' || timing?.status === 'soon';
  const transferInfo = getTransferWindowInfo(event);
  const adminUnlocked = user?.role === 'admin';

  const handleDropSeats = () => {
    if (!user) { base44.auth.redirectToLogin(); return; }
    setShowCreateDrop(true);
  };

  return (
    <div className="min-h-screen pb-32" style={{ background: 'hsl(var(--background))' }}>

      {/* ── Header: live mode uses EventModeHeader, otherwise hero ── */}
      {isLive ? (
        <EventModeHeader event={event} eventId={id} loading={loading} onRefresh={() => loadAll()} />
      ) : (
        <div className="relative h-56 overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
          {event.image_url ? (
            <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center text-7xl">🎫</div>
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.2) 0%, rgba(5,3,12,0.95) 100%)' }} />
          <Link to="/upgrades" className="absolute top-4 left-4 flex items-center gap-1.5 text-sm font-semibold text-white/80 px-3 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)' }}>
            <ArrowLeft className="w-4 h-4" /> Upgrades
          </Link>
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
            <h1 className="font-display text-foreground leading-tight" style={{ fontSize: 'clamp(1.5rem, 6vw, 2.2rem)' }}>{event.title}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="flex items-center gap-1 text-[11px] text-white/60">
                <Calendar className="w-3 h-3" />
                {(event.event_start_utc || event.date) ? format(new Date(event.event_start_utc || event.date), 'EEE, MMM d · h:mm a') : 'TBD'}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-white/60">
                <MapPin className="w-3 h-3" />
                {event.venue}{event.city ? `, ${event.city}` : ''}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 pt-4 space-y-4 max-w-2xl mx-auto">

        {/* ── LIVE HUB EXPLAINER — first-time only ── */}
        <LiveHubExplainer />

        {/* ── LIVE HUB STATUS BANNER — always visible ── */}
        <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
          style={isLive ? {
            background: 'linear-gradient(135deg, rgba(255,230,0,0.15), rgba(255,45,120,0.1))',
            border: '2px solid rgba(255,230,0,0.45)',
            boxShadow: '0 0 20px rgba(255,230,0,0.1)',
          } : {
            background: 'linear-gradient(135deg, rgba(191,95,255,0.1), rgba(0,200,255,0.07))',
            border: '1px solid rgba(191,95,255,0.35)',
          }}>
          <span className="text-2xl flex-shrink-0">{isLive ? '🔴' : '⚡'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 leading-none mb-1">
              <p className="font-black text-sm text-foreground leading-none">
                {isLive ? 'Live Hub — Active Now' : 'Live Hub'}
              </p>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Where upgrades, Flash Drops, and fan activity happen during the event.
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {isLive
                ? 'Flash Drops and seat upgrades are happening right now.'
                : isUpcoming
                ? 'Flash Drops and live upgrades activate at showtime. Preview them below.'
                : 'Flash Drops and live upgrades unlock when the event goes live.'}
            </p>
          </div>
          {isLive && (
            <span className="flex-shrink-0 text-[10px] font-black px-2 py-1 rounded-full animate-pulse"
              style={{ background: '#FF2D7820', color: '#FF2D78', border: '1px solid #FF2D7855' }}>
              LIVE
            </span>
          )}
        </div>

        {/* Live activity bar — only when live */}
        {isLive && <LiveActivityBar drops={drops} listings={listings} />}

        {/* ── TABS — always visible ── */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
          {TABS.map(tab => (
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

            {/* ── FLASH DROPS TAB ── */}
            {activeTab === 'drops' && (
              <div className="space-y-4">
                {/* Flash Drop brand explainer — always shown */}
                <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
                  style={{ background: 'rgba(255,230,0,0.07)', border: '1px solid rgba(255,230,0,0.25)' }}>
                  <span className="text-xl flex-shrink-0">🎁</span>
                  <div>
                    <p className="font-black text-sm text-foreground">Flash Drop <span className="text-[11px] font-semibold text-muted-foreground ml-1">— Win Free Seats</span></p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Fans at the venue drop their extra seats for free. Enter in 60 seconds. Winner picked randomly. You pay nothing.
                    </p>
                  </div>
                </div>
                <FlashDropExplainer />
                {drops.length > 0 ? (
                  <FlashDropCenter
                    drops={drops}
                    user={user}
                    listings={listings}
                    loading={loading}
                    onDropSeats={handleDropSeats}
                    onWinnerSelected={() => setTimeout(loadAll, 2000)}
                  />
                ) : (
                  <div className="rounded-2xl px-5 py-8 text-center space-y-3"
                    style={{ background: 'rgba(255,230,0,0.05)', border: '1px solid rgba(255,230,0,0.2)' }}>
                    <p className="text-4xl">🎁</p>
                    <div>
                      <p className="font-black text-foreground text-sm">No Flash Drops yet</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-xs mx-auto">
                        {isLive
                          ? 'Fans at the show drop free seats here. Check back — drops happen spontaneously!'
                          : 'When the event starts, fans drop free seats here. First come, first served.'}
                      </p>
                    </div>
                    {isLive && (
                      <button onClick={handleDropSeats}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-black text-sm"
                        style={{ background: 'linear-gradient(135deg, #FFE600, #FF8C00)', color: '#000' }}>
                        ⚡ Drop Your Seats
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── UPGRADES TAB ── */}
            {activeTab === 'upgrades' && (
              <div>
                {/* Transfer window info */}
                {event && (
                  <div className="mb-3">
                    <TransferWindowBadge event={event} expanded showCountdown />
                  </div>
                )}

                {/* Community transfer report */}
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

                {listings.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-1 mb-1">
                      <h2 className="font-black text-sm text-foreground uppercase tracking-wide flex items-center gap-2">
                        <Zap className="w-4 h-4" style={{ color: '#00FF87' }} />
                        {listings.length} Upgrade{listings.length !== 1 ? 's' : ''} Available
                      </h2>
                      {isLive && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
                          Live
                        </span>
                      )}
                    </div>
                    <UpgradeFeed listings={listings} eventId={id} loading={loading} />
                  </div>
                ) : (
                  <div className="rounded-2xl px-5 py-8 text-center space-y-3"
                    style={{ background: 'rgba(0,200,255,0.05)', border: '1px solid rgba(0,200,255,0.2)' }}>
                    <p className="text-4xl">⚡</p>
                    <div>
                      <p className="font-black text-foreground text-sm">No Upgrades Yet</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-xs mx-auto">
                        {isLive
                          ? 'Fans at the venue list their seats here. Check back soon!'
                          : 'Seat upgrades appear here when the event is live. Watch this event to get alerted.'}
                      </p>
                    </div>
                    {!isLive && (
                      <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold"
                        style={{ background: 'rgba(0,200,255,0.1)', border: '1px solid rgba(0,200,255,0.25)', color: '#00C8FF' }}>
                        <Bell className="w-3.5 h-3.5" /> Notify me when upgrades go live
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── FAN KARMA TAB ── */}
            {activeTab === 'karma' && (
              <div className="space-y-4">
                {/* Fan Karma explainer */}
                <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
                  style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.25)' }}>
                  <span className="text-xl flex-shrink-0">🏆</span>
                  <div>
                    <p className="font-black text-sm text-foreground">Fan Karma</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Your community reputation score. Earn it by helping other fans — dropping free seats, fast transfers, and showing up for your buyers.
                    </p>
                  </div>
                </div>
                <FanKarmaCard eventId={id} user={user} />

                {/* Stats — show session checkins only when live */}
                {isLive && (
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
                )}

                {/* How to earn */}
                <div className="rounded-2xl px-4 py-4 space-y-2"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                    <Star className="w-3 h-3" /> How to earn Fan Karma
                  </p>
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

                {!isLive && (
                  <div className="rounded-2xl px-4 py-3 text-center"
                    style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.25)' }}>
                    <p className="text-xs text-muted-foreground">
                      🏆 <span className="font-bold text-foreground">Karma is earned at the event.</span> Donate seats or participate in Flash Drops when the show goes live to climb the leaderboard.
                    </p>
                  </div>
                )}
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {/* FAB — only when live, not on drops tab */}
      {isLive && activeTab !== 'drops' && (
        <button onClick={handleDropSeats}
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