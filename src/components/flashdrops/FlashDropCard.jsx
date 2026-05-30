import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Zap, Gift } from 'lucide-react';
import { Link } from 'react-router-dom';
import FlashDropCountdown from './FlashDropCountdown';

/**
 * A single active Flash Drop card with live countdown + entry button.
 * Props:
 *   drop: FlashDrop entity
 *   user: current user
 *   nearbyListings: Listing[] — shown to losers
 *   onEntered: (entry) => void
 *   onWinnerSelected: (drop, winner) => void
 */
export default function FlashDropCard({ drop, user, nearbyListings = [], onEntered, onWinnerSelected }) {
  const [phase, setPhase] = useState('active'); // active | entering | entered | expired | result
  const [entered, setEntered] = useState(false);
  const [result, setResult] = useState(null); // { won: bool, winner_name }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check if user already entered this drop
  useEffect(() => {
    if (!user?.email || !drop?.id) return;
    base44.entities.FlashDropEntry.filter({ flash_drop_id: drop.id, entrant_email: user.email })
      .then(rows => { if (rows.length > 0) setEntered(true); })
      .catch(() => {});
  }, [drop?.id, user?.email]);

  const handleEntry = async () => {
    if (!user) { base44.auth.redirectToLogin(); return; }
    setLoading(true);
    setError('');
    const res = await base44.functions.invoke('flashDrop', { action: 'enter', flash_drop_id: drop.id });
    setLoading(false);
    if (res?.data?.success) {
      setEntered(true);
      setPhase('entered');
      onEntered?.(res.data.entry);
    } else if (res?.data?.error === 'Already entered') {
      setEntered(true);
      setPhase('entered');
    } else {
      setError(res?.data?.error || 'Could not enter. Try again.');
    }
  };

  const handleExpired = async () => {
    setPhase('expired');
    // Auto-pick winner
    const res = await base44.functions.invoke('flashDrop', { action: 'close_and_pick', flash_drop_id: drop.id });
    const data = res?.data;
    if (data?.success) {
      const won = data.winner?.email === user?.email;
      setResult({ won, winner_name: data.winner?.name, no_entries: data.no_entries });
      setPhase('result');
      onWinnerSelected?.(drop, data.winner);
      // Track loser metric
      if (!won && data.winner) {
        base44.functions.invoke('flashDrop', { action: 'track_loser_action', flash_drop_id: drop.id, loser_action: 'none' }).catch(() => {});
      }
    }
  };

  const isActive = drop.status === 'active' && phase !== 'result';
  const isDonorOwnDrop = drop.donor_email === user?.email;

  return (
    <div className="rounded-2xl overflow-hidden relative"
      style={{
        background: 'linear-gradient(135deg, rgba(191,95,255,0.08) 0%, rgba(255,45,120,0.06) 100%)',
        border: '1px solid rgba(191,95,255,0.35)',
        boxShadow: '0 0 30px rgba(191,95,255,0.12)',
      }}>

      {/* Top accent */}
      <div className="h-0.5" style={{ background: 'linear-gradient(90deg, #BF5FFF, #FF2D78, #FFE600)' }} />

      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <span className="text-base">⚡</span>
        <span className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color: '#FFE600' }}>Flash Drop</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{drop.entry_count || 0} entered</span>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Seat info */}
        <div>
          <p className="font-black text-xl text-foreground">
            Section {drop.section}{drop.row ? ` · Row ${drop.row}` : ''}
          </p>
          {drop.quantity > 1 && (
            <p className="text-sm text-muted-foreground">{drop.quantity} seats</p>
          )}
          {drop.donor_message && (
            <p className="text-xs text-muted-foreground mt-1 italic">"{drop.donor_message}"</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            From: {drop.is_anonymous ? 'A generous fan' : (drop.donor_name || 'Anonymous')}
          </p>
        </div>

        {/* Phase: Active — countdown + entry */}
        {phase === 'active' && !isDonorOwnDrop && !entered && (
          <div className="space-y-3">
            <div className="rounded-xl py-3 flex justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
              <FlashDropCountdown closesAt={drop.entry_closes_at} onExpired={handleExpired} />
            </div>
            {error && <p className="text-xs text-center" style={{ color: '#FF2D78' }}>{error}</p>}
            <button
              onClick={handleEntry}
              disabled={loading}
              className="w-full py-4 rounded-2xl font-black text-base flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-transform"
              style={{
                background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
                color: '#fff',
                boxShadow: '0 0 24px rgba(191,95,255,0.5)',
              }}>
              {loading
                ? <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <><Gift className="w-5 h-5" /> Enter Now — It's Free</>}
            </button>
          </div>
        )}

        {/* Phase: Active — donor view */}
        {phase === 'active' && isDonorOwnDrop && (
          <div className="rounded-xl py-3 text-center space-y-1" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <FlashDropCountdown closesAt={drop.entry_closes_at} onExpired={handleExpired} />
            <p className="text-xs text-muted-foreground">Your drop is live 🎁</p>
          </div>
        )}

        {/* Phase: Already entered */}
        {(phase === 'entered' || (entered && phase === 'active')) && !isDonorOwnDrop && (
          <div className="rounded-xl py-3 text-center space-y-2" style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
            <p className="text-sm font-black" style={{ color: '#00FF87' }}>✓ You're in!</p>
            <FlashDropCountdown closesAt={drop.entry_closes_at} onExpired={handleExpired} />
            <p className="text-xs text-muted-foreground">Winner selected instantly when timer ends</p>
          </div>
        )}

        {/* Phase: Result */}
        {phase === 'result' && result && (
          <div>
            {result.won ? (
              <WinnerView drop={drop} />
            ) : (
              <LoserView drop={drop} nearbyListings={nearbyListings} />
            )}
          </div>
        )}

        {/* Phase: Expired with no entries */}
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
    </div>
  );
}

function LoserView({ drop, nearbyListings }) {
  const similar = nearbyListings.slice(0, 3);

  const handleListingClick = () => {
    base44.functions.invoke('flashDrop', {
      action: 'track_loser_action',
      flash_drop_id: drop.id,
      loser_action: 'clicked_listing',
    }).catch(() => {});
  };

  return (
    <div className="space-y-3">
      <div className="text-center py-2">
        <p className="text-sm font-bold text-foreground">Not this time — but check these out 👇</p>
        <p className="text-xs text-muted-foreground">Similar seats available right now</p>
      </div>
      {similar.length > 0 ? (
        <div className="space-y-2">
          {similar.map(l => (
            <Link
              key={l.id}
              to={`/events/${l.event_id}`}
              onClick={handleListingClick}
              className="flex items-center justify-between px-3 py-2.5 rounded-xl transition-all active:scale-95"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <span className="text-sm text-foreground font-semibold">
                Sec {l.section}{l.row ? ` Row ${l.row}` : ''}
              </span>
              <span className="font-black text-sm" style={{ color: '#00FF87' }}>${l.asking_price}</span>
            </Link>
          ))}
        </div>
      ) : (
        <Link to="/events" className="block text-center text-xs text-primary underline">Browse all available seats</Link>
      )}
    </div>
  );
}