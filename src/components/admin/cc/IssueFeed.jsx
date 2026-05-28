import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle, XCircle, ExternalLink, FileText, Flag, Eye, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';

// Build the issue list from raw data
function buildIssues(purchases, listings, donations, events) {
  const issues = [];
  const now = new Date();

  // DISPUTES
  purchases.filter(p => p.transfer_status === 'disputed').forEach(p => {
    issues.push({
      id: `dispute-${p.id}`,
      type: 'DISPUTE_OPENED',
      severity: 'critical',
      title: 'Dispute Opened',
      description: `Buyer ${p.buyer_email} disputed — "${p.dispute_reason || 'No reason given'}"`,
      purchase: p,
      event: events[p.event_id],
      timestamp: p.updated_date || p.created_date,
      recommended: 'Review proof, contact both parties, then refund or release.',
      actions: ['refund_buyer', 'release_seller', 'strike_seller'],
    });
  });

  // FAILED CAPTURES
  purchases.filter(p => p.payment_capture_failed).forEach(p => {
    issues.push({
      id: `capture-${p.id}`,
      type: 'PAYMENT_CAPTURE_FAILED',
      severity: 'critical',
      title: 'Payment Capture Failed',
      description: `Stripe capture failed for $${p.amount?.toFixed(2)} — buyer ${p.buyer_email}`,
      purchase: p,
      event: events[p.event_id],
      timestamp: p.updated_date || p.created_date,
      recommended: 'Retry capture in Stripe or refund buyer. Check Stripe logs.',
      actions: ['view_stripe', 'refund_buyer'],
    });
  });

  // SUSPICIOUS AI PROOFS
  purchases.filter(p => p.ai_proof_status === 'rejected_suspicious' && !p.admin_override_status).forEach(p => {
    issues.push({
      id: `suspicious-${p.id}`,
      type: 'AI_PROOF_SUSPICIOUS',
      severity: 'critical',
      title: 'Suspicious Transfer Proof',
      description: `AI flagged proof as suspicious — fraud risk ${p.fraud_risk_score ?? '?'}/100. Seller: ${p.seller_email}`,
      purchase: p,
      event: events[p.event_id],
      timestamp: p.ai_processed_at || p.updated_date,
      recommended: 'View screenshot, review flags, then approve, reject, or mark fraudulent.',
      actions: ['view_proof', 'approve_ai', 'reject_ai', 'mark_fraud'],
    });
  });

  // AI NEEDS REVIEW
  purchases.filter(p => p.ai_proof_status === 'needs_human_review' && !p.admin_override_status).forEach(p => {
    issues.push({
      id: `ai-review-${p.id}`,
      type: 'AI_PROOF_NEEDS_REVIEW',
      severity: 'high',
      title: 'AI Proof Needs Review',
      description: `AI flagged for human review — confidence ${p.ai_confidence_score ?? '?'}/100. Seller: ${p.seller_email}`,
      purchase: p,
      event: events[p.event_id],
      timestamp: p.ai_processed_at || p.updated_date,
      recommended: 'Review screenshot and AI notes, then approve or reject.',
      actions: ['view_proof', 'approve_ai', 'reject_ai'],
    });
  });

  // AI PROCESSING FAILED
  purchases.filter(p => p.ai_proof_status === 'failed_processing' && !p.admin_override_status).forEach(p => {
    issues.push({
      id: `ai-failed-${p.id}`,
      type: 'AI_PROOF_FAILED',
      severity: 'high',
      title: 'AI Processing Failed',
      description: `AI could not process proof screenshot. Manual review required. Seller: ${p.seller_email}`,
      purchase: p,
      event: events[p.event_id],
      timestamp: p.ai_processed_at || p.updated_date,
      recommended: 'Manually review the screenshot and approve or reject.',
      actions: ['view_proof', 'approve_ai', 'reject_ai'],
    });
  });

  // BUYER INACTIVE 24H
  purchases.filter(p => p.auto_review_flagged && p.transfer_status === 'pending_transfer').forEach(p => {
    issues.push({
      id: `inactive-${p.id}`,
      type: 'BUYER_INACTIVE_24H',
      severity: 'high',
      title: 'Buyer Inactive 24h',
      description: `Buyer ${p.buyer_email} hasn't confirmed after seller sent tickets. $${p.amount?.toFixed(2)} in escrow.`,
      purchase: p,
      event: events[p.event_id],
      timestamp: p.auto_review_flagged_at || p.updated_date,
      recommended: 'Contact buyer. If transfer is verified, approve capture. If suspicious, refund.',
      actions: p.transfer_proof_url ? ['approve_capture', 'refund_buyer'] : ['refund_buyer'],
    });
  });

  // STALE PENDING TRANSFERS (no seller confirmation 4+ hours)
  purchases.filter(p => {
    if (p.transfer_status !== 'pending_transfer') return false;
    if (p.seller_confirmed) return false;
    if (!p.created_date) return false;
    const hoursOld = (now - new Date(p.created_date)) / 3600000;
    return hoursOld > 4;
  }).forEach(p => {
    issues.push({
      id: `stale-${p.id}`,
      type: 'SELLER_DID_NOT_TRANSFER',
      severity: 'medium',
      title: 'Seller Not Responding',
      description: `Seller ${p.seller_email} hasn't confirmed transfer in 4+ hours. Buyer ${p.buyer_email} is waiting.`,
      purchase: p,
      event: events[p.event_id],
      timestamp: p.created_date,
      recommended: 'Send seller reminder or cancel and refund buyer.',
      actions: ['send_reminder', 'refund_buyer'],
    });
  });

  // STALE RESERVATIONS
  listings.filter(l => {
    if (!l.reservation_expires_at) return false;
    return new Date(l.reservation_expires_at) < now && l.status === 'active' && l.reservation_token;
  }).forEach(l => {
    issues.push({
      id: `stale-res-${l.id}`,
      type: 'STALE_RESERVATION',
      severity: 'low',
      title: 'Stale Reservation',
      description: `Listing Sec ${l.section} Row ${l.row} — reserved by ${l.reserved_by_email} but never purchased. Expired ${format(new Date(l.reservation_expires_at), 'h:mm a')}.`,
      listing: l,
      timestamp: l.reservation_expires_at,
      recommended: 'Clear the reservation to make listing available again.',
      actions: ['clear_reservation'],
    });
  });

  // INSTANT CUSTODY NEEDS REVIEW
  listings.filter(l => l.listing_mode === 'instant' && l.custody_status === 'pending_pg_verification').forEach(l => {
    issues.push({
      id: `custody-${l.id}`,
      type: 'INSTANT_CUSTODY_NEEDS_REVIEW',
      severity: 'high',
      title: 'Instant Listing Needs Custody Review',
      description: `Seller ${l.seller_email} submitted ticket for PG custody — Sec ${l.section} Row ${l.row}. $${l.asking_price}/ea.`,
      listing: l,
      timestamp: l.created_date,
      recommended: 'Review the submitted proof and approve or reject custody.',
      actions: ['approve_custody', 'reject_custody'],
    });
  });

  // STALE DONATIONS
  donations.filter(d => {
    if (d.donation_status !== 'active' && d.donation_status !== 'drawn') return false;
    if (!d.expires_at) return false;
    return new Date(d.expires_at) < now;
  }).forEach(d => {
    issues.push({
      id: `stale-donation-${d.id}`,
      type: 'DONATION_STALE',
      severity: 'low',
      title: 'Donation Expired Unclaimed',
      description: `Donation from ${d.donor_name || d.donor_email} for ${d.event_title || 'event'} expired without a winner accepting.`,
      donation: d,
      timestamp: d.expires_at,
      recommended: 'Mark donation as expired or extend its deadline.',
      actions: [],
    });
  });

  // Sort: critical → high → medium → low, then by timestamp desc
  const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  return issues.sort((a, b) => {
    const diff = ORDER[a.severity] - ORDER[b.severity];
    if (diff !== 0) return diff;
    return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
  });
}

const SEV_STYLES = {
  critical: { color: '#FF2D78', bg: 'rgba(255,45,120,0.1)', border: 'rgba(255,45,120,0.35)', label: 'CRITICAL' },
  high:     { color: '#FF8C00', bg: 'rgba(255,140,0,0.1)',  border: 'rgba(255,140,0,0.35)',  label: 'HIGH' },
  medium:   { color: '#FFE600', bg: 'rgba(255,230,0,0.08)', border: 'rgba(255,230,0,0.3)',   label: 'MEDIUM' },
  low:      { color: '#00C8FF', bg: 'rgba(0,200,255,0.06)', border: 'rgba(0,200,255,0.2)',   label: 'LOW' },
};

function IssueCard({ issue, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState('');
  const [confirmed, setConfirmed] = useState('');
  const sev = SEV_STYLES[issue.severity];
  const p = issue.purchase;
  const l = issue.listing;

  const confirm = (key, label, fn) => {
    if (confirmed === key) {
      fn();
      setConfirmed('');
    } else {
      setConfirmed(key);
      setTimeout(() => setConfirmed(''), 4000);
    }
  };

  const act = async (action) => {
    setLoading(action);
    try {
      if (action === 'refund_buyer' && p) {
        await base44.functions.invoke('cancelPurchase', { purchase_id: p.id });
      } else if (action === 'release_seller' && p) {
        await base44.entities.Purchase.update(p.id, { seller_confirmed: true, buyer_confirmed: true });
        await base44.functions.invoke('capturePayment', { purchase_id: p.id, confirming_role: 'buyer' });
      } else if (action === 'strike_seller' && p) {
        const users = await base44.entities.User.filter({ email: p.seller_email });
        if (users[0]) await base44.entities.User.update(users[0].id, { strike_count: (users[0].strike_count || 0) + 1 });
        await base44.entities.Purchase.update(p.id, { transfer_status: 'expired' });
      } else if (action === 'approve_capture' && p) {
        await base44.entities.Purchase.update(p.id, { seller_confirmed: true, buyer_confirmed: true });
        await base44.functions.invoke('capturePayment', { purchase_id: p.id, confirming_role: 'buyer' });
      } else if (action === 'approve_ai' && p) {
        await base44.functions.invoke('adminOverrideAIVerification', { purchase_id: p.id, action: 'approved', reason: 'Admin manual review' });
      } else if (action === 'reject_ai' && p) {
        await base44.functions.invoke('adminOverrideAIVerification', { purchase_id: p.id, action: 'rejected', reason: 'Admin rejected' });
      } else if (action === 'mark_fraud' && p) {
        await base44.functions.invoke('adminOverrideAIVerification', { purchase_id: p.id, action: 'marked_fraudulent', reason: 'Admin marked fraudulent' });
      } else if (action === 'clear_reservation' && l) {
        await base44.entities.Listing.update(l.id, { reservation_token: null, reservation_expires_at: null, reserved_by_email: null });
      } else if (action === 'approve_custody' && l) {
        await base44.entities.Listing.update(l.id, { custody_status: 'verified', status: 'active' });
      } else if (action === 'reject_custody' && l) {
        await base44.entities.Listing.update(l.id, { custody_status: 'rejected', status: 'cancelled' });
      } else if (action === 'send_reminder' && p) {
        await base44.integrations.Core.SendEmail({
          to: p.seller_email,
          subject: '⏰ Reminder: Please transfer your tickets',
          body: `Hi,\n\nA buyer is waiting for your ticket transfer. Please log into Peanut Gallery and complete the transfer as soon as possible.\n\nPurchase amount: $${p.amount?.toFixed(2)}\nBuyer email: ${p.buyer_email}\n\n— Peanut Gallery Team`,
        });
      }
      await onRefresh();
    } catch (e) {
      console.error(e);
    }
    setLoading('');
  };

  const ACTION_DEFS = {
    refund_buyer:       { label: 'Refund Buyer',       color: '#00C8FF', confirm: true },
    release_seller:     { label: 'Release to Seller',  color: '#00FF87', confirm: true },
    strike_seller:      { label: 'Refund + Strike',    color: '#FF2D78', confirm: true },
    approve_capture:    { label: 'Approve Capture',    color: '#00FF87', confirm: true, disabled: !p?.transfer_proof_url },
    view_proof:         { label: 'View Proof',         color: '#BF5FFF', isLink: true, href: p?.transfer_proof_url },
    approve_ai:         { label: 'Approve Proof',      color: '#00FF87', confirm: false },
    reject_ai:          { label: 'Reject Proof',       color: '#FF8C00', confirm: false },
    mark_fraud:         { label: 'Mark Fraud',         color: '#FF2D78', confirm: true },
    clear_reservation:  { label: 'Clear Reservation',  color: '#00C8FF', confirm: true },
    approve_custody:    { label: 'Approve Custody',    color: '#00FF87', confirm: true },
    reject_custody:     { label: 'Reject Custody',     color: '#FF2D78', confirm: true },
    send_reminder:      { label: 'Send Reminder',      color: '#FFE600', confirm: false },
    view_stripe:        { label: 'Open Stripe',        color: '#BF5FFF', isLink: true, href: 'https://dashboard.stripe.com' },
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: sev.bg, border: `1px solid ${sev.border}` }}>
      <div className="px-4 py-3.5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
            style={{ background: sev.bg, color: sev.color, border: `1px solid ${sev.border}` }}>
            {sev.label}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-foreground">{issue.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{issue.description}</div>
            {issue.event && <div className="text-xs font-medium mt-0.5" style={{ color: '#BF5FFF' }}>{issue.event.title}</div>}
            <div className="text-[10px] text-muted-foreground mt-1">
              {issue.timestamp ? formatRelative(issue.timestamp) : ''}
            </div>
          </div>
          <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mt-3">
          {issue.actions.map(key => {
            const def = ACTION_DEFS[key];
            if (!def) return null;
            if (def.isLink) {
              return def.href ? (
                <a key={key} href={def.href} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: `${def.color}15`, color: def.color, border: `1px solid ${def.color}40` }}>
                  <ExternalLink className="w-3 h-3" /> {def.label}
                </a>
              ) : null;
            }
            const isConfirming = confirmed === key;
            return (
              <button key={key}
                disabled={!!loading || def.disabled}
                onClick={() => def.confirm ? confirm(key, def.label, () => act(key)) : act(key)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                style={{
                  background: isConfirming ? def.color : `${def.color}15`,
                  color: isConfirming ? '#000' : def.color,
                  border: `1px solid ${def.color}40`,
                }}>
                {loading === key
                  ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : isConfirming ? '⚡ Confirm?' : def.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="pt-3 text-xs rounded-lg px-3 py-2 mt-1"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-1">Recommended Action</div>
            <div className="text-foreground">{issue.recommended}</div>
          </div>
          {p && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-muted-foreground text-[10px] mb-1 uppercase font-semibold">Buyer</div>
                <div className="font-medium text-foreground truncate">{p.buyer_email}</div>
                {p.buyer_name && <div className="text-muted-foreground">{p.buyer_name}</div>}
              </div>
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-muted-foreground text-[10px] mb-1 uppercase font-semibold">Seller</div>
                <div className="font-medium text-foreground truncate">{p.seller_email}</div>
              </div>
            </div>
          )}
          {p?.transfer_notes && (
            <div className="text-xs rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="text-muted-foreground text-[10px] mb-1 uppercase font-semibold">Transfer Notes</div>
              <div className="text-foreground">{p.transfer_notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelative(ts) {
  try {
    const d = new Date(ts);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return format(d, 'MMM d h:mm a');
  } catch { return ''; }
}

const SEV_FILTERS = [
  { key: 'all',      label: 'All Issues' },
  { key: 'critical', label: '🔴 Critical' },
  { key: 'high',     label: '🟠 High' },
  { key: 'medium',   label: '🟡 Medium' },
  { key: 'low',      label: '🔵 Low' },
];

export default function IssueFeed({ purchases, listings, events, donations, onRefresh }) {
  const [sevFilter, setSevFilter] = useState('all');
  const issues = buildIssues(purchases, listings, donations, events);
  const filtered = sevFilter === 'all' ? issues : issues.filter(i => i.severity === sevFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-bold text-foreground text-lg">Live Issue Feed</h2>
          <p className="text-xs text-muted-foreground">{issues.length} total · {issues.filter(i => i.severity === 'critical').length} critical</p>
        </div>
      </div>

      {/* Severity filter */}
      <div className="flex gap-2 flex-wrap mb-4">
        {SEV_FILTERS.map(f => (
          <button key={f.key} onClick={() => setSevFilter(f.key)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold transition-all"
            style={sevFilter === f.key
              ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
              : { background: 'rgba(255,255,255,0.06)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.1)' }}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 rounded-2xl" style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.2)' }}>
          <div className="text-3xl mb-3">✅</div>
          <div className="font-bold text-foreground">Everything looks healthy right now.</div>
          <div className="text-sm text-muted-foreground mt-1">No {sevFilter !== 'all' ? sevFilter + ' ' : ''}issues detected.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(issue => (
            <IssueCard key={issue.id} issue={issue} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}