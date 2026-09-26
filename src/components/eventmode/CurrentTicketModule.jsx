import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import EventThumbnail from '@/components/events/EventThumbnail';

/**
 * CurrentTicketModule — resolves the logged-in user's current seat for this
 * event and presents it as a personal "YOUR TICKET" module.
 *
 * Resolution order:
 *   1. Most recent completed Purchase for this event → its Listing
 *   2. SeatInventory owned by the user for this event (fallback)
 *
 * Only shows a verified/confirmed status line when the underlying data
 * genuinely supports it (ownership_verified or transfer_status === 'transfer_confirmed').
 * Renders nothing when the user does not own a ticket for the event.
 */
function resolveStatus(listing, seatInv) {
  if (seatInv?.ownership_verified) return { label: 'Ownership verified', tone: 'verified' };
  if (listing?.transfer_status === 'transfer_confirmed') return { label: 'Transfer confirmed', tone: 'verified' };
  if (listing?.transfer_status === 'transfer_unconfirmed') return { label: 'Transfer pending', tone: 'pending' };
  return null;
}

export default function CurrentTicketModule({ event, user }) {
  const [seat, setSeat] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!event?.id || !user?.email) { setLoading(false); return; }

    (async () => {
      try {
        const purchaseRes = await base44.functions.invoke('getPurchaseParticipantView', {
          action: 'list_mine', perspective: 'buyer', event_id: event.id,
        });
        if (cancelled) return;
        const purchases = purchaseRes?.data?.purchases || [];
        const sorted = [...purchases].sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
        const completed = sorted.find(p => p.transfer_status === 'completed')
          || sorted.find(p => p.transfer_status !== 'disputed');

        if (completed?.listing_id) {
          const lres = await base44.functions.invoke('getListingParticipantView', {
            listing_id: completed.listing_id,
          });
          if (cancelled) return;
          const listing = lres?.data?.listing || null;
          if (listing?.section) {
            setSeat({
              section: listing.section,
              row: listing.row,
              seats: listing.seats,
              quantity: completed.quantity || listing.quantity || 1,
              listing,
              seatInv: null,
              status: resolveStatus(listing, null),
            });
            if (!cancelled) setLoading(false);
            return;
          }
        }

        // Fallback: SeatInventory ownership record
        const inv = await base44.entities.SeatInventory.filter({ event_id: event.id, owner_email: user.email });
        if (cancelled) return;
        const si = (inv || [])[0];
        if (si?.section) {
          setSeat({
            section: si.section,
            row: si.row,
            seats: si.seats,
            quantity: si.quantity || 1,
            listing: null,
            seatInv: si,
            status: resolveStatus(null, si),
          });
        }
      } catch (_) { /* silent — module simply omits itself */ }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [event?.id, user?.email]);

  if (loading || !seat) return null;

  return (
    <section className="pg-current-seat" aria-label="Your ticket">
      <div className="pg-ticket pg-current-seat-ticket">
        <div className="pg-current-seat-copy">
          <p className="pg-ticket-label">Your seat</p>
          <h2>Sec {seat.section}{seat.row ? ` · Row ${seat.row}` : ''}</h2>
          <p>{seat.seats ? `Seats ${seat.seats} · ` : ''}{seat.quantity > 1 ? `${seat.quantity} tickets` : '1 ticket'}</p>
          {seat.status && <p className={`pg-current-seat-status pg-current-seat-status-${seat.status.tone}`}>{seat.status.label}</p>}
        </div>
        <EventThumbnail event={event} className="pg-current-seat-art" />
      </div>
    </section>
  );
}
