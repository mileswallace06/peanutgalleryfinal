import { ArrowUpRight, Flame, ShieldCheck, Clock } from 'lucide-react';

const TIER_STYLES = {
  floor: { color: '#FF2D78', bg: '#FF2D7815', label: 'Floor' },
  lower: { color: '#BF5FFF', bg: '#BF5FFF15', label: 'Lower Bowl' },
  mid:   { color: '#00C8FF', bg: '#00C8FF15', label: 'Mid Level' },
  upper: { color: '#FFE600', bg: '#FFE60015', label: 'Upper Level' },
};

export default function ListingCard({ listing, onUpgrade, isCheapest }) {
  const isDemo = listing.notes?.startsWith('[DEMO]');
  const isVerified = !!listing.proof_url && !isDemo;
  const tier = TIER_STYLES[listing.tier];
  const savings = listing.original_price
    ? Math.round(((listing.original_price - listing.asking_price) / listing.original_price) * 100)
    : null;

  const accentColor = isCheapest ? '#00FF87' : isVerified ? '#00FF87' : 'rgba(255,255,255,0.15)';

  return (
    <div
      className="rounded-2xl overflow-hidden flex transition-transform active:scale-[0.98]"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 100%)',
        border: isCheapest ? '1px solid #00FF8730' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: isCheapest
          ? '0 0 0 1px rgba(0,255,135,0.08), 0 8px 32px rgba(0,0,0,0.45)'
          : '0 4px 24px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Left accent bar */}
      <div
        className="w-1 shrink-0 rounded-r-full my-3"
        style={{ background: accentColor, boxShadow: isCheapest ? '0 0 8px #00FF8788' : 'none' }}
      />

      {/* Card body */}
      <div className="flex-1 px-4 py-5 flex flex-col gap-4">

        {/* Badges row */}
        <div className="flex items-center gap-2 flex-wrap">
          {isCheapest && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#00FF8712', color: '#00FF87', border: '1px solid #00FF8730' }}>
              <Flame className="w-2.5 h-2.5" /> Best Price
            </span>
          )}
          {tier && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: tier.bg, color: tier.color }}>
              {tier.label}
            </span>
          )}
          {isDemo ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#FFE60012', color: '#FFE600', border: '1px solid #FFE60030' }}>
              🥜 Demo
            </span>
          ) : isVerified ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#00FF8712', color: '#00FF87', border: '1px solid #00FF8730' }}>
              <ShieldCheck className="w-2.5 h-2.5" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#FFE60012', color: '#FFE600', border: '1px solid #FFE60030' }}>
              <Clock className="w-2.5 h-2.5" /> Pending
            </span>
          )}
        </div>

        {/* Seat info + Price */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="font-bold text-foreground text-base leading-tight">
              Section {listing.section}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Row {listing.row}
              {listing.seats && <> · Seats {listing.seats}</>}
              {listing.quantity > 1 && <> · {listing.quantity} tickets</>}
            </div>
          </div>

          {/* Price — dominant element */}
          <div className="text-right flex-shrink-0">
            <div
              className="font-display leading-none"
              style={{
                fontSize: 'clamp(2.2rem, 9vw, 2.8rem)',
                color: isCheapest ? '#00FF87' : '#fff',
                filter: isCheapest ? 'drop-shadow(0 0 12px #00FF8766)' : 'none',
              }}
            >
              ${listing.asking_price}
            </div>
            {listing.original_price && (
              <div className="text-[10px] text-muted-foreground line-through mt-0.5">${listing.original_price}</div>
            )}
            {savings !== null && savings > 0 && (
              <div className="text-[10px] font-bold mt-0.5" style={{ color: '#00FF87' }}>{savings}% off</div>
            )}
            <div className="text-[10px] text-muted-foreground mt-0.5">per ticket</div>
          </div>
        </div>

        {/* CTA Button */}
        <button
          onClick={() => onUpgrade(listing)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all active:scale-95 neon-glow-green"
          style={{
            background: 'linear-gradient(135deg, #00FF87, #00C8FF)',
            color: '#0D0B14',
          }}
        >
          <ArrowUpRight className="w-4 h-4" />
          Upgrade — ${listing.asking_price}{listing.quantity > 1 ? ` × ${listing.quantity}` : ''}
        </button>

        <p className="text-center text-[10px] text-muted-foreground -mt-1">
          Instant purchase · Escrow protected 🛡️
        </p>
      </div>
    </div>
  );
}