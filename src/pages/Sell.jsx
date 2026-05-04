import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Plus, Tag, TrendingUp, LogIn, Zap } from 'lucide-react';

export default function Sell() {
  const [user, setUser] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me()
      .then(async (me) => {
        setUser(me);
        const myListings = await base44.entities.Listing.filter({ seller_email: me.email });
        setListings(myListings.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 px-5 py-32 text-center">
        <div className="text-5xl">🥜</div>
        <h2 className="font-display text-3xl text-foreground">Sign In to Sell</h2>
        <p className="text-sm text-muted-foreground max-w-[240px]">
          List your seats and start earning.
        </p>
        <button
          onClick={() => base44.auth.redirectToLogin()}
          className="flex items-center gap-2 font-bold px-8 py-3.5 rounded-full neon-glow-green"
          style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', color: '#0D0B14' }}
        >
          <LogIn className="w-4 h-4" /> Sign In
        </button>
      </div>
    );
  }

  const active = listings.filter(l => l.status === 'active' || l.status === 'pending_transfer');
  const sold = listings.filter(l => l.status === 'sold');
  const other = listings.filter(l => l.status === 'cancelled' || l.status === 'expired');

  return (
    <div className="pb-32">
      {/* Hero */}
      <div className="relative h-56 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=900&q=80"
          alt="Sell"
          className="w-full h-full object-cover object-top"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.45) 0%, rgba(5,3,12,0.2) 40%, rgba(5,3,12,0.92) 100%)' }}
        />

        <div className="absolute bottom-5 left-4 right-4">
          <span className="text-[10px] font-black tracking-[0.2em] px-3 py-1 rounded-full inline-block mb-3"
            style={{ background: 'rgba(0,0,0,0.5)', color: '#FF2D78', border: '1px solid #FF2D7855', backdropFilter: 'blur(12px)' }}>
            🏷️ SELLER HUB
          </span>
          <h1 className="font-display leading-[0.9] mb-3"
            style={{
              fontSize: 'clamp(3.2rem, 15vw, 5.2rem)',
              letterSpacing: '-0.02em',
              background: 'linear-gradient(135deg, #FF2D78 0%, #FFE600 55%, #00FF87 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 6px 24px rgba(0,0,0,0.6))'
            }}>
            Sell Tickets
          </h1>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(255,45,120,0.15)', border: '1px solid rgba(255,45,120,0.35)' }}>
            <Tag className="w-3 h-3 flex-shrink-0" style={{ color: '#FF2D78' }} />
            <span className="text-[11px] font-medium leading-snug" style={{ color: 'rgba(255,215,235,0.9)' }}>
              List your seats and start earning instantly — keep 80% of sales.
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 pt-6 space-y-6">

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Active', value: active.length, color: '#00FF87' },
            { label: 'Sold', value: sold.length, color: '#00C8FF' },
            { label: 'Total', value: listings.length, color: '#BF5FFF' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-2xl px-4 py-3 text-center"
              style={{ background: `${color}0f`, border: `1px solid ${color}25` }}>
              <div className="font-display text-2xl" style={{ color }}>{value}</div>
              <div className="text-[11px] text-muted-foreground font-medium mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Active listings */}
        {active.length > 0 && (
          <section>
            <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
              <Tag className="w-3.5 h-3.5" style={{ color: '#00FF87' }} /> Active ({active.length})
            </h2>
            <div className="space-y-3">
              {active.map(l => <ListingRow key={l.id} listing={l} />)}
            </div>
          </section>
        )}

        {/* Sold */}
        {sold.length > 0 && (
          <section>
            <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" style={{ color: '#00C8FF' }} /> Sold ({sold.length})
            </h2>
            <div className="space-y-3">
              {sold.map(l => <ListingRow key={l.id} listing={l} />)}
            </div>
          </section>
        )}

        {/* Empty state */}
        {listings.length === 0 && (
          <div className="text-center py-16 glass-card rounded-2xl">
            <p className="text-4xl mb-3">🎟️</p>
            <p className="font-bold text-foreground">No listings yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Got seats you can't use? List them now.</p>
            <Link to="/create-listing"
              className="inline-flex items-center gap-2 font-bold px-6 py-3 rounded-full"
              style={{ background: '#FF2D78', color: '#fff' }}>
              <Plus className="w-4 h-4" /> Create Listing
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function ListingRow({ listing }) {
  const STATUS_COLOR = {
    active: '#00FF87',
    pending_transfer: '#FFE600',
    sold: '#00C8FF',
    cancelled: '#FF2D78',
    expired: 'rgba(255,255,255,0.3)',
  };
  const color = STATUS_COLOR[listing.status] || 'rgba(255,255,255,0.3)';

  return (
    <div className="rounded-2xl px-4 py-4 flex items-center justify-between gap-3"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm text-foreground truncate">
          Sec {listing.section}{listing.row ? ` · Row ${listing.row}` : ''}
          {listing.seats ? ` · Seats ${listing.seats}` : ''}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {listing.quantity} ticket{listing.quantity !== 1 ? 's' : ''} · ${listing.asking_price}/ea
        </div>
      </div>
      <span className="text-[10px] font-black px-2.5 py-1 rounded-full capitalize flex-shrink-0"
        style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
        {listing.status.replace('_', ' ')}
      </span>
    </div>
  );
}