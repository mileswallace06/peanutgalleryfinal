import { useState } from 'react';
import { CheckCircle, ChevronDown, ChevronUp, Shield } from 'lucide-react';

const TERMS = [
  {
    id: 'ownership',
    label: 'I own or control this ticket',
    detail: 'I confirm I have the right to transfer this ticket. I am the original purchaser or have been granted transfer rights by the original purchaser.',
  },
  {
    id: 'limited_agent',
    label: 'I authorize Peanut Gallery as a limited transfer agent',
    detail: 'I authorize Peanut Gallery to temporarily receive and hold this ticket solely for the purpose of completing delivery to a verified buyer. Peanut Gallery does not purchase or own this ticket at any point.',
  },
  {
    id: 'custody_purpose',
    label: 'Delivery custody is temporary and purpose-limited',
    detail: 'Peanut Gallery may only use its temporary custody of this ticket to transfer it to a buyer who completes a verified purchase. No other use is permitted.',
  },
  {
    id: 'return_if_unsold',
    label: 'Ticket will be returned or released if not sold',
    detail: 'If the listing expires, is cancelled, or the ticket does not sell before the event, Peanut Gallery will return or release the ticket to me where technically possible. I understand that certain ticketing platforms may have limitations on reverse transfers.',
  },
  {
    id: 'validity',
    label: 'I am responsible for ticket validity',
    detail: 'I confirm this ticket is valid, has not been previously transferred, voided, or used. I understand that if the ticket is found to be invalid, my listing may be removed and I may be held liable for any buyer refund.',
  },
];

export default function InstantTransferAgreement({ onConfirmed }) {
  const [checked, setChecked] = useState({});
  const [expanded, setExpanded] = useState({});

  const toggle = (id) => setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const allChecked = TERMS.every(t => checked[t.id]);

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid rgba(0,200,255,0.25)', background: 'rgba(0,200,255,0.04)' }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start gap-3"
        style={{ borderBottom: '1px solid rgba(0,200,255,0.12)' }}>
        <Shield className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#00C8FF' }} />
        <div>
          <div className="font-bold text-sm" style={{ color: '#00C8FF' }}>Instant Transfer Ready Agreement</div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            By enabling this mode, you authorize Peanut Gallery to act as a <strong className="text-foreground">limited transfer agent</strong> solely for buyer delivery. PG does not purchase or own your ticket.
          </p>
        </div>
      </div>

      {/* Terms checklist */}
      <div className="divide-y" style={{ borderColor: 'rgba(0,200,255,0.08)' }}>
        {TERMS.map(term => (
          <div key={term.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => toggle(term.id)}
                aria-checked={!!checked[term.id]}
                role="checkbox"
                className="mt-0.5 w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center border transition-all"
                style={{
                  background: checked[term.id] ? '#00C8FF' : 'transparent',
                  borderColor: checked[term.id] ? '#00C8FF' : 'rgba(0,200,255,0.35)',
                }}
              >
                {checked[term.id] && <CheckCircle className="w-3.5 h-3.5 text-black" />}
              </button>
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => toggle(term.id)}
                  className="text-left text-[13px] font-semibold text-foreground leading-snug"
                >
                  {term.label}
                </button>
                <button
                  type="button"
                  onClick={() => toggleExpand(term.id)}
                  className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground"
                >
                  {expanded[term.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {expanded[term.id] ? 'Hide details' : 'What does this mean?'}
                </button>
                {expanded[term.id] && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1.5 pr-2">
                    {term.detail}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Confirm button */}
      <div className="px-4 py-4" style={{ borderTop: '1px solid rgba(0,200,255,0.12)' }}>
        <button
          type="button"
          disabled={!allChecked}
          onClick={() => allChecked && onConfirmed()}
          className="w-full py-3 rounded-2xl font-black text-sm transition-all disabled:opacity-40"
          style={{
            background: allChecked ? 'linear-gradient(135deg, #00C8FF, #00FF87)' : 'hsl(var(--muted))',
            color: allChecked ? '#0D0B14' : 'hsl(var(--muted-foreground))',
          }}
        >
          {allChecked ? '✓ I Agree — Enable Instant Transfer Ready' : `Check all ${TERMS.length} boxes to continue`}
        </button>
        <p className="text-[10px] text-muted-foreground text-center mt-2 leading-relaxed">
          This agreement does not transfer ownership of your ticket. Peanut Gallery acts solely as a limited delivery agent on your behalf.
        </p>
      </div>
    </div>
  );
}