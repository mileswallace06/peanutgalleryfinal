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
    <div className="rounded-2xl overflow-hidden text-sm"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3"
        style={{ background: 'rgba(255,230,0,0.06)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
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
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,230,0,0.15)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
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
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'rgba(0,200,255,0.1)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.25)' }}>
            ⚡ Instant Listing — verify PG has custody before approving
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {listing.proof_url && (
            <a href={listing.proof_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(191,95,255,0.1)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>
              <ExternalLink className="w-3 h-3" /> Ticket Proof
            </a>
          )}
          {listing.pg_transfer_proof_url && (
            <a href={listing.pg_transfer_proof_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(0,200,255,0.1)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.25)' }}>
              <ExternalLink className="w-3 h-3" /> PG Transfer Proof
            </a>
          )}
          {listing.transfer_verification_proof_url && (
            <a href={listing.transfer_verification_proof_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(0,255,135,0.08)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.2)' }}>
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
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
              style={{ background: 'rgba(0,255,135,0.1)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
              {isLoading ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button onClick={() => setShowReject(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(255,45,120,0.08)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
              <XCircle className="w-3.5 h-3.5" /> Reject
            </button>
            <button onClick={() => setShowMessage(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(255,230,0,0.08)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.2)' }}>
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
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }} />
            <div className="flex gap-2">
              <button onClick={() => onReject(listing, rejectReason)} disabled={!rejectReason.trim() || isLoading}
                className="flex-1 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
                style={{ background: '#FF2D78', color: '#fff' }}>
                Confirm Reject
              </button>
              <button onClick={() => setShowReject(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
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
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }} />
            <div className="flex gap-2">
              <button onClick={() => { onMessage(listing, message); setShowMessage(false); setMessage(''); }}
                disabled={!message.trim()}
                className="flex-1 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
                style={{ background: 'rgba(255,230,0,0.15)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
                Send Message
              </button>
              <button onClick={() => setShowMessage(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
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
    const user = await base44.auth.me().catch(() => null);
    await base44.entities.Listing.update(listing.id, {
      proof_status: 'approved',
      status: 'active',
    }).catch(() => {});

    // Audit log
    base44.entities.BetaTransferLog.create({
      log_type: 'listing_restored',
      actor_email: user?.email || 'admin',
      actor_role: 'admin',
      listing_id: listing.id,
      before_state: { proof_status: 'pending_review', status: listing.status },
      after_state: { proof_status: 'approved', status: 'active' },
      notes: 'Admin approved listing via Review Queue',
    }).catch(() => {});

    // Notify seller
    base44.functions.invoke('recordNotification', {
      user_email: listing.seller_email,
      type: 'listing_approved',
      title: 'Listing approved ✅',
      body: `Your listing (Sec ${listing.section}, Row ${listing.row}) is now live and visible to buyers.`,
      reference_id: listing.id,
      reference_type: 'listing',
      action_url: '/my-sales',
    }).catch(() => {});

    await loadData();
    onRefresh?.();
    setActionLoading('');
  };

  const handleReject = async (listing, reason) => {
    setActionLoading(listing.id);
    const user = await base44.auth.me().catch(() => null);
    await base44.entities.Listing.update(listing.id, {
      proof_status: 'rejected',
      status: 'hidden',
      hidden_reason: 'admin_disabled',
      proof_rejection_reason: reason,
    }).catch(() => {});

    // Audit log
    base44.entities.BetaTransferLog.create({
      log_type: 'listing_hidden',
      actor_email: user?.email || 'admin',
      actor_role: 'admin',
      listing_id: listing.id,
      before_state: { proof_status: 'pending_review', status: listing.status },
      after_state: { proof_status: 'rejected', status: 'hidden', hidden_reason: 'admin_disabled' },
      notes: `Admin rejected listing. Reason: ${reason}`,
    }).catch(() => {});

    // Notify seller
    base44.functions.invoke('recordNotification', {
      user_email: listing.seller_email,
      type: 'listing_rejected',
      title: 'Listing not approved',
      body: `Your listing (Sec ${listing.section}, Row ${listing.row}) was not approved. Reason: ${reason}`,
      reference_id: listing.id,
      reference_type: 'listing',
      action_url: '/my-sales',
    }).catch(() => {});

    await loadData();
    onRefresh?.();
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
          {[1, 2].map(i => <div key={i} className="h-40 rounded-2xl bg-white/5 animate-pulse" />)}
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-12 rounded-2xl"
          style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.15)' }}>
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