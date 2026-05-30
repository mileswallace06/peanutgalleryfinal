/**
 * Event Mode — the live event companion experience.
 * Replaces the static marketplace with a live, urgent, sportsbook-like dashboard.
 * Users see activity, enter Flash Drops, and discover upgrades throughout the event.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import CreateFlashDropSheet from '@/components/flashdrops/CreateFlashDropSheet';
import { logNavEvent } from '@/lib/navLogger';
import EventModeHeader from '@/components/eventmode/EventModeHeader';
import LiveActivityBar from '@/components/eventmode/LiveActivityBar';
import FlashDropCenter from '@/components/eventmode/FlashDropCenter';
import UpgradeFeed from '@/components/eventmode/UpgradeFeed';
import FanKarmaCard from '@/components/eventmode/FanKarmaCard';

const TABS = [
  { id: 'drops', label: '🎁 Flash Drops' },
  { id: 'upgrades', label: '⚡ Upgrades' },
  { id: 'karma', label: '🏆 Fan Karma' },
];

export default function EventMode() {
  const { id: eventId } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [event, setEvent] = useState(null);
  const [drops, setDrops] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDrop, setShowCreateDrop] = useState(false);
  const [activeTab, setActiveTab] = useState('drops');
  const [sessionCheckins, setSessionCheckins] = useState(0);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const logCtx = { route_param: eventId, source_page: 'EventMode', ts: new Date().toISOString() };

    // Resolve event with fallbacks: direct id → tm_ prefix strip → tm_id field
    let ev = await base44.entities.Event.filter({ id: eventId }).then(r => r[0] || null).catch(() => null);
    let lookupMethod = 'direct_id';

    if (!ev && eventId && eventId.startsWith('tm_')) {
      lookupMethod = 'tm_prefix_strip';
      ev = await base44.entities.Event.filter({ tm_id: eventId.replace('tm_', '') }).then(r => r[0] || null).catch(() => null);
    }
    if (!ev) {
      lookupMethod = 'tm_id_field';
      ev = await base44.entities.Event.filter({ tm_id: eventId }).then(r => r[0] || null).catch(() => null);
    }

    if (ev) {
      console.info('[EventMode] lookup success', { ...logCtx, lookup_method: lookupMethod, resolved_id: ev.id, event_source: ev.source || 'pg' });
      logNavEvent({ result: lookupMethod === 'direct_id' ? 'success' : 'lookup_fallback_success', event: ev, sourcePage: 'EventMode', generatedHref: `/event-mode/${eventId}`, lookupMethod });
    } else {
      console.warn('[EventMode] lookup=all_methods MISS', { ...logCtx, lookup_method: lookupMethod });
      logNavEvent({ result: 'event_not_found', event: { id: eventId }, sourcePage: 'EventMode', generatedHref: `/event-mode/${eventId}`, lookupMethod, failureReason: 'All lookup methods exhausted' });
    }

    const resolvedId = ev?.id || eventId;
    const [rawDrops, rawListings] = await Promise.all([
      base44.entities.FlashDrop.filter({ event_id: resolvedId }),
      base44.entities.Listing.filter({ event_id: resolvedId, status: 'active' }),
    ]);
    setEvent(ev);
    // Keep drops relevant: active, pending scheduled, and completed within last 5 min
    const relevant = (rawDrops || []).filter(d =>
      d.status === 'active' ||
      d.status === 'pending' ||
      (d.status === 'winner_selected' && d.winner_selected_at && Date.now() - new Date(d.winner_selected_at) < 300000) ||
      (d.status === 'expired' && d.winner_selected_at && Date.now() - new Date(d.winner_selected_at) < 120000)
    );
    setDrops(relevant);
    setListings(rawListings || []);
    setSessionCheckins(c => c + 1);
    setLoading(false);
  }, [eventId]);

  // Initial load + 15s poll
  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 15000);
    return () => clearInterval(id);
  }, [loadAll]);

  // Real-time subscriptions
  useEffect(() => {
    const unsubDrop = base44.entities.FlashDrop.subscribe(evt => {
      if (evt.data?.event_id === eventId) loadAll();
    });
    const unsubListing = base44.entities.Listing.subscribe(evt => {
      if (evt.data?.event_id === eventId) loadAll();
    });
    return () => { unsubDrop(); unsubListing(); };
  }, [eventId, loadAll]);

  if (!event && !loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-5xl">🎟️</p>
        <div>
          <p className="font-bold text-foreground text-lg">Event not loaded yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            This event may still be syncing. Try refreshing.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-full font-bold text-sm"
          style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
        >
          Retry
        </button>
        <Link to="/events" className="text-sm text-muted-foreground underline">← Back to Events</Link>
      </div>
    );
  }

  const handleDropSeats = () => {
    if (!user) { base44.auth.redirectToLogin(); return; }
    setShowCreateDrop(true);
  };

  return (
    <div className="min-h-screen pb-32" style={{ background: 'hsl(var(--background))' }}>
      {/* Header */}
      <EventModeHeader
        event={event}
        eventId={eventId}
        loading={loading}
        onRefresh={loadAll}
      />

      <div className="px-4 pt-4 space-y-4 max-w-2xl mx-auto">
        {/* Live Activity Bar */}
        <LiveActivityBar drops={drops} listings={listings} />

        {/* Tab nav */}
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

        {/* Tab content */}
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
                  <Link to={`/events/${eventId}`} className="text-xs text-muted-foreground hover:text-foreground">
                    Full view →
                  </Link>
                </div>
                <UpgradeFeed listings={listings} eventId={eventId} loading={loading} />
              </section>
            )}

            {activeTab === 'karma' && (
              <div className="space-y-4">
                <FanKarmaCard eventId={eventId} user={user} />

                {/* Session stats */}
                <div className="rounded-2xl px-4 py-3 grid grid-cols-2 gap-3"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="text-center">
                    <p className="text-2xl font-black text-foreground">{sessionCheckins}</p>
                    <p className="text-[10px] text-muted-foreground">Times checked PG tonight</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-black" style={{ color: '#BF5FFF' }}>
                      {drops.filter(d => d.status === 'winner_selected').length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Drops completed tonight</p>
                  </div>
                </div>

                {/* How to earn */}
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

      {/* FAB — Drop Seats */}
      {activeTab !== 'drops' && (
        <button
          onClick={handleDropSeats}
          className="fixed bottom-24 right-4 z-30 flex items-center gap-2 px-4 py-3 rounded-full font-black text-sm shadow-2xl"
          style={{ background: 'linear-gradient(135deg, #FFE600, #FF8C00)', color: '#000', boxShadow: '0 0 30px rgba(255,230,0,0.35)' }}>
          ⚡ Drop Seats
        </button>
      )}

      {/* Create Flash Drop Sheet */}
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