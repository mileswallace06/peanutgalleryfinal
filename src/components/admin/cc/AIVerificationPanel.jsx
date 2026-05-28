import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Brain, CheckCircle, XCircle, AlertTriangle, ExternalLink, Flag, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';

const STATUS_CONFIG = {
  verified_high_confidence:   { label: 'Verified ✓',       color: '#00FF87', bg: 'rgba(0,255,135,0.08)',   border: 'rgba(0,255,135,0.25)' },
  verified_medium_confidence: { label: 'Likely Valid',      color: '#00C8FF', bg: 'rgba(0,200,255,0.08)',   border: 'rgba(0,200,255,0.25)' },
  needs_human_review:         { label: 'Needs Review',      color: '#FF8C00', bg: 'rgba(255,140,0,0.08)',   border: 'rgba(255,140,0,0.3)' },
  rejected_suspicious:        { label: '🚨 Suspicious',     color: '#FF2D78', bg: 'rgba(255,45,120,0.08)',  border: 'rgba(255,45,120,0.35)' },
  failed_processing:          { label: 'Failed',            color: '#FFE600', bg: 'rgba(255,230,0,0.08)',   border: 'rgba(255,230,0,0.3)' },
  processing:                 { label: 'Processing…',       color: '#BF5FFF', bg: 'rgba(191,95,255,0.08)',  border: 'rgba(191,95,255,0.3)' },
  pending:                    { label: 'Pending',           color: '#888',    bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.1)' },
};

const FILTER_TABS = [
  { key: 'needs_human_review',   label: 'Needs Review' },
  { key: 'rejected_suspicious',  label: 'Suspicious' },
  { key: 'failed_processing',    label: 'Failed' },
  { key: 'all',                  label: 'All' },
  { key: 'verified_high_confidence', label: 'Verified' },
];

function AICard({ purchase, event, onOverride }) {
  const [showAction, setShowAction] = useState(false);
  const [selectedAction, setSelectedAction] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const status = purchase.ai_proof_status || 'pending';
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const score = purchase.ai_confidence_score ?? null;

  const submit = async () => {
    if (!reason.trim()) return;
    setLoading(true);
    await base44.functions.invoke('adminOverrideAIVerification', { purchase_id: purchase.id, action: selectedAction, reason: reason.trim() });
    await onOverride();
    setLoading(false);
    setShowAction(false);
    setReason('');
  };

  return (
    <div className="rounded-xl p-4 text-sm space-y-3" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">{event?.title || purchase.event_id}</div>
          <div className="text-xs text-muted-foreground">Seller: {purchase.seller_email}</div>
          <div className="text-xs text-muted-foreground">${purchase.amount?.toFixed(2)} · {purchase.ai_processed_at ? format(new Date(purchase.ai_processed_at), 'MMM d h:mm a') : '—'}</div>
        </div>
        <span className="text-xs font-bold px-2 py-1 rounded-full flex-shrink-0"
          style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
          {cfg.label}
        </span>
      </div>

      {score !== null && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <div className="h-full rounded-full" style={{ width: `${score}%`, background: score >= 80 ? '#00FF87' : score >= 50 ? '#FF8C00' : '#FF2D78' }} />
          </div>
          <span className="text-xs font-bold w-12 text-right" style={{ color: score >= 80 ? '#00FF87' : score >= 50 ? '#FF8C00' : '#FF2D78' }}>{score}/100</span>
        </div>
      )}

      {purchase.ai_review_notes && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {purchase.ai_review_notes}
        </div>
      )}

      {purchase.ai_flags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {purchase.ai_flags.map((flag, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
              {flag}
            </span>
          ))}
        </div>
      )}

      {purchase.admin_override_status && (
        <div className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(191,95,255,0.1)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
          Admin override: <strong>{purchase.admin_override_status}</strong>
          {purchase.admin_override_reason && <span className="text-muted-foreground"> — {purchase.admin_override_reason}</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {purchase.transfer_proof_url && (
          <a href={purchase.transfer_proof_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'rgba(191,95,255,0.1)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
            <ExternalLink className="w-3 h-3" /> View Proof
          </a>
        )}
        {!purchase.admin_override_status && (
          <>
            {[
              { action: 'approved',          label: 'Approve',    color: '#00FF87' },
              { action: 'rejected',          label: 'Reject',     color: '#FF8C00' },
              { action: 'marked_fraudulent', label: 'Mark Fraud', color: '#FF2D78' },
            ].map(({ action, label, color }) => (
              <button key={action}
                onClick={() => { setSelectedAction(action); setShowAction(true); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: `${color}15`, color, border: `1px solid ${color}40` }}>
                {label}
              </button>
            ))}
          </>
        )}
      </div>

      {showAction && (
        <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="text-xs font-semibold text-muted-foreground">Reason for override (required):</div>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            rows={2} placeholder="Enter reason…"
            className="w-full px-3 py-2 text-xs text-foreground rounded-lg resize-none focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }} />
          <div className="flex gap-2">
            <button onClick={submit} disabled={!reason.trim() || loading}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
              style={{ background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
              {loading ? 'Saving…' : 'Confirm Override'}
            </button>
            <button onClick={() => { setShowAction(false); setReason(''); }}
              className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AIVerificationPanel({ purchases, listings, events, onRefresh }) {
  const [filter, setFilter] = useState('needs_human_review');

  const withProof = purchases.filter(p => p.transfer_proof_url && p.ai_proof_status && p.ai_proof_status !== 'pending');
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const stats = {
    high: withProof.filter(p => p.ai_proof_status === 'verified_high_confidence').length,
    medium: withProof.filter(p => p.ai_proof_status === 'verified_medium_confidence').length,
    review: withProof.filter(p => p.ai_proof_status === 'needs_human_review').length,
    suspicious: withProof.filter(p => p.ai_proof_status === 'rejected_suspicious').length,
    failed: withProof.filter(p => p.ai_proof_status === 'failed_processing').length,
    processing: purchases.filter(p => p.ai_proof_status === 'processing').length,
  };

  const filtered = (filter === 'all' ? withProof : withProof.filter(p => p.ai_proof_status === filter))
    .sort((a, b) => {
      const aRev = !!a.admin_override_status;
      const bRev = !!b.admin_override_status;
      if (aRev !== bRev) return aRev ? 1 : -1;
      return new Date(b.ai_processed_at || 0) - new Date(a.ai_processed_at || 0);
    });

  return (
    <div className="space-y-5">
      <h2 className="font-bold text-foreground text-lg">AI Verification</h2>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {[
          { label: 'Verified', value: stats.high,        color: '#00FF87' },
          { label: 'Likely OK', value: stats.medium,     color: '#00C8FF' },
          { label: 'Review', value: stats.review,        color: '#FF8C00' },
          { label: 'Suspicious', value: stats.suspicious,color: '#FF2D78' },
          { label: 'Failed', value: stats.failed,        color: '#FFE600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="text-xl font-black" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_TABS.map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold transition-all"
            style={filter === tab.key
              ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
              : { background: 'rgba(255,255,255,0.06)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.1)' }}>
            {tab.label} ({tab.key === 'all' ? withProof.length : (stats[{ needs_human_review: 'review', rejected_suspicious: 'suspicious', failed_processing: 'failed', verified_high_confidence: 'high' }[tab.key]] ?? 0)})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">No items in this category.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => (
            <AICard key={p.id} purchase={p} event={events[p.event_id]} onOverride={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}