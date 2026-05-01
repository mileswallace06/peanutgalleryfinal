import { ArrowUpRight, Flame } from 'lucide-react';

const TIER_STYLES = {
  floor: { color: '#FF2D78', bg: '#FF2D7815', label: 'Floor' },
  lower: { color: '#BF5FFF', bg: '#BF5FFF15', label: 'Lower Bowl' },
  mid:   { color: '#00C8FF', bg: '#00C8FF15', label: 'Mid Level' },
  upper: { color: '#FFE600', bg: '#FFE60015', label: 'Upper Level' },
};

export default function ListingCard({ listing, onUpgrade, isCheapest }) {
  const isDemo = listing.notes?.startsWith('[DEMO]');
  const tier = TIER_STYLES[listing.tier];
  const savings = listing.original_price
    ? Math.round(((listing.original_price - listing.asking_price) / listing.original_price) * 100)
    : null;

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4 transition-transform active:scale-[0.98]"
      style={{
        background: isCheapest
          ? 'linear-gradient(135deg, rgba(0,255,135,0.07) 0%, rgba(0,200,255,0.04) 100%)'
          : 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
        border: isCheapest ? '1px solid rgba(0,255,135,0.3)' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: isCheapest ? '0 0 30px rgba(0,255,135,0.10)' : 'none',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        {isCheapest && (
          <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full"
            style={{ background: '#00FF8718', color: '#00FF87', border: '1px solid #00FF8740' }}>
            <Flame className="w-3 h-3" /> Best Price
          </span>
        )}
        {tier && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: tier.bg, color: tier.color }}>
            {tier.label}
          </span>
        )}
        {isDemo ? (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: '#FFE60012', color: '#FFE600', border: '1px solid #FFE60030' }}>
            🥜 Demo
          </span>
        ) : listing.proof_url ? (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: '#00FF8712', color: '#00FF87', border: '1px solid #00FF8730' }}>
            ✓ Verified
          </span>
        ) : null}
      </div>

      {/* Seat + Price row */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-bold text-foreground text-lg leading-tight">
            Section {listing.section}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            Row {listing.row}
            {listing.seats && <> · Seats {listing.seats}</>}
            {listing.quantity > 1 && <> · {listing.quantity} tickets</>}
          </div>
        </div>

        {/* Price — most prominent element */}
        <div className="text-right flex-shrink-0">
          <div
            className="font-display leading-none"
            style={{
              fontSize: 'clamp(2.4rem, 10vw, 3rem)',
              color: isCheapest ? '#00FF87' : '#fff',
              filter: isCheapest ? 'drop-shadow(0 0 16px #00FF8766)' : 'none',
            }}
          >
            ${listing.asking_price}
          </div>
          {listing.original_price && (
            <div className="text-xs text-muted-foreground line-through mt-0.5">${listing.original_price}</div>
          )}
          {savings !== null && savings > 0 && (
            <div className="text-xs font-bold mt-0.5" style={{ color: '#00FF87' }}>{savings}% off</div>
          )}
          <div className="text-[11px] text-muted-foreground mt-0.5">per ticket</div>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={() => onUpgrade(listing)}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-black text-base transition-all active:scale-95"
        style={{
          background: '#00FF87',
          color: '#0D0B14',
          boxShadow: '0 0 24px rgba(0,255,135,0.45), 0 0 48px rgba(0,255,135,0.2)',
        }}
      >
        <ArrowUpRight className="w-5 h-5" />
        Upgrade — ${listing.asking_price}{listing.quantity > 1 ? ` × ${listing.quantity}` : ''}
      </button>

      <p className="text-center text-xs text-muted-foreground -mt-1">
        Instant purchase · Escrow protected
      </p>
    </div>
  );
}