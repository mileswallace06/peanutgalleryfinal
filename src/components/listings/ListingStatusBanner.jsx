/**
 * ListingStatusBanner
 * Shows a contextual status banner for a seller's listing on MySales.
 * Covers: live, pending_review, verification_expired, hidden, sold.
 */
import { CheckCircle, Clock, XCircle, EyeOff, AlertTriangle } from 'lucide-react';
import VerifyTransferButton from '@/components/listings/VerifyTransferButton';
import { isVerificationExpired } from '@/lib/transferConfidence';

export default function ListingStatusBanner({ listing, event, onRefresh }) {
  // ── Sold ─────────────────────────────────────────────────────────────────
  if (listing.status === 'sold' || listing.status === 'pending_transfer') {
    return (
      <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
        style={{ background: 'rgba(0,255,135,0.07)', border: '1px solid rgba(0,255,135,0.25)' }}>
        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#00FF87' }} />
        <div className="min-w-0">
          <p className="font-bold text-sm" style={{ color: '#00FF87' }}>Sold 🎉</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            This listing has been purchased. Transfer the tickets to the buyer to receive your payout.
          </p>
        </div>
      </div>
    );
  }

  // ── Pending PG custody review (instant listing) ───────────────────────────
  if (listing.listing_mode === 'instant' && listing.status === 'pending_verification') {
    return (
      <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
        style={{ background: 'rgba(0,200,255,0.07)', border: '1px solid rgba(0,200,255,0.25)' }}>
        <Clock className="w-4 h-4 mt-0.5 flex-shrink-0 animate-pulse" style={{ color: '#00C8FF' }} />
        <div className="min-w-0">
          <p className="font-bold text-sm" style={{ color: '#00C8FF' }}>⚡ Pending Custody Verification</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Our team is verifying that your ticket has been transferred to Peanut Gallery. Usually verified within a few hours. Once confirmed, your listing goes live with the Instant Transfer badge.
          </p>
        </div>
      </div>
    );
  }

  // ── Pending proof review (standard listing flagged) ───────────────────────
  if (listing.proof_status === 'pending_review' && listing.status !== 'hidden') {
    return (
      <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
        style={{ background: 'rgba(255,230,0,0.07)', border: '1px solid rgba(255,230,0,0.25)' }}>
        <Clock className="w-4 h-4 mt-0.5 flex-shrink-0 animate-pulse" style={{ color: '#FFE600' }} />
        <div className="min-w-0">
          <p className="font-bold text-sm" style={{ color: '#FFE600' }}>Pending Review</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your listing is being reviewed by our team. This usually takes a few minutes. You'll be notified once it's approved and visible to buyers.
          </p>
        </div>
      </div>
    );
  }

  // ── Proof rejected ────────────────────────────────────────────────────────
  if (listing.proof_status === 'rejected') {
    return (
      <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
        style={{ background: 'rgba(255,45,120,0.07)', border: '1px solid rgba(255,45,120,0.3)' }}>
        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#FF2D78' }} />
        <div className="min-w-0">
          <p className="font-bold text-sm" style={{ color: '#FF2D78' }}>Listing Rejected</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {listing.proof_rejection_reason
              ? `Our team rejected this listing: "${listing.proof_rejection_reason}"`
              : 'Our team was unable to verify this listing. Please contact support if you believe this is an error.'}
          </p>
        </div>
      </div>
    );
  }

  // ── Hidden — verification expired ─────────────────────────────────────────
  if (listing.status === 'hidden' && listing.hidden_reason === 'expired_verification') {
    return (
      <div className="rounded-2xl px-4 py-3 space-y-3"
        style={{ background: 'rgba(255,140,0,0.07)', border: '1px solid rgba(255,140,0,0.3)' }}>
        <div className="flex items-start gap-3">
          <EyeOff className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#FF8C00' }} />
          <div className="min-w-0">
            <p className="font-bold text-sm" style={{ color: '#FF8C00' }}>Hidden — Transfer Verification Expired</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your transfer verification expired after 60 minutes, so this listing was hidden from buyers. Re-verify that transfers are still available to restore it immediately.
            </p>
          </div>
        </div>
        {event && (
          <VerifyTransferButton listing={listing} event={event} onVerified={onRefresh} />
        )}
      </div>
    );
  }

  // ── Hidden — admin disabled ───────────────────────────────────────────────
  if (listing.status === 'hidden' && listing.hidden_reason === 'admin_disabled') {
    return (
      <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
        style={{ background: 'rgba(255,45,120,0.07)', border: '1px solid rgba(255,45,120,0.3)' }}>
        <EyeOff className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#FF2D78' }} />
        <div className="min-w-0">
          <p className="font-bold text-sm" style={{ color: '#FF2D78' }}>Hidden by Admin</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            This listing has been temporarily hidden by our team. Please contact support for details.
          </p>
        </div>
      </div>
    );
  }

  // ── Hidden — other ────────────────────────────────────────────────────────
  if (listing.status === 'hidden') {
    return (
      <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
        style={{ background: 'rgba(255,140,0,0.07)', border: '1px solid rgba(255,140,0,0.25)' }}>
        <EyeOff className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#FF8C00' }} />
        <div className="min-w-0">
          <p className="font-bold text-sm" style={{ color: '#FF8C00' }}>Hidden from Buyers</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            This listing is not currently visible to buyers.{' '}
            {listing.hidden_reason === 'transfer_disabled'
              ? 'Transfers appear unavailable for this event. Restore when transfers reopen.'
              : 'Contact support if you believe this is an error.'}
          </p>
        </div>
        {event && listing.hidden_reason === 'transfer_disabled' && (
          <VerifyTransferButton listing={listing} event={event} onVerified={onRefresh} />
        )}
      </div>
    );
  }

  // ── Active — verification expired (still visible but risky) ───────────────
  if (listing.status === 'active' && isVerificationExpired(listing)) {
    return (
      <div className="rounded-2xl px-4 py-3 space-y-3"
        style={{ background: 'rgba(255,140,0,0.07)', border: '1px solid rgba(255,140,0,0.25)' }}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#FF8C00' }} />
          <div className="min-w-0">
            <p className="font-bold text-sm" style={{ color: '#FF8C00' }}>⚠️ Verification Expired</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your transfer verification has expired. Buyers see a low-confidence warning on your listing. Re-verify now to keep buyer trust high and avoid your listing being hidden.
            </p>
          </div>
        </div>
        {event && <VerifyTransferButton listing={listing} event={event} onVerified={onRefresh} />}
      </div>
    );
  }

  // ── Active — live ─────────────────────────────────────────────────────────
  if (listing.status === 'active') {
    return (
      <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
        style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
        <div className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: '#00FF87' }} />
        <p className="text-xs font-semibold" style={{ color: '#00FF87' }}>
          Live — Visible to buyers
        </p>
      </div>
    );
  }

  return null;
}