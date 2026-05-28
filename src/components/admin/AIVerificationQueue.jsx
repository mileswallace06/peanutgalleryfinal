import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Brain, CheckCircle, XCircle, AlertTriangle, ExternalLink, ChevronDown, ChevronUp, Flag, ShieldCheck, ShieldAlert, Clock } from 'lucide-react';

const STATUS_CONFIG = {
  verified_high_confidence:   { label: 'Verified ✓',       color: '#00FF87', bg: 'rgba(0,255,135,0.1)',   border: 'rgba(0,255,135,0.3)',  icon: ShieldCheck },
  verified_medium_confidence: { label: 'Likely Valid',      color: '#00C8FF', bg: 'rgba(0,200,255,0.1)',   border: 'rgba(0,200,255,0.3)',  icon: ShieldCheck },
  needs_human_review:         { label: 'Needs Review',      color: '#FF8C00', bg: 'rgba(255,140,0,0.1)',   border: 'rgba(255,140,0,0.3)',  icon: Clock },
  rejected_suspicious:        { label: '🚨 Suspicious',     color: '#FF2D78', bg: 'rgba(255,45,120,0.1)',  border: 'rgba(255,45,120,0.35)', icon: ShieldAlert },
  processing:                 { label: 'Processing…',       color: '#BF5FFF', bg: 'rgba(191,95,255,0.1)',  border: 'rgba(191,95,255,0.3)', icon: Brain },
  failed_processing:          { label: 'Processing Failed', color: '#FFE600', bg: 'rgba(255,230,0,0.1)',   border: 'rgba(255,230,0,0.3)',  icon: AlertTriangle },
  pending:                    { label: 'Not Yet Analyzed',  color: '#888',    bg: 'rgba(255,255,255,0.04)',border: 'rgba(255,255,255,0.1)', icon: Clock },
};

const PLATFORM_ICONS = {
  ticketmaster: '🎟',
  seatgeek: '🟢',
  axs: '🔵',
  stubhub: '🟠',
  apple_wallet: '🍎',
  vivid: '🟣',
  screenshot_unknown: '❓',
  other: '📸',
};

function ConfidenceBar({ score }) {
  const color = score >= 90 ? '#00FF87' : score >= 70 ? '#00C8FF' : score >= 40 ? '#FF8C00' : '#FF2D78';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-bold w-10 text-right" style={{ color }}>{score}/100</span>
    </div>
  );
}

function AIVerificationCard({ purchase, event, listing, onOverride, actionLoading }) {
  const [expanded, setExpanded] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);

  const status = purchase.ai_proof_status || 'pending';
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const score = purchase.ai_confidence_score ?? null;

  const handleOverride = async (action) => {
    if (!overrideReason.trim()) return;
    await onOverride(purchase.id, action, overrideReason.trim());
    setShowOverride(false);
    setOverrideReason('');
  };

  return (
    <div className="rounded-xl text-sm space-y-3" style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, padding: '16px' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">{event?.title || purchase.event_id}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Seller: {purchase.seller_email} · Buyer: {purchase.buyer_email}
          </div>
          <div className="text-xs text-muted-foreground">
            ${purchase.amount?.toFixed(2)} · {purchase.ai_processed_at ? format(new Date(purchase.ai_processed_at), 'MMM d h:mm a') : 'Not processed'}
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0"
          style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
          <Icon className="w-3 h-3" /> {cfg.label}
        </div>
      </div>

      {/* Score bar */}
      {score !== null && (
        <div>
          <div className="text-xs text-muted-foreground mb-1 font-medium">AI Confidence</div>
          <ConfidenceBar score={score} />
        </div>
      )}

      {/* Fraud risk */}
      {purchase.fraud_risk_score > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <Flag className="w-3 h-3 text-destructive flex-shrink-0" />
          <span className="text-muted-foreground">Fraud Risk:</span>
          <span className="font-bold" style={{ color: purchase.fraud_risk_score >= 60 ? '#FF2D78' : purchase.fraud_risk_score >= 30 ? '#FF8C00' : '#FFE600' }}>
            {purchase.fraud_risk_score}/100
          </span>
        </div>
      )}

      {/* Platform + summary */}
      {purchase.ai_review_notes && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {purchase.ai_detected_platform && purchase.ai_detected_platform !== 'screenshot_unknown' && (
            <span className="mr-1">{PLATFORM_ICONS[purchase.ai_detected_platform] || '📸'}</span>
          )}
          {purchase.ai_review_notes}
        </div>
      )}

      {/* Flags */}
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

      {/* Admin override indicator */}
      {purchase.admin_override_status && (
        <div className="text-xs rounded-lg px-3 py-2 flex items-center gap-2"
          style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.3)' }}>
          <ShieldCheck className="w-3 h-3" style={{ color: '#BF5FFF' }} />
          <span style={{ color: '#BF5FFF' }}>Admin override: <strong>{purchase.admin_override_status}</strong></span>
          {purchase.admin_override_reason && <span className="text-muted-foreground">— {purchase.admin_override_reason}</span>}
        </div>
      )}

      {/* Expand/collapse extracted data */}
      <button onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? 'Hide extracted data' : 'Show extracted data'}
      </button>

      {expanded && (
        <div className="rounded-lg p-3 space-y-2 text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Platform',   purchase.ai_detected_platform],
              ['Event',      purchase.ai_extracted_event_name],
              ['Recipient',  purchase.ai_extracted_recipient],
              ['Section',    purchase.ai_extracted_section],
              ['Row',        purchase.ai_extracted_row],
              ['Seats',      purchase.ai_extracted_seats],
              ['Transfer Time', purchase.ai_extracted_transfer_time],
            ].map(([label, val]) => val ? (
              <div key={label}>
                <div className="text-muted-foreground font-medium">{label}</div>
                <div className="text-foreground font-mono text-[10px] truncate">{val}</div>
              </div>
            ) : null)}
          </div>
          {purchase.ai_processed_by_model && (
            <div className="text-muted-foreground text-[10px] pt-1 border-t border-white/5">
              Model: {purchase.ai_processed_by_model}
            </div>
          )}
        </div>
      )}

      {/* Proof screenshot link */}
      {purchase.transfer_proof_url && (
        <a href={purchase.transfer_proof_url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
          style={{ color: '#BF5FFF' }}>
          <ExternalLink className="w-3 h-3" /> View proof screenshot
        </a>
      )}

      {/* Admin actions */}
      <div className="pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {!showOverride ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setSelectedAction('approved'); setShowOverride(true); }}
              disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'rgba(0,255,135,0.1)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
              <CheckCircle className="w-3 h-3" /> Approve
            </button>
            <button onClick={() => { setSelectedAction('rejected'); setShowOverride(true); }}
              disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'rgba(0,200,255,0.1)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
              <XCircle className="w-3 h-3" /> Reject
            </button>
            <button onClick={() => { setSelectedAction('escalated'); setShowOverride(true); }}
              disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'rgba(255,230,0,0.1)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
              <AlertTriangle className="w-3 h-3" /> Escalate
            </button>
            <button onClick={() => { setSelectedAction('marked_fraudulent'); setShowOverride(true); }}
              disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'rgba(255,45,120,0.1)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.3)' }}>
              <Flag className="w-3 h-3" /> Mark Fraud
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs font-semibold" style={{ color: selectedAction === 'approved' ? '#00FF87' : selectedAction === 'marked_fraudulent' ? '#FF2D78' : '#FFE600' }}>
              Override: {selectedAction} — reason required
            </div>
            <textarea
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              placeholder="Enter reason for override…"
              rows={2}
              className="w-full px-3 py-2 text-xs text-foreground rounded-lg resize-none focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
            />
            <div className="flex gap-2">
              <button onClick={() => handleOverride(selectedAction)}
                disabled={!overrideReason.trim() || !!actionLoading}
                className="flex-1 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
                style={{ background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
                {actionLoading === purchase.id ? 'Saving…' : 'Submit Override'}
              </button>
              <button onClick={() => { setShowOverride(false); setOverrideReason(''); }}
                className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AIVerificationQueue({ purchases, events, listings, onRefresh }) {
  const [actionLoading, setActionLoading] = useState('');
  const [filter, setFilter] = useState('needs_human_review');

  // Purchases that have a proof URL and some AI status
  const verifiedPurchases = purchases.filter(p =>
    p.transfer_proof_url && p.ai_proof_status && p.ai_proof_status !== 'pending'
  );

  const filtered = (filter === 'all' ? verifiedPurchases : verifiedPurchases.filter(p => p.ai_proof_status === filter))
    .sort((a, b) => {
      // Prioritize unreviewed items
      const aReviewed = !!a.admin_override_status;
      const bReviewed = !!b.admin_override_status;
      if (aReviewed !== bReviewed) return aReviewed ? 1 : -1;
      return new Date(b.ai_processed_at || 0) - new Date(a.ai_processed_at || 0);
    });

  // Stats
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const stats = {
    total: verifiedPurchases.length,
    high: verifiedPurchases.filter(p => p.ai_proof_status === 'verified_high_confidence').length,
    medium: verifiedPurchases.filter(p => p.ai_proof_status === 'verified_medium_confidence').length,
    review: verifiedPurchases.filter(p => p.ai_proof_status === 'needs_human_review').length,
    suspicious: verifiedPurchases.filter(p => p.ai_proof_status === 'rejected_suspicious').length,
    failed: verifiedPurchases.filter(p => p.ai_proof_status === 'failed_processing').length,
    processing: purchases.filter(p => p.ai_proof_status === 'processing').length,
    verifiedToday: verifiedPurchases.filter(p =>
      p.ai_processed_at && new Date(p.ai_processed_at) >= todayStart &&
      (p.ai_proof_status === 'verified_high_confidence' || p.ai_proof_status === 'verified_medium_confidence')
    ).length,
    overridden: verifiedPurchases.filter(p => p.admin_override_status).length,
    needsAttention: verifiedPurchases.filter(p =>
      ['needs_human_review', 'rejected_suspicious', 'failed_processing'].includes(p.ai_proof_status) && !p.admin_override_status
    ).length,
  };

  const handleOverride = async (purchaseId, action, reason) => {
    setActionLoading(purchaseId);
    await base44.functions.invoke('adminOverrideAIVerification', { purchase_id: purchaseId, action, reason });
    await onRefresh();
    setActionLoading('');
  };

  const FILTER_TABS = [
    { key: 'needs_human_review',        label: `Needs Review (${stats.review})`,    color: '#FF8C00' },
    { key: 'rejected_suspicious',       label: `Suspicious (${stats.suspicious})`,  color: '#FF2D78' },
    { key: 'failed_processing',         label: `Failed (${stats.failed})`,          color: '#FFE600' },
    { key: 'all',                       label: `All (${stats.total})` },
    { key: 'verified_high_confidence',  label: `Verified (${stats.high})`,          color: '#00FF87' },
    { key: 'verified_medium_confidence',label: `Likely Valid (${stats.medium})`,    color: '#00C8FF' },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-5">
        <Brain className="w-5 h-5" style={{ color: '#BF5FFF' }} />
        <h2 className="font-bold text-lg text-foreground">AI Transfer Verification Queue</h2>
        {stats.suspicious > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,45,120,0.15)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.35)' }}>
            {stats.suspicious} suspicious
          </span>
        )}
      </div>

      {/* Operational metrics */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Needs Attention', value: stats.needsAttention, color: '#FF8C00' },
          { label: 'Suspicious',      value: stats.suspicious,     color: '#FF2D78' },
          { label: 'Failed',          value: stats.failed,         color: '#FFE600' },
          { label: 'Verified Today',  value: stats.verifiedToday,  color: '#00FF87' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${s.value > 0 && s.color !== '#00FF87' ? s.color + '40' : 'rgba(255,255,255,0.08)'}` }}>
            <div className="text-xl font-black" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
      {/* Secondary metrics row */}
      <div className="flex gap-3 text-xs text-muted-foreground mb-5 flex-wrap">
        <span>Total processed: <strong className="text-foreground">{stats.total}</strong></span>
        {stats.processing > 0 && <span style={{ color: '#BF5FFF' }}>⏳ {stats.processing} processing now</span>}
        {stats.overridden > 0 && <span>Admin overridden: <strong className="text-foreground">{stats.overridden}</strong></span>}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap mb-4">
        {FILTER_TABS.map(tab => (
          <button key={tab.key}
            onClick={() => setFilter(tab.key)}
            className="text-xs px-2.5 py-1 rounded-lg transition-all"
            style={filter === tab.key
              ? { background: tab.color ? `${tab.color}20` : 'rgba(255,255,255,0.12)', color: tab.color || 'hsl(var(--foreground))', border: `1px solid ${tab.color || 'rgba(255,255,255,0.25)'}` }
              : { background: 'rgba(255,255,255,0.04)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.08)' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No AI-verified transfers in this category.</p>
      ) : (
        <div className="space-y-4">
          {filtered.map(p => (
            <AIVerificationCard
              key={p.id}
              purchase={p}
              event={events[p.event_id]}
              listing={listings?.find(l => l.id === p.listing_id)}
              onOverride={handleOverride}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}