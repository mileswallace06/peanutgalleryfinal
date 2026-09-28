import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle, XCircle, RefreshCw, ExternalLink, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function ReviewCard({ listing, event, onApprove, onReject, onMessage, loading }) {
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [message, setMessage] = useState('');
  const [showMessage, setShowMessage] = useState(false);
  const isLoading = loading === listing.id;

  return (
    <div className="pg-operations-card rounded-2xl overflow-hidden text-sm"
      style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3"
        style={{ background: 'color-mix(in srgb, rgb(255 230 0) 6%, var(--pg-surface))', borderBottom: '1px solid var(--pg-line)' }}>
        <div className="min-w-0">
          <p className="font-bold text-foreground truncate">
            {event?.title || listing.event_id?.slice(0, 16)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sec {listing.section} · Row {listing.row} · {listing.quantity} seat{listing.quantity !== 1 ? 's' : ''} · ${listing.asking_price}/ea
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Seller: <span className="text-foreground font-medium">{listing.seller_email}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="pg-operations-status text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'color-mix(in srgb, rgb(255 230 0) 15%, var(--pg-surface))', '--pg-status-ink': '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
            Pending Review
          </span>
          <span className="text-[10px] text-muted-foreground">
            {listing.created_date ? formatDistanceToNow(new Date(listing.created_date), { addSuffix: true }) : ''}
          </span>
        </div>
      </div>

      {/* Proof */}
      <div className="px-4 py-3 space-y-2">
        {listing.listing_mode === 'instant' && (
          <div className="pg-operations-status flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'color-mix(in srgb, rgb(0 200 255) 10%, var(--pg-surface))', '--pg-status-ink': '#00C8FF', border: '1px solid rgba(0,200,255,0.25)' }}>
            ⚡ Instant Listing — verify PG has custody before approving
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {listing.proof_url && (
            <a href={listing.proof_url} target="_blank" rel="noopener noreferrer"
              className="pg-operations-status inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'color-mix(in srgb, rgb(191 95 255) 10%, var(--pg-surface))', '--pg-status-ink': '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>
              <ExternalLink className="w-3 h-3" /> Ticket Proof
            </a>
          )}
          {listing.pg_transfer_proof_url && (
            <a href={listing.pg_transfer_proof_url} target="_blank" rel="noopener noreferrer"
              className="pg-operations-status inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'color-mix(in srgb, rgb(0 200 255) 10%, var(--pg-surface))', '--pg-status-ink': '#00C8FF', border: '1px solid rgba(0,200,255,0.25)' }}>
              <ExternalLink className="w-3 h-3" /> PG Transfer Proof
            </a>
          )}
          {listing.transfer_verification_proof_url && (
            <a href={listing.transfer_verification_proof_url} target="_blank" rel="noopener noreferrer"
              className="pg-operations-status inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'color-mix(in srgb, rgb(0 255 135) 8%, var(--pg-surface))', '--pg-status-ink': '#00FF87', border: '1px solid rgba(0,255,135,0.2)' }}>
              <ExternalLink className="w-3 h-3" /> Transfer Verification
            </a>
          )}
        </div>

        {listing.pg_transfer_notes && (
          <p className="text-xs text-muted-foreground px-1">📝 {listing.pg_transfer_notes}</p>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 space-y-2">
        {!showReject && !showMessage && (
          <div className="flex gap-2">
            <button onClick={() => onApprove(listing)} disabled={isLoading}
              className="pg-operations-status flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
              style={{ background: 'color-mix(in srgb, rgb(0 255 135) 10%, var(--pg-surface))', '--pg-status-ink': '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
              {isLoading ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button onClick={() => setShowReject(true)}
              className="pg-operations-status flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold"
              style={{ background: 'color-mix(in srgb, rgb(255 45 120) 8%, var(--pg-surface))', '--pg-status-ink': '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
              <XCircle className="w-3.5 h-3.5" /> Reject
            </button>
            <button onClick={() => setShowMessage(true)}
              className="pg-operations-status flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: 'color-mix(in srgb, rgb(255 230 0) 8%, var(--pg-surface))', '--pg-status-ink': '#FFE600', border: '1px solid rgba(255,230,0,0.2)' }}>
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {showReject && (
          <div className="space-y-2">
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Rejection reason (shown to seller)…"
              rows={2}
              className="w-full px-3 py-2 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
              style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }} />
            <div className="flex gap-2">
              <button onClick={() => onReject(listing, rejectReason)} disabled={!rejectReason.trim() || isLoading}
                className="flex-1 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
                style={{ background: '#FF2D78', color: '#fff' }}>
                Confirm Reject
              </button>
              <button onClick={() => setShowReject(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground"
                style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {showMessage && (
          <div className="space-y-2">
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Message to seller…"
              rows={2}
              className="w-full px-3 py-2 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
              style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }} />
            <div className="flex gap-2">
              <button onClick={() => { onMessage(listing, message); setShowMessage(false); setMessage(''); }}
                disabled={!message.trim()}
                className="pg-operations-status flex-1 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
                style={{ background: 'color-mix(in srgb, rgb(255 230 0) 15%, var(--pg-surface))', '--pg-status-ink': '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
                Send Message
              </button>
              <button onClick={() => setShowMessage(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground"
                style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PendingReviewQueue({ onRefresh }) {
  const [listings, setListings] = useState([]);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');

  const loadData = async () => {
    setLoading(true);
    const pending = await base44.entities.Listing.filter({ proof_status: 'pending_review' }, '-created_date', 50).catch(() => []);
    setListings(pending);

    const eids = [...new Set(pending.map(l => l.event_id).filter(Boolean))];
    const eMap = {};
    await Promise.all(eids.map(async eid => {
      const res = await base44.entities.Event.filter({ id: eid }).catch(() => []);
      if (res[0]) eMap[eid] = res[0];
    }));
    setEvents(eMap);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleApprove = async (listing) => {
    setActionLoading(listing.id);
    const res = await base44.functions.invoke('approveListingReview', { listing_id: listing.id });
    if (!res.data?.success) {
      console.error('[approve] failed:', res.data?.reason);
      alert(`Approval failed: ${res.data?.reason || 'Unknown error'}`);
    } else {
      await loadData();
      onRefresh?.();
    }
    setActionLoading('');
  };

  const handleReject = async (listing, reason) => {
    setActionLoading(listing.id);
    const res = await base44.functions.invoke('rejectListingReview', { listing_id: listing.id, reason });
    if (!res.data?.success) {
      console.error('[reject] failed:', res.data?.reason);
      alert(`Rejection failed: ${res.data?.reason || 'Unknown error'}`);
    } else {
      await loadData();
      onRefresh?.();
    }
    setActionLoading('');
  };

  const handleMessage = async (listing, message) => {
    // Send as notification + email
    base44.functions.invoke('recordNotification', {
      user_email: listing.seller_email,
      type: 'admin_message',
      title: 'Message from Peanut Gallery',
      body: message,
      reference_id: listing.id,
      reference_type: 'listing',
      action_url: '/my-sales',
    }).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg text-foreground">Pending Review Queue</h2>
          <p className="text-xs text-muted-foreground">
            {listings.length} listing{listings.length !== 1 ? 's' : ''} awaiting approval
          </p>
        </div>
        <button onClick={loadData} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="pg-operations-card h-40 rounded-2xl pg-operations-skeleton animate-pulse" />)}
        </div>
      ) : listings.length === 0 ? (
        <div className="pg-operations-card text-center py-12 rounded-2xl"
          style={{ background: 'color-mix(in srgb, rgb(0 255 135) 5%, var(--pg-surface))', border: '1px solid rgba(0,255,135,0.15)' }}>
          <p className="text-2xl mb-2">✅</p>
          <p className="text-sm font-semibold text-foreground">No listings pending review</p>
          <p className="text-xs text-muted-foreground mt-1">All caught up!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map(listing => (
            <ReviewCard
              key={listing.id}
              listing={listing}
              event={events[listing.event_id]}
              onApprove={handleApprove}
              onReject={handleReject}
              onMessage={handleMessage}
              loading={actionLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}