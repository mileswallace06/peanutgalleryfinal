import '@/components/events/detail-ticket.css';
import { getTransferStatusBadge, getConfidenceDisplay, formatVerificationAge, isVerificationExpired } from '@/lib/transferConfidence';

/**
 * Shows the listing-level transfer status badge + confidence score + age.
 * Props:
 *   listing: Listing entity
 *   compact: boolean — show single-line badge only (no confidence bar)
 */
export default function TransferStatusBadge({ listing, compact = false }) {
  const badge = getTransferStatusBadge(listing);
  const score = listing.transfer_confidence_score ?? null;
  const confDisplay = score !== null ? getConfidenceDisplay(score) : null;
  const age = formatVerificationAge(listing.last_transfer_verification);
  const expired = isVerificationExpired(listing);

  if (compact) {
    return (
      <span
        className="pg-transfer-badge inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded"
        data-tone={badge.color}
        style={{ background: 'color-mix(in srgb, var(--pg-transfer-ink) 9%, transparent)', color: 'var(--pg-transfer-ink)', border: '1px solid color-mix(in srgb, var(--pg-transfer-ink) 30%, transparent)' }}
      >
        {badge.icon} {badge.label}
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Status badge */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span
          className="pg-transfer-badge inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded"
        data-tone={badge.color}
          style={{ background: 'color-mix(in srgb, var(--pg-transfer-ink) 9%, transparent)', color: 'var(--pg-transfer-ink)', border: '1px solid color-mix(in srgb, var(--pg-transfer-ink) 30%, transparent)' }}
        >
          {badge.icon} {badge.label}
        </span>

        {age && (
          <span className="text-[10px] text-muted-foreground">
            {expired ? '⏱ ' : ''}{age}
          </span>
        )}
      </div>

      {/* Confidence score bar */}
      {confDisplay && (
        <div className="pg-transfer-badge flex items-center gap-2" data-tone={confDisplay.color}>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--pg-line)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${score}%`, background: 'var(--pg-transfer-ink)' }}
            />
          </div>
          <span className="text-[10px] font-bold w-24 text-right" style={{ color: 'var(--pg-transfer-ink)' }}>
            {confDisplay.label}
          </span>
        </div>
      )}
    </div>
  );
}