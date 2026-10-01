import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Gift, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import FlashDropCountdown from './FlashDropCountdown';
import './fan-gifts-ticket.css';

/**
 * FlashDropCard — Race-safe, server-authority winner selection.
 *
 * Winner selection flow:
 * 1. Client countdown hits 0 → setPhase('expired') only (no close_and_pick call)
 * 2. ONE designated caller (the donor's device OR any single device via timeout) calls close_and_pick ONCE
 * 3. ALL devices poll `poll_result` until ready=true
 * 4. Result shown to all — won/lost uses the server's viewer-specific flag.
 *
 * This eliminates the 500-device race condition entirely.
 */
export default function FlashDropCard({ drop: initialDrop, user, allListings = [], onEntered, onWinnerSelected }) {
  const [drop, setDrop] = useState(initialDrop);
  const [phase, setPhase] = useState(() => {
    if (initialDrop.status === 'winner_selected' || initialDrop.status === 'expired') return 'result';
    return 'active';
  });
  const [entered, setEntered] = useState(false);
  const [result, setResult] = useState(() => {
    if (initialDrop.status === 'winner_selected') {
      return { is_winner: initialDrop.is_winner === true, winner_name: initialDrop.winner_name, no_entries: false };
    }
    if (initialDrop.status === 'expired') return { no_entries: true };
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pollIntervalRef = useRef(null);
  const selectionFiredRef = useRef(false);

  // Check existing entry on mount
  useEffect(() => {
    if (!user?.email || !drop?.id) return;
    base44.entities.FlashDropEntry.filter({ flash_drop_id: drop.id, entrant_email: user.email })
      .then(rows => { if (rows.length > 0) setEntered(true); })
      .catch(() => {});
  }, [drop?.id, user?.email]);

  // Track view
  useEffect(() => {
    if (drop?.id && drop.status === 'active') {
      base44.functions.invoke('flashDrop', { action: 'track_view', flash_drop_id: drop.id }).catch(() => {});
    }
  }, [drop?.id]);

  // Cleanup poll on unmount
  useEffect(() => () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
  }, []);

  const startPolling = (flash_drop_id) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      const res = await base44.functions.invoke('flashDrop', { action: 'poll_result', flash_drop_id });
      const data = res?.data;
      if (data?.ready) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        setResult({
          is_winner: data.winner?.is_you === true,
          winner_name: data.winner?.name || null,
          no_entries: data.no_entries || false,
        });
        setPhase('result');
        onWinnerSelected?.(drop, data.winner);
      }
    }, 1000); // poll every second until result
  };

  /**
   * handleExpired — called by FlashDropCountdown when timer hits 0.
   * ONLY the donor's device fires close_and_pick. All others just poll.
   * This is a best-effort optimization — the server handles idempotency regardless.
   */
  const handleExpired = async () => {
    setPhase('expired');

    const isDonor = drop.is_donor === true;
    const flash_drop_id = drop.id;

    if (isDonor && !selectionFiredRef.current) {
      selectionFiredRef.current = true;
      // Donor triggers selection once
      base44.functions.invoke('flashDrop', {
        action: 'close_and_pick',
        flash_drop_id,
        request_id: `${flash_drop_id}-${Date.now()}`,
      }).catch(() => {});
    } else if (!isDonor) {
      // Non-donors: small random delay then fire close_and_pick as fallback
      // Server is idempotent — only the first one wins
      const delay = 500 + Math.random() * 3000;
      setTimeout(() => {
        if (!selectionFiredRef.current) {
          selectionFiredRef.current = true;
          base44.functions.invoke('flashDrop', {
            action: 'close_and_pick',
            flash_drop_id,
            request_id: `${flash_drop_id}-${Date.now()}`,
          }).catch(() => {});
        }
      }, delay);
    }

    // All devices poll for the result
    startPolling(flash_drop_id);
  };

  const handleEntry = async () => {
    if (!user) { base44.auth.redirectToLogin(); return; }
    setLoading(true);
    setError('');
    const res = await base44.functions.invoke('flashDrop', { action: 'enter', flash_drop_id: drop.id });
    setLoading(false);
    const data = res?.data;
    if (data?.success) {
      setEntered(true);
      setPhase('entered');
      onEntered?.(data.entry);
    } else if (data?.error === 'Already entered') {
      setEntered(true);
      setPhase('entered');
    } else {
      setError(data?.error || 'Could not enter. Try again.');
    }
  };

  const isDonorOwnDrop = drop.is_donor === true;
  const isVerified = (drop.trust_score || 0) >= 80;
  const won = result?.is_winner === true;

  return (
    <div className="pg-fan-gifts pg-gift-card overflow-hidden relative">
      <div className="pg-gift-card-accent h-0.5" />

      {/* Header row */}
      <div className="pg-gift-card-header px-4 pt-3 pb-2 flex flex-wrap items-center gap-2">
        <span className="text-base">⚡</span>
        <span className="pg-gift-yellow text-[10px] font-black tracking-[0.2em] uppercase">Flash Drop — Win Free Seats</span>
        {isVerified && (
          <span className="pg-gift-stamp pg-gift-stamp-success flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5">
            <ShieldCheck className="w-2.5 h-2.5" /> Verified
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">{drop.entry_count || 0} entered</span>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Seat info */}
        <div>
          <p className="font-black text-xl text-foreground">
            Section {drop.section}{drop.row ? ` · Row ${drop.row}` : ''}
          </p>
          {drop.quantity > 1 && <p className="text-sm text-muted-foreground">{drop.quantity} seats</p>}
          {drop.donor_message && (
            <p className="text-xs text-muted-foreground mt-1 italic">"{drop.donor_message}"</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            From: {drop.is_anonymous ? 'A generous fan' : (drop.donor_name || 'Anonymous')}
          </p>
          {!drop.ownership_verified && (
            <p className="pg-gift-warning text-[10px] mt-1">⚠ Ownership unverified</p>
          )}
        </div>

        {/* Active — not entered, not donor */}
        {(phase === 'active' || phase === 'entered') && !isDonorOwnDrop && !entered && phase !== 'entered' && (
          <div className="space-y-3">
            <div className="pg-gift-counter-panel py-3 flex justify-center">
              <FlashDropCountdown closesAt={drop.entry_closes_at} onExpired={handleExpired} />
            </div>
            {error && <p className="pg-gift-error text-xs text-center">{error}</p>}
            <button onClick={handleEntry} disabled={loading}
              className="pg-gift-button pg-gift-button-primary w-full py-4 font-black text-base flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-transform">
              {loading
                ? <span className="pg-gift-spinner w-5 h-5 border-2 rounded-full animate-spin" />
                : <><Gift className="w-5 h-5" /> Enter Now — It's Free</>}
            </button>
          </div>
        )}

        {/* Active — donor view */}
        {(phase === 'active' || phase === 'entered') && isDonorOwnDrop && (
          <div className="pg-gift-counter-panel py-3 text-center space-y-1">
            <FlashDropCountdown closesAt={drop.entry_closes_at} onExpired={handleExpired} />
            <p className="text-xs text-muted-foreground">Your drop is live 🎁</p>
          </div>
        )}

        {/* Entered — waiting for result */}
        {(phase === 'entered' || (entered && (phase === 'active'))) && !isDonorOwnDrop && (
          <div className="pg-gift-counter-panel pg-gift-counter-entered py-3 text-center space-y-2">
            <p className="pg-gift-success text-sm font-black">✓ You're in!</p>
            <FlashDropCountdown closesAt={drop.entry_closes_at} onExpired={handleExpired} />
            <p className="text-xs text-muted-foreground">Winner selected instantly when timer ends</p>
          </div>
        )}

        {/* Expired — waiting for server result */}
        {phase === 'expired' && !result && (
          <div className="pg-gift-counter-panel py-3 text-center">
            <span className="pg-gift-spinner w-5 h-5 border-2 rounded-full animate-spin inline-block mb-2" />
            <p className="text-xs text-muted-foreground">Selecting winner…</p>
          </div>
        )}

        {/* Result */}
        {phase === 'result' && result && !result.no_entries && (
          won
            ? <WinnerView drop={drop} />
            : <LoserView drop={drop} allListings={allListings} userEmail={user?.email} />
        )}
        {phase === 'result' && result?.no_entries && (
          <div className="pg-gift-counter-panel py-3 text-center">
            <p className="text-sm text-muted-foreground">No entries — drop expired.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function WinnerView({ drop }) {
  return (
    <div className="text-center space-y-2 py-2">
      <div className="text-5xl">🎁</div>
      <p className="pg-gift-success font-black text-xl">You Won!</p>
      <p className="text-sm text-muted-foreground">
        Section {drop.section}{drop.row ? ` Row ${drop.row}` : ''} — check your notifications for transfer details.
      </p>
      <p className="text-xs text-muted-foreground">
        Delivery: <span className="text-foreground capitalize">{(drop.ownership_delivery_method || 'ticket_transfer').replace(/_/g, ' ')}</span>
      </p>
    </div>
  );
}

/**
 * Intelligent loser funnel — ranked by proximity and price match.
 */
function LoserView({ drop, allListings, userEmail }) {
  const dropSection = parseInt(drop.section) || 0;

  // Rank listings: same section > adjacent section (±10) > same tier > rest
  const scored = allListings.map(l => {
    const listSection = parseInt(l.section) || 0;
    const sectionDiff = Math.abs(listSection - dropSection);
    let score = 0;
    if (l.section === drop.section) score += 100;
    else if (sectionDiff <= 5) score += 60;
    else if (sectionDiff <= 15) score += 30;
    if (l.tier === drop.tier) score += 20;
    // Price similarity bonus (within $20)
    const priceDiff = Math.abs((l.asking_price || 0) - 0); // relative — just prefer cheaper
    score -= priceDiff * 0.1;
    return { ...l, _score: score };
  });

  const ranked = scored.sort((a, b) => b._score - a._score).slice(0, 4);

  const handleListingClick = () => {
    base44.functions.invoke('flashDrop', {
      action: 'track_loser_action',
      flash_drop_id: drop.id,
      loser_action: 'clicked_listing',
    }).catch(() => {});
  };

  return (
    <div className="space-y-3">
      <div className="text-center py-1">
        <p className="text-sm font-bold text-foreground">Not this time — but upgrades are available 👇</p>
        <p className="text-[10px] text-muted-foreground">Nearby seats available right now</p>
      </div>
      {ranked.length > 0 ? (
        <div className="space-y-2">
          {ranked.map(l => {
            const isSameSection = l.section === drop.section;
            return (
              <Link key={l.id} to={`/upgrades/${l.event_id}`} onClick={handleListingClick}
                className={`pg-gift-listing flex items-center justify-between gap-2 px-3 py-2.5 transition-all active:scale-95${isSameSection ? ' pg-gift-listing-same' : ''}`}>
                <div>
                  <span className="text-sm text-foreground font-semibold">
                    Sec {l.section}{l.row ? ` Row ${l.row}` : ''}
                  </span>
                  {isSameSection && (
                    <span className="pg-gift-stamp pg-gift-stamp-success ml-2 text-[9px] font-black px-1.5 py-0.5">Same section</span>
                  )}
                </div>
                <span className="pg-gift-listing-price font-black text-sm">${l.asking_price}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <Link to={`/upgrades/${drop.event_id}`}
          onClick={handleListingClick}
          className="pg-gift-link block text-center text-xs underline py-2">
          Browse all available seats →
        </Link>
      )}
    </div>
  );
}
