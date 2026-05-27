/**
 * FulfillmentItem — single row in the fulfillment queue.
 * Shows event, timing, urgency, seat info, and admin action buttons.
 */
import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle, AlertTriangle, Upload, Bell, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { getUrgency, URGENCY_STYLES } from './useUrgency';
import { format } from 'date-fns';

const FULFILLMENT_LABELS = {
  awaiting_pg_transfer:  { label: 'Awaiting Transfer', color: '#FF8C00' },
  transfer_in_progress:  { label: 'Transfer In Progress', color: '#00C8FF' },
  fulfilled:             { label: 'Fulfilled', color: '#00FF87' },
  buyer_confirmed:       { label: 'Buyer Confirmed', color: '#00FF87' },
  issue_reported:        { label: 'Issue Reported', color: '#FF2D78' },
};

export default function FulfillmentItem({ listing, purchase, event, onRefresh, adminEmail }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [notes, setNotes] = useState('');

  const eventDate = event?.event_start_utc || event?.event_start_local || event?.date;
  const { level, label: urgencyLabel, countdown } = getUrgency(
    eventDate,
    purchase?.created_date,
    purchase?.fulfillment_status
  );
  const urgStyle = URGENCY_STYLES[level] || URGENCY_STYLES.low;

  const fs = FULFILLMENT_LABELS[purchase?.fulfillment_status] || null;

  const handleCustodyVerify = async () => {
    setLoading('verify');
    await base44.entities.Listing.update(listing.id, {
      custody_status: 'verified',
      status: 'active',
      proof_status: 'approved',
    });
    await onRefresh();
    setLoading('');
  };

  const handleCustodyReject = async () => {
    const reason = notes.trim() || 'Custody proof insufficient';
    setLoading('reject');
    await base44.entities.Listing.update(listing.id, {
      custody_status: 'rejected',
      status: 'cancelled',
      proof_status: 'rejected',
      proof_rejection_reason: reason,
    });
    await onRefresh();
    setLoading('');
    setNotes('');
  };

  const act = async (action, extra = {}) => {
    setLoading(action);
    const now = new Date().toISOString();
    const updates = { ...extra };

    if (action === 'start') {
      updates.fulfillment_status = 'transfer_in_progress';
      updates.fulfillment_started_at = now;
      updates.seller_confirmed = true; // unblocks buyer confirm flow
    } else if (action === 'complete') {
      updates.fulfillment_status = 'fulfilled';
      updates.fulfillment_completed_at = now;
      updates.seller_confirmed = true;
    } else if (action === 'issue') {
      updates.fulfillment_status = 'issue_reported';
    } else if (action === 'notify') {
      // Fire notification — fire-and-forget
      base44.functions.invoke('sendUserNotification', {
        user_email: purchase.buyer_email,
        title: 'Your ticket transfer is in progress ⚡',
        body: 'Peanut Gallery is transferring your ticket now. Check your email for the transfer invite shortly.',
        type: 'tickets_sent',
        purchase_id: purchase.id,
      }).catch(() => {});
      setLoading('');
      return;
    }

    if (notes.trim()) updates.fulfillment_notes = notes.trim();

    await base44.entities.Purchase.update(purchase.id, updates);
    await onRefresh();
    setLoading('');
    setNotes('');
  };

  const handleProofUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingProof(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    await base44.entities.Purchase.update(purchase.id, {
      fulfillment_proof_url: file_url,
      fulfillment_status: 'fulfilled',
      fulfillment_completed_at: new Date().toISOString(),
      seller_confirmed: true,
    });
    await onRefresh();
    setUploadingProof(false);
  };

  const isLoading = (a) => loading === a;

  return (
    <div className="rounded-xl overflow-hidden text-sm"
      style={{ background: urgStyle.bg, border: `1px solid ${urgStyle.border}` }}>
      {/* Header row */}
      <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            {/* Urgency badge */}
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
              style={{ background: urgStyle.bg, color: urgStyle.color, border: `1px solid ${urgStyle.border}` }}>
              {urgencyLabel}
            </span>
            {countdown && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
                ⏱ {countdown}
              </span>
            )}
            {fs && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.06)', color: fs.color }}>
                {fs.label}
              </span>
            )}
          </div>
          <div className="font-bold text-foreground truncate">{event?.title || listing.event_id}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Sec {listing.section} · Row {listing.row}
            {listing.quantity > 1 && <> · {listing.quantity} tickets</>}
            {' '}· ${listing.asking_price}/ea
          </div>
          {eventDate && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {format(new Date(eventDate), 'EEE MMM d · h:mm a')}
            </div>
          )}
        </div>

        <button onClick={() => setExpanded(v => !v)}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground flex-shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded details + actions */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t space-y-3"
          style={{ borderColor: `${urgStyle.border}` }}>

          {/* Seller / Buyer info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="text-muted-foreground uppercase tracking-wide font-semibold mb-0.5 text-[9px]">Seller</div>
              <div className="font-medium text-foreground truncate">{listing.seller_email}</div>
            </div>
            {purchase ? (
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-muted-foreground uppercase tracking-wide font-semibold mb-0.5 text-[9px]">Buyer</div>
                <div className="font-medium text-foreground truncate">{purchase.buyer_email}</div>
                {purchase.buyer_name && <div className="text-muted-foreground text-[10px]">{purchase.buyer_name}</div>}
              </div>
            ) : (
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-muted-foreground uppercase tracking-wide font-semibold mb-0.5 text-[9px]">Status</div>
                <div className="text-muted-foreground">Not yet sold</div>
              </div>
            )}
          </div>

          {/* Custody proof links */}
          <div className="flex flex-wrap gap-2">
            {listing.pg_transfer_proof_url && (
              <a href={listing.pg_transfer_proof_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(191,95,255,0.1)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>
                Custody Proof <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
            {purchase?.fulfillment_proof_url && (
              <a href={purchase.fulfillment_proof_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(0,255,135,0.1)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.25)' }}>
                Fulfillment Proof <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>

          {/* Transfer notes */}
          {listing.pg_transfer_notes && (
            <div className="text-[11px] text-muted-foreground italic px-2.5 py-2 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              "{listing.pg_transfer_notes}"
            </div>
          )}

          {/* Admin notes input */}
          {purchase && (
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add fulfillment notes (saved with next action)…"
              rows={2}
              className="w-full px-3 py-2 rounded-lg text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
          )}

          {/* Custody verification actions — for pending_pg_verification listings */}
          {listing.custody_status === 'pending_pg_verification' && !purchase && (
            <div className="flex flex-wrap gap-2">
              <button onClick={handleCustodyVerify} disabled={!!loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
                {isLoading('verify') ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                Verify & Go Live
              </button>
              <button onClick={handleCustodyReject} disabled={!!loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: 'rgba(255,45,120,0.08)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
                {isLoading('reject') ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                Reject
              </button>
            </div>
          )}

          {/* Admin action buttons — only for sold/pending fulfillment */}
          {purchase && (
            <div className="flex flex-wrap gap-2">
              {(purchase.fulfillment_status === 'awaiting_pg_transfer' || !purchase.fulfillment_status) && (
                <button onClick={() => act('start')} disabled={!!loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: 'rgba(0,200,255,0.12)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
                  {isLoading('start') ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : '⚡'}
                  Mark Transfer Started
                </button>
              )}
              {purchase.fulfillment_status === 'transfer_in_progress' && (
                <button onClick={() => act('complete')} disabled={!!loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
                  {isLoading('complete') ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                  Mark Transfer Complete
                </button>
              )}
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                style={{ background: 'rgba(191,95,255,0.1)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>
                {uploadingProof
                  ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <Upload className="w-3 h-3" />}
                Upload Proof
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleProofUpload} disabled={uploadingProof} />
              </label>
              <button onClick={() => act('notify')} disabled={!!loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
                <Bell className="w-3 h-3" /> Notify Buyer
              </button>
              {purchase.fulfillment_status !== 'issue_reported' && (
                <button onClick={() => act('issue')} disabled={!!loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: 'rgba(255,45,120,0.08)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
                  <AlertTriangle className="w-3 h-3" /> Escalate Issue
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}