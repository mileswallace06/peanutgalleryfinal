import { ArrowRight, Clock } from 'lucide-react';
import EventThumbnail from '@/components/events/EventThumbnail';
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
export default function MoveCloserListing({ listing, event, accent = 'mint', currentUserEmail, onView }) {
  if (!listing) return null;

  const tierLabel = TIER_LABELS[listing.tier] || 'Available upgrade';
  const sold = isSold(listing);
  const reservedByOther = isReservedByOther(listing, currentUserEmail);
  const reservedByMe = isReservedByMe(listing, currentUserEmail);
  const transferDisabled = listing.transfer_status === 'transfer_disabled';
  const canView = !sold && !reservedByOther && !transferDisabled;

  return (
    <article className={`pg-ticket pg-seat-offer pg-seat-offer-${accent}`}>
      <EventThumbnail event={event || {}} className="pg-seat-offer-art" />
      <div className="pg-seat-offer-copy">
        <p className="pg-ticket-label">{tierLabel}{listing.is_instant_ready ? ' · Instant' : ''}</p>
        <h3>Section {listing.section}</h3>
        <p>Row {listing.row}{listing.seats ? ` · Seats ${listing.seats}` : ''}</p>
        {listing.quantity > 1 && <p>{listing.quantity} tickets</p>}
      </div>
      <div className="pg-ticket-end pg-seat-offer-action">
        <div className="pg-seat-offer-price"><strong>${listing.asking_price}</strong><span>/ seat</span>
          {listing.original_price && listing.original_price > listing.asking_price ? <del>${listing.original_price}</del> : null}
        </div>
        {sold ? <span className="pg-seat-offer-status">Sold</span>
          : reservedByOther ? <span className="pg-seat-offer-status"><Clock size={14} />Reserved</span>
          : transferDisabled ? <span className="pg-seat-offer-status">Unavailable</span>
          : reservedByMe ? <span className="pg-seat-offer-view pg-seat-offer-reserved"><Clock size={14} /><span>Reserved for you</span></span>
          : <span className="pg-seat-offer-view">View<ArrowRight size={16} /></span>}
      </div>
      {canView && <button
        type="button"
        className="absolute inset-0 z-10 h-full w-full bg-transparent"
        style={{ borderRadius: 'inherit', outlineOffset: '-3px' }}
        aria-label={`${reservedByMe ? 'Reserved for you. View' : 'View'} ${tierLabel}, section ${listing.section}, row ${listing.row}${listing.seats ? `, seats ${listing.seats}` : ''}, $${listing.asking_price} per seat`}
        onClick={() => { if (canView) onView?.(listing); }}
      />}
    </article>
  );
}
