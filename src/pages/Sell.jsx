import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Plus, Ticket, LogIn, ExternalLink, Loader2, AlertCircle, MapPin, ChevronRight, ArrowRight } from 'lucide-react';
import { fetchTMEvents } from '@/lib/tmCache';
import { isAdmin } from '@/lib/isAdmin';
import './sell-ticket.css';

export default function Sell() {
  const [user, setUser] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingChecking, setOnboardingChecking] = useState(false);
  const [searchParams] = useSearchParams();

  // Nearby events state
  const [nearbyEvents, setNearbyEvents] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(true);

  const loadUser = async () => {
    // Pass { fresh: true } to bypass any SDK-level cache
    const me = await base44.auth.me({ fresh: true }).catch(() => base44.auth.me());
    setUser(me);
    return me;
  };

  // Fetch nearby events via geolocation — same logic as Events page
  useEffect(() => {
    setNearbyLoading(true);
    const now = Date.now();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const ll = `${pos.coords.latitude},${pos.coords.longitude}`;
        try {
          const [localData, { events: tmEventsRaw }] = await Promise.all([
            base44.entities.Event.list('date', 50),
            fetchTMEvents(base44, { latlong: ll, radius: '50', size: 40 }),
          ]);

          const tmCities = new Set(tmEventsRaw.map(e => e.city?.toLowerCase()).filter(Boolean));

          let pgFiltered = localData
            .filter(e => e.status !== 'ended')
            .filter(e => !e.date || now < new Date(e.date).getTime())
            .filter(e => !e.is_beta_live);

          if (tmCities.size > 0) {
            pgFiltered = pgFiltered.filter(e => !e.city || tmCities.has(e.city.toLowerCase()));
          } else {
            pgFiltered = [];
          }

          const pgEvents = pgFiltered.map(e => ({ ...e, source: 'pg' }));
          const pgTmIds = new Set(pgEvents.map(e => e.tm_id).filter(Boolean));
          const tmEvents = tmEventsRaw
            .filter(e => !pgTmIds.has(e.tm_id))
            .map(e => ({ ...e, id: `tm_${e.tm_id}`, source: 'ticketmaster' }));

          setNearbyEvents([...pgEvents, ...tmEvents].slice(0, 8));
        } catch (_) {}
        setNearbyLoading(false);
      },
      () => setNearbyLoading(false),
      { timeout: 8000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    loadUser()
      .then(async (me) => {
        const myListings = await base44.entities.Listing.filter({ seller_email: me.email });
        setListings(myListings.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));

        const param = searchParams.get('onboarding');
        const needsCheck =
          // Returned from Stripe onboarding flow
          (param === 'complete' || param === 'refresh') ||
          // Has a stripe account but flag is stale/missing — re-sync against Stripe
          (me.stripe_account_id && !me.stripe_onboarding_complete);

        if (needsCheck) {
          setOnboardingChecking(true);
          const res = await base44.functions.invoke('checkSellerOnboarding', {});
          if (res.data.complete) {
            await loadUser();
          }
          setOnboardingChecking(false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleStartOnboarding = async () => {
    setOnboardingLoading(true);
    const res = await base44.functions.invoke('onboardSeller', {});
    if (res.data.url) {
      window.top.location.href = res.data.url;
    } else {
      setOnboardingLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="pg-design-page pg-sell-page">
        <div className="pg-state pg-sell-loading" role="status">
          <Loader2 className="pg-sell-spinner" aria-hidden="true" />
          <span>Loading your listings…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="pg-design-page pg-sell-page">
        <div className="pg-state pg-sell-signin">
          <Ticket className="pg-sell-state-icon" aria-hidden="true" />
          <h1 className="pg-page-title">Sign in to sell</h1>
          <p>List your seats and start earning.</p>
          <button onClick={() => base44.auth.redirectToLogin()} className="pg-action pg-sell-primary">
            <LogIn size={18} aria-hidden="true" /> Sign In
          </button>
        </div>
      </div>
    );
  }

  const active = listings.filter(l => l.status === 'active' || l.status === 'pending_transfer');
  const drafts = listings.filter(l => l.status === 'pending_payout_setup');
  const sold = listings.filter(l => l.status === 'sold');
  const other = listings.filter(l => l.status === 'cancelled' || l.status === 'expired');

  return (
    <div className="pg-design-page pg-sell-page">
      <header className="pg-sell-intro" data-page-hero="sell">
        <h1 className="pg-page-title">Sell your seats</h1>
      </header>

      <div className="pg-sell-content">
        {/* Listing creation remains available while payout setup is incomplete. */}
        {!isAdmin(user) && user.stripe_onboarding_complete !== true && user.stripe_onboarding_complete !== 'true' && (
          <Link to="/create-listing" className="pg-action pg-sell-primary">
            <Plus size={19} aria-hidden="true" />
            <span>List my tickets</span>
            <ArrowRight size={21} aria-hidden="true" />
          </Link>
        )}

        {/* Stripe onboarding gate and existing payout actions. */}
        {onboardingChecking ? (
          <div className="pg-sell-payout pg-sell-verifying" role="status">
            <Loader2 className="pg-sell-spinner" size={18} aria-hidden="true" />
            <span>Verifying payout account…</span>
          </div>
        ) : isAdmin(user) || user.stripe_onboarding_complete === true || user.stripe_onboarding_complete === 'true' ? (
          <Link to="/create-listing" className="pg-action pg-sell-primary">
            <Plus size={19} aria-hidden="true" />
            <span>List my tickets</span>
            <ArrowRight size={21} aria-hidden="true" />
          </Link>
        ) : (
          <div className="pg-sell-payout">
            <div className="pg-sell-payout-heading">
              <span className="pg-sell-payout-icon"><AlertCircle size={19} aria-hidden="true" /></span>
              <div>
                <h2>{user.stripe_account_id ? 'Finish your payout setup' : 'Payout setup needed'}</h2>
                <p>{user.stripe_account_id
                  ? 'Finish your Stripe setup to activate payouts and start listing.'
                  : 'Connect a bank account via Stripe to list tickets and receive payouts.'}</p>
              </div>
            </div>
            <button onClick={handleStartOnboarding} disabled={onboardingLoading} className="pg-action pg-sell-payout-action">
              {onboardingLoading
                ? <><Loader2 className="pg-sell-spinner" size={17} aria-hidden="true" /> Redirecting to Stripe…</>
                : <><ExternalLink size={17} aria-hidden="true" /> {user.stripe_account_id ? 'Finish Payout Setup' : 'Set Up Payouts with Stripe'} <ChevronRight size={17} aria-hidden="true" /></>}
            </button>
            <p className="pg-sell-payout-note">Powered by Stripe Connect. Your bank details are never stored by Peanut Gallery.</p>
            <Link to="/seller-payout-guide" className="pg-action pg-sell-guide">
              How does payout setup work? <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
        )}

        {!isAdmin(user) && user.stripe_onboarding_complete !== true && user.stripe_onboarding_complete !== 'true' && (
          <p className="pg-sell-draft-note">Save your listing now. It will go live once payout setup is complete.</p>
        )}

        <div className="pg-sell-stats" aria-label="Your listing totals">
          {[
            { label: 'Active', value: active.length },
            { label: 'Sold', value: sold.length },
            { label: 'Total', value: listings.length },
          ].map(({ label, value }) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>

        {drafts.length > 0 && (
          <section className="pg-sell-listing-section">
            <h2 className="pg-section-title">Your drafts <span>{drafts.length}</span></h2>
            <div className="pg-sell-listings">
              {drafts.map(l => <ListingRow key={l.id} listing={l} event={nearbyEvents.find(ev => ev.id === l.event_id)} />)}
            </div>
          </section>
        )}

        {active.length > 0 && (
          <section className="pg-sell-listing-section">
            <h2 className="pg-section-title">Active <span>{active.length}</span></h2>
            <div className="pg-sell-listings">
              {active.map(l => <ListingRow key={l.id} listing={l} event={nearbyEvents.find(ev => ev.id === l.event_id)} />)}
            </div>
          </section>
        )}

        {sold.length > 0 && (
          <section className="pg-sell-listing-section">
            <h2 className="pg-section-title">Sold <span>{sold.length}</span></h2>
            <div className="pg-sell-listings">
              {sold.map(l => <ListingRow key={l.id} listing={l} event={nearbyEvents.find(ev => ev.id === l.event_id)} />)}
            </div>
          </section>
        )}

        {listings.length === 0 && (
          <div className="pg-state pg-sell-empty">
            <Ticket className="pg-sell-state-icon" aria-hidden="true" />
            <h2>Got seats you can’t use?</h2>
            <p>Create your first listing and give another fan a better view.</p>
            <Link to="/create-listing" className="pg-action pg-sell-empty-action"><Plus size={17} aria-hidden="true" /> Create Listing</Link>
            <Link to="/why-peanut-gallery" className="pg-action pg-sell-guide">How we protect fans <ChevronRight size={16} aria-hidden="true" /></Link>
          </div>
        )}

        {/* Nearby event links retain their existing search and event destinations. */}
        <section className="pg-sell-nearby">
          <h2 className="pg-section-title"><MapPin size={19} aria-hidden="true" /> Events near you</h2>
          {nearbyLoading ? (
            <div className="pg-sell-nearby-list" aria-label="Loading nearby events" role="status">
              {[1, 2, 3].map(i => <div key={i} className="pg-sell-nearby-skeleton" />)}
            </div>
          ) : nearbyEvents.length === 0 ? (
            <div className="pg-state pg-sell-location-state"><MapPin size={20} aria-hidden="true" /><p>Allow location access to see events near you.</p></div>
          ) : (
            <div className="pg-sell-nearby-list">
              {nearbyEvents.map(ev => {
                const isTM = ev.source === 'ticketmaster';
                const linkTo = isTM
                  ? `/create-listing?tab=search&q=${encodeURIComponent(ev.title)}`
                  : `/create-listing?event_id=${ev.id}`;
                return (
                  <Link key={ev.id} to={linkTo} className="pg-ticket pg-printed-ticket pg-sell-nearby-event">
                    {ev.image_url
                      ? <img src={ev.image_url} alt="" />
                      : <span className="pg-sell-nearby-placeholder"><Ticket size={22} aria-hidden="true" /></span>}
                    <div className="pg-sell-nearby-details">
                      <h3>{ev.title}</h3>
                      <p>{ev.venue}{ev.city ? `, ${ev.city}` : ''}{ev.date ? ` · ${format(new Date(ev.date), 'MMM d')}` : ''}</p>
                    </div>
                    {isTM ? <span className="pg-sell-search-label">Search <ChevronRight size={14} aria-hidden="true" /></span> : <ChevronRight size={19} aria-hidden="true" />}
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ListingRow({ listing, event }) {
  const STATUS_LABEL = {
    active: 'Active',
    pending_transfer: 'Pending transfer',
    sold: 'Sold',
    cancelled: 'Cancelled',
    expired: 'Expired',
    pending_payout_setup: 'Draft · Payout pending',
  };
  const isDraft = listing.status === 'pending_payout_setup';

  return (
    <article className={`pg-ticket pg-printed-ticket pg-sell-listing pg-sell-listing-${listing.status}`}>
      <div className="pg-sell-listing-image">
        {event?.image_url ? <img src={event.image_url} alt="" /> : <Ticket size={27} strokeWidth={1.6} aria-hidden="true" />}
      </div>
      <div className="pg-sell-listing-details">
        <h3>{event?.title || `Section ${listing.section}`}</h3>
        {event?.date && <p className="pg-sell-listing-date">{format(new Date(event.date), 'MMM d · h:mm a')}</p>}
        <p className="pg-sell-seat-details">
          {event?.title ? `Sec ${listing.section}` : ''}
          {listing.row ? `${event?.title ? ' · ' : ''}Row ${listing.row}` : ''}
          {listing.seats ? `${event?.title || listing.row ? ' · ' : ''}Seats ${listing.seats}` : ''}
        </p>
        <p className="pg-sell-listing-quantity">{listing.quantity} ticket{listing.quantity !== 1 ? 's' : ''}</p>
        <span className="pg-sell-status">{STATUS_LABEL[listing.status] || listing.status.replace(/_/g, ' ')}</span>
      </div>
      <div className="pg-ticket-end pg-sell-listing-price"><strong>${listing.asking_price}</strong><span>each</span></div>
      {isDraft && <p className="pg-sell-listing-note">Not visible to buyers until payout setup is complete.</p>}
    </article>
  );
}
