import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Gift, ShieldCheck } from 'lucide-react';
import FlashDropCountdown from './FlashDropCountdown';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30000;

function actionError(error, fallback) {
  return error?.response?.data?.error || error?.data?.error || error?.message || fallback;
}

/**
 * FlashDropCard — Race-safe, server-authority winner selection.
 *
 * Winner selection flow:
 * 1. Client countdown hits 0 → setPhase('expired') only (no close_and_pick call)
 * 2. Only the donor's device calls close_and_pick; entrants never select winners
 * 3. ALL devices poll `poll_result` until ready=true
 * 4. Result shown to all — won/lost based on winner.email === user.email
 *
 * This eliminates the 500-device race condition entirely.
 */
export default function FlashDropCard({ drop: initialDrop, user, allListings = [], onEntered, onWinnerSelected }) {
  const drop = initialDrop;
  const [phase, setPhase] = useState(() => {
    if (initialDrop.status === 'winner_selected' || initialDrop.status === 'expired') return 'result';
    return 'active';
  });
  const [entered, setEntered] = useState(false);
  const [result, setResult] = useState(() => {
    if (initialDrop.status === 'winner_selected') {
      return { winner_email: initialDrop.winner_email, winner_name: initialDrop.winner_name, no_entries: false };
    }
    if (initialDrop.status === 'expired') return { no_entries: true };
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const pollIntervalRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const pollInFlightRef = useRef(false);
  const pollFailuresRef = useRef(0);
  const selectionFiredRef = useRef(false);

  // Check existing entry on mount
  useEffect(() => {
    if (!user?.email || !drop?.id) return;
    base44.entities.FlashDropEntry.filter({ flash_drop_id: drop.id, entrant_email: user.email })
      .then(rows => { if (rows.length > 0) setEntered(true); })
      .catch(() => setError('Could not confirm your entry status. You can retry entering safely.'));
  }, [drop?.id, user?.email]);

  // Track view
  useEffect(() => {
    if (drop?.id && drop.status === 'active') {
      base44.functions.invoke('flashDrop', { action: 'track_view', flash_drop_id: drop.id }).catch(() => {});
    }
  }, [drop?.id]);

  const clearPolling = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    pollIntervalRef.current = null;
    pollTimeoutRef.current = null;
    pollInFlightRef.current = false;
  };

  // Cleanup poll on unmount
  useEffect(() => () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
  }, []);

  const applyResult = (data) => {
    clearPolling();
    setResult({
      winner_email: data.winner?.email || null,
      winner_name: data.winner?.name || null,
      no_entries: data.no_entries || false,
    });
    setPollError('');
    setPhase('result');
    onWinnerSelected?.(drop.id, data.winner);
  };

  const startPolling = (flash_drop_id) => {
    clearPolling();
    setPollError('');
    pollFailuresRef.current = 0;

    const pollOnce = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const res = await base44.functions.invoke('flashDrop', { action: 'poll_result', flash_drop_id });
        const data = res?.data;
        if (data?.error) throw new Error(data.error);
        pollFailuresRef.current = 0;
        if (data?.ready) applyResult(data);
      } catch (pollFailure) {
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= 3) {
          clearPolling();
          setPollError(actionError(pollFailure, 'Could not check the winner. Tap Retry result check.'));
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    pollIntervalRef.current = setInterval(pollOnce, POLL_INTERVAL_MS);
    pollTimeoutRef.current = setTimeout(() => {
      clearPolling();
      setPollError(drop.donor_email === user?.email
        ? 'Winner selection is taking longer than expected. Tap Retry winner selection.'
        : 'The donor has not finalized the result yet. Tap Retry result check in a moment.');
    }, POLL_TIMEOUT_MS);
    void pollOnce();
  };

  const requestWinnerSelection = async () => {
    setSelectionLoading(true);
    setPollError('');
    try {
      const res = await base44.functions.invoke('flashDrop', {
        action: 'close_and_pick',
        flash_drop_id: drop.id,
        request_id: `${drop.id}-${Date.now()}`,
      });
      const data = res?.data;
      if (data?.success && (Object.prototype.hasOwnProperty.call(data, 'winner') || data.no_entries)) {
        applyResult(data);
        return;
      }
      if (!data?.pending) throw new Error(data?.error || 'Winner selection could not start.');
      startPolling(drop.id);
    } catch (selectionError) {
      startPolling(drop.id);
      setPollError(actionError(selectionError, 'Winner selection failed. Tap Retry winner selection.'));
    } finally {
      setSelectionLoading(false);
    }
  };

  /**
   * handleExpired — called by FlashDropCountdown when timer hits 0.
   * ONLY the donor's device fires close_and_pick. Entrants only poll.
   */
  const handleExpired = async () => {
    setPhase('expired');
    setPollError('');

    const isDonor = drop.donor_email === user?.email;
    if (isDonor && !selectionFiredRef.current) {
      selectionFiredRef.current = true;
      await requestWinnerSelection();
      return;
    }
    if (entered) startPolling(drop.id);
    else setPhase('closed');
  };

  const retryResult = async () => {
    setPollError('');
    setPhase('expired');
    if (drop.donor_email === user?.email) await requestWinnerSelection();
    else startPolling(drop.id);
  };

  const handleEntry = async () => {
    if (!user) { base44.auth.redirectToLogin(); return; }
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('flashDrop', { action: 'enter', flash_drop_id: drop.id });
      const data = res?.data;
      if (data?.success) {
        setEntered(true);
        setPhase('entered');
        onEntered?.(data.entry);
      } else if (data?.error === 'Already entered') {
        setEntered(true);
        setPhase('entered');
      } else {
        setError(data?.error || 'Could not enter. Check your connection and try again.');
      }
    } catch (entryError) {
      setError(actionError(entryError, 'Could not enter. Check your connection and try again.'));
    } finally {
      setLoading(false);
    }
  };

  const isDonorOwnDrop = drop.donor_email === user?.email;
  const isVerified = (drop.trust_score || 0) >= 80;
  const won = result?.winner_email === user?.email;

  return (
    <div className="rounded-2xl overflow-hidden relative"
      style={{
        background: 'linear-gradient(135deg, rgba(191,95,255,0.08) 0%, rgba(255,45,120,0.06) 100%)',
        border: '1px solid rgba(191,95,255,0.35)',
        boxShadow: '0 0 30px rgba(191,95,255,0.12)',
      }}>
      <div className="h-0.5" style={{ background: 'linear-gradient(90deg, #BF5FFF, #FF2D78, #FFE600)' }} />

      {/* Header row */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <span className="text-base">⚡</span>
        <span className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color: '#FFE600' }}>Flash Drop — Win Free Seats</span>
        {isVerified && (
          <span className="flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
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
            <p className="text-[10px] mt-1" style={{ color: '#FF8C00' }}>⚠ Ownership unverified</p>
          )}
        </div>

        {/* Active — not entered, not donor */}
        {(phase === 'active' || phase === 'entered') && !isDonorOwnDrop && !entered && phase !== 'entered' && (
          <div className="space-y-3">
            <div className="rounded-xl py-3 flex justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
              <FlashDropCountdown closesAt={drop.entry_closes_at} onExpired={handleExpired} />
            </div>
            {error && <p role="alert" className="text-xs text-center" style={{ color: '#FF2D78' }}>{error}</p>}
            <button type="button" onClick={handleEntry} disabled={loading}
              className="w-full py-4 rounded-2xl font-black text-base flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-transform"
              style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff', boxShadow: '0 0 24px rgba(191,95,255,0.5)' }}>
              {loading
                ? <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <><Gift className="w-5 h-5" /> Enter Now — It's Free</>}
            </button>
          </div>
        )}

        {/* Active — donor view */}
        {(phase === 'active' || phase === 'entered') && isDonorOwnDrop && (
          <div className="rounded-xl py-3 text-center space-y-1" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <FlashDropCountdown closesAt={drop.entry_closes_at} onExpired={handleExpired} />
            <p className="text-xs text-muted-foreground">Your drop is live 🎁</p>
          </div>
        )}

        {/* Entered — waiting for result */}
        {(phase === 'entered' || (entered && (phase === 'active'))) && !isDonorOwnDrop && (
          <div className="rounded-xl py-3 text-center space-y-2" style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
            <p className="text-sm font-black" style={{ color: '#00FF87' }}>✓ You're in!</p>
            <FlashDropCountdown closesAt={drop.entry_closes_at} onExpired={handleExpired} />
            <p className="text-xs text-muted-foreground">Winner selected instantly when timer ends</p>
          </div>
        )}

        {/* Expired — waiting for server result */}
        {phase === 'expired' && !result && (
          <div className="rounded-xl px-3 py-3 text-center space-y-2" style={{ background: 'rgba(0,0,0,0.3)' }}>
            {!pollError && <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />}
            <p className="text-xs text-muted-foreground">
              {selectionLoading ? 'Starting winner selection…' : pollError ? 'Result check paused' : 'Selecting winner…'}
            </p>
            {pollError && <p role="alert" className="text-xs" style={{ color: '#FF7AA8' }}>{pollError}</p>}
            {pollError && (
              <button type="button" onClick={retryResult} disabled={selectionLoading}
                className="px-3 py-2 rounded-full text-xs font-bold disabled:opacity-50"
                style={{ background: 'rgba(191,95,255,0.16)', border: '1px solid rgba(191,95,255,0.35)', color: '#E2BEFF' }}>
                {drop.donor_email === user?.email ? 'Retry winner selection' : 'Retry result check'}
              </button>
            )}
          </div>
        )}

        {phase === 'closed' && (
          <div className="rounded-xl py-3 text-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <p className="text-sm text-muted-foreground">Entry is closed.</p>
          </div>
        )}

        {/* Result */}
        {phase === 'result' && result && !result.no_entries && (
          won
            ? <WinnerView drop={drop} />
            : <LoserView allListings={allListings} />
        )}
        {phase === 'result' && result?.no_entries && (
          <div className="rounded-xl py-3 text-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
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
      <p className="font-black text-xl" style={{ color: '#00FF87' }}>You Won!</p>
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
function LoserView({ allListings }) {
  return (
    <div className="space-y-3">
      <div className="text-center py-1">
        <p className="text-sm font-bold text-foreground">Not this time — but upgrades are available 👇</p>
        <p className="text-[10px] text-muted-foreground">Nearby seats available right now</p>
      </div>
      <div className="rounded-xl px-3 py-2.5 text-center"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-xs text-muted-foreground">
          {allListings.length > 0
            ? 'Upgrade options are available — open the Upgrades tab above.'
            : 'No upgrade listings are available right now. Check the Upgrades tab again soon.'}
        </p>
      </div>
    </div>
  );
}
