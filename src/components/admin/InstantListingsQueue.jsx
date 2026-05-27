import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle, XCircle, Zap, FileText, ExternalLink } from 'lucide-react';

export default function InstantListingsQueue({ listings, user, onRefresh }) {
  const [actionLoading, setActionLoading] = useState('');
  const [rejectReason, setRejectReason] = useState({});

  const instantPending = listings.filter(
    l => l.listing_mode === 'instant' && l.custody_status === 'pending_pg_verification'
  );
  const instantVerified = listings.filter(
    l => l.listing_mode === 'instant' && l.custody_status === 'verified' && l.status === 'active'
  );

  const handleVerify = async (listing) => {
    setActionLoading(listing.id + '_verify');
    await base44.entities.Listing.update(listing.id, {
      custody_status: 'verified',
      status: 'active',
      proof_status: 'approved',
    });
    await onRefresh();
    setActionLoading('');
  };

  const handleReject = async (listing) => {
    const reason = rejectReason[listing.id] || 'Custody proof insufficient';
    setActionLoading(listing.id + '_reject');
    await base44.entities.Listing.update(listing.id, {
      custody_status: 'rejected',
      status: 'cancelled',
      proof_status: 'rejected',
      proof_rejection_reason: reason,
    });
    await onRefresh();
    setActionLoading('');
  };

  const handleMarkFulfilled = async (listing, purchaseId) => {
    setActionLoading(listing.id + '_fulfill');
    const now = new Date().toISOString();
    await base44.entities.Listing.update(listing.id, {
      pg_fulfilled_at: now,
      pg_fulfilled_by: user?.email || 'admin',
    });
    // Also mark seller_confirmed on the purchase so buyer can confirm receipt
    if (purchaseId) {
      await base44.entities.Purchase.update(purchaseId, { seller_confirmed: true });
    }
    await onRefresh();
    setActionLoading('');
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-5 h-5" style={{ color: '#00C8FF' }} />
        <h2 className="font-bold text-lg">Instant Listings</h2>
        <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(0,200,255,0.12)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
          {instantPending.length} pending
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Sellers have transferred tickets to PG. Verify custody before listing goes live.
      </p>

      {/* Pending verification */}
      {instantPending.length === 0 && (
        <p className="text-sm text-muted-foreground mb-4">No listings pending custody verification.</p>
      )}
      <div className="space-y-3 mb-6">
        {instantPending.map(l => (
          <div key={l.id} className="rounded-xl p-4 space-y-3 text-sm"
            style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.2)' }}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <div className="font-semibold text-foreground">Section {l.section} · Row {l.row} · ${l.asking_price}/ea</div>
                <div className="text-xs text-muted-foreground mt-0.5">{l.seller_email}</div>
              </div>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(0,200,255,0.15)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
                ⚡ INSTANT
              </span>
            </div>

            {/* Proof links */}
            <div className="flex flex-wrap gap-2 text-xs">
              {l.pg_transfer_proof_url && (
                <a href={l.pg_transfer_proof_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
                  style={{ background: 'rgba(191,95,255,0.1)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.25)' }}>
                  <FileText className="w-3 h-3" /> Transfer Proof <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
              {l.proof_url && (
                <a href={l.proof_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }}>
                  <FileText className="w-3 h-3" /> Original Proof <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>

            {l.pg_transfer_notes && (
              <div className="text-xs text-muted-foreground px-3 py-2 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                "{l.pg_transfer_notes}"
              </div>
            )}

            {/* Reject reason input */}
            <input
              type="text"
              value={rejectReason[l.id] || ''}
              onChange={e => setRejectReason(prev => ({ ...prev, [l.id]: e.target.value }))}
              placeholder="Reject reason (optional)"
              className="w-full px-3 py-1.5 rounded-lg text-xs focus:outline-none"
              style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
            />

            <div className="flex gap-2">
              <button
                onClick={() => handleVerify(l)}
                disabled={!!actionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
                {actionLoading === l.id + '_verify'
                  ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <CheckCircle className="w-3.5 h-3.5" />}
                Verify & Go Live
              </button>
              <button
                onClick={() => handleReject(l)}
                disabled={!!actionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'rgba(255,45,120,0.1)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
                {actionLoading === l.id + '_reject'
                  ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <XCircle className="w-3.5 h-3.5" />}
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Verified + sold — awaiting PG fulfillment */}
      {instantVerified.length > 0 && (
        <>
          <div className="text-xs font-black tracking-widest uppercase mb-2" style={{ color: '#00FF87' }}>
            Live Instant Listings ({instantVerified.length})
          </div>
          <div className="space-y-2">
            {instantVerified.map(l => (
              <div key={l.id} className="rounded-xl px-4 py-3 flex items-center justify-between gap-2 text-sm"
                style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.15)' }}>
                <div>
                  <span className="font-semibold text-foreground">Sec {l.section} · Row {l.row}</span>
                  <span className="text-xs text-muted-foreground ml-2">{l.seller_email}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.25)' }}>
                  ✓ Verified
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}