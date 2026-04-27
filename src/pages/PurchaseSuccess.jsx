import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { CheckCircle, Clock, XCircle, AlertTriangle, ArrowLeft, Ticket, Upload, FileText, ExternalLink, RefreshCw } from 'lucide-react';

// ── Progress bar ────────────────────────────────────────────────────────────
const STEPS = ['Payment Authorized', 'Seller Sending', 'Buyer Confirmed', 'Complete'];

function ProgressBar({ purchase }) {
  const step = purchase.transfer_status === 'completed'
    ? 3
    : purchase.buyer_confirmed
    ? 3
    : purchase.seller_confirmed
    ? 2
    : 1;

  return (
    <div className="mb-8">
      <div className="flex items-center">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                i < step ? 'bg-green-500 border-green-500 text-white'
                : i === step ? 'bg-primary border-primary text-white animate-pulse'
                : 'bg-white border-border text-muted-foreground'
              }`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className="text-[9px] text-muted-foreground mt-1 text-center w-14 leading-tight hidden sm:block">{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 sm:mb-0 transition-all ${i < step ? 'bg-green-400' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Countdown timer (5-minute urgency) ──────────────────────────────────────
function CountdownTimer({ createdAt }) {
  const URGENCY_SECONDS = 5 * 60;
  const [remaining, setRemaining] = useState(URGENCY_SECONDS);

  useEffect(() => {
    const created = createdAt ? new Date(createdAt).getTime() : Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - created) / 1000);
      setRemaining(Math.max(0, URGENCY_SECONDS - elapsed));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isUrgent = remaining < 60;
  const expired = remaining === 0;

  return (
    <div className={`rounded-xl px-4 py-3 flex items-center gap-3 mb-5 border ${
      expired ? 'bg-red-50 border-red-200' : isUrgent ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
    }`}>
      <Clock className={`w-5 h-5 flex-shrink-0 ${isUrgent || expired ? 'text-red-500' : 'text-amber-500'}`} />
      <div>
        <div className={`font-bold text-sm ${isUrgent || expired ? 'text-red-700' : 'text-amber-800'}`}>
          {expired ? 'Transfer overdue — please act now!' : `Transfer now — buyer is waiting`}
        </div>
        <div className={`text-xs ${isUrgent || expired ? 'text-red-600' : 'text-amber-700'}`}>
          {expired ? 'Your response time is being tracked.' : `${mins}:${String(secs).padStart(2, '0')} elapsed since purchase`}
        </div>
      </div>
      {!expired && (
        <div className={`ml-auto font-mono font-bold text-lg ${isUrgent ? 'text-red-600' : 'text-amber-700'}`}>
          {mins}:{String(secs).padStart(2, '0')}
        </div>
      )}
    </div>
  );
}

// ── Transfer platform buttons ────────────────────────────────────────────────
const PLATFORMS = [
  { label: 'Ticketmaster', url: 'https://www.ticketmaster.com/member', color: 'bg-blue-600 hover:bg-blue-700' },
  { label: 'SeatGeek',     url: 'https://seatgeek.com/account/orders', color: 'bg-green-600 hover:bg-green-700' },
  { label: 'StubHub',      url: 'https://www.stubhub.com/selling',     color: 'bg-orange-500 hover:bg-orange-600' },
];

// ── Seller View ──────────────────────────────────────────────────────────────
function SellerPanel({ purchase, onConfirm, actionLoading, error, setError }) {
  const [proofNote, setProofNote] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [proofUploading, setProofUploading] = useState(false);

  const handleConfirm = async () => {
    if (!proofNote.trim() && !proofFile) {
      setError('Please upload a screenshot or add a transfer note before confirming.');
      return;
    }
    setProofUploading(true);
    let proofUrl = null;
    if (proofFile) {
      const uploadRes = await base44.integrations.Core.UploadFile({ file: proofFile });
      proofUrl = uploadRes.file_url;
    }
    setProofUploading(false);
    await onConfirm({ proofUrl, proofNote: proofNote.trim() });
  };

  if (purchase.seller_confirmed) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
          <div>
            <div className="font-bold text-green-800">Tickets Sent ✓</div>
            <div className="text-sm text-green-700">Waiting for buyer to confirm receipt.</div>
          </div>
        </div>
        {(purchase.transfer_notes || purchase.transfer_proof_url) && (
          <div className="bg-white border border-green-200 rounded-xl p-3 text-sm space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Proof Submitted</div>
            {purchase.transfer_notes && <p className="text-foreground">{purchase.transfer_notes}</p>}
            {purchase.transfer_proof_url && (
              <a href={purchase.transfer_proof_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline text-xs font-medium">
                <FileText className="w-3.5 h-3.5" /> View screenshot
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary/10 to-amber-50 border-b border-border px-5 py-4">
        <h2 className="font-bold text-lg text-foreground">Transfer Your Tickets Now</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Follow the steps below to complete this sale</p>
      </div>

      <div className="p-5 space-y-5">
        {/* Buyer info */}
        <div className="bg-secondary rounded-xl p-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Transfer To</div>
          <div className="space-y-1 text-sm">
            <div className="font-semibold text-foreground">{purchase.buyer_name || 'Buyer'}</div>
            <div className="text-primary font-medium">{purchase.buyer_email}</div>
            {purchase.buyer_phone && <div className="text-muted-foreground">{purchase.buyer_phone}</div>}
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
            <div>
              <div className="font-semibold text-sm">Open your ticket platform</div>
              <div className="text-xs text-muted-foreground mb-2">Transfer tickets to the buyer's email above</div>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map(p => (
                  <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold transition-colors ${p.color}`}>
                    {p.label} <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
            <div className="flex-1">
              <div className="font-semibold text-sm">Upload proof of transfer</div>
              <div className="text-xs text-muted-foreground mb-2">Screenshot of the transfer confirmation screen</div>
              <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed border-border rounded-xl px-4 py-3 hover:border-primary/40 hover:bg-primary/5 transition-all text-sm text-muted-foreground">
                <Upload className="w-4 h-4 flex-shrink-0 text-primary" />
                {proofFile
                  ? <span className="text-foreground font-medium truncate">{proofFile.name}</span>
                  : <span>Tap to upload screenshot</span>}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setProofFile(e.target.files[0] || null)} />
              </label>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</div>
            <div className="flex-1">
              <div className="font-semibold text-sm">Add a transfer note <span className="text-muted-foreground font-normal">(optional if screenshot provided)</span></div>
              <textarea
                value={proofNote}
                onChange={e => setProofNote(e.target.value)}
                placeholder="e.g. Transferred via Ticketmaster to buyer's email at 7:32 PM"
                rows={2}
                className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={actionLoading}
          className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl font-bold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {proofUploading ? (
            <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Uploading proof…</>
          ) : actionLoading ? (
            <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Confirming…</>
          ) : (
            <><CheckCircle className="w-4 h-4" /> I've Sent the Tickets</>
          )}
        </button>

        <p className="text-xs text-center text-muted-foreground">
          Payment will be released once the buyer confirms receipt.
        </p>
      </div>
    </div>
  );
}

// ── Buyer View ───────────────────────────────────────────────────────────────
function BuyerPanel({ purchase, onConfirm, onDispute, onCancel, actionLoading }) {
  if (purchase.buyer_confirmed) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-5 flex items-center gap-3">
        <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
        <div>
          <div className="font-bold text-green-800">You confirmed receipt ✓</div>
          <div className="text-sm text-green-700">Payment has been released to the seller.</div>
        </div>
      </div>
    );
  }

  if (!purchase.seller_confirmed) {
    return (
      <div className="bg-white border border-border rounded-2xl p-5 space-y-4">
        {/* Waiting banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Clock className="w-4 h-4 text-blue-600 animate-pulse" />
          </div>
          <div>
            <div className="font-bold text-blue-900 text-sm">Waiting for Seller to Transfer</div>
            <div className="text-xs text-blue-700 mt-0.5">The seller has been notified and is processing your tickets.</div>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            Average transfer time is <span className="font-semibold text-foreground mx-1">under 5 minutes</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            Your payment is held in escrow — fully protected
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            This page refreshes automatically every 15 seconds
          </div>
        </div>

        <div className="bg-secondary rounded-xl p-3 text-xs text-muted-foreground text-center">
          Check your email — the ticket transfer invite may arrive before this page updates.
        </div>

        <button
          onClick={onCancel}
          disabled={actionLoading}
          className="w-full border border-border text-muted-foreground py-2.5 rounded-xl text-sm hover:bg-muted transition-colors disabled:opacity-60"
        >
          Cancel Purchase & Refund
        </button>
      </div>
    );
  }

  // Seller has confirmed — prompt buyer to verify
  return (
    <div className="bg-white border border-border rounded-2xl p-5 space-y-4">
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <div className="font-bold text-green-800 text-sm mb-1">🎟 Seller has sent your tickets!</div>
        <div className="text-xs text-green-700">Check your email and the ticket platform for the transfer invite.</div>
      </div>

      {/* Seller's proof */}
      {(purchase.transfer_notes || purchase.transfer_proof_url) && (
        <div className="bg-secondary border border-border rounded-xl p-3 text-sm space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Seller's Transfer Proof</div>
          {purchase.transfer_notes && <p className="text-foreground">{purchase.transfer_notes}</p>}
          {purchase.transfer_proof_url && (
            <a href={purchase.transfer_proof_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:underline text-xs font-medium">
              <FileText className="w-3.5 h-3.5" /> View screenshot
            </a>
          )}
        </div>
      )}

      <button
        onClick={() => onConfirm('buyer')}
        disabled={actionLoading}
        className="w-full bg-accent text-accent-foreground py-3.5 rounded-xl font-bold text-sm hover:bg-accent/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {actionLoading
          ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Processing…</>
          : <><CheckCircle className="w-4 h-4" /> I Received My Tickets</>
        }
      </button>

      <div className="flex gap-2">
        <button
          onClick={onDispute}
          disabled={actionLoading}
          className="flex-1 border border-amber-300 text-amber-700 bg-amber-50 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-100 transition-colors"
        >
          Open Dispute
        </button>
        <button
          onClick={onCancel}
          disabled={actionLoading}
          className="flex-1 border border-border text-muted-foreground py-2.5 rounded-xl text-sm hover:bg-muted transition-colors"
        >
          Cancel & Refund
        </button>
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Only confirm once you've accepted the ticket transfer.
      </p>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function PurchaseSuccess() {
  const { id } = useParams();
  const [purchase, setPurchase] = useState(null);
  const [listing, setListing] = useState(null);
  const [event, setEvent] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const autoRefreshRef = useRef(null);

  const load = async () => {
    const [me, purchases] = await Promise.all([
      base44.auth.me().catch(() => null),
      base44.entities.Purchase.filter({ id }),
    ]);
    setUser(me);
    const p = purchases[0];
    if (p) {
      setPurchase(p);
      const [listings, events] = await Promise.all([
        base44.entities.Listing.filter({ id: p.listing_id }),
        base44.entities.Event.filter({ id: p.event_id }),
      ]);
      setListing(listings[0] || null);
      setEvent(events[0] || null);
    }
  };

  useEffect(() => {
    load().catch(console.error).finally(() => setLoading(false));
  }, [id]);

  // Auto-refresh every 15s for buyer while pending
  useEffect(() => {
    if (!purchase) return;
    const isBuyerView = user?.email === purchase.buyer_email;
    const isPending = purchase.transfer_status === 'pending_transfer';
    if (isBuyerView && isPending) {
      autoRefreshRef.current = setInterval(() => load().catch(console.error), 15000);
    }
    return () => clearInterval(autoRefreshRef.current);
  }, [purchase?.transfer_status, user?.email]);

  const handleSellerConfirm = async ({ proofUrl, proofNote }) => {
    setActionLoading(true);
    setError('');
    await base44.entities.Purchase.update(purchase.id, {
      ...(proofUrl ? { transfer_proof_url: proofUrl } : {}),
      ...(proofNote ? { transfer_notes: proofNote } : {}),
    });
    const res = await base44.functions.invoke('capturePayment', {
      purchase_id: purchase.id,
      confirming_role: 'seller',
    });
    if (res.data.error) setError(res.data.error);
    else await load();
    setActionLoading(false);
  };

  const handleConfirm = async (role) => {
    setActionLoading(true);
    setError('');
    const res = await base44.functions.invoke('capturePayment', {
      purchase_id: purchase.id,
      confirming_role: role,
    });
    if (res.data.error) setError(res.data.error);
    else await load();
    setActionLoading(false);
  };

  const handleCancel = async () => {
    if (!confirm('Cancel this purchase? The payment will be refunded.')) return;
    setActionLoading(true);
    setError('');
    const res = await base44.functions.invoke('cancelPurchase', { purchase_id: purchase.id });
    if (res.data.error) setError(res.data.error);
    else await load();
    setActionLoading(false);
  };

  const handleDispute = async () => {
    const reason = prompt('Please describe the issue:');
    if (!reason) return;
    await base44.entities.Purchase.update(purchase.id, {
      transfer_status: 'disputed',
      dispute_reason: reason,
    });
    await load();
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin inline-block" />
        <p className="text-sm text-muted-foreground mt-3">Loading transfer details…</p>
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center text-muted-foreground">
        <p>Purchase not found.</p>
        <Link to="/events" className="text-primary text-sm mt-3 inline-block">← Browse events</Link>
      </div>
    );
  }

  const isBuyer = user?.email === purchase.buyer_email;
  const isSeller = !isBuyer && (user?.email === purchase.seller_email || user?.role === 'admin');
  const isCompleted = purchase.transfer_status === 'completed';
  const isExpired = purchase.transfer_status === 'expired';
  const isDisputed = purchase.transfer_status === 'disputed';
  const isPending = purchase.transfer_status === 'pending_transfer';

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-12">
      <Link to="/events" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      {/* Terminal status banners */}
      {isCompleted && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl p-4 mb-5">
          <CheckCircle className="w-7 h-7 text-green-600 flex-shrink-0" />
          <div>
            <div className="font-bold text-green-800">Transfer Complete! 🎉</div>
            <div className="text-sm text-green-700 mt-0.5">Payment released. Enjoy the upgrade!</div>
          </div>
        </div>
      )}
      {isExpired && (
        <div className="flex items-center gap-3 bg-muted rounded-2xl p-4 mb-5">
          <XCircle className="w-6 h-6 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-semibold">Purchase Cancelled</div>
            <div className="text-sm text-muted-foreground">Refund issued to your original payment method.</div>
          </div>
        </div>
      )}
      {isDisputed && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5">
          <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0" />
          <div>
            <div className="font-bold text-amber-800">Dispute Open</div>
            <div className="text-sm text-amber-700">Payment frozen. Our team will review and resolve.</div>
          </div>
        </div>
      )}

      {/* Order summary card */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden mb-5">
        <div className="bg-secondary px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-primary" />
            <span className="font-bold text-sm">{event?.title || 'Your Upgrade'}</span>
          </div>
          {isBuyer && isPending && (
            <button onClick={() => load().catch(console.error)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          )}
        </div>
        {listing && (
          <div className="px-5 py-4 grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Section</div><div className="font-bold">{listing.section}</div></div>
            <div><div className="text-xs text-muted-foreground">Row</div><div className="font-bold">{listing.row}</div></div>
            <div><div className="text-xs text-muted-foreground">Qty</div><div className="font-bold">{purchase.quantity}</div></div>
          </div>
        )}
        <div className="border-t border-border px-5 py-3 flex justify-between font-bold text-sm">
          <span>Total Paid</span>
          <span>${purchase.amount?.toFixed(2)}</span>
        </div>
      </div>

      {/* Progress bar */}
      {isPending && <ProgressBar purchase={purchase} />}

      {/* Urgency countdown — seller only, while unsent */}
      {isPending && isSeller && !purchase.seller_confirmed && (
        <CountdownTimer createdAt={purchase.created_date} />
      )}

      {/* Role-specific panels */}
      {isPending && isSeller && (
        <SellerPanel
          purchase={purchase}
          onConfirm={handleSellerConfirm}
          actionLoading={actionLoading}
          error={error}
          setError={setError}
        />
      )}
      {isPending && isBuyer && (
        <BuyerPanel
          purchase={purchase}
          onConfirm={handleConfirm}
          onDispute={handleDispute}
          onCancel={handleCancel}
          actionLoading={actionLoading}
        />
      )}

      {!isPending && error && (
        <div className="mt-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}