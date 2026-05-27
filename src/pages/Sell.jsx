import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Plus, Tag, TrendingUp, LogIn, BadgeCheck, ExternalLink, Loader2, AlertCircle, MapPin, Calendar, ChevronRight } from 'lucide-react';
import { fetchTMEvents } from '@/lib/tmCache';
import { isAdmin } from '@/lib/isAdmin';

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
      <div className="flex items-center justify-center py-32">
        <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 px-5 py-32 text-center">
        <div className="text-5xl">🥜</div>
        <h2 className="font-display text-3xl text-foreground">Sign In to Sell</h2>
        <p className="text-sm text-muted-foreground max-w-[240px]">
          List your seats and start earning.
        </p>
        <button
          onClick={() => base44.auth.redirectToLogin()}
          className="flex items-center gap-2 font-bold px-8 py-3.5 rounded-full neon-glow-green"
          style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', color: '#0D0B14' }}
        >
          <LogIn className="w-4 h-4" /> Sign In
        </button>
      </div>
    );
  }

  const active = listings.filter(l => l.status === 'active' || l.status === 'pending_transfer');
  const sold = listings.filter(l => l.status === 'sold');
  const other = listings.filter(l => l.status === 'cancelled' || l.status === 'expired');

  return (
    <div className="pb-32">
      {/* Hero */}
      <div className="relative h-56 overflow-hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        <img
          src="https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=900&q=80"
          alt="Sell"
          className="w-full h-full object-cover object-top"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.45) 0%, rgba(5,3,12,0.2) 40%, rgba(5,3,12,0.92) 100%)' }}
        />

        <div className="absolute bottom-5 left-4 right-4">
          <span className="text-[10px] font-black tracking-[0.2em] px-3 py-1 rounded-full inline-block mb-3"
            style={{ background: 'rgba(0,0,0,0.5)', color: '#FF8C00', border: '1px solid #FF8C0055', backdropFilter: 'blur(12px)' }}>
            🏷️ SELLER HUB
          </span>
          <h1 className="font-display leading-[0.9] mb-3"
            style={{
              fontSize: 'clamp(3.2rem, 15vw, 5.2rem)',
              letterSpacing: '-0.02em',
              background: 'linear-gradient(135deg, #FF2D78 0%, #FFE600 55%, #00FF87 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 6px 24px rgba(0,0,0,0.6))'
            }}>
            Sell Tickets
          </h1>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(255,140,0,0.15)', border: '1px solid rgba(255,140,0,0.35)' }}>
            <Tag className="w-3 h-3 flex-shrink-0" style={{ color: '#FF2D78' }} />
            <span className="text-[11px] font-medium leading-snug" style={{ color: 'rgba(255,215,235,0.9)' }}>
              List your seats instantly. Sellers keep 95% — the highest rate in the industry.
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 pt-6 space-y-6">

        {/* Stripe Onboarding Gate */}
        {onboardingChecking ? (
          <div className="flex items-center justify-center gap-3 py-5 rounded-2xl"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-muted-foreground">Verifying payout account…</span>
          </div>
        ) : isAdmin(user) || user.stripe_onboarding_complete === true || user.stripe_onboarding_complete === 'true' ? (
          /* Primary CTA — onboarding done or admin bypass */
          <Link
            to="/create-listing"
            className="flex items-center justify-center gap-2 w-full py-4 rounded-full font-black text-sm"
            style={{ background: 'linear-gradient(135deg, #FF2D78, #BF5FFF)', color: '#fff', boxShadow: '0 0 20px rgba(191,95,255,0.25)' }}
          >
            <Plus className="w-4 h-4" /> List My Tickets
          </Link>
        ) : (
          /* Onboarding CTA — required before listing */
          <div className="rounded-2xl overflow-hidden"
            style={{ border: '1px solid rgba(255,140,0,0.35)', background: 'rgba(255,140,0,0.06)' }}>
            <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,140,0,0.2)' }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'rgba(255,140,0,0.15)', border: '1px solid rgba(255,140,0,0.3)' }}>
                  <AlertCircle className="w-4 h-4" style={{ color: '#FF8C00' }} />
                </div>
                <div>
                  <p className="font-black text-sm text-foreground">
                    {user.stripe_account_id ? 'Finish Your Payout Setup' : 'Connect Your Payout Account'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {user.stripe_account_id
                      ? 'Your Stripe account was started but not completed. Finish setup to activate payouts and start listing.'
                      : 'To list tickets and receive payouts, you need to connect a bank account via Stripe. Takes under 2 minutes.'}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
                {['Secure & encrypted', 'Instant payouts', 'Industry standard'].map(t => (
                  <div key={t} className="flex flex-col items-center gap-1">
                    <BadgeCheck className="w-3.5 h-3.5 text-primary" />
                    {t}
                  </div>
                ))}
              </div>
              <button
                onClick={handleStartOnboarding}
                disabled={onboardingLoading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #FF8C00, #FF2D78)', color: '#fff', boxShadow: '0 0 18px rgba(255,140,0,0.25)' }}
              >
                {onboardingLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Stripe…</>
                  : <><ExternalLink className="w-4 h-4" /> {user.stripe_account_id ? 'Finish Payout Setup' : 'Set Up Payouts with Stripe'}</>
                }
              </button>
              <p className="text-[10px] text-center text-muted-foreground">
                Powered by Stripe Connect. Your bank details are never stored by Peanut Gallery.
              </p>
              <Link to="/seller-payout-guide"
                className="block text-center text-xs font-semibold transition-colors"
                style={{ color: '#FF8C00' }}>
                📖 How does payout setup work? →
              </Link>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Active', value: active.length, color: 'var(--neon-green)', bg: 'rgba(0,255,135,0.08)', border: 'rgba(0,255,135,0.2)' },
            { label: 'Sold', value: sold.length, color: 'var(--neon-cyan)', bg: 'rgba(0,200,255,0.08)', border: 'rgba(0,200,255,0.2)' },
            { label: 'Total', value: listings.length, color: 'var(--neon-purple)', bg: 'rgba(191,95,255,0.08)', border: 'rgba(191,95,255,0.2)' },
          ].map(({ label, value, color, bg, border }) => (
            <div key={label} className="rounded-2xl px-4 py-3 text-center"
              style={{ background: bg, border: `1px solid ${border}` }}>
              <div className="font-display text-2xl" style={{ color }}>{value}</div>
              <div className="text-[11px] text-muted-foreground font-medium mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Recommended Events Near You */}
        <section>
          <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5" style={{ color: '#00C8FF' }} /> Events Near You
          </h2>
          {nearbyLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: 'hsl(var(--muted))' }} />)}
            </div>
          ) : nearbyEvents.length === 0 ? (
            <div className="rounded-2xl px-4 py-5 text-center text-sm text-muted-foreground"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              📍 Allow location access to see events near you
            </div>
          ) : (
            <div className="space-y-2">
              {nearbyEvents.map(ev => {
                const isTM = ev.source === 'ticketmaster';
                return (
                  <Link
                    key={ev.id}
                    to={`/create-listing?event_id=${isTM ? '' : ev.id}`}
                    onClick={isTM ? e => e.preventDefault() : undefined}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all active:scale-[0.98]"
                    style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  >
                    {ev.image_url
                      ? <img src={ev.image_url} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                      : <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background: 'hsl(var(--muted))' }}>🎫</div>
                    }
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-foreground truncate">{ev.title}</div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        <span className="truncate">{ev.venue}{ev.city ? `, ${ev.city}` : ''}</span>
                        {ev.date && <span className="flex-shrink-0">· {format(new Date(ev.date), 'MMM d')}</span>}
                      </div>
                    </div>
                    {!isTM && <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                    {isTM && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>TM</span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Active listings */}
        {active.length > 0 && (
          <section>
            <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
              <Tag className="w-3.5 h-3.5" style={{ color: '#00FF87' }} /> Active ({active.length})
            </h2>
            <div className="space-y-3">
              {active.map(l => <ListingRow key={l.id} listing={l} />)}
            </div>
          </section>
        )}

        {/* Sold */}
        {sold.length > 0 && (
          <section>
            <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" style={{ color: '#00C8FF' }} /> Sold ({sold.length})
            </h2>
            <div className="space-y-3">
              {sold.map(l => <ListingRow key={l.id} listing={l} />)}
            </div>
          </section>
        )}

        {/* Empty state */}
        {listings.length === 0 && (
          <div className="text-center py-12 glass-card rounded-2xl px-6">
            <p className="text-4xl mb-3">🎟️</p>
            <p className="font-bold text-foreground">No listings yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Got seats you can't use? List them now.</p>
            <Link to="/create-listing"
              className="inline-flex items-center gap-2 font-bold px-6 py-3 rounded-full"
              style={{ background: '#FF2D78', color: '#fff' }}>
              <Plus className="w-4 h-4" /> Create Listing
            </Link>
            <Link to="/why-peanut-gallery"
              className="block mt-4 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
              🥜 Why Peanut Gallery? How we protect fans →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function ListingRow({ listing }) {
  const STATUS_COLOR = {
    active: 'var(--neon-green)',
    pending_transfer: 'var(--neon-yellow)',
    sold: 'var(--neon-cyan)',
    cancelled: 'var(--neon-pink)',
    expired: 'hsl(var(--muted-foreground))',
  };
  const color = STATUS_COLOR[listing.status] || 'hsl(var(--muted-foreground))';

  return (
    <div className="rounded-2xl px-4 py-4 flex items-center justify-between gap-3"
      style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm text-foreground truncate">
          Sec {listing.section}{listing.row ? ` · Row ${listing.row}` : ''}
          {listing.seats ? ` · Seats ${listing.seats}` : ''}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {listing.quantity} ticket{listing.quantity !== 1 ? 's' : ''} · ${listing.asking_price}/ea
        </div>
      </div>
      <span className="text-[10px] font-black px-2.5 py-1 rounded-full capitalize flex-shrink-0"
        style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
        {listing.status.replace('_', ' ')}
      </span>
    </div>
  );
}