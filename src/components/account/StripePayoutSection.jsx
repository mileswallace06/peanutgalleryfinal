import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Banknote, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';

export default function StripePayoutSection({ user, stripeStatus, loading }) {
  const [open, setOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);

  const hasStripe = !!stripeStatus?.details_submitted;
  const isReady = stripeStatus?.charges_enabled;

  const handleSetupStripe = async () => {
    setOnboarding(true);
    const res = await base44.functions.invoke('onboardSeller', {});
    if (res?.data?.url) window.location.href = res.data.url;
    setOnboarding(false);
  };

  return (
    <section>
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Payout Account</h3>
      <div className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        {/* Status row */}
        <button
          className="flex items-center gap-3 px-4 py-3.5 w-full text-left"
          onClick={() => setOpen(o => !o)}
        >
          <Banknote className="w-4 h-4 flex-shrink-0" style={{ color: '#00FF87' }} />
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Payout Account</p>
            {loading ? (
              <p className="text-sm text-muted-foreground">Checking…</p>
            ) : !hasStripe ? (
              <p className="text-sm text-foreground">Not connected</p>
            ) : isReady ? (
              <p className="text-sm font-semibold" style={{ color: '#00FF87' }}>✓ Active — payouts enabled</p>
            ) : (
              <p className="text-sm font-semibold" style={{ color: '#FFE600' }}>⚠ Setup incomplete</p>
            )}
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {open && (
          <div className="px-4 pb-4 space-y-3 border-t border-border">
            <p className="text-xs text-muted-foreground pt-3 leading-relaxed">
              Peanut Gallery uses Stripe to pay out sellers after ticket transfers are confirmed. Your banking info is stored securely by Stripe — we never see it.
            </p>
            {!hasStripe || !isReady ? (
              <button
                onClick={handleSetupStripe}
                disabled={onboarding}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-60"
                style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}
              >
                {onboarding
                  ? <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: '#00FF87', borderTopColor: 'transparent' }} />
                  : null
                }
                {hasStripe ? 'Complete Stripe Setup' : 'Connect Stripe Account'}
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="rounded-xl px-4 py-3 text-xs space-y-1"
                style={{ background: 'rgba(0,255,135,0.07)', border: '1px solid rgba(0,255,135,0.2)' }}>
                <p className="font-bold text-foreground">Stripe account connected</p>
                <p className="text-muted-foreground">Charges enabled · Payouts routed automatically after transfer confirmation.</p>
              </div>
            )}
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