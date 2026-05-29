import { useState, useEffect } from 'react';
import { getTransferWindowInfo } from '@/lib/transferWindow';

/**
 * Compact badge + optional expanded info panel for transfer window status.
 * Props:
 *   event: Event object
 *   expanded: boolean — if true, show full info panel instead of just badge
 *   showCountdown: boolean — live countdown ticker
 */
export default function TransferWindowBadge({ event, expanded = false, showCountdown = false }) {
  const [info, setInfo] = useState(() => getTransferWindowInfo(event));

  // Refresh every 30s for live countdown
  useEffect(() => {
    if (!showCountdown) return;
    const timer = setInterval(() => setInfo(getTransferWindowInfo(event)), 30000);
    return () => clearInterval(timer);
  }, [event, showCountdown]);

  if (!expanded) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}` }}
      >
        {info.badgeIcon} {info.badge}
      </span>
    );
  }

  return (
    <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
      style={{ background: info.bg, border: `1px solid ${info.border}` }}>
      <span className="text-lg flex-shrink-0 mt-0.5">{info.badgeIcon}</span>
      <div className="min-w-0">
        <div className="text-sm font-bold" style={{ color: info.color }}>{info.label}</div>
        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{info.sublabel}</div>
        {info.minutesRemaining !== null && info.minutesRemaining > 0 && (
          <div className="text-xs font-semibold mt-1" style={{ color: info.color }}>
            ⏱ ~{Math.round(info.minutesRemaining)} min remaining
          </div>
        )}
        {event?.transfer_window_source && event.transfer_window_source !== 'inferred' && (
          <div className="text-[10px] text-muted-foreground mt-1 opacity-60">
            Source: {event.transfer_window_source}
            {event.transfer_window_confidence != null ? ` · ${event.transfer_window_confidence}% confidence` : ''}
          </div>
        )}
        {event?.admin_transfer_notes && (
          <div className="text-xs text-muted-foreground mt-1.5 italic">
            Note: {event.admin_transfer_notes}
          </div>
        )}
      </div>
    </div>
  );
}