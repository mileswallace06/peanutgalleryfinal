import { useState } from 'react';
import { Zap, CheckCircle2, Circle, ChevronDown, ChevronUp } from 'lucide-react';

const LIVE_CHECKS = [
  {
    category: 'Pre-Show (T-2 hours)',
    color: '#BF5FFF',
    items: [
      { id: 'stripe_mode', label: 'Stripe is in LIVE mode — confirm in Admin panel', critical: true },
      { id: 'listing_created', label: 'Test listing created for the event' },
      { id: 'listing_approved', label: 'Listing proof approved in Admin' },
      { id: 'location_test', label: 'Location detection tested at venue vicinity' },
      { id: 'event_visible', label: 'Event appears in Upgrades tab' },
      { id: 'event_listing', label: 'Listings visible on event detail page' },
    ]
  },
  {
    category: 'At-Show (Listing Speed)',
    color: '#FF8C00',
    items: [
      { id: 'create_speed', label: 'Listing creation < 60 seconds start-to-finish' },
      { id: 'photo_upload', label: 'Ticket photo uploads successfully on mobile' },
      { id: 'listing_live', label: 'Listing appears for buyers immediately after submit' },
      { id: 'price_correct', label: 'Asking price displays correctly on listing card' },
    ]
  },
  {
    category: 'At-Show (Purchase Flow)',
    color: '#FF2D78',
    items: [
      { id: 'buyer_finds', label: 'Buyer can find listing easily', critical: true },
      { id: 'purchase_speed', label: 'Purchase dialog → payment < 2 minutes' },
      { id: 'payment_success', label: 'Payment succeeds without errors', critical: true },
      { id: 'buyer_confirmed', label: 'Buyer receives confirmation prompt' },
      { id: 'seller_notified', label: 'Seller sees sale notification' },
    ]
  },
  {
    category: 'Transfer Timing',
    color: '#00C8FF',
    items: [
      { id: 'transfer_initiated', label: 'Seller initiates transfer within 10 minutes' },
      { id: 'transfer_method', label: 'Transfer method is clear to seller' },
      { id: 'buyer_receives', label: 'Buyer receives tickets and confirms' },
      { id: 'payout_triggered', label: 'Payout triggered after buyer confirmation' },
    ]
  },
  {
    category: 'Upgrade Experience',
    color: '#00FF87',
    items: [
      { id: 'upgrade_excitement', label: '"Upgrade excitement" factor — does it feel live and urgent?' },
      { id: 'upgrade_location', label: 'Upgrades tab showing correct events for venue location' },
      { id: 'upgrade_speed', label: 'Upgrade purchase flow faster than general purchase' },
      { id: 'live_badge', label: 'LIVE badge visible on event cards' },
    ]
  },
  {
    category: 'Usability Under Urgency',
    color: '#FFE600',
    items: [
      { id: 'one_hand', label: 'Can complete purchase one-handed on iPhone' },
      { id: 'low_light', label: 'UI readable in dark/stadium conditions' },
      { id: 'no_crashes', label: 'No crashes or freezes during flow' },
      { id: 'back_nav', label: 'Back navigation works without data loss' },
    ]
  },
];

const STORAGE_KEY = 'pg_live_event_checks';

function loadChecks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveChecks(c) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {}
}

export default function LiveEventChecklist() {
  const [checks, setChecks] = useState(loadChecks);
  const [notes, setNotes] = useState({});
  const [openCats, setOpenCats] = useState({});
  const [eventName, setEventName] = useState(localStorage.getItem('pg_live_event_name') || '');

  const toggle = (id) => {
    const next = { ...checks, [id]: checks[id] === 'pass' ? 'untested' : 'pass' };
    setChecks(next);
    saveChecks(next);
  };

  const reset = () => {
    setChecks({});
    saveChecks({});
  };

  const allItems = LIVE_CHECKS.flatMap(c => c.items);
  const criticalItems = allItems.filter(i => i.critical);
  const passCount = allItems.filter(i => checks[i.id] === 'pass').length;
  const critPass = criticalItems.filter(i => checks[i.id] === 'pass').length;
  const critTotal = criticalItems.length;
  const pct = Math.round((passCount / allItems.length) * 100);
  const isLaunchReady = critPass === critTotal && pct >= 80;

  return (
    <div className="space-y-4">
      {/* Event name */}
      <div className="flex gap-3 items-center">
        <input value={eventName}
          onChange={e => { setEventName(e.target.value); localStorage.setItem('pg_live_event_name', e.target.value); }}
          placeholder="Event name (e.g. Taylor Swift @ MSG)"
          className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-bold focus:outline-none"
          style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
        <button onClick={reset}
          className="px-3 py-2.5 rounded-2xl text-xs font-bold"
          style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }}>
          Reset
        </button>
      </div>

      {/* Launch readiness */}
      <div className="rounded-2xl px-4 py-4" style={{
        background: isLaunchReady ? 'rgba(0,255,135,0.07)' : 'rgba(255,45,120,0.06)',
        border: `1px solid ${isLaunchReady ? 'rgba(0,255,135,0.25)' : 'rgba(255,45,120,0.2)'}`,
      }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" style={{ color: isLaunchReady ? '#00FF87' : '#FF2D78' }} />
            <span className="text-sm font-black" style={{ color: isLaunchReady ? '#00FF87' : '#FF2D78' }}>
              {isLaunchReady ? '✓ Ready for Live Event' : 'Not Ready for Live Event'}
            </span>
          </div>
          <span className="text-xs font-black" style={{ color: isLaunchReady ? '#00FF87' : '#FF2D78' }}>{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.1)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: isLaunchReady ? '#00FF87' : '#FF2D78' }} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Critical checks: {critPass}/{critTotal} · All checks: {passCount}/{allItems.length}
        </p>
      </div>

      {/* Categories */}
      {LIVE_CHECKS.map(({ category, color, items }) => {
        const catPass = items.filter(i => checks[i.id] === 'pass').length;
        const isOpen = openCats[category] !== false;

        return (
          <div key={category} className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: `1px solid hsl(var(--border))` }}>
            <button onClick={() => setOpenCats(p => ({ ...p, [category]: !isOpen }))}
              className="w-full flex items-center gap-3 px-4 py-3 text-left">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="flex-1 text-sm font-bold text-foreground">{category}</span>
              <span className="text-xs font-bold" style={{ color: catPass === items.length ? '#00FF87' : 'hsl(var(--muted-foreground))' }}>
                {catPass}/{items.length}
              </span>
              {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {isOpen && (
              <div className="divide-y divide-border border-t border-border">
                {items.map(({ id, label, critical }) => {
                  const done = checks[id] === 'pass';
                  return (
                    <button key={id} onClick={() => toggle(id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                      style={{ background: done ? 'rgba(0,255,135,0.03)' : 'transparent' }}>
                      {done
                        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#00FF87' }} />
                        : <Circle className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                      }
                      <span className="flex-1 text-sm" style={{ color: done ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))' }}>
                        {label}
                      </span>
                      {critical && !done && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
                          CRITICAL
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}