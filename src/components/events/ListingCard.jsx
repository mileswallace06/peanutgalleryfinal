import { ArrowUpRight, FlameKindling } from 'lucide-react';

const TIER_STYLES = {
  floor: { color: '#FF2D78', bg: '#FF2D7815' },
  lower: { color: '#BF5FFF', bg: '#BF5FFF15' },
  mid:   { color: '#00C8FF', bg: '#00C8FF15' },
  upper: { color: '#FFE600', bg: '#FFE60015' },
};

export default function ListingCard({ listing, onUpgrade, isCheapest }) {
  const isDemo = listing.notes?.startsWith('[DEMO]');
  const tier = TIER_STYLES[listing.tier];
  const savings = listing.original_price
    ? Math.round(((listing.original_price - listing.asking_price) / listing.original_price) * 100)
    : null;

  return (
    <div
      className={`glass-card rounded-2xl p-4 flex flex-col gap-3 active:scale-[0.98] transition-transform ${isCheapest ? 'neon-border-green' : ''}`}
      style={isCheapest ? {} : { border: '1px solid rgba(255,255,255,0.09)' }}
    >
      {/* Top badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        {isCheapest && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: '#00FF8712', color: '#00FF87', border: '1px solid #00FF8730' }}>
            <FlameKindling className="w-3 h-3" /> Best Price
          </span>
        )}
        {tier && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize"
            style={{ background: tier.bg, color: tier.color }}>
            {listing.tier}
          </span>
        )}
        {isDemo ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: '#FFE60012', color: '#FFE600', border: '1px solid #FFE60030' }}>
            🥜 Demo
          </span>
        ) : listing.proof_url ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: '#00FF8712', color: '#00FF87', border: '1px solid #00FF8730' }}>
            ✓ Verified
          </span>
        ) : null}
      </div>

      {/* Seat info + price */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-bold text-foreground text-lg leading-tight">Section {listing.section}</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            Row {listing.row}
            {listing.seats && <> · Seats {listing.seats}</>}
            {listing.quantity > 1 && <> · ×{listing.quantity} tickets</>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-display text-3xl text-foreground">${listing.asking_price}</div>
          {listing.original_price && (
            <div className="text-xs text-muted-foreground line-through">${listing.original_price}</div>
          )}
          {savings !== null && savings > 0 && (
            <div className="text-xs font-bold" style={{ color: '#00FF87' }}>{savings}% off</div>
          )}
          <div className="text-xs text-muted-foreground">per ticket</div>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={() => onUpgrade(listing)}
        className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-full font-bold text-base transition-all neon-glow-green active:scale-95"
        style={{ background: '#00FF87', color: '#0D0B14' }}
      >
        <ArrowUpRight className="w-5 h-5" />
        Upgrade to These Seats — ${listing.asking_price}
        {listing.quantity > 1 ? ` × ${listing.quantity}` : ''}
      </button>
      <p className="text-center text-xs text-muted-foreground">Instant purchase • Pay safely</p>
    </div>
  );
}