import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';

const RISKS = [
  {
    category: 'Seller Risks',
    items: [
      { id: 'seller_disappears', label: 'Seller disappears after sale', mitigation: 'Escrow holds payment until buyer confirms. Admin can force-refund via Dispute Queue.' },
      { id: 'seller_delayed', label: 'Seller delays ticket transfer', mitigation: '48hr window before buyer can dispute. Admin can escalate and strike seller.' },
      { id: 'fake_tickets', label: 'Seller uploads fake proof', mitigation: 'Proof review queue — admin approves before listing goes live.' },
      { id: 'seller_no_stripe', label: 'Seller not Stripe-onboarded', mitigation: 'Stripe check gates listing creation. Seller blocked until onboarded.' },
    ]
  },
  {
    category: 'Transfer & Timing',
    items: [
      { id: 'tm_lag', label: 'Ticketmaster transfer lag (24-48hr)', mitigation: 'Communicate expected timeline to buyer. Admin can extend window.' },
      { id: 'transfer_proof_missing', label: 'Transfer proof not submitted', mitigation: 'Seller reminder in UI. Admin can mark expired and refund buyer.' },
      { id: 'wrong_seats', label: 'Wrong seat section transferred', mitigation: 'Buyer confirms exact seats. Dispute triggers escrow freeze.' },
    ]
  },
  {
    category: 'Payments & Payouts',
    items: [
      { id: 'stripe_payout_delay', label: 'Stripe payout delay (2-7 days)', mitigation: 'Expected behavior for new accounts. Communicate to sellers upfront.' },
      { id: 'payment_failed', label: 'Payment intent fails at purchase', mitigation: 'Stripe handles card errors. Listing stays active. Buyer sees error message.' },
      { id: 'key_mismatch', label: 'Stripe key mismatch (test vs live)', mitigation: 'Admin panel shows key mode status. Check before any live event.' },
    ]
  },
  {
    category: 'Platform & Technical',
    items: [
      { id: 'event_sync_fail', label: 'TM event sync failure', mitigation: 'Events already saved to DB after first sync. App degrades gracefully.' },
      { id: 'location_fail', label: 'Location detection failure', mitigation: 'Manual city search fallback. Denied state shows clear instructions.' },
      { id: 'dispute_escalation', label: 'Dispute requires manual resolution', mitigation: 'Admin dispute queue. Force-refund or force-release available.' },
      { id: 'rate_limit', label: 'Ticketmaster API rate limit', mitigation: '3-minute cache layer. Retry button shown. Graceful error state in UI.' },
    ]
  },
];

const STATUS_OPTIONS = [
  { value: 'mitigated', label: 'Mitigated', color: '#00FF87', Icon: CheckCircle2 },
  { value: 'monitoring', label: 'Monitoring', color: '#FFE600', Icon: Clock },
  { value: 'exposed',   label: 'Exposed',   color: '#FF2D78', Icon: XCircle },
];

const STORAGE_KEY = 'pg_risk_status';

function loadStatuses() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveStatuses(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

export default function OperationalRiskChecklist() {
  const [statuses, setStatuses] = useState(loadStatuses);
  const [expanded, setExpanded] = useState({});

  const setStatus = (id, value) => {
    const next = { ...statuses, [id]: value };
    setStatuses(next);
    saveStatuses(next);
  };

  const allItems = RISKS.flatMap(r => r.items);
  const mitigatedCount = allItems.filter(i => statuses[i.id] === 'mitigated').length;
  const exposedCount = allItems.filter(i => statuses[i.id] === 'exposed').length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 px-4 py-3 rounded-2xl" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: exposedCount > 0 ? '#FF2D78' : '#00FF87' }} />
        <div className="flex-1">
          <p className="text-xs font-black text-foreground">{mitigatedCount}/{allItems.length} risks addressed</p>
          <p className="text-[10px] text-muted-foreground">{exposedCount > 0 ? `${exposedCount} exposed — review before launch` : 'All tracked risks have a mitigation plan'}</p>
        </div>
        {exposedCount > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.3)' }}>
            {exposedCount} exposed
          </span>
        )}
      </div>

      {RISKS.map(({ category, items }) => (
        <div key={category} className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-black tracking-widest uppercase text-muted-foreground">{category}</p>
          </div>
          <div className="divide-y divide-border">
            {items.map(({ id, label, mitigation }) => {
              const status = statuses[id] || 'monitoring';
              const statusCfg = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[1];
              const isExpanded = expanded[id];

              return (
                <div key={id}>
                  <button onClick={() => setExpanded(p => ({ ...p, [id]: !isExpanded }))}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left">
                    <statusCfg.Icon className="w-4 h-4 flex-shrink-0" style={{ color: statusCfg.color }} />
                    <span className="flex-1 text-sm text-foreground">{label}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: `${statusCfg.color}15`, color: statusCfg.color, border: `1px solid ${statusCfg.color}30` }}>
                      {statusCfg.label}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                      <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.15)' }}>
                        <p className="font-black text-muted-foreground uppercase tracking-wider text-[9px] mb-1">Mitigation</p>
                        <p className="text-foreground">{mitigation}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Update Status</p>
                        <div className="flex gap-2 flex-wrap">
                          {STATUS_OPTIONS.map(s => (
                            <button key={s.value} onClick={() => setStatus(id, s.value)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                              style={status === s.value
                                ? { background: `${s.color}20`, color: s.color, border: `1px solid ${s.color}50` }
                                : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }
                              }>
                              <s.Icon className="w-3 h-3" /> {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}