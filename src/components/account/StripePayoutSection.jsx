import '@/components/member-surfaces.css';
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Banknote, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';

export default function StripePayoutSection({ stripeStatus, loading, error = false, onRetry, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [onboarding, setOnboarding] = useState(false);
  const [setupError, setSetupError] = useState(false);
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);

  // The current onboarding endpoint reports charge readiness, not payout
  // readiness. Missing payout evidence must never become an enabled claim.
  const detailsSubmitted = stripeStatus?.details_submitted === true;
  const payoutsEnabled = stripeStatus?.payouts_enabled === true;
  const payoutsDisabled = stripeStatus?.payouts_enabled === false;
  const statusLabel = loading ? 'Checking Stripe status…'
    : error ? 'Stripe status unavailable'
      : payoutsEnabled ? 'Payouts enabled'
        : payoutsDisabled ? 'Payouts disabled'
          : 'Payout status not confirmed';

  const handleSetupStripe = async () => {
    setOnboarding(true);
    setSetupError(false);
    try {
      const res = await base44.functions.invoke('onboardSeller', {});
      if (!res?.data?.url) throw new Error('Setup link unavailable');
      window.location.href = res.data.url;
    } catch { setSetupError(true); }
    finally { setOnboarding(false); }
  };

  return (
    <section id="payouts" tabIndex={-1} aria-label="Payout account setup" className="pg-member-section" style={{ scrollMarginTop: 24 }}>
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Payout Account</h3>
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
        {/* Status row */}
        <button
          className="flex items-center gap-3 px-4 py-3.5 w-full text-left"
          aria-expanded={open}
          aria-controls="payout-account-details"
          onClick={() => setOpen(o => !o)}
        >
          <Banknote className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-green)' }} />
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Payout Account</p>
            <p role="status" className="text-sm font-semibold text-foreground">{statusLabel}</p>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {open && (
          <div id="payout-account-details" className="px-4 pb-4 space-y-3 border-t border-border">
            <p className="text-xs text-muted-foreground pt-3 leading-relaxed">
              Peanut Gallery uses Stripe to pay out sellers after ticket transfers are confirmed. Your banking info is stored securely by Stripe — we never see it.
            </p>
            {error && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Stripe status could not be checked. Your account connection and payout readiness are unconfirmed.</p>
                <button type="button" onClick={onRetry} className="pg-action">Retry Stripe status</button>
              </div>
            )}
            {!loading && !error && (
              <div className="rounded-xl px-4 py-3 text-xs space-y-1" style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)' }}>
                <p className="font-bold text-foreground">{detailsSubmitted ? 'Stripe setup details submitted' : 'Stripe setup incomplete'}</p>
                <p className="text-muted-foreground">{stripeStatus?.charges_enabled === true ? 'Charges enabled.' : 'Charges not enabled.'} {payoutsEnabled ? 'Stripe reports payouts enabled; this does not confirm any individual bank deposit.' : payoutsDisabled ? 'Stripe reports payouts disabled. Review your Stripe account requirements.' : 'Payout readiness is not included in the available status. Review Stripe for payout details.'}</p>
              </div>
            )}
            {!loading && !error && !payoutsEnabled && (
              <button
                type="button"
                onClick={handleSetupStripe}
                disabled={onboarding}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-60"
                style={{ background: 'rgba(0,255,135,0.12)', color: 'var(--neon-green)', border: '1px solid rgba(0,255,135,0.3)' }}
              >
                {onboarding
                  ? <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: '#00FF87', borderTopColor: 'transparent' }} />
                  : null
                }
                {detailsSubmitted ? 'Review Stripe Setup' : 'Continue Stripe Setup'}
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
            {setupError && <p role="alert" className="text-xs text-foreground">Stripe setup could not be opened. Please try again.</p>}
            {/* Trust note */}
            <div className="flex items-start gap-2 px-1">
              <span className="text-[10px] text-muted-foreground leading-relaxed">
                🔒 Secured via Stripe · Your banking info is never stored by Peanut Gallery
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
