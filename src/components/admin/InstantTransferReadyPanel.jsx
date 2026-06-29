import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { RefreshCw, AlertTriangle, CheckCircle, RotateCcw, XCircle, Package } from 'lucide-react';

const CUSTODY_LABELS = {
  not_received: { label: 'Not Received', color: '#FF8C00', bg: 'rgba(255,140,0,0.1)' },
  pending:      { label: 'Pending',       color: '#FFE600', bg: 'rgba(255,230,0,0.1)' },
  received:     { label: 'Received ✓',   color: '#00C8FF', bg: 'rgba(0,200,255,0.1)' },
  delivered_to_buyer: { label: 'Delivered to Buyer', color: '#00FF87', bg: 'rgba(0,255,135,0.1)' },
  returned_to_seller: { label: 'Returned to Seller', color: '#BF5FFF', bg: 'rgba(191,95,255,0.1)' },
  failed:  { label: 'Failed',   color: '#FF2D78', bg: 'rgba(255,45,120,0.1)' },
  expired: { label: 'Expired',  color: '#666',    bg: 'rgba(102,102,102,0.1)' },
};

const STATUS_TRANSITIONS = [
  { value: 'pending',           label: '⏳ Mark Pending' },
  { value: 'received',          label: '📬 Mark Received' },
  { value: 'delivered_to_buyer',label: '✅ Mark Delivered to Buyer' },
  { value: 'returned_to_seller',label: '↩️ Mark Returned to Seller' },
  { value: 'failed',            label: '❌ Mark Failed' },
  { value: 'expired',           label: '🕐 Mark Expired' },
];

export default function InstantTransferReadyPanel() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [failureReason, setFailureReason] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    setLoading(true);
    const data = await base44.entities.Listing.filter({ listing_transfer_mode: 'instant_transfer_ready' }, '-created_date', 100);
    setListings(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateCustody = async (listing, newStatus, extraFields = {}) => {
    setUpdating(listing.id);
    const patch = {
      ticket_custody_status: newStatus,
      ...extraFields,
    };
    if (newStatus === 'received') patch.custody_received_at = new Date().toISOString();
    if (newStatus === 'delivered_to_buyer') patch.buyer_delivered_at = new Date().toISOString();
    if (newStatus === 'returned_to_seller') patch.returned_to_seller_at = new Date().toISOString();

    await base44.entities.Listing.update(listing.id, patch);
    await load();
    setUpdating(null);
  };

  const triggerRefund = async (listing) => {
    if (!window.confirm(`Trigger refund workflow for listing ${listing.id}? This will mark the listing as failed and notify the buyer.`)) return;
    setUpdating(listing.id);
    await base44.entities.Listing.update(listing.id, {
      ticket_custody_status: 'failed',
      status: 'cancelled',
      transfer_failure_reason: failureReason || 'Delivery failed — buyer refund initiated by admin.',
    });
    // Create admin alert for manual refund processing
    await base44.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'critical',
      title: `ITR Delivery Failed — Refund Required`,
      description: `Instant Transfer Ready listing ${listing.id} failed delivery. Manual Stripe refund required for buyer ${listing.reserved_by_email || 'unknown'}. Failure: ${failureReason || 'Not specified'}`,
      reference_id: listing.id,
      reference_type: 'listing',
      seller_email: listing.seller_email,
    }).catch(() => {});
    await load();
    setUpdating(null);
  };

  const flagSeller = async (listing) => {
    if (!window.confirm(`Flag seller ${listing.seller_email} for invalid ticket on listing ${listing.id}?`)) return;
    await base44.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'high',
      title: `Seller Flag: Invalid Ticket`,
      description: `Seller ${listing.seller_email} submitted an invalid ticket for Instant Transfer Ready listing ${listing.id}. Review and consider account action.`,
      reference_id: listing.id,
      reference_type: 'listing',
      seller_email: listing.seller_email,
    });
    alert('Seller flagged. Admin alert created.');
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-foreground text-lg">Instant Transfer Ready</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Listings where sellers authorized PG as limited transfer agent. PG does not own these tickets.
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-xl" style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Disclaimer banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-2xl"
        style={{ background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.25)' }}>
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#FF8C00' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,200,130,0.9)' }}>
          PG acts as a <strong style={{ color: '#FF8C00' }}>limited transfer agent only</strong>. Sellers retain ownership. Do not mark "Received" unless the ticket has been physically transferred to the PG account. Refund buyers immediately if delivery fails.
        </p>
      </div>

      {listings.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <Package className="w-10 h-10 text-muted-foreground mx-auto opacity-40" />
          <p className="text-sm text-muted-foreground">No Instant Transfer Ready listings yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map(listing => {
            const custody = CUSTODY_LABELS[listing.ticket_custody_status || 'not_received'];
            const isExpanded = expandedId === listing.id;

            return (
              <div key={listing.id} className="rounded-2xl overflow-hidden"
                style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                {/* Header row */}
                <button
                  className="w-full px-4 py-3.5 text-left flex items-center gap-3"
                  onClick={() => setExpandedId(isExpanded ? null : listing.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground">Sec {listing.section} · Row {listing.row}</span>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: custody.bg, color: custody.color }}>
                        {custody.label}
                      </span>
                      {listing.status === 'cancelled' && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(255,45,120,0.1)', color: '#FF2D78' }}>
                          Cancelled
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {listing.seller_email} · ${listing.asking_price}/ea · {listing.quantity || 1} ticket{(listing.quantity || 1) !== 1 ? 's' : ''}
                    </p>
                    {listing.created_date && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Listed {format(new Date(listing.created_date), 'MMM d, h:mm a')}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">{isExpanded ? '▲' : '▼'}</span>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: 'hsl(var(--border))' }}>
                    {/* Key fields */}
                    <div className="grid grid-cols-2 gap-2 pt-3">
                      {[
                        { label: 'Ownership Confirmed', value: listing.seller_ownership_confirmed ? '✓ Yes' : '✗ No' },
                        { label: 'Transfer Auth Granted', value: listing.limited_transfer_authorization ? '✓ Yes' : '✗ No' },
                        { label: 'Custody Status', value: custody.label },
                        { label: 'Listing Status', value: listing.status || '—' },
                        { label: 'Received At', value: listing.custody_received_at ? format(new Date(listing.custody_received_at), 'MMM d, h:mm a') : '—' },
                        { label: 'Delivered At', value: listing.buyer_delivered_at ? format(new Date(listing.buyer_delivered_at), 'MMM d, h:mm a') : '—' },
                        { label: 'Returned At', value: listing.returned_to_seller_at ? format(new Date(listing.returned_to_seller_at), 'MMM d, h:mm a') : '—' },
                        { label: 'Seller Release Deadline', value: listing.seller_release_deadline ? format(new Date(listing.seller_release_deadline), 'MMM d, h:mm a') : '—' },
                      ].map(({ label, value }) => (
                        <div key={label} className="px-3 py-2 rounded-xl"
                          style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                          <p className="text-[10px] text-muted-foreground">{label}</p>
                          <p className="text-xs font-bold text-foreground mt-0.5">{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Transfer proof */}
                    {listing.pg_transfer_proof_url && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1">Transfer Proof</p>
                        <a href={listing.pg_transfer_proof_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-bold underline"
                          style={{ color: '#00C8FF' }}>
                          View Screenshot ↗
                        </a>
                      </div>
                    )}

                    {/* Failure reason input */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Failure reason (for refund/flag actions)</label>
                      <input
                        type="text"
                        value={failureReason}
                        onChange={e => setFailureReason(e.target.value)}
                        placeholder="e.g. Ticket already used, transfer reversed by TM…"
                        className="w-full px-3 py-2 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                        style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))' }}
                      />
                    </div>

                    {/* Custody status actions */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">Update Custody Status</p>
                      <div className="grid grid-cols-2 gap-2">
                        {STATUS_TRANSITIONS.map(opt => (
                          <button
                            key={opt.value}
                            disabled={!!updating || listing.ticket_custody_status === opt.value}
                            onClick={() => updateCustody(listing, opt.value)}
                            className="px-3 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-40 text-left"
                            style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                          >
                            {updating === listing.id ? '…' : opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Danger actions */}
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => triggerRefund(listing)}
                        disabled={!!updating}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                        style={{ background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.3)', color: '#FF2D78' }}
                      >
                        <XCircle className="w-3.5 h-3.5" /> Trigger Refund Workflow
                      </button>
                      <button
                        onClick={() => flagSeller(listing)}
                        disabled={!!updating}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                        style={{ background: 'rgba(255,140,0,0.1)', border: '1px solid rgba(255,140,0,0.3)', color: '#FF8C00' }}
                      >
                        <AlertTriangle className="w-3.5 h-3.5" /> Flag Seller
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}