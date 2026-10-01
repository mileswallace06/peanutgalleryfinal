import '@/components/member-surfaces.css';
import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const DISPUTE_CATEGORIES = [
  { value: 'never_received', label: 'Never received tickets' },
  { value: 'wrong_tickets', label: 'Wrong tickets (different event/section)' },
  { value: 'invalid_tickets', label: 'Invalid or already-used tickets' },
  { value: 'seller_unresponsive', label: 'Seller unresponsive' },
  { value: 'other', label: 'Other' },
];

export default function DisputeModal({ onSubmit, onClose, loading }) {
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!category) return;
    onSubmit({ category, details: details.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="pg-member-sheet pg-member-sheet--dispute shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="pg-member-sheet-title text-xl">Open a Dispute</h2>
          </div>
          <button onClick={onClose} aria-label="Close dispute dialog" className="pg-member-close text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="pg-member-dispute-note rounded-lg p-3 text-sm">
            Opening a dispute will <strong>freeze the payout</strong> immediately. Our team will review and resolve within 24–48 hours.
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold mb-2">What went wrong?</label>
            <div className="space-y-2">
              {DISPUTE_CATEGORIES.map(c => (
                <label key={c.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  category === c.value
                    ? 'pg-member-dispute-option is-selected'
                    : 'pg-member-dispute-option'
                }`}>
                  <input
                    type="radio"
                    name="category"
                    value={c.value}
                    checked={category === c.value}
                    onChange={() => setCategory(c.value)}
                    className="accent-amber-500"
                  />
                  <span className="text-sm">{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Details */}
          <div>
            <label className="block text-sm font-semibold mb-1">
              Additional details <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder="Describe what happened…"
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="pg-member-action pg-member-action--secondary flex-1 py-2.5 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!category || loading}
              className="pg-member-action pg-member-action--warning flex-1 py-2.5 text-sm font-bold transition-colors disabled:opacity-50"
            >
              {loading ? 'Submitting…' : 'Submit Dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
