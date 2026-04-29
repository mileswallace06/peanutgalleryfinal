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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="font-bold text-base">Open a Dispute</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            Opening a dispute will <strong>freeze the payout</strong> immediately. Our team will review and resolve within 24–48 hours.
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold mb-2">What went wrong?</label>
            <div className="space-y-2">
              {DISPUTE_CATEGORIES.map(c => (
                <label key={c.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  category === c.value
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-border hover:border-amber-300 hover:bg-amber-50/50'
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
              className="flex-1 border border-border py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!category || loading}
              className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-amber-600 transition-colors disabled:opacity-50"
            >
              {loading ? 'Submitting…' : 'Submit Dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}