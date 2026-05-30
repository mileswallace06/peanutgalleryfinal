import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { CheckCircle, Clock, XCircle, AlertTriangle, ArrowLeft, Ticket, Upload, FileText, ExternalLink, RefreshCw, Sparkles, Send } from 'lucide-react';
import DisputeModal from '@/components/purchase/DisputeModal';
import AIVerificationStatus from '@/components/purchase/AIVerificationStatus';
import { createOptimisticPurchaseUpdate } from '@/lib/optimisticUI';
import NotificationPermissionPrompt from '@/components/NotificationPermissionPrompt';

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
    <div className="mb-6">
      <div className="flex items-center">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                i < step ? 'border-transparent text-black' :
                i === step ? 'border-primary text-primary animate-pulse' :
                'border-border text-muted-foreground'
              }`} style={i < step ? { background: 'linear-gradient(135deg, #00FF87, #00C8FF)' } : {}}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className="text-[9px] text-muted-foreground mt-1 text-center w-14 leading-tight hidden sm:block">{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 sm:mb-0 transition-all ${i < step ? '' : 'bg-border'}`}
                style={i < step ? { background: 'linear-gradient(90deg, #00FF87, #00C8FF)' } : {}} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Transfer platform buttons ────────────────────────────────────────────────
const PLATFORMS = [
  { label: 'Ticketmaster', url: 'https://www.ticketmaster.com/member', color: '#006AFF' },
  { label: 'SeatGeek',     url: 'https://seatgeek.com/account/orders', color: '#00A651' },
  { label: 'StubHub',      url: 'https://www.stubhub.com/selling',     color: '#FF5C00' },
];

// ── Seller View ──────────────────────────────────────────────────────────────
function SellerPanel({ purchase, onConfirm, actionLoading, error, setError, user }) {
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

  // Seller confirmed — waiting on buyer
  if (purchase.seller_confirmed) {
    return (
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,200,255,0.3)', background: 'rgba(0,200,255,0.06)' }}>
        {/* Hero state */}
        <div className="px-5 pt-6 pb-5 text-center" style={{ borderBottom: '1px solid rgba(0,200,255,0.15)' }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: 'linear-gradient(135deg, #00C8FF33, #BF5FFF33)', border: '2px solid rgba(0,200,255,0.4)' }}>
            <Send className="w-6 h-6" style={{ color: '#00C8FF' }} />
          </div>
          <h2 className="font-display text-2xl text-foreground mb-1">Tickets Sent 🚀</h2>
          <p className="text-sm text-muted-foreground">We're waiting for the buyer to confirm receipt.</p>
        </div>

        {/* Status pill */}
        <div className="px-5 py-4 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
            style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}>
            <Clock className="w-4 h-4 animate-pulse" /> Waiting on buyer confirmation
          </div>
          <p className="text-xs text-center text-muted-foreground">
            Your payout is released once the buyer confirms.
          </p>

          {/* AI Verification Status */}
          <AIVerificationStatus purchase={purchase} role="seller" />

          {/* Proof submitted */}
          {(purchase.transfer_notes || purchase.transfer_proof_url) && (
            <div className="w-full rounded-xl p-3 text-sm space-y-2 mt-1"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Proof Submitted</div>
              {purchase.transfer_notes && <p className="text-foreground text-xs">{purchase.transfer_notes}</p>}
              {purchase.transfer_proof_url && (
                <a href={purchase.transfer_proof_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline text-xs font-medium">
                  <FileText className="w-3.5 h-3.5" /> View screenshot
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Seller needs to send tickets
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <div className="px-5 py-4" style={{ background: 'rgba(191,95,255,0.1)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="font-bold text-lg text-foreground">Send Your Tickets Now</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Transfer your tickets using your ticket app, then return here to confirm. You will be paid after the buyer confirms receipt.</p>
      </div>

      <div className="p-5 space-y-5">
        {/* Buyer info */}
        <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Transfer To</div>
          <div className="space-y-1 text-sm">
            <div className="font-semibold text-foreground">{purchase.buyer_name || 'Buyer'}</div>
            <div className="font-medium" style={{ color: '#BF5FFF' }}>{purchase.buyer_email}</div>
            {purchase.buyer_phone && <div className="text-muted-foreground">{purchase.buyer_phone}</div>}
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
            <div>
              <div className="font-semibold text-sm text-foreground">Open your ticket platform</div>
              <div className="text-xs text-muted-foreground mb-2">Transfer tickets to the buyer's email above</div>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map(p => (
                  <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold"
                    style={{ background: p.color }}>
                    {p.label} <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
            <div className="flex-1">
              <div className="font-semibold text-sm text-foreground">Upload proof of transfer</div>
              <div className="text-xs text-muted-foreground mb-2">Screenshot of the transfer confirmation screen</div>
              <label className="flex items-center gap-2 cursor-pointer rounded-xl px-4 py-3 transition-all text-sm text-muted-foreground"
                style={{ border: '1.5px dashed rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.03)' }}>
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
              <div className="font-semibold text-sm text-foreground">Add a transfer note <span className="text-muted-foreground font-normal">(optional if screenshot provided)</span></div>
              <textarea
                value={proofNote}
                onChange={e => setProofNote(e.target.value)}
                placeholder="e.g. Transferred via Ticketmaster to buyer's email at 7:32 PM"
                rows={2}
                className="mt-1.5 w-full px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm rounded-xl px-3 py-2" style={{ color: '#FF2D78', background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.25)' }}>
            {error}
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={actionLoading}
          className="w-full py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14' }}
        >
          {proofUploading ? (
            <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Uploading proof…</>
          ) : actionLoading ? (
            <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Confirming…</>
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
  // Buyer confirmed — complete
  if (purchase.buyer_confirmed) {
    return (
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,255,135,0.35)', background: 'rgba(0,255,135,0.07)' }}>
        <div className="px-5 pt-6 pb-5 text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: 'linear-gradient(135deg, #00FF8733, #00C8FF33)', border: '2px solid rgba(0,255,135,0.5)' }}>
            <CheckCircle className="w-6 h-6" style={{ color: '#00FF87' }} />
          </div>
          <h2 className="font-display text-2xl text-foreground mb-1">Upgrade Confirmed 🎟️</h2>
          <p className="text-sm text-muted-foreground">Your tickets are confirmed. Payment has been released to the seller.</p>
          <div className="flex flex-col gap-2 mt-4 text-xs text-center">
            <span className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full font-semibold mx-auto"
              style={{ background: 'rgba(0,255,135,0.15)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
              ✓ Transfer complete
            </span>
            <span className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full font-semibold mx-auto"
              style={{ background: 'rgba(0,200,255,0.12)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
              ✓ Payment captured
            </span>
            <span className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full font-semibold mx-auto"
              style={{ background: 'rgba(191,95,255,0.12)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
              ✓ Payout processing to seller
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Waiting on seller to send
  if (!purchase.seller_confirmed) {
    return (
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,200,255,0.25)', background: 'rgba(0,200,255,0.05)' }}>
        {/* Hero */}
        <div className="px-5 pt-6 pb-5 text-center" style={{ borderBottom: '1px solid rgba(0,200,255,0.15)' }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: 'linear-gradient(135deg, #00FF8733, #00C8FF33)', border: '2px solid rgba(0,200,255,0.4)' }}>
            <Sparkles className="w-6 h-6" style={{ color: '#00C8FF' }} />
          </div>
          <h2 className="font-display text-2xl text-foreground mb-1">You're In 🎉</h2>
          <p className="text-sm text-muted-foreground">Your payment is protected. The seller is sending your tickets now.</p>
        </div>

        {/* Status */}
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold"
            style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}>
            <Clock className="w-4 h-4 animate-pulse" /> Waiting on seller transfer
          </div>

          <div className="space-y-2 text-sm">
            {[
              'Average transfer time is under 5 minutes',
              'You won\'t be charged until the transfer is confirmed.',
              'This page refreshes automatically every 15 seconds',
            ].map(t => (
              <div key={t} className="flex items-start gap-2 text-muted-foreground">
                <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#00FF87' }} />
                <span>{t}</span>
              </div>
            ))}
          </div>

          <div className="rounded-xl p-3 text-xs text-muted-foreground text-center"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Check your email — the ticket transfer invite may arrive before this page updates.
          </div>

          <button
            onClick={onCancel}
            disabled={actionLoading}
            className="w-full py-2.5 rounded-xl text-sm text-muted-foreground transition-colors disabled:opacity-60"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
          >
            Cancel Purchase & Refund
          </button>

          {/* Escalation CTA — visible after 4h if seller still hasn't confirmed */}
          {purchase.created_date && (Date.now() - new Date(purchase.created_date).getTime()) > 4 * 60 * 60 * 1000 && (
            <div className="rounded-xl p-3 text-center space-y-2"
              style={{ background: 'rgba(255,45,120,0.07)', border: '1px solid rgba(255,45,120,0.2)' }}>
              <p className="text-xs font-bold" style={{ color: '#FF2D78' }}>⚠️ Seller hasn't responded in 4+ hours</p>
              <p className="text-[11px] text-muted-foreground">You can open a dispute or contact support for help.</p>
              <button
                onClick={onDispute}
                disabled={actionLoading}
                className="w-full py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-60"
                style={{ background: 'rgba(255,45,120,0.12)', border: '1px solid rgba(255,45,120,0.35)', color: '#FF2D78' }}>
                Seller Unresponsive — Open Dispute
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Seller confirmed — buyer needs to verify
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,255,135,0.3)', background: 'rgba(0,255,135,0.05)' }}>
      <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(0,255,135,0.15)' }}>
        <div className="font-bold text-foreground text-base mb-0.5">🎟 Seller has sent your tickets!</div>
        <div className="text-xs text-muted-foreground">Check your email and the ticket platform for the transfer invite.</div>
      </div>

      <div className="p-5 space-y-4">
        {/* AI verification status for buyer */}
        <AIVerificationStatus purchase={purchase} role="buyer" />

        {/* Seller's proof */}
        {(purchase.transfer_notes || purchase.transfer_proof_url) && (
          <div className="rounded-xl p-3 text-sm space-y-2"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Seller's Transfer Proof</div>
            {purchase.transfer_notes && <p className="text-foreground text-xs">{purchase.transfer_notes}</p>}
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
          className="w-full py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14' }}
        >
          {actionLoading
            ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Processing…</>
            : <><CheckCircle className="w-4 h-4" /> I Received My Tickets</>
          }
        </button>

        <div className="flex gap-2">
          <button onClick={onDispute} disabled={actionLoading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
            style={{ background: 'rgba(255,200,0,0.1)', border: '1px solid rgba(255,200,0,0.3)', color: '#FFE600' }}>
            I Haven't Received Tickets
          </button>
        </div>
        <p className="text-xs text-center text-muted-foreground">
          Seller has confirmed transfer — to dispute, use the button above.
        </p>

        <p className="text-xs text-center text-muted-foreground">
          Only confirm once you've accepted the ticket transfer.
        </p>
      </div>
    </div>
  );
}

// ── Completed state (role-specific) ─────────────────────────────────────────
function CompletedBanner({ isSeller }) {
  return (
    <div className="rounded-2xl overflow-hidden mb-5" style={{
      border: '1px solid rgba(0,255,135,0.35)',
      background: 'linear-gradient(135deg, rgba(0,255,135,0.08), rgba(0,200,255,0.06))'
    }}>
      <div className="px-5 pt-6 pb-5 text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
          style={{ background: 'linear-gradient(135deg, #00FF8733, #00C8FF33)', border: '2px solid rgba(0,255,135,0.5)' }}>
          <CheckCircle className="w-6 h-6" style={{ color: '#00FF87' }} />
        </div>
        <h2 className="font-display text-2xl text-foreground mb-1">
          {isSeller ? 'Sale Complete 💸' : 'Upgrade Confirmed 🎟️'}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          {isSeller
            ? 'Great work. Your payout is being processed by Stripe.'
            : 'Enjoy the show! Payment has been released to the seller.'}
        </p>
        {isSeller && (
          <div className="text-xs text-muted-foreground px-3 py-2 rounded-xl mb-2"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            💳 Stripe typically deposits in <strong className="text-foreground">2–7 business days</strong>. First-time payouts may take up to <strong className="text-foreground">14 days</strong> while Stripe verifies your account.
          </div>
        )}
        <div className="flex flex-col gap-2 items-center text-xs">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-semibold"
            style={{ background: 'rgba(0,255,135,0.15)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
            ✓ Transfer complete
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-semibold"
            style={{ background: 'rgba(0,200,255,0.12)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
            ✓ Payment captured
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-semibold"
            style={{ background: 'rgba(191,95,255,0.12)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
            ✓ {isSeller ? 'Payout processing' : 'Payout released to seller'}
          </span>
        </div>
      </div>
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
  const [showDisputeModal, setShowDisputeModal] = useState(false);
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
      ...(proofUrl ? { transfer_proof_url: proofUrl, ai_proof_status: 'pending' } : {}),
      ...(proofNote ? { transfer_notes: proofNote } : {}),
    });
    const res = await base44.functions.invoke('capturePayment', {
      purchase_id: purchase.id,
      confirming_role: 'seller',
    });
    if (res.data.error) {
      setError(res.data.error);
    } else {
      // Trigger AI verification async — fire-and-forget, non-blocking
      if (proofUrl) {
        base44.functions.invoke('verifyTransferProof', {
          purchase_id: purchase.id,
          proof_url: proofUrl,
        }).catch(err => console.warn('[AI verify] failed to trigger:', err?.message));
      }
      await load();
    }
    setActionLoading(false);
  };

  const handleConfirm = async (role) => {
    setActionLoading(true);
    setError('');

    const optimisticUpdate = createOptimisticPurchaseUpdate(purchase.id, role);
    setPurchase(prev => ({ ...prev, ...optimisticUpdate }));

    try {
      const res = await base44.functions.invoke('capturePayment', {
        purchase_id: purchase.id,
        confirming_role: role,
      });
      if (res.data.error) {
        setError(res.data.error);
        setPurchase(prev => ({
          ...prev,
          _optimistic: false,
          _updating: false,
          buyer_confirmed: role === 'buyer' ? false : prev.buyer_confirmed,
          seller_confirmed: role === 'seller' ? false : prev.seller_confirmed,
        }));
      } else {
        setPurchase(prev => ({ ...prev, ...res.data, _optimistic: false, _updating: false }));
      }
    } catch (err) {
      setError(err.message || 'Confirmation failed');
      setPurchase(prev => ({
        ...prev,
        _optimistic: false,
        _updating: false,
        buyer_confirmed: role === 'buyer' ? false : prev.buyer_confirmed,
        seller_confirmed: role === 'seller' ? false : prev.seller_confirmed,
      }));
    } finally {
      setActionLoading(false);
    }
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

  const handleDispute = async ({ category, details }) => {
    setActionLoading(true);
    const reason = details ? `${category}: ${details}` : category;
    await base44.entities.Purchase.update(purchase.id, {
      transfer_status: 'disputed',
      dispute_reason: reason,
    });

    // Notify buyer, seller, and support — fire-and-forget
    base44.functions.invoke('recordNotification', {
      user_email: purchase.buyer_email,
      type: 'dispute_opened',
      title: 'Dispute submitted ⚖️',
      body: `Your dispute has been received. Our team will review and resolve it promptly. Reason: ${reason}`,
      reference_id: purchase.id,
      reference_type: 'purchase',
      action_url: `/purchase/${purchase.id}`,
    }).catch(() => {});
    base44.functions.invoke('recordNotification', {
      user_email: purchase.seller_email,
      type: 'dispute_opened',
      title: 'Buyer opened a dispute ⚖️',
      body: `The buyer disputed this transaction. Reason: ${reason}. Our team will review and reach out.`,
      reference_id: purchase.id,
      reference_type: 'purchase',
      action_url: `/purchase/${purchase.id}`,
    }).catch(() => {});
    base44.functions.invoke('sendNotificationEmail', {
      to: 'experience@peanutgallery.store',
      subject: `⚠️ Dispute opened — Purchase ${purchase.id}`,
      body: `A dispute has been opened on Peanut Gallery.\n\nPurchase ID: ${purchase.id}\nBuyer: ${purchase.buyer_email}${purchase.buyer_name ? ` (${purchase.buyer_name})` : ''}\nSeller: ${purchase.seller_email}\nAmount: $${purchase.amount?.toFixed(2)}\nReason: ${reason}\n\nReview in the admin panel and resolve promptly.\n\n— Peanut Gallery`,
    }).catch(err => console.error('[dispute] email notify failed:', err?.message));

    setShowDisputeModal(false);
    await load();
    setActionLoading(false);
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

  // Access control — only buyer, seller, or admin may view purchase details
  const isSeller = user?.email === purchase.seller_email;
  const isBuyer = !isSeller && (user?.email === purchase.buyer_email || user?.email === purchase.created_by);
  const isAdminViewer = user?.role === 'admin';

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-4">
        <p className="text-4xl">🔒</p>
        <p className="font-semibold text-foreground">Sign in to view this purchase</p>
        <button onClick={() => base44.auth.redirectToLogin()}
          className="px-6 py-2.5 rounded-full bg-primary text-primary-foreground font-bold text-sm">
          Sign In
        </button>
      </div>
    );
  }

  if (!isSeller && !isBuyer && !isAdminViewer) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center text-muted-foreground">
        <p>You don't have access to this purchase.</p>
        <Link to="/events" className="text-primary text-sm mt-3 inline-block">← Browse events</Link>
      </div>
    );
  }
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
      {isCompleted && <CompletedBanner isSeller={isSeller} />}

      {isExpired && (
        <div className="flex items-center gap-3 rounded-2xl p-4 mb-5"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <XCircle className="w-6 h-6 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-semibold text-foreground">Purchase Cancelled</div>
            <div className="text-sm text-muted-foreground">Refund issued to your original payment method.</div>
          </div>
        </div>
      )}

      {isDisputed && (
        <div className="flex items-center gap-3 rounded-2xl p-4 mb-5"
          style={{ background: 'rgba(255,200,0,0.1)', border: '1px solid rgba(255,200,0,0.3)' }}>
          <AlertTriangle className="w-6 h-6 flex-shrink-0" style={{ color: '#FFE600' }} />
          <div>
            <div className="font-bold text-foreground">Dispute Open</div>
            <div className="text-sm text-muted-foreground">Payment frozen. Our team will review and resolve.</div>
          </div>
        </div>
      )}

      {/* Order summary card */}
      <div className="rounded-2xl overflow-hidden mb-5"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="px-5 py-3.5 flex items-center justify-between"
          style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-primary" />
            <span className="font-bold text-sm text-foreground">{event?.title || 'Your Upgrade'}</span>
          </div>
          {isBuyer && isPending && (
            <button onClick={() => load().catch(console.error)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          )}
        </div>
        {listing && (
          <div className="px-5 py-4 grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Section</div><div className="font-bold text-foreground">{listing.section}</div></div>
            <div><div className="text-xs text-muted-foreground">Row</div><div className="font-bold text-foreground">{listing.row}</div></div>
            <div><div className="text-xs text-muted-foreground">Qty</div><div className="font-bold text-foreground">{purchase.quantity}</div></div>
          </div>
        )}
        <div className="px-5 py-3 flex justify-between font-bold text-sm text-foreground"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <span>Total Paid</span>
          <span style={{ color: '#00FF87' }}>${purchase.amount?.toFixed(2)}</span>
        </div>
      </div>

      {/* Progress bar */}
      {isPending && <ProgressBar purchase={purchase} />}

      {/* Role-specific panels */}
      {isPending && isSeller && listing?.listing_mode !== 'instant' && (
        <SellerPanel
          purchase={purchase}
          onConfirm={handleSellerConfirm}
          actionLoading={actionLoading}
          error={error}
          setError={setError}
        />
      )}
      {isPending && isSeller && listing?.listing_mode === 'instant' && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,200,255,0.3)', background: 'rgba(0,200,255,0.06)' }}>
          <div className="px-5 pt-6 pb-5 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ background: 'linear-gradient(135deg, #00C8FF33, #BF5FFF33)', border: '2px solid rgba(0,200,255,0.4)' }}>
              <span className="text-2xl">⚡</span>
            </div>
            <h2 className="font-display text-2xl text-foreground mb-1">Instant Listing Sold</h2>
            <p className="text-sm text-muted-foreground">
              Peanut Gallery is managing the ticket transfer to the buyer. You don't need to do anything — we'll handle it.
            </p>
          </div>
          <div className="px-5 pb-5 space-y-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold justify-center"
              style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}>
              🎟 PG-managed transfer in progress
            </div>
            <p className="text-center text-xs">Your payout will be released once the buyer confirms receipt.</p>
          </div>
        </div>
      )}
      {isPending && isBuyer && listing?.listing_mode === 'instant' && !purchase.seller_confirmed && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,200,255,0.25)', background: 'rgba(0,200,255,0.05)' }}>
          <div className="px-5 pt-6 pb-5 text-center" style={{ borderBottom: '1px solid rgba(0,200,255,0.15)' }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ background: 'linear-gradient(135deg, #00FF8733, #00C8FF33)', border: '2px solid rgba(0,200,255,0.4)' }}>
              <span className="text-2xl">⚡</span>
            </div>
            <h2 className="font-display text-2xl text-foreground mb-1">You're In 🎉</h2>
            <p className="text-sm text-muted-foreground">
              {purchase.fulfillment_status === 'transfer_in_progress'
                ? 'Peanut Gallery is actively transferring your ticket right now. Check your email for the invite.'
                : purchase.fulfillment_status === 'fulfilled'
                ? 'Your ticket has been sent! Check your email or ticket app to accept the transfer.'
                : 'Peanut Gallery already has this ticket in custody and is preparing your transfer.'}
            </p>
          </div>
          <div className="px-5 py-4 space-y-3">
            {/* Dynamic fulfillment status steps */}
            <div className="space-y-1.5">
              {[
                { key: null, label: 'PG preparing your transfer', done: !!purchase.fulfillment_status },
                { key: 'transfer_in_progress', label: 'Transfer in progress', done: purchase.fulfillment_status === 'transfer_in_progress' || purchase.fulfillment_status === 'fulfilled' },
                { key: 'fulfilled', label: 'Ticket delivered — check your email', done: purchase.fulfillment_status === 'fulfilled' },
              ].map(({ label, done }, i) => (
                <div key={i} className="flex items-center gap-2.5 text-xs">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-black ${done ? '' : 'opacity-30'}`}
                    style={{ background: done ? '#00C8FF' : 'rgba(255,255,255,0.1)' }}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span className={done ? 'text-foreground font-medium' : 'text-muted-foreground'}>{label}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold"
              style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}>
              <Clock className="w-4 h-4 animate-pulse" />
              {purchase.fulfillment_status === 'transfer_in_progress' ? 'Transfer in progress'
                : purchase.fulfillment_status === 'fulfilled' ? 'Ticket delivered — confirm receipt below'
                : 'PG preparing transfer'}
            </div>
            <div className="rounded-xl p-3 text-xs text-muted-foreground text-center"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              Check your email — the ticket transfer invite will arrive from Peanut Gallery.
            </div>
            <button onClick={handleCancel} disabled={actionLoading}
              className="w-full py-2.5 rounded-xl text-sm text-muted-foreground transition-colors disabled:opacity-60"
              style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
              Cancel Purchase & Refund
            </button>
          </div>
        </div>
      )}
      {isPending && isBuyer && !(listing?.listing_mode === 'instant' && !purchase.seller_confirmed) && (
        <BuyerPanel
          purchase={purchase}
          onConfirm={handleConfirm}
          onDispute={() => setShowDisputeModal(true)}
          onCancel={handleCancel}
          actionLoading={actionLoading}
        />
      )}

      {showDisputeModal && (
        <DisputeModal
          onSubmit={handleDispute}
          onClose={() => setShowDisputeModal(false)}
          loading={actionLoading}
        />
      )}

      {/* Prompt for push notifications — shown once after landing on this page */}
      <NotificationPermissionPrompt trigger="purchase" />

      {!isPending && error && (
        <div className="mt-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}