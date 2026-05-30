/**
 * Event Mode — the in-venue dashboard.
 * Shown when user is at/near a live event.
 * Replaces the standard home experience with Flash Drops, upgrades, and price drops.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { RefreshCw, Zap, TrendingDown, ArrowUpRight, Shield } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import FlashDropCard from '@/components/flashdrops/FlashDropCard';
import FlashDropAlertBanner from '@/components/flashdrops/FlashDropAlertBanner';
import CreateFlashDropSheet from '@/components/flashdrops/CreateFlashDropSheet';

export default function EventMode() {
  const { id: eventId } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [event, setEvent] = useState(null);
  const [activeDrops, setActiveDrops] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDrop, setShowCreateDrop] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [ev, drops, listingData] = await Promise.all([
      base44.entities.Event.filter({ id: eventId }).then(r => r[0] || null),
      base44.entities.FlashDrop.filter({ event_id: eventId }),
      base44.entities.Listing.filter({ event_id: eventId, status: 'active' }),
    ]);
    setEvent(ev);
    // Only show active drops + recently completed (within last 2 min for result state)
    const relevant = (drops || []).filter(d =>
      d.status === 'active' ||
      (d.status === 'winner_selected' && d.winner_selected_at && Date.now() - new Date(d.winner_selected_at) < 120000)
    );
    setActiveDrops(relevant);
    setListings(listingData || []);
    setLastRefresh(new Date());
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    loadAll();
    // Poll every 15s for new flash drops
    const id = setInterval(loadAll, 15000);
    return () => clearInterval(id);
  }, [loadAll]);

  // Subscribe to real-time FlashDrop changes
  useEffect(() => {
    const unsub = base44.entities.FlashDrop.subscribe((evt) => {
      if (evt.data?.event_id === eventId) loadAll();
    });
    return unsub;
  }, [eventId, loadAll]);

  // Recent price drops: listings updated within last hour, sorted by price
  const recentPriceDrops = listings
    .filter(l => l.updated_date && Date.now() - new Date(l.updated_date) < 3600000)
    .sort((a, b) => a.asking_price - b.asking_price)
    .slice(0, 5);

  // Upgrade listings: sorted by price asc — "available now"
  const upgradeListings = [...listings].sort((a, b) => a.asking_price - b.asking_price).slice(0, 6);

  if (!event && !loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-4xl">🎫</p>
        <p className="font-bold text-foreground">Event not found</p>
        <Link to="/events" className="text-primary underline text-sm">Browse Events</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-32" style={{ background: 'hsl(var(--background))' }}>
      {/* Header */}
      <div className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3 border-b border-border"
        style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(24px)' }}>
        <span className="text-base">⚡</span>
        <div className="flex-1 min-w-0">
          <span className="font-black text-sm text-foreground tracking-wide">EVENT MODE</span>
          {lastRefresh && <span className="text-muted-foreground text-xs ml-2">{formatDistanceToNow(lastRefresh, { addSuffix: true })}</span>}
        </div>
        {event && (
          <Link to={`/events/${eventId}`} className="text-xs text-muted-foreground hover:text-foreground hidden sm:block flex-shrink-0">
            Event Page →
          </Link>
        )}
        <button onClick={loadAll} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="px-4 pt-4 space-y-6 max-w-2xl mx-auto">
        {/* Event pill */}
        {event && (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
            {event.image_url && <img src={event.image_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm text-foreground truncate">{event.title}</p>
              <p className="text-xs text-muted-foreground">{event.venue} · {event.city}</p>
            </div>
            <span className="text-xs px-2 py-1 rounded-full font-black flex-shrink-0"
              style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
              🔴 LIVE
            </span>
          </div>
        )}

        {/* Flash Drop Opt-in Banner */}
        {eventId && (
          <FlashDropAlertBanner
            eventId={eventId}
            onOptIn={() => {/* Push notification opt-in can be wired here */}}
          />
        )}

        {/* ── ACTIVE FLASH DROPS ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🎁</span>
              <h2 className="font-black text-sm text-foreground uppercase tracking-wide">Active Flash Drops</h2>
              {activeDrops.length > 0 && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,45,120,0.2)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.4)' }}>
                  {activeDrops.length} LIVE
                </span>
              )}
            </div>
            <button
              onClick={() => user ? setShowCreateDrop(true) : base44.auth.redirectToLogin()}
              className="text-xs px-3 py-1.5 rounded-full font-bold"
              style={{ background: 'rgba(255,230,0,0.1)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
              + Drop Seats
            </button>
          </div>

          {loading ? (
            <div className="h-48 rounded-2xl animate-pulse bg-muted" />
          ) : activeDrops.length === 0 ? (
            <div className="rounded-2xl px-5 py-8 text-center"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)' }}>
              <p className="text-3xl mb-2">🎁</p>
              <p className="text-sm font-bold text-foreground mb-1">No active Flash Drops yet</p>
              <p className="text-xs text-muted-foreground mb-3">If you upgraded your seat, drop your old ones for a fellow fan.</p>
              <button onClick={() => user ? setShowCreateDrop(true) : base44.auth.redirectToLogin()}
                className="text-xs px-4 py-2 rounded-full font-bold"
                style={{ background: 'rgba(255,230,0,0.12)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
                ⚡ Create First Drop
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {activeDrops.map(drop => (
                <FlashDropCard
                  key={drop.id}
                  drop={drop}
                  user={user}
                  nearbyListings={upgradeListings}
                  onEntered={() => {}}
                  onWinnerSelected={() => setTimeout(loadAll, 2000)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── AVAILABLE UPGRADES ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">⚡</span>
              <h2 className="font-black text-sm text-foreground uppercase tracking-wide">Available Upgrades</h2>
              {upgradeListings.length > 0 && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,200,255,0.15)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
                  {upgradeListings.length}
                </span>
              )}
            </div>
            <Link to={`/events/${eventId}`} className="text-xs text-muted-foreground hover:text-foreground">
              See all →
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl animate-pulse bg-muted" />)}</div>
          ) : upgradeListings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No upgrades listed right now.</p>
          ) : (
            <div className="space-y-2">
              {upgradeListings.map(l => (
                <Link key={l.id} to={`/events/${eventId}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:scale-98"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">
                      Sec {l.section}{l.row ? ` · Row ${l.row}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {l.quantity} ticket{l.quantity !== 1 ? 's' : ''} · {l.transfer_method?.replace('_', ' ')}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-black text-sm" style={{ color: '#00FF87' }}>${l.asking_price}</p>
                    {l.original_price && l.original_price > l.asking_price && (
                      <p className="text-[10px] text-muted-foreground line-through">${l.original_price}</p>
                    )}
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ── RECENT PRICE DROPS ─────────────────────────────────────────── */}
        {recentPriceDrops.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">🔥</span>
              <h2 className="font-black text-sm text-foreground uppercase tracking-wide">Recent Price Drops</h2>
            </div>
            <div className="space-y-2">
              {recentPriceDrops.map(l => (
                <Link key={l.id} to={`/events/${eventId}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: 'rgba(255,45,120,0.05)', border: '1px solid rgba(255,45,120,0.15)' }}>
                  <TrendingDown className="w-4 h-4 flex-shrink-0" style={{ color: '#FF2D78' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">Sec {l.section}{l.row ? ` · Row ${l.row}` : ''}</p>
                    <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(l.updated_date), { addSuffix: true })}</p>
                  </div>
                  <p className="font-black text-sm flex-shrink-0" style={{ color: '#FF2D78' }}>${l.asking_price}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── TRANSFER WINDOW STATUS ─────────────────────────────────────── */}
        {event && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4" style={{ color: '#BF5FFF' }} />
              <h2 className="font-black text-sm text-foreground uppercase tracking-wide">Transfer Window</h2>
            </div>
            <div className="rounded-xl px-4 py-3 flex items-center gap-3"
              style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.2)' }}>
              <div className="flex-1">
                <p className="text-sm font-bold text-foreground capitalize">
                  {event.transfer_window_status?.replace(/_/g, ' ') || 'Unknown'}
                </p>
                {event.admin_transfer_notes && (
                  <p className="text-xs text-muted-foreground mt-0.5">{event.admin_transfer_notes}</p>
                )}
              </div>
              <span className="text-xs px-2 py-1 rounded-full font-semibold flex-shrink-0"
                style={{
                  background: event.transfer_window_status?.includes('open') ? 'rgba(0,255,135,0.1)' : 'rgba(255,45,120,0.1)',
                  color: event.transfer_window_status?.includes('open') ? '#00FF87' : '#FF2D78',
                }}>
                {event.transfer_window_status?.includes('open') ? 'Open' : 'Uncertain'}
              </span>
            </div>
          </section>
        )}
      </div>

      {/* Create Flash Drop Sheet */}
      {showCreateDrop && event && (
        <CreateFlashDropSheet
          event={event}
          user={user}
          onClose={() => setShowCreateDrop(false)}
          onCreated={(drop) => {
            setShowCreateDrop(false);
            loadAll();
          }}
        />
      )}
    </div>
  );
}