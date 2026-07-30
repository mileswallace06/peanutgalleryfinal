import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Ticket } from 'lucide-react';

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
    <section className="px-4 mt-5" style={{ marginBottom: 'var(--ev-gap)' }}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="h-3.5 w-1 rounded-full" style={{ background: 'var(--ev-teal)' }} />
        <h2 className="font-display uppercase tracking-wide" style={{ color: 'var(--ev-text)', fontSize: '1.05rem' }}>
          Your Ticket
        </h2>
      </div>

      <div className="rounded-2xl p-4 flex items-center gap-4"
        style={{ background: 'var(--ev-surface)', border: '1px solid var(--ev-border)' }}>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--ev-teal-soft)', border: '1px solid var(--ev-teal-border)' }}>
          <Ticket className="w-5 h-5" style={{ color: 'var(--ev-teal)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold leading-tight" style={{ color: 'var(--ev-text)', fontSize: '1.1rem' }}>
            Section {seat.section}{seat.row ? ` · Row ${seat.row}` : ''}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ev-text-2)' }}>
            {seat.seats ? `Seats ${seat.seats} · ` : ''}{seat.quantity > 1 ? `${seat.quantity} tickets` : '1 ticket'}
          </div>
          {seat.status && (
            <div className="text-[11px] font-semibold mt-1.5"
              style={{ color: seat.status.tone === 'verified' ? 'var(--ev-teal)' : 'var(--ev-text-muted)' }}>
              {seat.status.label}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}