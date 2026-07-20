import { Link } from 'react-router-dom';
import { Tag, ArrowRight } from 'lucide-react';

/**
 * SellSeatsModule — calm invitation to list seats through the existing
 * create-listing flow. No time promises.
 */
export default function SellSeatsModule({ event }) {
  return (
    <section style={{ marginTop: 'var(--ev-gap)' }}>
      <div className="rounded-2xl p-5 flex items-center gap-4"
        style={{ background: 'var(--ev-surface)', border: '1px solid var(--ev-border)' }}>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ev-border)' }}>
          <Tag className="w-5 h-5" style={{ color: 'var(--ev-text-2)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm" style={{ color: 'var(--ev-text)' }}>Want to sell your seats?</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ev-text-2)' }}>
            List your seats through the Peanut Gallery marketplace.
          </p>
        </div>
        <Link to={`/create-listing?event_id=${event?.id || ''}`}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold flex-shrink-0 transition-all active:scale-95"
          style={{ background: 'transparent', color: 'var(--ev-teal)', border: '1px solid var(--ev-teal-border)' }}>
          List seats <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </section>
  );
}