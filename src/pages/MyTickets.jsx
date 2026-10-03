import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Ticket, AlertTriangle, RefreshCw, LockKeyhole, ArrowRight, Info } from 'lucide-react';
import DonateSeatSheet from '@/components/donations/DonateSeatSheet';
import EventThumbnail from '@/components/events/EventThumbnail';
import { PageIntro } from '@/components/ClarityUI';
import './community-ticket.css';

export default function MyTickets() {
  const [user, setUser] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [donatingPurchase, setDonatingPurchase] = useState(null);

  const fetchPurchases = useCallback(async (silent = false) => {
    try {
      const res = await base44.functions.invoke('getPurchaseParticipantView', {
        action: 'list_mine', perspective: 'buyer',
      });
      const myPurchases = res?.data?.purchases || [];
      setPurchases(myPurchases);

      const eventIds = [...new Set(myPurchases.map(p => p.event_id).filter(Boolean))];
      const eventResults = await Promise.all(
        eventIds.map(eid => base44.entities.Event.filter({ id: eid }).then(r => r[0]).catch(() => null))
      );
      const eventMap = {};
      eventIds.forEach((eid, i) => { if (eventResults[i]) eventMap[eid] = eventResults[i]; });
      setEvents(eventMap);
      return myPurchases;
    } catch (err) {
      if (!silent) throw err;
      return [];
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await base44.auth.me();
      if (!me) { setLoading(false); return; }
      setUser(me);
      await fetchPurchases(false);
    } catch (err) {
      setError(err?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [fetchPurchases]);

  useEffect(() => { load(); }, [load]);

  // Poll for updates while there are pending purchases (no raw subscriptions)
  useEffect(() => {
    const hasPending = purchases.some(p => p.transfer_status === 'pending_transfer');
    if (!hasPending) return;

    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchPurchases(true);
    }, 20000);

    return () => clearInterval(interval);
  }, [purchases, fetchPurchases]);

  // Preserve the wallet's action-first order while presenting one compact list.
  const purchasePriority = (p) => {
    if (p.transfer_status === 'pending_transfer' && p.seller_confirmed && !p.buyer_confirmed) return 0;
    if (p.transfer_status === 'pending_transfer') return 1;
    if (p.transfer_status === 'disputed') return 2;
    if (p.transfer_status === 'completed') return 3;
    return 4;
  };
  const orderedPurchases = [...purchases].sort((a, b) => purchasePriority(a) - purchasePriority(b));

  return (
    <div className="pg-design-page pg-wallet-page">
      {donatingPurchase && (
        <DonateSeatSheet
          event={donatingPurchase.event}
          purchase={donatingPurchase.purchase}
          onClose={() => setDonatingPurchase(null)}
          onDonated={() => setDonatingPurchase(null)}
        />
      )}
      <PageIntro title="My tickets" description="Your tickets and upgrades." backTo="/me" backLabel="Back to Me" />

      {loading ? (
        <div className="pg-state pg-community-state" role="status">
          <RefreshCw size={30} className="animate-spin" aria-hidden="true" />
          <p>Loading your tickets…</p>
        </div>
      ) : error ? (
        <div className="pg-state pg-community-state">
          <AlertTriangle size={32} aria-hidden="true" />
          <h2>Failed to load tickets</h2>
          <p>{error}</p>
          <button onClick={load} className="pg-action pg-wallet-primary"><RefreshCw size={17} aria-hidden="true" /> Try again</button>
        </div>
      ) : !user ? (
        <div className="pg-state pg-community-state">
          <LockKeyhole size={32} aria-hidden="true" />
          <h2>Sign in to view your tickets</h2>
          <button onClick={() => base44.auth.redirectToLogin()} className="pg-action pg-wallet-primary">Sign in <ArrowRight size={18} aria-hidden="true" /></button>
        </div>
      ) : purchases.length === 0 ? (
        <div className="pg-state pg-community-state">
          <Ticket size={36} aria-hidden="true" />
          <h2>No tickets yet</h2>
          <p>Browse events and buy tickets — they’ll appear here.</p>
          <Link to="/events" className="pg-action pg-wallet-primary">Browse events <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
      ) : (
        <>
          <div className="pg-wallet-tickets">
            {orderedPurchases.map(p => (
              <PurchaseRow key={p.id} purchase={p} event={events[p.event_id]}
                onDonate={() => setDonatingPurchase({ purchase: p, event: events[p.event_id] })} />
            ))}
          </div>
          <p className="pg-wallet-note"><Info size={19} aria-hidden="true" /><span>Manage your orders here.</span></p>
        </>
      )}
    </div>
  );
}

function getTransferState(purchase) {
  if (purchase.transfer_status === 'completed') return { label: 'Received', tone: 'received' };
  if (purchase.transfer_status === 'disputed') return { label: 'Disputed', tone: 'disputed' };
  if (purchase.transfer_status === 'pending_transfer') {
    if (!purchase.seller_confirmed) return { label: 'Waiting on seller', tone: 'waiting' };
    if (!purchase.buyer_confirmed) return { label: 'Confirm receipt', tone: 'confirm' };
    return { label: 'Awaiting completion', tone: 'waiting' };
  }
  return { label: purchase.transfer_status?.replaceAll('_', ' ') || 'Status unavailable', tone: 'other' };
}

function PurchaseRow({ purchase: p, event, onDonate }) {
  const needsConfirm = p.transfer_status === 'pending_transfer' && p.seller_confirmed && !p.buyer_confirmed;
  const canUpgradeOrDonate = p.transfer_status === 'completed' && event;
  const status = getTransferState(p);
  const eventDate = event?.event_start_utc || event?.date;
  const date = eventDate ? new Date(eventDate) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? format(date, 'MMM d · h:mm a') : '';
  const amount = p.amount != null && Number.isFinite(Number(p.amount)) ? `$${Number(p.amount).toFixed(2)}` : null;

  return (
    <article className="pg-ticket pg-wallet-ticket" aria-label={`${event?.title || 'Event'}, ${status.label}`}>
      <div className="pg-wallet-ticket-summary">
        {event ? <EventThumbnail event={event} className="pg-wallet-event-image" /> : (
          <div className="pg-wallet-event-image pg-wallet-image-fallback"><Ticket size={28} aria-hidden="true" /></div>
        )}
        <div className="pg-wallet-ticket-info">
          <h2>{event?.title || 'Event'}</h2>
          {dateLabel && <p className="pg-wallet-date">{dateLabel}</p>}
          {event?.venue && <p className="pg-wallet-venue">{event.venue}</p>}
          <div className="pg-wallet-ticket-meta">
            <p>{amount}{amount && p.quantity != null ? ' · ' : ''}{p.quantity != null ? `${p.quantity} ${Number(p.quantity) === 1 ? 'ticket' : 'tickets'}` : ''}</p>
            <span className={`pg-transfer-status pg-transfer-${status.tone}`}>{status.label}</span>
          </div>
        </div>
      </div>
      <div className={`pg-wallet-ticket-actions${canUpgradeOrDonate ? ' pg-wallet-three-actions' : ''}`}>
        <Link to={`/purchase/${p.id}`} className={`pg-action pg-wallet-view${needsConfirm ? ' pg-wallet-confirm' : ''}`}>
          <span>{needsConfirm ? 'Confirm' : 'View'}</span>
          {!canUpgradeOrDonate && <ArrowRight size={23} aria-hidden="true" />}
        </Link>
        {canUpgradeOrDonate && (
          <>
            <Link to={`/upgrades/${p.event_id}`} className="pg-action pg-wallet-upgrade">Upgrade</Link>
            <button onClick={onDonate} className="pg-action pg-wallet-donate">Donate</button>
          </>
        )}
      </div>
    </article>
  );
}
