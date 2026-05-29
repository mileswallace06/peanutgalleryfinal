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
        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}
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
          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}
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
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/10">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${score}%`, background: confDisplay.color }}
            />
          </div>
          <span className="text-[10px] font-bold w-24 text-right" style={{ color: confDisplay.color }}>
            {confDisplay.label}
          </span>
        </div>
      )}
    </div>
  );
}