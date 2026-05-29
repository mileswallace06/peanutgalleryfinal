import { useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import TransferStatusBadge from './TransferStatusBadge';
import { getTransferStatusBadge, formatVerificationAge } from '@/lib/transferConfidence';

/**
 * Shown inside PurchaseDialog before checkout.
 * If confidence < 70, requires explicit buyer checkbox.
 * Props:
 *   listing: Listing entity
 *   onAcknowledged: () => void — called when buyer is cleared to proceed
 */
export default function TransferAcknowledgment({ listing, onAcknowledged }) {
  const score = listing.transfer_confidence_score ?? null;
  const needsAck = score !== null && score < 70;
  const badge = getTransferStatusBadge(listing);
  const age = formatVerificationAge(listing.last_transfer_verification);
  const [checked, setChecked] = useState(false);

  // Disabled listing — hard block
  if (listing.transfer_status === 'transfer_disabled') {
    return (
      <div className="rounded-2xl px-4 py-4 space-y-2"
        style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.3)' }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">❌</span>
          <span className="font-bold text-sm" style={{ color: '#FF2D78' }}>Transfer Unavailable</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The seller has confirmed this ticket can no longer be transferred. This listing is not available for purchase.
        </p>
      </div>
    );
  }

  // Good confidence, no ack needed — show compact trust signal
  if (!needsAck) {
    return (
      <div className="rounded-xl px-4 py-3 space-y-2"
        style={{ background: badge.bg, border: `1px solid ${badge.border}` }}>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: badge.color }} />
          <span className="text-sm font-bold" style={{ color: badge.color }}>
            {badge.icon} {badge.label}
          </span>
        </div>
        {score !== null && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${score}%`, background: badge.color }} />
            </div>
            <span className="text-[10px] font-bold" style={{ color: badge.color }}>{score}% Confidence</span>
          </div>
        )}
        {age && <p className="text-[10px] text-muted-foreground">{age}</p>}
      </div>
    );
  }

  // Low confidence — require acknowledgment
  return (
    <div className="rounded-2xl space-y-3"
      style={{ background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.3)', padding: '16px' }}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#FF8C00' }} />
        <div>
          <div className="font-bold text-sm" style={{ color: '#FF8C00' }}>Transfer Status Uncertain</div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Transfer availability for this ticket has not been recently confirmed.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <TransferStatusBadge listing={listing} />
      </div>

      <button
        type="button"
        onClick={() => setChecked(v => !v)}
        className="w-full flex items-start gap-3 text-left px-4 py-3.5 rounded-xl transition-all"
        style={{
          background: checked ? 'rgba(255,140,0,0.08)' : 'rgba(255,255,255,0.04)',
          border: checked ? '1.5px solid rgba(255,140,0,0.4)' : '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{
            background: checked ? '#FF8C00' : 'transparent',
            border: checked ? 'none' : '2px solid rgba(255,255,255,0.3)',
          }}>
          {checked && <span className="text-black text-xs font-black">✓</span>}
        </div>
        <span className="text-xs text-foreground leading-relaxed">
          I understand that transfer availability is unconfirmed for this ticket. I accept the risk and want to proceed with purchase.
        </span>
      </button>

      {checked && (
        <button
          onClick={onAcknowledged}
          className="w-full py-2.5 rounded-xl text-xs font-bold"
          style={{ background: 'rgba(255,140,0,0.15)', color: '#FF8C00', border: '1px solid rgba(255,140,0,0.3)' }}
        >
          Proceed Anyway →
        </button>
      )}
    </div>
  );
}