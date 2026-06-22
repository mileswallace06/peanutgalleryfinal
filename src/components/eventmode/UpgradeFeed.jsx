/**
 * UpgradeFeed — live upgrades first, then resale/admission support.
 */
import { Link } from 'react-router-dom';
import { ArrowUpRight, TrendingDown, Bell, Zap, Ticket } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';

const UPGRADE_TYPES = new Set(['live_upgrade', 'venue_upgrade']);
const ADMISSION_TYPES = new Set(['resale_ticket', 'venue_ticket', null, undefined]);

function confidenceColor(score) {
  if (!score) return '#888';
  if (score >= 80) return '#00FF87';
  if (score >= 55) return '#FFE600';
  return '#FF8C00';
}

function ListingRow({ l, eventId, index }) {
  const isPriceDrop = l.original_price && l.original_price > l.asking_price;
  const savings = isPriceDrop ? Math.round(l.original_price - l.asking_price) : 0;
  const isNew = l.created_date && Date.now() - new Date(l.created_date) < 600000;
  const isUpgrade = UPGRADE_TYPES.has(l.listing_type);

  return (
    <motion.div key={l.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }}>
      <Link to={`/events/${eventId}`}
        className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:scale-98"
        style={{
          background: isPriceDrop ? 'rgba(255,45,120,0.05)' : isUpgrade ? 'rgba(0,200,255,0.04)' : 'rgba(255,255,255,0.04)',
          border: isPriceDrop ? '1px solid rgba(255,45,120,0.2)' : isUpgrade ? '1px solid rgba(0,200,255,0.15)' : '1px solid rgba(255,255,255,0.08)',
        }}>
        {isPriceDrop
          ? <TrendingDown className="w-4 h-4 flex-shrink-0" style={{ color: '#FF2D78' }} />
          : isUpgrade
            ? <Zap className="w-4 h-4 flex-shrink-0" style={{ color: '#00C8FF' }} />
            : <Ticket className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-bold text-foreground">
              Sec {l.section}{l.row ? ` · Row ${l.row}` : ''}
            </p>
            {isNew && (
              <span className="text-[8px] font-black px-1 py-0.5 rounded-full" style={{ background: 'rgba(0,255,135,0.15)', color: '#00FF87' }}>NEW</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {l.quantity} ticket{l.quantity !== 1 ? 's' : ''} ·{' '}
            {l.created_date ? formatDistanceToNow(new Date(l.created_date), { addSuffix: true }) : ''}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-black text-base" style={{ color: isPriceDrop ? '#FF2D78' : isUpgrade ? '#00C8FF' : '#00FF87' }}>${l.asking_price}</p>
          {isPriceDrop && (
            <p className="text-[10px] text-muted-foreground">
              <span className="line-through">${l.original_price}</span>
              <span className="ml-1 font-bold" style={{ color: '#FF2D78' }}>-${savings}</span>
            </p>
          )}
          <div className="flex items-center justify-end gap-0.5 mt-0.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: confidenceColor(l.transfer_confidence_score) }} />
          </div>
        </div>
        <ArrowUpRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      </Link>
    </motion.div>
  );
}

export default function UpgradeFeed({ listings, eventId, loading, event }) {
  if (loading) return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl animate-pulse bg-muted" />)}
    </div>
  );

  const TYPE_ORDER = { venue_upgrade: 0, live_upgrade: 1, venue_ticket: 2, resale_ticket: 3 };

  const upgradeListings = listings
    .filter(l => UPGRADE_TYPES.has(l.listing_type))
    .sort((a, b) => {
      const typeOrder = (TYPE_ORDER[a.listing_type] ?? 99) - (TYPE_ORDER[b.listing_type] ?? 99);
      if (typeOrder !== 0) return typeOrder;
      return a.asking_price - b.asking_price;
    });

  const admissionListings = listings
    .filter(l => ADMISSION_TYPES.has(l.listing_type))
    .sort((a, b) => {
      const typeOrder = (TYPE_ORDER[a.listing_type] ?? 99) - (TYPE_ORDER[b.listing_type] ?? 99);
      if (typeOrder !== 0) return typeOrder;
      return a.asking_price - b.asking_price;
    });

  const eventStatus = event?.status;
  const isEnded = eventStatus === 'ended';
  const isLive = eventStatus === 'live';

  // Event ended state
  if (isEnded) {
    return (
      <div className="rounded-2xl px-5 py-8 text-center space-y-2"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-3xl">🏁</p>
        <p className="font-semibold text-sm text-foreground">Event has ended</p>
        <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
          No more upgrades are available. The event is over.
        </p>
      </div>
    );
  }

  // Event not live yet — no upgrades
  if (!isLive && upgradeListings.length === 0) {
    return (
      <div className="rounded-2xl px-5 py-8 text-center space-y-3"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Zap className="w-5 h-5 mx-auto opacity-20" />
        <div>
          <p className="font-semibold text-sm text-foreground">Upgrades open when the event goes live</p>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-[220px] mx-auto leading-relaxed">
            Seat upgrades will appear here once doors open and fans start listing.
          </p>
        </div>
      </div>
    );
  }

  // Live but no upgrades
  if (upgradeListings.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl px-5 py-8 text-center space-y-3"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <Zap className="w-5 h-5 mx-auto opacity-20" />
          <div>
            <p className="font-semibold text-sm text-foreground">No live upgrades yet</p>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-[220px] mx-auto leading-relaxed">
              Fans inside the venue can list seat upgrades. Check back soon.
            </p>
          </div>
        </div>

        {admissionListings.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2">Admission Tickets</span>
              <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
            </div>
            <p className="text-[11px] text-muted-foreground text-center -mt-2">These are full admission tickets, not upgrades.</p>
            <div className="space-y-2">
              {admissionListings.map((l, i) => <ListingRow key={l.id} l={l} eventId={eventId} index={i} />)}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Live upgrades section */}
      <div className="space-y-2">
        {upgradeListings.map((l, i) => <ListingRow key={l.id} l={l} eventId={eventId} index={i} />)}
      </div>

      {/* Admission tickets below as secondary section */}
      {admissionListings.length > 0 && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2">Also Available — Admission</span>
            <div className="flex-1 h-px" style={{ background: 'hsl(var(--border))' }} />
          </div>
          <p className="text-[11px] text-muted-foreground text-center -mt-2">Full admission tickets. Not upgrades.</p>
          <div className="space-y-2">
            {admissionListings.map((l, i) => <ListingRow key={l.id} l={l} eventId={eventId} index={i} />)}
          </div>
        </>
      )}
    </div>
  );
}