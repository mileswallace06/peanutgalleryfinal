/**
 * VerifyTransferButton — QUARANTINED
 *
 * Transfer re-verification is temporarily unavailable while secure proof
 * scanning is being enabled. This component renders a non-mutating disabled
 * notice and performs no API calls, uploads, or entity writes.
 *
 * No Base44 client import. No UploadFile/UploadPrivateFile. No Listing
 * update. No BetaTransferLog create. No proof URL state.
 */
export default function VerifyTransferButton({ listing, event, onVerified }) {
  return (
    <div className="rounded-xl px-4 py-3 text-xs leading-relaxed"
      style={{
        background: 'rgba(var(--neon-orange-rgb), 0.06)',
        border: '1px solid rgba(var(--neon-orange-rgb), 0.2)',
        color: 'var(--neon-orange)',
      }}>
      Transfer re-verification is temporarily unavailable while secure proof scanning is being enabled.
    </div>
  );
}