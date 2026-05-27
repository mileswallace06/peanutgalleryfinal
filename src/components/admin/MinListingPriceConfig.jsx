/**
 * MinListingPriceConfig
 * ──────────────────────
 * Admin UI to preview and configure the minimum listing price policy.
 * Stored in localStorage for now (no backend needed until enforced).
 * Does NOT enforce the rule yet — wiring into CreateListing is a separate step.
 */
import { useState, useEffect } from 'react';
import { calculateFees, FEE_MODELS, ACTIVE_FEE_MODEL_ID } from '@/lib/feeEngine';

const STORAGE_KEY = 'pg_min_listing_price_config';

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { enabled: false, threshold: 10 };
  } catch { return { enabled: false, threshold: 10 }; }
}

export default function MinListingPriceConfig() {
  const [config, setConfig] = useState(loadConfig);
  const [saved, setSaved] = useState(false);

  const save = (next) => {
    setConfig(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const thresholdFees = calculateFees(config.threshold, 1, ACTIVE_FEE_MODEL_ID);
  const thresholdFees5min1 = calculateFees(config.threshold, 1, 'pct5_min1');

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🔒</span>
        <h2 className="font-bold text-lg">Minimum Listing Price</h2>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold ml-1"
          style={{ background: 'rgba(255,200,0,0.12)', color: '#FFE600', border: '1px solid rgba(255,200,0,0.25)' }}>
          NOT ENFORCED
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Configure the floor price for new listings. Enforcement requires separate wiring into CreateListing — this is config preview only.
      </p>

      {/* Toggle */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => save({ ...config, enabled: !config.enabled })}
          className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
          style={{ background: config.enabled ? '#00FF87' : 'hsl(var(--muted))' }}
        >
          <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
            style={{ transform: config.enabled ? 'translateX(20px)' : 'translateX(0)' }} />
        </button>
        <span className="text-sm font-semibold text-foreground">
          {config.enabled ? 'Enabled (preview only)' : 'Disabled'}
        </span>
      </div>

      {/* Threshold */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-muted-foreground whitespace-nowrap">Minimum price:</label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-muted-foreground">$</span>
          <input
            type="number" min="1" max="100" step="1"
            value={config.threshold}
            onChange={e => save({ ...config, threshold: parseInt(e.target.value) || 1 })}
            className="w-20 px-3 py-2 rounded-xl text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            style={{ background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))' }}
          />
          <span className="text-xs text-muted-foreground">per ticket</span>
        </div>
        {saved && <span className="text-xs font-semibold" style={{ color: '#00FF87' }}>✓ Saved</span>}
      </div>

      {/* Impact preview at threshold */}
      <div className="rounded-xl p-3 text-xs space-y-1.5"
        style={{ background: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))' }}>
        <div className="font-black text-muted-foreground uppercase tracking-wide text-[10px] mb-2">
          At ${config.threshold} minimum (5% + $1 min model):
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Buyer pays</span>
          <span className="font-bold text-foreground">${thresholdFees5min1.buyerTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">PG fee collected</span>
          <span className="font-bold" style={{ color: '#BF5FFF' }}>${thresholdFees5min1.pgFee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">PG net (after Stripe)</span>
          <span className="font-bold" style={{ color: thresholdFees5min1.pgNetRevenue > 0 ? '#00FF87' : '#FF2D78' }}>
            ${thresholdFees5min1.pgNetRevenue.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Seller receives</span>
          <span className="font-bold text-foreground">${thresholdFees5min1.sellerPayout.toFixed(2)}</span>
        </div>
        <div className="pt-1.5 border-t border-border">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${thresholdFees5min1.profitable ? '' : ''}`}
            style={thresholdFees5min1.profitable
              ? { background: 'rgba(0,255,135,0.12)', color: '#00FF87' }
              : { background: 'rgba(255,45,120,0.12)', color: '#FF2D78' }}>
            {thresholdFees5min1.profitable ? '✓ Profitable at this floor' : '✗ Still unprofitable — raise threshold'}
          </span>
        </div>
      </div>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-2 mt-3">
        <span className="text-xs text-muted-foreground self-center">Presets:</span>
        {[5, 10, 15, 20].map(t => (
          <button key={t}
            onClick={() => save({ ...config, threshold: t })}
            className="text-xs px-3 py-1 rounded-xl transition-all"
            style={{
              background: config.threshold === t ? 'rgba(191,95,255,0.15)' : 'hsl(var(--muted))',
              border: config.threshold === t ? '1px solid rgba(191,95,255,0.4)' : '1px solid hsl(var(--border))',
              color: config.threshold === t ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
            }}>
            ${t}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground mt-3">
        Recommended: <strong>$10</strong> — profitable on 5% + $1 min, low UX friction, blocks economically impossible transactions.
      </p>
    </div>
  );
}