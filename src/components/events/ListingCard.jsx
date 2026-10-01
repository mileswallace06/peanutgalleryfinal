import '@/components/events/detail-ticket.css';
import { ArrowUpRight, ShieldCheck, Zap, MapPin, AlertTriangle, Clock } from 'lucide-react';
import TransferStatusBadge from '@/components/listings/TransferStatusBadge';
import { UPGRADE_LISTING_TYPES } from '@/lib/listingTypes';
import { isReservedByMe, isReservedByOther, isSold } from '@/lib/listingVisibility';

const TIER_STYLES = {
  floor: { color: 'var(--neon-pink)', bg: 'color-mix(in srgb, var(--neon-pink) 8%, transparent)', label: 'Floor' },
  lower: { color: 'var(--neon-purple)', bg: 'color-mix(in srgb, var(--neon-purple) 8%, transparent)', label: 'Lower Bowl' },
  mid:   { color: 'var(--neon-cyan)', bg: 'color-mix(in srgb, var(--neon-cyan) 8%, transparent)', label: 'Mid Level' },
  upper: { color: 'var(--pg-muted)', bg: 'var(--pg-surface-raised)', label: 'Upper Level' },
};



export default function ListingCard({ listing, onUpgrade, isCheapest, mode = 'upgrade', transferWarning = null, currentUserEmail }) {
  const isDemo = !!listing.is_demo_listing;
  const isUpgrade = UPGRADE_LISTING_TYPES.includes(listing.listing_type);
  const isVerified = !!listing.is_verified && !isDemo;
  const isInstant = !!listing.is_instant_ready;
  const isTransferDisabled = listing.transfer_status === 'transfer_disabled';
  const tier = TIER_STYLES[listing.tier];
  const savings = listing.original_price
    ? Math.round(((listing.original_price - listing.asking_price) / listing.original_price) * 100)
    : null;

  const accentColor = isCheapest ? 'var(--pg-mint)' : isVerified ? 'var(--pg-mint)' : 'var(--pg-line)';

  return (
    <div
      className="pg-listing-card pg-detail-surface rounded-lg overflow-hidden flex transition-transform active:scale-[0.98]"
      style={{
        background: 'var(--pg-surface)',
        border: isCheapest ? '1px solid color-mix(in srgb, var(--pg-mint) 20%, transparent)' : '1px solid var(--pg-line)',
      }}
    >
      {/* Left accent bar */}
      <div
        className="w-1 shrink-0 rounded-r-full my-3"
        style={{ background: accentColor }}
      />

      {/* Card body */}
      <div className="min-w-0 flex-1 px-4 py-5 flex flex-col gap-4">

        {/* Upgrade disclaimer — shown prominently above everything else */}
        {isUpgrade && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--pg-orange) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--pg-orange) 30%, transparent)' }}>
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--neon-orange)' }} />
            <p className="text-[11px] font-semibold leading-snug" style={{ color: 'var(--neon-orange)' }}>
              This is an upgrade, not admission. You must already have a ticket to this event.
            </p>
          </div>
        )}

        {/* Location requirement */}
        {listing.requires_location && listing.location_requirement !== 'none' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--pg-cyan) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--pg-cyan) 20%, transparent)' }}>
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--neon-cyan)' }} />
            <p className="text-[11px]" style={{ color: 'var(--neon-cyan)' }}>
              {listing.location_requirement === 'inside_venue' && 'Must be inside the venue to purchase'}
              {listing.location_requirement === 'venue_proximity' && 'Must be near the venue to purchase'}
              {listing.location_requirement === 'city_only' && 'Must be in the city to purchase'}
            </p>
          </div>
        )}

        {/* Badges row */}
        <div className="flex items-center gap-2 flex-wrap">
          {isDemo && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'var(--pg-surface-raised)', color: 'var(--pg-muted)', border: '1px solid var(--pg-line)' }}>
              Demo
            </span>
          )}
          {isUpgrade && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'color-mix(in srgb, var(--pg-orange) 12%, transparent)', color: 'var(--neon-orange)', border: '1px solid color-mix(in srgb, var(--neon-orange) 25%, transparent)' }}>
              Seat Upgrade
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
              style={{ background: 'color-mix(in srgb, var(--pg-cyan) 10%, transparent)', color: 'var(--neon-cyan)', border: '1px solid color-mix(in srgb, var(--neon-cyan) 20%, transparent)' }}>
              <Zap className="w-2.5 h-2.5" /> Instant
            </span>
          )}
          {isVerified && !isDemo && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'var(--pg-surface-raised)', color: 'var(--pg-muted)', border: '1px solid var(--pg-line)' }}>
              <ShieldCheck className="w-2.5 h-2.5" /> Verified
            </span>
          )}
        </div>

        {/* Seat info + Price */}
        <div className="pg-listing-seat-summary pg-detail-paper flex items-end justify-between gap-3">
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
                color: 'var(--pg-ink)',
              }}
            >
              ${listing.asking_price}
            </div>
            {listing.original_price && (
              <div className="text-[10px] text-muted-foreground line-through mt-0.5">${listing.original_price}</div>
            )}
            {savings !== null && savings > 0 && (
              <div className="text-[10px] font-bold mt-0.5" style={{ color: '#356249' }}>{savings}% off</div>
            )}
            <div className="text-[10px] text-muted-foreground mt-0.5">per ticket</div>
          </div>
        </div>

        {/* Transfer availability */}
        <TransferStatusBadge listing={listing} />

        {/* Event-level transfer warning (advisory only) */}
        {transferWarning && !isTransferDisabled && (
          <div className="text-[10px] px-3 py-2 rounded-lg leading-relaxed"
            style={{ background: 'color-mix(in srgb, var(--pg-orange) 6%, transparent)', color: 'var(--neon-orange)', border: '1px solid color-mix(in srgb, var(--neon-orange) 20%, transparent)' }}>
            {transferWarning}
          </div>
        )}

        {/* CTA Button — sold / reserved / transfer-disabled / available */}
        {isSold(listing) ? (
          <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-bold text-sm cursor-not-allowed"
            style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)', color: 'var(--pg-muted)' }}>
            This listing has sold
          </div>
        ) : isReservedByOther(listing, currentUserEmail) ? (
          <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-bold text-sm cursor-not-allowed"
            style={{ background: 'color-mix(in srgb, var(--pg-orange) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--pg-orange) 20%, transparent)', color: 'var(--neon-orange)' }}>
            <Clock className="w-4 h-4" /> Temporarily reserved
          </div>
        ) : isReservedByMe(listing, currentUserEmail) ? (
          <div className="flex flex-col gap-2">
            <div className="w-full flex items-center justify-center gap-2 py-2 rounded-full font-bold text-xs"
              style={{ background: 'color-mix(in srgb, var(--pg-mint) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--pg-mint) 20%, transparent)', color: 'var(--neon-green)' }}>
              <Clock className="w-3.5 h-3.5" /> Reserved for you
            </div>
            {onUpgrade && (
              <button
                onClick={() => onUpgrade(listing)}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all active:scale-95"
                style={{
                  background: isUpgrade
                    ? 'var(--pg-orange)'
                    : 'var(--pg-mint)',
                  color: 'var(--pg-ink)',
                }}
              >
                <ArrowUpRight className="w-4 h-4" />
                Continue to Checkout
              </button>
            )}
          </div>
        ) : isTransferDisabled ? (
          <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-bold text-sm cursor-not-allowed"
            style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)', color: 'var(--pg-muted)' }}>
            Transfer Unavailable
          </div>
        ) : onUpgrade ? (
          <button
            onClick={() => onUpgrade(listing)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all active:scale-95"
            style={{
              background: isUpgrade
                ? 'var(--pg-orange)'
                : 'var(--pg-mint)',
              color: 'var(--pg-ink)',
            }}
          >
            <ArrowUpRight className="w-4 h-4" />
            {isDemo && isUpgrade
              ? `Simulate Upgrade — $${listing.asking_price}${listing.quantity > 1 ? ` × ${listing.quantity}` : ''}`
              : isUpgrade
              ? `Upgrade Live — $${listing.asking_price}${listing.quantity > 1 ? ` × ${listing.quantity}` : ''}`
              : `Buy Ticket — $${listing.asking_price}${listing.quantity > 1 ? ` × ${listing.quantity}` : ''}`
            }
          </button>
        ) : (
          <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-medium text-sm opacity-40 cursor-not-allowed"
            style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)', color: 'var(--pg-muted)' }}>
            Unavailable
          </div>
        )}

        {/* Buyer protection */}
        <div className="flex items-center gap-3 -mt-1 flex-wrap">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--neon-green)', opacity: 0.7 }} />
            <p className="text-[10px] text-muted-foreground">
              {isUpgrade
                ? 'Upgrade access only · existing admission required · disputes supported'
                : 'Money held in escrow · seller paid only after you confirm · disputes supported'
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}