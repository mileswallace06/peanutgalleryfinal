import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { CheckCircle, Clock, XCircle, AlertTriangle, Ticket, FileText, RefreshCw } from 'lucide-react';
import DisputeModal from '@/components/purchase/DisputeModal';
import AIVerificationStatus from '@/components/purchase/AIVerificationStatus';
import TransferAssistant from '@/components/purchase/TransferAssistant';
import { createOptimisticPurchaseUpdate } from '@/lib/optimisticUI';
import NotificationPermissionPrompt from '@/components/NotificationPermissionPrompt';
import { UPGRADE_LISTING_TYPES } from '@/lib/listingTypes';
import { PageIntro, Disclosure } from '@/components/ClarityUI';
import './transaction-clarity.css';

// Status history is secondary to the action needed to finish the transfer.
function TransactionTimeline({ purchase }) {
  const isCompleted = purchase.transfer_status === 'completed';
  const steps = [
    { label: 'Order created', detail: 'Transfer requested', done: true, ts: purchase.created_date },
    { label: 'Tickets sent', detail: purchase.seller_confirmed ? 'Sender confirmed transfer' : 'Waiting for transfer', done: !!purchase.seller_confirmed, ts: purchase.seller_confirmed_at },
    { label: 'Receipt confirmed', detail: purchase.buyer_confirmed ? 'Buyer confirmed receipt' : 'Buyer accepts the transfer', done: !!purchase.buyer_confirmed && !purchase._updating },
    { label: 'Transfer complete', detail: isCompleted ? 'Transfer marked complete' : 'Waiting for completion', done: isCompleted },
  ];
  return <ol className="pg-purchase-timeline" aria-label="Transfer history">
    {steps.map((step, index) => <li key={step.label}>
      <span className={step.done ? 'is-done' : ''}>{step.done ? <CheckCircle size={16} aria-hidden="true" /> : index + 1}</span>
      <div><p>{step.label}</p><small>{step.detail}</small>{step.ts && <time dateTime={step.ts}>{new Date(step.ts).toLocaleString()}</time>}</div>
    </li>)}
  </ol>;
}

function BuyerPanel({ purchase, onConfirm, onDispute, onCancel, actionLoading, isUpgrade }) {
  if (purchase.buyer_confirmed) {
    return <section className="pg-transaction-status pg-transaction-status-pending" aria-live="polite">
      <Clock size={24} aria-hidden="true" />
      <div><p className="pg-transaction-kicker">Receipt confirmation</p><h2>{purchase._updating ? 'Confirming your receipt…' : 'Receipt recorded'}</h2>
        <p>{purchase._updating ? 'Keep this page open while your confirmation is processed.' : 'Your receipt is recorded. We’re waiting for the transaction to finish processing.'}</p>
      </div>
    </section>;
  }

  if (!purchase.seller_confirmed) {
    return <section className="pg-transaction-card pg-purchase-next">
      <p className="pg-transaction-kicker"><Clock size={15} aria-hidden="true" /> Transfer pending</p>
      <h2>Watch for your transfer email.</h2>
      <p>The seller has not confirmed sending your {isUpgrade ? 'upgrade' : 'tickets'} yet. Check your email and ticket app for an invitation.</p>
      <p className="pg-transaction-note">This page updates every 15 seconds. Confirm here after you accept the transfer.</p>
      <button onClick={onCancel} disabled={actionLoading} className="pg-action pg-transaction-secondary pg-purchase-cancel">Cancel purchase & refund</button>
      {purchase.created_date && (Date.now() - new Date(purchase.created_date).getTime()) > 4 * 60 * 60 * 1000 && (
        <div className="pg-transaction-alert">
          <p><strong>No seller response for over 4 hours.</strong> Open a dispute or contact support for help.</p>
          <button onClick={onDispute} disabled={actionLoading} className="pg-action pg-transaction-secondary">Open a dispute</button>
        </div>
      )}
    </section>;
  }

  return <section className="pg-transaction-card pg-purchase-next">
    <p className="pg-transaction-kicker">Your next step</p>
    <h2>Accept the transfer, then confirm.</h2>
    <p>The seller says your {isUpgrade ? 'upgrade was' : 'tickets were'} sent. Open the invitation in your email or ticket app and accept it before confirming below.</p>
    <AIVerificationStatus purchase={purchase} role="buyer" />
    {(purchase.transfer_notes || purchase.transfer_proof_url) && (
      <div className="pg-purchase-proof">
        <p className="pg-transaction-kicker">Seller’s transfer proof</p>
        {purchase.transfer_notes && <p>{purchase.transfer_notes}</p>}
        {purchase.transfer_proof_url && <a href={purchase.transfer_proof_url} target="_blank" rel="noopener noreferrer" className="pg-purchase-proof-link"><FileText size={16} aria-hidden="true" /> View screenshot</a>}
      </div>
    )}
    <p className="pg-purchase-confirm-note">Only confirm once you’ve accepted the transfer. Confirmation allows payment to be released to the seller.</p>
    <button onClick={() => onConfirm('buyer')} disabled={actionLoading} className="pg-action pg-transaction-primary pg-purchase-confirm">
      {actionLoading ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Processing…</> : <><CheckCircle size={18} aria-hidden="true" /> I received my tickets</>}
    </button>
    <button onClick={onDispute} disabled={actionLoading} className="pg-action pg-transaction-secondary pg-purchase-confirm">I haven’t received tickets</button>
  </section>;
}

function CompletedBanner({ isSeller, isUpgrade }) {
  return <section className="pg-transaction-card pg-purchase-complete">
    <p className="pg-transaction-kicker"><CheckCircle size={16} aria-hidden="true" /> Transfer complete</p>
    <h2>{isSeller ? 'Your sale is complete.' : 'Receipt confirmed.'}</h2>
    <p>{isSeller ? 'The buyer has confirmed receipt of the tickets. Check My sales for your payout details.' : isUpgrade ? 'Your upgrade transfer is complete. You still need valid event admission.' : 'Your transfer is complete. Open your ticket provider’s app to access your tickets.'}</p>
    {isSeller ? <Link to="/my-sales" className="pg-action pg-transaction-primary">View my sales</Link> : <Link to="/my-tickets" className="pg-action pg-transaction-primary">{isUpgrade ? 'View my upgrade' : 'View my tickets'}</Link>}
    {isSeller && <p className="pg-transaction-note">Stripe typically deposits in 2–7 business days. First payouts may take up to 14 days while Stripe verifies your account.</p>}
  </section>;
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
    try {
      const res = await base44.functions.invoke('sellerConfirmTransfer', {
        purchase_id: purchase.id,
        proof_url: proofUrl || null,
        proof_note: proofNote || null,
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
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Confirmation failed');
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
    try {
      const res = await base44.functions.invoke('openDispute', {
        purchase_id: purchase.id,
        reason,
      });
      if (res.data.error) {
        setError(res.data.error);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Dispute failed');
    }
    setShowDisputeModal(false);
    await load();
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="pg-secondary-page pg-transaction-page pg-transaction-empty">
        <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin inline-block" />
        <p className="text-sm text-muted-foreground mt-3">Loading transfer details…</p>
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="pg-secondary-page pg-transaction-page pg-transaction-empty">
        <p>Purchase not found.</p>
        <Link to="/events" className="text-primary text-sm mt-3 inline-block">← Browse events</Link>
      </div>
    );
  }

  // Access control — only buyer, seller, or admin may view purchase details
  if (!user) {
    return (
      <div className="pg-secondary-page pg-transaction-page pg-transaction-empty space-y-4">
        <p className="text-4xl">🔒</p>
        <p className="font-semibold text-foreground">Sign in to view this purchase</p>
        <button onClick={() => base44.auth.redirectToLogin()}
          className="pg-action pg-transaction-primary">
          Sign In
        </button>
      </div>
    );
  }

  const isSeller = user.email === purchase.seller_email;
  const isBuyer = !isSeller && (user.email === purchase.buyer_email || user.email === purchase.created_by);
  const isAdminViewer = user.role === 'admin';
  const isUpgrade = listing && UPGRADE_LISTING_TYPES.includes(listing.listing_type);

  if (!isSeller && !isBuyer && !isAdminViewer) {
    return (
      <div className="pg-secondary-page pg-transaction-page pg-transaction-empty">
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
    <div className="pg-secondary-page pg-transaction-page pg-purchase-page">
      <PageIntro
        eyebrow="Your order"
        title={isSeller ? 'Sale details.' : 'Purchase details.'}
        description={isCompleted ? 'The transfer is complete.' : isExpired ? 'This purchase has been cancelled.' : isDisputed ? 'Your dispute is under review.' : isPending ? 'Follow your transfer and see what to do next.' : 'Review the current details of your order.'}
        backTo={isSeller ? '/my-sales' : isAdminViewer ? '/admin' : '/my-tickets'}
        backLabel={isSeller ? 'My sales' : isAdminViewer ? 'Admin' : 'My tickets'}
      />

      {/* Terminal status banners */}
      {isCompleted && <CompletedBanner isSeller={isSeller} isUpgrade={isUpgrade} />}

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

      {/* Role-specific panels */}
      {isPending && isSeller && listing?.listing_mode !== 'instant' && (
        <TransferAssistant
          purchase={purchase}
          listing={listing}
          onConfirm={handleSellerConfirm}
          actionLoading={actionLoading}
          error={error}
          setError={setError}
          sellerPayout={purchase.seller_payout ?? purchase.amount}
        />
      )}
      {isPending && isSeller && listing?.listing_mode === 'instant' && (
        <section className="pg-transaction-card pg-purchase-next">
          <p className="pg-transaction-kicker"><Clock size={15} aria-hidden="true" /> PG-managed transfer</p>
          <h2>We’re handling delivery.</h2>
          <p>Peanut Gallery is managing the transfer to the buyer. No transfer action is needed from you.</p>
          <p className="pg-transaction-note">Your payout will be released once the buyer confirms receipt.</p>
        </section>
      )}
      {isPending && isBuyer && listing?.listing_mode === 'instant' && !purchase.seller_confirmed && (
        <section className="pg-transaction-card pg-purchase-next">
          <p className="pg-transaction-kicker"><Clock size={15} aria-hidden="true" /> PG-managed transfer</p>
          <h2>{purchase.fulfillment_status === 'fulfilled' ? 'Check for your transfer invite.' : purchase.fulfillment_status === 'transfer_in_progress' ? 'Your transfer is in progress.' : 'We’re preparing your transfer.'}</h2>
          <p>{purchase.fulfillment_status === 'transfer_in_progress'
            ? 'Peanut Gallery is transferring your ticket. Check your email for the invitation.'
            : purchase.fulfillment_status === 'fulfilled'
            ? 'Your ticket has been sent. Open the invitation in your email or ticket app and accept the transfer.'
            : 'Peanut Gallery has this ticket in custody and is preparing your transfer.'}</p>
          <p className="pg-transaction-note">This page updates every 15 seconds. Receipt confirmation will appear here once the transfer is marked sent.</p>
          <button onClick={handleCancel} disabled={actionLoading} className="pg-action pg-transaction-secondary pg-purchase-cancel">Cancel purchase & refund</button>
        </section>
      )}
      {isPending && isBuyer && !(listing?.listing_mode === 'instant' && !purchase.seller_confirmed) && (
        <BuyerPanel
          purchase={purchase}
          onConfirm={handleConfirm}
          onDispute={() => setShowDisputeModal(true)}
          onCancel={handleCancel}
          actionLoading={actionLoading}
          isUpgrade={isUpgrade}
        />
      )}

      <section className="pg-purchase-ticket" aria-label="Order summary">
        <div className="pg-purchase-ticket-heading">
          <p><Ticket size={16} aria-hidden="true" /> Order summary</p>
          <h2>{event?.title || (isUpgrade ? 'Your upgrade' : 'Your purchase')}</h2>
        </div>
        {listing && <dl className="pg-purchase-seats">
          <div><dt>Section</dt><dd>{listing.section}</dd></div>
          <div><dt>Row</dt><dd>{listing.row}</dd></div>
          <div><dt>Quantity</dt><dd>{purchase.quantity}</dd></div>
        </dl>}
        <div className="pg-purchase-total"><span>Order total</span><strong>${purchase.amount?.toFixed(2)}</strong></div>
        <p className="pg-purchase-ticket-note">{isUpgrade ? 'Seat upgrade only. Valid event admission is required.' : 'Purchase record. Use your ticket provider’s app for entry.'}</p>
      </section>

      {(isPending || isCompleted) && !isExpired && <Disclosure title="Transfer history" description="See each step of your transfer.">
        <TransactionTimeline purchase={purchase} />
        {isBuyer && isPending && <button onClick={() => load().catch(console.error)} className="pg-action pg-transaction-secondary pg-purchase-refresh"><RefreshCw size={16} aria-hidden="true" /> Refresh status</button>}
      </Disclosure>}

      {showDisputeModal && (
        <DisputeModal
          onSubmit={handleDispute}
          onClose={() => setShowDisputeModal(false)}
          loading={actionLoading}
        />
      )}

      {/* Prompt for push notifications — shown once after landing on this page */}
      <NotificationPermissionPrompt trigger="purchase" />

      {error && !(isPending && isSeller && listing?.listing_mode !== 'instant') && (
        <div role="alert" className="pg-transaction-alert">
          {error}
        </div>
      )}
    </div>
  );
}