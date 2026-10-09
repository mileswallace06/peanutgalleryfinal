import { adminEventIdentity } from '@/lib/salesPresentation';
import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle, XCircle, ExternalLink } from 'lucide-react';

function StatCard({ label, value, color }) {
  return (
    <div className="pg-operations-card rounded-xl p-4 text-center" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
      <div className="pg-operations-status text-2xl font-black" style={{ '--pg-status-ink': color || 'var(--pg-text)' }}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

export default function InstantOpsPanel({ purchases, listings, events, onRefresh }) {
  const [loading, setLoading] = useState('');

  const instantListings = listings.filter(l => l.listing_mode === 'instant');
  const awaitingCustody = instantListings.filter(l => l.custody_status === 'pending_pg_verification');
  const custodyVerified = instantListings.filter(l => l.custody_status === 'verified');
  const rejected = instantListings.filter(l => l.custody_status === 'rejected');

  const instantPurchases = purchases.filter(p => {
    const listing = listings.find(l => l.id === p.listing_id);
    return listing?.listing_mode === 'instant';
  });
  const awaitingFulfillment = instantPurchases.filter(p =>
    p.transfer_status === 'pending_transfer' && !p.buyer_confirmed
  );
  const fulfilled = instantPurchases.filter(p => p.transfer_status === 'completed');

  const act = async (action, id, extra = {}) => {
    setLoading(action + id);
    if (action === 'approve_custody') {
      await base44.entities.Listing.update(id, { custody_status: 'verified', status: 'active', ...extra });
    } else if (action === 'reject_custody') {
      await base44.entities.Listing.update(id, { custody_status: 'rejected', status: 'cancelled' });
    } else if (action === 'mark_fulfilled') {
      await base44.entities.Purchase.update(id, { seller_confirmed: true, fulfillment_status: 'fulfilled' });
    }
    await onRefresh();
    setLoading('');
  };

  return (
    <div className="space-y-6">
      <h2 className="font-bold text-foreground text-lg">Instant Transfer Ops</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Awaiting Custody" value={awaitingCustody.length} color={awaitingCustody.length > 0 ? '#FF8C00' : '#888'} />
        <StatCard label="Custody Verified" value={custodyVerified.length} color="#00FF87" />
        <StatCard label="Awaiting Fulfillment" value={awaitingFulfillment.length} color={awaitingFulfillment.length > 0 ? '#FF8C00' : '#888'} />
        <StatCard label="Fulfilled" value={fulfilled.length} color="#00C8FF" />
      </div>

      {/* Awaiting custody review */}
      {awaitingCustody.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Awaiting PG Custody Review ({awaitingCustody.length})
          </h3>
          <div className="space-y-3">
            {awaitingCustody.map(l => (
              <div key={l.id} className="pg-operations-card rounded-xl p-4 text-sm space-y-3"
                style={{ background: 'color-mix(in srgb, rgb(255 140 0) 8%, var(--pg-surface))', border: '1px solid rgba(255,140,0,0.3)' }}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-semibold text-foreground">Sec {l.section} Row {l.row} — ${l.asking_price}/ea</div>
                    <div className="text-xs text-muted-foreground">{l.seller_email} · {l.quantity} ticket{l.quantity !== 1 ? 's' : ''}</div>
                    {l.pg_transfer_notes && <div className="text-xs text-muted-foreground mt-1 italic">"{l.pg_transfer_notes}"</div>}
                  </div>
                </div>
                {l.pg_transfer_proof_url && (
                  <a href={l.pg_transfer_proof_url} target="_blank" rel="noopener noreferrer"
                    className="pg-operations-status inline-flex items-center gap-1.5 text-xs font-medium"
                    style={{ '--pg-status-ink': '#BF5FFF' }}>
                    <ExternalLink className="w-3 h-3" /> View submitted proof
                  </a>
                )}
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => act('approve_custody', l.id)}
                    disabled={!!loading}
                    className="pg-operations-status flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                    style={{ background: 'color-mix(in srgb, rgb(0 255 135) 12%, var(--pg-surface))', '--pg-status-ink': '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
                    {loading === 'approve_custody' + l.id
                      ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      : <CheckCircle className="w-3 h-3" />}
                    Approve Custody
                  </button>
                  <button onClick={() => act('reject_custody', l.id)}
                    disabled={!!loading}
                    className="pg-operations-status flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                    style={{ background: 'color-mix(in srgb, rgb(255 45 120) 10%, var(--pg-surface))', '--pg-status-ink': '#FF2D78', border: '1px solid rgba(255,45,120,0.3)' }}>
                    <XCircle className="w-3 h-3" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Awaiting fulfillment */}
      {awaitingFulfillment.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Awaiting Fulfillment ({awaitingFulfillment.length})
          </h3>
          <div className="space-y-3">
            {awaitingFulfillment.map(p => {
              const ev = events[p.event_id];
              return (
                <div key={p.id} className="pg-operations-card rounded-xl p-4 text-sm space-y-2"
                  style={{ background: 'color-mix(in srgb, rgb(0 200 255) 6%, var(--pg-surface))', border: '1px solid rgba(0,200,255,0.2)' }}>
                  <div className="font-semibold text-foreground">{adminEventIdentity(ev, p.event_id)}</div>
                  <div className="text-xs text-muted-foreground">
                    Buyer: {p.buyer_email} · ${p.amount?.toFixed(2)}
                  </div>
                  <div className="pg-operations-status flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full w-fit"
                    style={{ background: 'color-mix(in srgb, rgb(0 200 255) 10%, var(--pg-surface))', '--pg-status-ink': '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
                    Status: {p.fulfillment_status || 'awaiting_pg_transfer'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {awaitingCustody.length === 0 && awaitingFulfillment.length === 0 && (
        <div className="pg-operations-card text-center py-10 rounded-2xl" style={{ background: 'color-mix(in srgb, rgb(0 255 135) 4%, var(--pg-surface))', border: '1px solid rgba(0,255,135,0.15)' }}>
          <div className="text-2xl mb-2">⚡</div>
          <div className="text-sm text-muted-foreground">No instant ops need attention right now.</div>
        </div>
      )}
    </div>
  );
}