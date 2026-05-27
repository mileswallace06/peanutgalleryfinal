/**
 * DonationWinNotification — full-screen celebration shown to donation winners.
 * Polls for active drawn donations where the current user is the winner.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function DonationWinNotification({ userEmail }) {
  const [donation, setDonation] = useState(null);
  const [responding, setResponding] = useState(false);
  const [accepted, setAccepted] = useState(null);
  const [countdown, setCountdown] = useState(120); // 2 min to respond

  // Poll for pending donations where user is winner
  useEffect(() => {
    if (!userEmail) return;
    const check = async () => {
      const donations = await base44.entities.SeatDonation.filter({
        winner_email: userEmail,
        donation_status: 'drawn',
      }).catch(() => []);
      if (donations.length > 0) setDonation(donations[0]);
    };
    check();
    const interval = setInterval(check, 15000); // check every 15s
    return () => clearInterval(interval);
  }, [userEmail]);

  // Countdown timer
  useEffect(() => {
    if (!donation) return;
    setCountdown(120);
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(t);
          handleRespond(false); // auto-decline on timeout
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [donation?.id]);

  const handleRespond = async (accept) => {
    if (!donation || responding) return;
    setResponding(true);
    try {
      await base44.functions.invoke('seatDonation', {
        action: 'respond',
        donation_id: donation.id,
        accepted: accept,
      });
      setAccepted(accept);
      if (!accept) {
        setTimeout(() => setDonation(null), 3000);
      }
    } catch {
      // Any failure — clear overlay so user is never trapped
      setDonation(null);
    } finally {
      setResponding(false);
    }
  };

  if (!donation) return null;

  const donorName = donation.is_anonymous ? 'A fan' : (donation.donor_name || 'A fan');
  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const urgentColor = countdown < 30 ? '#FF2D78' : countdown < 60 ? '#FF8C00' : '#00FF87';

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex flex-col items-center justify-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />

        {/* Stars / confetti visual */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute text-2xl"
              initial={{ opacity: 0, scale: 0, y: '100%', x: `${8 + i * 8}%` }}
              animate={{ opacity: [0, 1, 0], scale: [0, 1, 0.5], y: ['100%', `${10 + (i % 5) * 15}%`] }}
              transition={{ delay: i * 0.08, duration: 2, repeat: Infinity, repeatDelay: 3 }}
            >
              {['🥜', '✨', '🎉', '⭐'][i % 4]}
            </motion.div>
          ))}
        </div>

        <motion.div
          className="relative w-full max-w-lg rounded-t-3xl p-6 text-center"
          style={{
            background: 'linear-gradient(180deg, rgba(191,95,255,0.15) 0%, hsl(var(--card)) 30%)',
            border: '1px solid rgba(191,95,255,0.4)',
            paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))',
          }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        >
          {accepted === true ? (
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <div className="text-6xl mb-3">🎉</div>
              <h2 className="font-display text-3xl mb-2" style={{ color: '#BF5FFF' }}>Enjoy Your Upgrade!</h2>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                <span className="font-bold text-foreground">{donorName}</span> upgraded your night.
                {donation.donor_message && (
                  <><br /><br /><em className="text-foreground">"{donation.donor_message}"</em></>
                )}
              </p>
              <div className="rounded-2xl px-4 py-3 mb-4 text-left"
                style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.3)' }}>
                <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-1">Your new seats</p>
                <p className="font-display text-xl text-foreground">
                  Section {donation.section}{donation.row ? ` · Row ${donation.row}` : ''}
                </p>
                {donation.seats && <p className="text-sm text-muted-foreground mt-0.5">Seats: {donation.seats}</p>}
              </div>
              <p className="text-xs text-muted-foreground">+10 🥜 Peanut Points added to your balance</p>
            </motion.div>
          ) : accepted === false ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="text-5xl mb-3">😊</div>
              <h2 className="font-display text-2xl mb-1">No worries!</h2>
              <p className="text-sm text-muted-foreground">Another fan will get the seats.</p>
            </motion.div>
          ) : (
            <>
              {/* Countdown */}
              <div className="flex items-center justify-center gap-2 mb-4">
                <Zap className="w-4 h-4" style={{ color: urgentColor }} />
                <span className="font-black text-sm tabular-nums" style={{ color: urgentColor }}>
                  {mins}:{String(secs).padStart(2, '0')} to respond
                </span>
              </div>

              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="text-6xl mb-4"
              >
                🎉
              </motion.div>

              <h2 className="font-display text-3xl text-foreground mb-2">You've Been Selected!</h2>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                <span className="font-bold text-foreground">{donorName}</span> is upgrading your night at{' '}
                <span className="font-bold text-foreground">{donation.event_title}</span>.
              </p>

              {/* Seat preview */}
              <div className="rounded-2xl px-4 py-3 mb-4 text-left"
                style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.3)' }}>
                <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-1">Donated seats</p>
                <p className="font-display text-xl text-foreground">
                  Section {donation.section}{donation.row ? ` · Row ${donation.row}` : ''}
                </p>
                {donation.seats && <p className="text-sm text-muted-foreground mt-0.5">Seats: {donation.seats}</p>}
                {donation.donor_message && (
                  <p className="text-xs text-muted-foreground mt-2 italic">"{donation.donor_message}"</p>
                )}
              </div>

              {/* Progress bar */}
              <div className="h-1.5 rounded-full overflow-hidden mb-5" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${urgentColor}80, ${urgentColor})` }}
                  animate={{ width: `${(countdown / 120) * 100}%` }}
                  transition={{ duration: 1 }}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleRespond(false)}
                  disabled={responding}
                  className="flex-1 py-3.5 rounded-full font-black text-sm"
                  style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
                  Decline
                </button>
                <button
                  onClick={() => handleRespond(true)}
                  disabled={responding}
                  className="flex-[2] py-3.5 rounded-full font-black text-sm flex items-center justify-center gap-2"
                  style={{
                    background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
                    color: '#fff',
                    boxShadow: '0 0 24px rgba(191,95,255,0.4)',
                  }}>
                  {responding
                    ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    : '🎉 Accept Upgrade!'}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}