/**
 * DonationOptInBanner — shown to fans at live events.
 * One-tap opt-in to become eligible for seat donation draws.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, MapPin, CheckCircle, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function DonationOptInBanner({ event, purchase, userLat, userLng, onOptedIn }) {
  const [status, setStatus] = useState('idle'); // idle | loading | opted_in | ineligible | dismissed
  const [reason, setReason] = useState('');

  // Check if current user is already opted in — must filter by BOTH event_id AND user email
  useEffect(() => {
    if (!event?.id) return;
    base44.auth.me().then(me => {
      if (!me?.email) return;
      base44.entities.DonationOptIn.filter({ event_id: event.id, user_email: me.email })
        .then(rows => {
          if (rows.length > 0) setStatus('opted_in');
        })
        .catch(() => {});
    }).catch(() => {});
  }, [event?.id]);

  const handleOptIn = async () => {
    setStatus('loading');
    const res = await base44.functions.invoke('seatDonation', {
      action: 'opt_in',
      event_id: event.id,
      purchase_id: purchase?.id,
      user_lat: userLat || null,
      user_lng: userLng || null,
    });

    const data = res?.data;
    if (data?.eligible === false) {
      setStatus('ineligible');
      setReason(data.message || 'Not eligible');
    } else if (data?.success) {
      setStatus('opted_in');
      onOptedIn?.();
    } else {
      setStatus('ineligible');
      setReason('Something went wrong. Try again.');
    }
  };

  if (status === 'dismissed') return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="rounded-2xl overflow-hidden mb-4"
        style={{
          background: status === 'opted_in'
            ? 'rgba(0,255,135,0.06)'
            : 'rgba(191,95,255,0.08)',
          border: status === 'opted_in'
            ? '1px solid rgba(0,255,135,0.25)'
            : '1px solid rgba(191,95,255,0.3)',
        }}
      >
        <div className="px-4 py-4">
          {status === 'opted_in' ? (
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: '#00FF87' }} />
              <div className="flex-1">
                <p className="text-sm font-black text-foreground">You're in the donation pool! 🎉</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">If a fan donates seats, you could be selected.</p>
              </div>
            </div>
          ) : status === 'ineligible' ? (
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#FF8C00' }} />
              <p className="text-sm text-muted-foreground leading-snug">{reason}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-black text-foreground">🎉 Opt Into Seat Donations</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Get eligible for surprise seat upgrades from fans at this event.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleOptIn}
                  disabled={status === 'loading'}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full font-black text-xs disabled:opacity-60"
                  style={{
                    background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
                    color: '#fff',
                  }}>
                  {status === 'loading'
                    ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    : <><Heart className="w-3.5 h-3.5" /> Opt In</>
                  }
                </button>
                <button onClick={() => setStatus('dismissed')}
                  className="p-1.5 rounded-full text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}