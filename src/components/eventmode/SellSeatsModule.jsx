import { Link } from 'react-router-dom';
import { Tag, ArrowRight } from 'lucide-react';
import { listingEventEligibility } from '../../../base44/shared/listingEventEligibility.js';

/**
 * SellSeatsModule — calm invitation to list seats through the existing
 * create-listing flow. No time promises.
 */
export default function SellSeatsModule({ event, nowMs = Date.now() }) {
  if (!listingEventEligibility(event, nowMs).allowed) return null;
  return (
    <section className="pg-live-sell">
      <Tag size={22} aria-hidden="true" />
      <div><h2>Leaving early?</h2><p>List your seats through Peanut Gallery.</p></div>
      <Link to={`/create-listing?event_id=${event?.id || ''}`} className="pg-action">List seats<ArrowRight size={17} /></Link>
    </section>
  );
}
