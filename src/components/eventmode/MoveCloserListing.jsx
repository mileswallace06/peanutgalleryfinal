import { ArrowUpRight, Clock } from 'lucide-react';
import { isSold, isReservedByOther, isReservedByMe } from '@/lib/listingVisibility';

const TIER_LABELS = {
  floor: 'Floor',
  lower: 'Lower Bowl',
  mid: 'Club Level',
  upper: 'Upper Level',
};

/**
 * MoveCloserListing — a single upgrade card in the Move Closer rail.
 * Reuses the existing visibility / reservation helpers so sold, reserved,
 * and transfer-disabled states are handled identically to the marketplace.
 * No invented quality claims — only the existing tier label is shown.
 */
export default function MoveCloserListing({ listing, currentUserEmail, onView }) {
  if (!listing) return null;

  const tierLabel = TIER_LABELS[listing.tier] || 'Available upgrade';
  const sold = isSold(listing);
  const reservedByOther = isReservedByOther(listing, currentUserEmail);
  const reservedByMe = isReservedByMe(listing, currentUserEmail);
  const transferDisabled = listing.transfer_status === 'transfer_disabled';

  return (
    <div className="flex-shrink-0 w-64 rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--ev-surface)', border: '1px solid var(--ev-border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--ev-teal)' }}>
          {tierLabel}
        </span>
        {listing.is_instant_ready && (
          <span className="text-[10px] font-semibold" style={{ color: 'var(--ev-text-2)' }}>Instant</span>
        )}
      </div>

      <div>
        <div className="font-bold leading-tight" style={{ color: 'var(--ev-text)', fontSize: '1.15rem' }}>
          Section {listing.section}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--ev-text-2)' }}>
          Row {listing.row}
          {listing.seats ? ` · Seats ${listing.seats}` : ''}
          {listing.quantity > 1 ? ` · ${listing.quantity} tickets` : ''}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <span className="font-bold text-lg" style={{ color: 'var(--ev-text)' }}>${listing.asking_price}</span>
        {listing.original_price && listing.original_price > listing.asking_price && (
          <span className="text-xs line-through" style={{ color: 'var(--ev-text-muted)' }}>${listing.original_price}</span>
        )}
      </div>

      {sold ? (
        <div className="text-xs font-semibold py-2 text-center rounded-xl"
          style={{ color: 'var(--ev-text-muted)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--ev-border)' }}>
          Sold
        </div>
      ) : reservedByOther ? (
        <div className="flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-xl"
          style={{ color: 'var(--ev-text-muted)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--ev-border)' }}>
          <Clock className="w-3.5 h-3.5" /> Reserved
        </div>
      ) : transferDisabled ? (
        <div className="text-xs font-semibold py-2 text-center rounded-xl"
          style={{ color: 'var(--ev-text-muted)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--ev-border)' }}>
          Unavailable
        </div>
      ) : reservedByMe ? (
        <button onClick={() => onView?.(listing)}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95"
          style={{ background: 'var(--ev-teal-soft)', color: 'var(--ev-teal)', border: '1px solid var(--ev-teal-border)' }}>
          <Clock className="w-3.5 h-3.5" /> Reserved for you
        </button>
      ) : (
        <button onClick={() => onView?.(listing)}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95"
          style={{ background: 'transparent', color: 'var(--ev-teal)', border: '1px solid var(--ev-teal-border)' }}>
          View <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}