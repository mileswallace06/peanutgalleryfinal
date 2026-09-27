import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Ticket, Clock, CheckCircle, AlertTriangle, ArrowRight, Plus, RefreshCw, Zap } from 'lucide-react';
import SellerMetrics from '@/components/sales/SellerMetrics';
import ListingStatusBanner from '@/components/listings/ListingStatusBanner';
import { isVerificationExpired } from '@/lib/transferConfidence';
import { PageIntro, Disclosure } from '@/components/ClarityUI';
import './activity-clarity.css';

export default function MySales() {
  const [user, setUser] = useState(null);
  const [listings, setListings] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await base44.auth.me();
      if (!me) { setLoading(false); return; }
      setUser(me);

      const [listingRes, purchaseRes] = await Promise.all([
        base44.functions.invoke('getListingParticipantView', { action: 'list_mine' }),
        base44.functions.invoke('getPurchaseParticipantView', { action: 'list_mine', perspective: 'seller' }),
      ]);

      const myListings = listingRes?.data?.listings || [];
      const mySales = purchaseRes?.data?.sales || [];

      setListings(myListings);
      setPurchases(mySales);

      const eventIds = [...new Set([
        ...myListings.map(l => l.event_id),
        ...mySales.map(p => p.event_id),
      ])].filter(Boolean);

      const eventResults = await Promise.all(
        eventIds.map(eid => base44.entities.Event.filter({ id: eid }).then(r => r[0]).catch(() => null))
      );
      const eventMap = {};
      eventIds.forEach((eid, i) => { if (eventResults[i]) eventMap[eid] = eventResults[i]; });
      setEvents(eventMap);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load sales');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePauseListing = async (id) => {
    setActionError(null);
    try {
      await base44.functions.invoke('submitListing', { action: 'manage_existing', operation: 'pause', listing_id: id });
      load();
    } catch (err) {
      setActionError(err?.response?.data?.error || err?.message || 'Failed to pause listing');
    }
  };

  const handleResumeListing = async (id) => {
    setActionError(null);
    try {
      await base44.functions.invoke('submitListing', { action: 'manage_existing', operation: 'resume', listing_id: id });
      load();
    } catch (err) {
      setActionError(err?.response?.data?.error || err?.message || 'Failed to resume listing');
    }
  };

  const handleCancelListing = async (listing) => {
    if (!window.confirm(`Cancel this listing?\n\nSection ${listing.section} · Row ${listing.row}\nThe listing will be cancelled but preserved for your records. It will no longer be visible to buyers.`)) return;
    setActionError(null);
    try {
      await base44.functions.invoke('submitListing', { action: 'manage_existing', operation: 'cancel', listing_id: listing.id });
      load();
    } catch (err) {
      setActionError(err?.response?.data?.error || err?.message || 'Failed to cancel listing');
    }
  };

  if (loading) {
    return (
      <div className="pg-secondary-page pg-activity-page pg-sales-page">
        <PageIntro eyebrow="Seller desk" title="My Sales" description="Manage listings and ticket transfers." />
        <div className="pg-state pg-activity-state" role="status">
          <RefreshCw className="w-6 h-6 animate-spin" aria-hidden="true" />
          <p>Loading your sales…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pg-secondary-page pg-activity-page pg-sales-page">
        <PageIntro eyebrow="Seller desk" title="My Sales" description="Manage listings and ticket transfers." />
        <div className="pg-state pg-activity-state" role="alert">
          <AlertTriangle className="w-7 h-7" aria-hidden="true" />
          <h2>Failed to load sales</h2>
          <p>{error}</p>
          <button onClick={load} className="pg-action">
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="pg-secondary-page pg-activity-page pg-sales-page">
        <PageIntro eyebrow="Seller desk" title="My Sales" description="Manage listings and ticket transfers." />
        <div className="pg-state pg-activity-state">
          <Ticket className="w-7 h-7" aria-hidden="true" />
          <h2>Sign in to view your sales</h2>
          <button onClick={() => base44.auth.redirectToLogin()} className="pg-action">Sign In</button>
        </div>
      </div>
    );
  }

  const pendingTransfers = purchases.filter(p => p.transfer_status === 'pending_transfer' && !p.seller_confirmed);
  const awaitingBuyer = purchases.filter(p => p.transfer_status === 'pending_transfer' && p.seller_confirmed && !p.buyer_confirmed);
  const completedSales = purchases.filter(p => p.transfer_status === 'completed');
  const activeListings = listings.filter(l => l.status === 'active');
  const hiddenOrRejectedListings = listings.filter(l =>
    l.status === 'hidden' || l.proof_status === 'rejected'
  );
  const pendingPayouts = completedSales.filter(p => !p.payment_captured).length;
  const failedCaptures = completedSales.filter(p => p.payment_capture_failed).length;

  return (
    <div className="pg-secondary-page pg-activity-page pg-sales-page">
      <PageIntro
        eyebrow="Seller desk"
        title="My Sales"
        description="Your listings, next steps, and completed sales."
        action={
          <Link to="/create-listing" className="pg-action">
            <Plus className="w-4 h-4" aria-hidden="true" /> List Tickets
          </Link>
        }
      />

      {actionError && <div className="pg-activity-alert" role="alert">{actionError}</div>}

      {purchases.length > 0 && (
        <Disclosure title="Seller performance" description="Transfer times, completed sales, and seller tier." className="pg-sales-performance">
          <SellerMetrics purchases={purchases} />
        </Disclosure>
      )}

      {pendingTransfers.length > 0 && (
        <section className="pg-sales-section" aria-labelledby="sales-action-heading">
          <div className="pg-activity-section-heading">
            <Clock className="pg-activity-icon-warning" aria-hidden="true" />
            <h2 id="sales-action-heading">Action required</h2>
            <span className="pg-activity-count">{pendingTransfers.length}</span>
          </div>
          <p className="pg-activity-section-description">Open each sale to send the buyer their tickets.</p>
          <div className="pg-activity-list">
            {pendingTransfers.map(p => {
              const ev = events[p.event_id];
              return (
                <article key={p.id} className="pg-sale-ticket pg-sale-ticket-action">
                  <div className="pg-sale-ticket-summary">
                    <div className="pg-sale-copy">
                      <span className="pg-sale-kicker">Ready for transfer</span>
                      <h3>{ev?.title || 'Event'}</h3>
                      <p>Amount: <strong>${p.amount?.toFixed(2)}</strong> · Qty: {p.quantity}</p>
                    </div>
                    <span className="pg-sale-status pg-sale-status-warning">Send tickets</span>
                  </div>
                  <div className="pg-sale-ticket-footer">
                    <p>Buyer ready for transfer — open the transfer page to continue.</p>
                    <Link to={`/purchase/${p.id}`} className="pg-action pg-sales-send">
                      Send Tickets <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {awaitingBuyer.length > 0 && (
        <section className="pg-sales-section" aria-labelledby="sales-awaiting-heading">
          <div className="pg-activity-section-heading">
            <Clock aria-hidden="true" />
            <h2 id="sales-awaiting-heading">Awaiting buyer confirmation</h2>
            <span className="pg-activity-count">{awaitingBuyer.length}</span>
          </div>
          <div className="pg-activity-list">
            {awaitingBuyer.map(p => {
              const ev = events[p.event_id];
              return (
                <article key={p.id} className="pg-sale-ticket">
                  <div className="pg-sale-ticket-summary">
                    <div className="pg-sale-copy">
                      <h3>{ev?.title || 'Event'}</h3>
                      <p>${p.amount?.toFixed(2)} · Qty: {p.quantity}</p>
                    </div>
                    <Link to={`/purchase/${p.id}`} className="pg-action pg-sales-view">
                      View transfer <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="pg-sales-section" aria-labelledby="sales-active-heading">
        <div className="pg-activity-section-heading">
          <Ticket aria-hidden="true" />
          <h2 id="sales-active-heading">Active listings</h2>
          <span className="pg-activity-count">{activeListings.length}</span>
        </div>
        {activeListings.length === 0 ? (
          <div className="pg-state pg-activity-state">
            <Ticket className="w-7 h-7" aria-hidden="true" />
            <h3>No active listings</h3>
            <p>List tickets to start selling.</p>
          </div>
        ) : (
          <div className="pg-activity-list">
            {activeListings.map(l => {
              const ev = events[l.event_id];
              const expired = isVerificationExpired(l);
              return (
                <article key={l.id} className={`pg-sale-ticket ${expired ? 'pg-sale-ticket-action' : ''}`}>
                  <div className="pg-sale-ticket-summary">
                    <div className="pg-sale-copy">
                      <h3>{ev?.title || 'Event'}</h3>
                      <p>Section {l.section} · Row {l.row}</p>
                      <p>{l.quantity} seat{l.quantity !== 1 ? 's' : ''} · <strong>${l.asking_price}/ea</strong></p>
                    </div>
                    <span className="pg-sale-status pg-sale-status-active">Active</span>
                  </div>
                  <div className="pg-sale-ticket-body">
                    <ListingStatusBanner listing={l} event={ev} onRefresh={load} />
                    <Disclosure title="Manage listing" description="Pause or cancel this listing." className="pg-sale-management">
                      <div className="pg-activity-controls">
                        <button onClick={() => handlePauseListing(l.id)} className="pg-action pg-activity-secondary">Pause</button>
                        <button onClick={() => handleCancelListing(l)} className="pg-action pg-activity-danger">Cancel Listing</button>
                      </div>
                    </Disclosure>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {hiddenOrRejectedListings.length > 0 && (
        <section className="pg-sales-section" aria-labelledby="sales-attention-heading">
          <div className="pg-activity-section-heading">
            <AlertTriangle className="pg-activity-icon-danger" aria-hidden="true" />
            <h2 id="sales-attention-heading">Needs attention</h2>
            <span className="pg-activity-count">{hiddenOrRejectedListings.length}</span>
          </div>
          <div className="pg-activity-list">
            {hiddenOrRejectedListings.map(l => {
              const ev = events[l.event_id];
              return (
                <article key={l.id} className="pg-sale-ticket pg-sale-ticket-attention">
                  <div className="pg-sale-ticket-summary">
                    <div className="pg-sale-copy">
                      <h3>{ev?.title || 'Event'}</h3>
                      <p>Section {l.section} · Row {l.row}</p>
                      <p>{l.quantity} seat{l.quantity !== 1 ? 's' : ''} · <strong>${l.asking_price}/ea</strong></p>
                    </div>
                  </div>
                  <div className="pg-sale-ticket-body">
                    <ListingStatusBanner listing={l} event={ev} onRefresh={load} />
                    {l.status === 'hidden' && (
                      <button onClick={() => handleResumeListing(l.id)} className="pg-action pg-sale-resume">Resume listing</button>
                    )}
                    <Disclosure title="Listing options" description="Cancel this listing." className="pg-sale-management">
                      <button onClick={() => handleCancelListing(l)} className="pg-action pg-activity-danger">Cancel Listing</button>
                    </Disclosure>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {(() => {
        const instantPending = listings.filter(l => l.listing_mode === 'instant' && l.status === 'pending_verification');
        const instantActive = listings.filter(l => l.listing_mode === 'instant' && l.status === 'active' && l.is_instant_ready);
        const instantSold = purchases.filter(p => {
          const l = listings.find(ll => ll.id === p.listing_id);
          return l?.listing_mode === 'instant' && p.transfer_status === 'pending_transfer';
        });
        if (instantPending.length === 0 && instantActive.length === 0 && instantSold.length === 0) return null;
        return (
          <section className="pg-sales-section" aria-labelledby="sales-instant-heading">
            <div className="pg-activity-section-heading">
              <Zap aria-hidden="true" />
              <h2 id="sales-instant-heading">Instant listings</h2>
            </div>
            <div className="pg-activity-list">
              {instantPending.map(l => {
                const ev = events[l.event_id];
                return (
                  <article key={l.id} className="pg-sale-ticket">
                    <div className="pg-sale-ticket-summary">
                      <div className="pg-sale-copy">
                        <h3>{ev?.title || 'Event'}</h3>
                        <p>Sec {l.section} · Row {l.row} · ${l.asking_price}/ea</p>
                      </div>
                      <span className="pg-sale-status pg-sale-status-warning">Pending verification</span>
                    </div>
                  </article>
                );
              })}
              {instantActive.map(l => {
                const ev = events[l.event_id];
                return (
                  <article key={l.id} className="pg-sale-ticket">
                    <div className="pg-sale-ticket-summary">
                      <div className="pg-sale-copy">
                        <h3>{ev?.title || 'Event'}</h3>
                        <p>Sec {l.section} · Row {l.row} · ${l.asking_price}/ea</p>
                      </div>
                      <span className="pg-sale-status pg-sale-status-info">Live — Instant</span>
                    </div>
                  </article>
                );
              })}
              {instantSold.map(p => {
                const ev = events[p.event_id];
                const fsLabel = p.fulfillment_status === 'transfer_in_progress' ? 'Transfer In Progress'
                  : p.fulfillment_status === 'fulfilled' ? 'Ticket Delivered'
                  : 'Sold — PG Handling Fulfillment';
                return (
                  <article key={p.id} className="pg-sale-ticket">
                    <div className="pg-sale-ticket-summary">
                      <div className="pg-sale-copy">
                        <h3>{ev?.title || 'Event'}</h3>
                        <p>${p.amount?.toFixed(2)} · Qty: {p.quantity}</p>
                      </div>
                      <span className="pg-sale-status pg-sale-status-active">{fsLabel}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })()}

      <Disclosure
        title={`Completed sales (${completedSales.length})`}
        description={failedCaptures > 0
          ? `${failedCaptures} capture failed — contact support. View sale and payout details.`
          : pendingPayouts > 0
            ? `${pendingPayouts} pending payout. View sale and payout details.`
            : 'Sale history, payout status, and transaction details.'}
        defaultOpen={pendingPayouts > 0 || failedCaptures > 0}
        className="pg-sales-history"
      >
        {completedSales.length === 0 ? (
          <div className="pg-state pg-activity-state">
            <CheckCircle className="w-7 h-7" aria-hidden="true" />
            <h3>No completed sales yet</h3>
            <p>When a buyer confirms receipt, your sale appears here.</p>
          </div>
        ) : (
          <div className="pg-activity-list">
            {completedSales.map(p => {
              const ev = events[p.event_id];
              const eventDate = ev?.event_start_local || ev?.date;
              const payoutState = p.payment_captured ? 'paid out' : 'pending payout';
              return (
                <article key={p.id} className="pg-sale-ticket">
                  <div className="pg-sale-ticket-summary">
                    <div className="pg-sale-copy">
                      <h3>{ev?.title || 'Event'}</h3>
                      {eventDate && <p>{format(new Date(eventDate), 'EEE, MMM d, yyyy')}</p>}
                      <p className="pg-sale-payout">${p.seller_payout != null ? p.seller_payout.toFixed(2) : p.amount?.toFixed(2)}</p>
                    </div>
                    <span className={`pg-sale-status ${p.payment_captured ? 'pg-sale-status-active' : 'pg-sale-status-warning'}`}>{payoutState}</span>
                  </div>
                  <div className="pg-sale-ticket-footer">
                    <div className="pg-sale-history-notes">
                      {p.payment_captured && <p>Stripe deposits 2–7 days (up to 14 days first payout)</p>}
                      {p.payment_capture_failed && <p className="pg-activity-error-text"><AlertTriangle className="w-4 h-4" aria-hidden="true" /> Capture failed — contact support</p>}
                      {p.created_date && <p>Sale date: {format(new Date(p.created_date), 'MMM d, yyyy')}</p>}
                    </div>
                    <Link to={`/purchase/${p.id}`} className="pg-action pg-activity-secondary">
                      View sale <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Disclosure>
    </div>
  );
}
