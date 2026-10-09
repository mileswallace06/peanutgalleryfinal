import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getEventDateDisplay } from '@/lib/eventDateDisplay';
import { Plus, Ticket, LogIn, ExternalLink, Loader2, AlertCircle, MapPin, ChevronRight, ArrowRight, X } from 'lucide-react';
import { useSellingDiscovery } from '@/hooks/useSellingDiscovery';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { sellingEventList } from '@/lib/sellingEventTiming';
import { useEventClock } from '@/hooks/useEventClock';
import { isAdmin } from '@/lib/isAdmin';
import './sell-ticket.css';
import { useSellerSummary } from '@/hooks/useSellerSummary';
import { SELLER_HISTORY_SCOPE } from '@/lib/salesPresentation';

export default function Sell() {
  const [user, setUser] = useState(null);
  const sellerHistory = useSellerSummary(user);
  const [listingsError, setListingsError] = useState(false);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingChecking, setOnboardingChecking] = useState(false);
  const [searchParams] = useSearchParams();

  // A browsing market never grants venue eligibility or replaces purchase checks.
  const discovery = useSellingDiscovery();
  const now = useEventClock();
  const nearbyEvents = sellingEventList(discovery.result.events, 'all', now).slice(0, 8).map(row => row.event);
  const nearbyLoading = discovery.loading || discovery.restoring;
  const nearbyError = discovery.result.pgError || discovery.result.tmError;

  const loadUser = async () => {
    // Pass { fresh: true } to bypass any SDK-level cache
    const me = await base44.auth.me({ fresh: true }).catch(() => base44.auth.me());
    setUser(me);
    return me;
  };

  useEffect(() => {
    loadUser()
      .then(async (me) => {
        const myListings = await base44.entities.Listing.filter({ seller_email: me.email }).catch(error => { setListingsError(true); throw error; });
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

        <div className="pg-sell-stats" aria-label="Your listings and sales">
          {[
            { label: 'Active listings', value: listingsError ? 'Unavailable' : active.length },
            { label: 'Completed sales', value: sellerHistory.status === 'ready' ? sellerHistory.summary.completedCount : sellerHistory.status === 'loading' ? '…' : 'Unavailable' },
            { label: 'Loaded listings', value: listingsError ? 'Unavailable' : listings.length },
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

        <p className="pg-sell-draft-note">Completed sales: completed transfers in {SELLER_HISTORY_SCOPE.toLowerCase()}</p>
        {sellerHistory.status === 'error' && <button type="button" className="pg-action" onClick={sellerHistory.reload}>Retry sales total</button>}
        {listingsError && <p role="alert">Your listing summary could not be loaded. Refresh to try again.</p>}

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
            <h2 className="pg-section-title">Listings marked sold <span>{sold.length}</span></h2>
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
          <h2 className="pg-section-title"><MapPin size={19} aria-hidden="true" /> Nearby events</h2>
          <button type="button" className="pg-action pg-sell-guide" onClick={discovery.openLocation} aria-expanded={discovery.editingLocation} aria-controls="sell-location-filter">
            <MapPin size={16} aria-hidden="true" />{discovery.area?.label || 'Choose city'}<ChevronRight size={16} aria-hidden="true" />
          </button>
          {discovery.editingLocation && <section id="sell-location-filter" aria-label="Browsing location" className="rounded-xl border border-border bg-card p-4 space-y-3 mb-3">
            <div className="flex items-center justify-between gap-2"><h3 className="font-bold">Choose your local area</h3><button type="button" onClick={discovery.closeLocation} aria-label="Close location picker" className="pg-action min-h-11 min-w-11 flex items-center justify-center"><X size={18} aria-hidden="true" /></button></div>
            <LocationAutocomplete value={discovery.locationInput} onChange={discovery.changeLocationInput} onSelect={discovery.selectCity} onSubmit={discovery.rejectCity} onNearMe={null} autoFocus placeholder="Find a city" />
            {discovery.cityError && <p role="alert" className="text-sm text-muted-foreground">{discovery.cityError}</p>}
            <button type="button" onClick={() => discovery.locate()} disabled={discovery.locationStatus === 'requesting'} className="pg-action pg-sell-guide disabled:opacity-50">{discovery.locationStatus === 'requesting' ? 'Locating…' : 'Use my location'}</button>
          </section>}
          {nearbyError && <div className="pg-state pg-sell-location-state" role="status"><p>Event results are incomplete. Try loading them again.</p><button type="button" className="pg-action pg-sell-guide" onClick={discovery.refresh}>Try again</button></div>}
          {nearbyLoading ? (
            <div className="pg-sell-nearby-list" aria-label="Loading nearby events" role="status">
              {[1, 2, 3].map(i => <div key={i} className="pg-sell-nearby-skeleton" />)}
            </div>
          ) : nearbyEvents.length === 0 ? (
            <div className="pg-state pg-sell-location-state"><MapPin size={20} aria-hidden="true" /><div><p>{!discovery.area ? 'Choose a city or use your location to browse nearby events.' : nearbyError ? 'Nearby events could not be fully loaded.' : `No events found near ${discovery.area.label}. Try another city.`}</p><button type="button" className="pg-action pg-sell-guide" onClick={discovery.openLocation}>Choose city</button></div></div>
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
                      <p>{ev.venue}{ev.city ? `, ${ev.city}` : ''}{` · ${getEventDateDisplay(ev)?.compactLabel || 'Date to be confirmed'}`}</p>
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
        {event && <p className="pg-sell-listing-date">{getEventDateDisplay(event)?.compactLabel || 'Date to be confirmed'}</p>}
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
