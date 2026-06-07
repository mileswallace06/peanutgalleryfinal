import { ArrowUpRight, ShieldCheck, Zap } from 'lucide-react';
import TransferStatusBadge from '@/components/listings/TransferStatusBadge';

const TIER_STYLES = {
  floor: { color: '#FF2D78', bg: '#FF2D7815', label: 'Floor' },
  lower: { color: '#BF5FFF', bg: '#BF5FFF15', label: 'Lower Bowl' },
  mid:   { color: '#00C8FF', bg: '#00C8FF15', label: 'Mid Level' },
  upper: { color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.06)', label: 'Upper Level' },
};



export default function ListingCard({ listing, onUpgrade, isCheapest, mode = 'upgrade', transferWarning = null }) {
  const isDemo = listing.notes?.startsWith('[DEMO]');
  const isVerified = !!listing.proof_url && !isDemo;
  const isInstant = listing.listing_mode === 'instant' && listing.custody_status === 'verified';
  const isTransferDisabled = listing.transfer_status === 'transfer_disabled';
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
        border: isCheapest ? '1px solid rgba(0,255,135,0.2)' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: isCheapest
          ? '0 0 0 1px rgba(0,255,135,0.05), 0 6px 24px rgba(0,0,0,0.4)'
          : '0 4px 20px rgba(0,0,0,0.3)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Left accent bar */}
      <div
        className="w-1 shrink-0 rounded-r-full my-3"
        style={{ background: accentColor, boxShadow: isCheapest ? '0 0 6px #00FF8744' : 'none' }}
      />

      {/* Card body */}
      <div className="flex-1 px-4 py-5 flex flex-col gap-4">

        {/* Badges row — max 2 badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {isDemo && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.1)' }}>
              Demo
            </span>
          )}
          {tier && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: tier.bg, color: tier.color }}>
              {tier.label}
            </span>
          )}
          {isInstant && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(0,200,255,0.1)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.2)' }}>
              <Zap className="w-2.5 h-2.5" /> Instant
            </span>
          )}
          {isVerified && !isDemo && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <ShieldCheck className="w-2.5 h-2.5" /> Verified
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
                filter: isCheapest ? 'drop-shadow(0 0 8px #00FF8740)' : 'none',
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

        {/* Transfer availability */}
        <TransferStatusBadge listing={listing} />

        {/* Event-level transfer warning (advisory only) */}
        {transferWarning && !isTransferDisabled && (
          <div className="text-[10px] px-3 py-2 rounded-xl leading-relaxed"
            style={{ background: 'rgba(255,140,0,0.06)', color: '#FF8C00', border: '1px solid rgba(255,140,0,0.2)' }}>
            {transferWarning}
          </div>
        )}

        {/* CTA Button */}
        {/* Block purchase only for transfer_disabled listings */}
        {isTransferDisabled ? (
          <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-bold text-sm cursor-not-allowed"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'hsl(var(--muted-foreground))' }}>
            Transfer Unavailable
          </div>
        ) : onUpgrade ? (
          <button
            onClick={() => onUpgrade(listing)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #00E87A, #00B8E8)',
              color: '#0D0B14',
              boxShadow: '0 0 18px rgba(0,232,122,0.22), 0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            <ArrowUpRight className="w-4 h-4" />
            {mode === 'upgrade'
              ? `Upgrade to These Seats — $${listing.asking_price}${listing.quantity > 1 ? ` × ${listing.quantity}` : ''}`
              : `Buy Tickets — $${listing.asking_price}${listing.quantity > 1 ? ` × ${listing.quantity}` : ''}`
            }
          </button>
        ) : (
          <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-medium text-sm opacity-40 cursor-not-allowed"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'hsl(var(--muted-foreground))' }}>
            Unavailable
          </div>
        )}

        {/* Buyer protection */}
        <div className="flex items-center gap-3 -mt-1 flex-wrap">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 flex-shrink-0" style={{ color: '#00FF87', opacity: 0.7 }} />
            <p className="text-[10px] text-muted-foreground">Money held in escrow · seller paid only after you confirm · disputes supported</p>
          </div>
        </div>
      </div>
    </div>
  );
}