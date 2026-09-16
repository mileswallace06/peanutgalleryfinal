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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispute-modal-title"
        className="rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col text-foreground"
        style={{
          background: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 1.5rem)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 id="dispute-modal-title" className="font-bold text-base text-foreground">Open a Dispute</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dispute form" className="w-10 h-10 -mr-2 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto overscroll-contain">
          <div className="rounded-xl p-3 text-xs leading-relaxed"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: 'hsl(var(--foreground))' }}>
            Opening a dispute will <strong>freeze the payout</strong> immediately. Our team will review and resolve within 24–48 hours.
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold mb-2">What went wrong?</label>
            <div className="space-y-2">
              {DISPUTE_CATEGORIES.map(c => (
                <label key={c.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  category === c.value
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-border hover:border-amber-400/60 hover:bg-amber-500/5'
                }`}>
                  <input
                    type="radio"
                    name="category"
                    value={c.value}
                    checked={category === c.value}
                    onChange={() => setCategory(c.value)}
                    className="accent-amber-500"
                  />
                  <span className="text-sm text-foreground">{c.label}</span>
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
              className="w-full px-3 py-2 text-sm rounded-xl border border-border bg-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-none"
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
              className="flex-1 bg-amber-500 text-[#0D0B14] py-2.5 rounded-xl text-sm font-bold hover:bg-amber-400 transition-colors disabled:opacity-50"
            >
              {loading ? 'Submitting…' : 'Submit Dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
