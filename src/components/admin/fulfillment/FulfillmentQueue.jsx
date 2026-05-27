/**
 * FulfillmentQueue — renders a labeled section of the fulfillment center
 * with sortable items.
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import FulfillmentItem from './FulfillmentItem';

export default function FulfillmentQueue({ title, icon, items, listings, purchases, events, onRefresh, adminEmail, defaultOpen = true, accentColor = '#00C8FF' }) {
  const [open, setOpen] = useState(defaultOpen);
  const [sortBy, setSortBy] = useState('urgency');

  if (items.length === 0 && !defaultOpen) return null;

  const sorted = [...items].sort((a, b) => {
    if (sortBy === 'urgency') {
      const order = { critical: 0, high: 1, medium: 2, low: 3, ended: 4 };
      const aListing = listings.find(l => l.id === a.listing_id) || a;
      const bListing = listings.find(l => l.id === b.listing_id) || b;
      const aEvent = events[a.event_id || aListing.event_id];
      const bEvent = events[b.event_id || bListing.event_id];
      const aDate = aEvent?.event_start_utc || aEvent?.date;
      const bDate = bEvent?.event_start_utc || bEvent?.date;
      const aMs = aDate ? new Date(aDate).getTime() - Date.now() : Infinity;
      const bMs = bDate ? new Date(bDate).getTime() - Date.now() : Infinity;
      return aMs - bMs;
    }
    if (sortBy === 'price') return (b.asking_price || 0) - (a.asking_price || 0);
    return 0;
  });

  return (
    <div className="mb-5">
      {/* Section header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 mb-2 text-left"
      >
        <span className="text-base">{icon}</span>
        <h3 className="font-black text-sm tracking-wide uppercase" style={{ color: accentColor }}>{title}</h3>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full ml-1"
          style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}44` }}>
          {items.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {open && (
            <select
              value={sortBy}
              onChange={e => { e.stopPropagation(); setSortBy(e.target.value); }}
              onClick={e => e.stopPropagation()}
              className="text-[10px] px-2 py-1 rounded-lg focus:outline-none"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
            >
              <option value="urgency">Sort: Urgency</option>
              <option value="price">Sort: Price</option>
            </select>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        items.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">None</p>
        ) : (
          <div className="space-y-2">
            {sorted.map(item => {
              // item could be a listing (inventory sections) or a purchase (sold sections)
              const isListing = !item.listing_id;
              const listing = isListing ? item : listings.find(l => l.id === item.listing_id);
              const purchase = isListing ? purchases.find(p => p.listing_id === item.id && p.transfer_status === 'pending_transfer') : item;
              const eventId = listing?.event_id || item.event_id;
              const event = events[eventId];

              if (!listing) return null;

              return (
                <FulfillmentItem
                  key={item.id}
                  listing={listing}
                  purchase={purchase || null}
                  event={event}
                  onRefresh={onRefresh}
                  adminEmail={adminEmail}
                />
              );
            })}
          </div>
        )
      )}
    </div>
  );
}