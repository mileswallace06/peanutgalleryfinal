/**
 * DonateSeatSheet — bottom sheet triggered after upgrade or from My Tickets.
 * Allows a fan to donate their old seats to the community donation pool.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Heart, Zap, ChevronRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function DonateSeatSheet({ event, purchase, onClose, onDonated }) {
  const [step, setStep] = useState('confirm'); // confirm → details → done
  const [section, setSection] = useState(purchase?.listing_section || '');
  const [row, setRow] = useState(purchase?.listing_row || '');
  const [seats, setSeats] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDonate = async () => {
    if (!section) return;
    setLoading(true);
    const res = await base44.functions.invoke('seatDonation', {
      action: 'create_donation',
      event_id: event?.id,
      section,
      row,
      seats,
      quantity: purchase?.quantity || 1,
      is_anonymous: isAnonymous,
      donor_message: message || null,
      source_purchase_id: purchase?.id || null,
    });
    setLoading(false);
    if (res?.data?.success) {
      setStep('done');
      onDonated?.();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex flex-col justify-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

        <motion.div
          className="relative rounded-t-3xl overflow-hidden"
          style={{
            background: 'hsl(var(--card))',
            border: '1px solid rgba(255,255,255,0.1)',
            paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
          }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>

          <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full"
            style={{ background: 'hsl(var(--muted))' }}>
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="px-6 pt-2 pb-6">
            {step === 'confirm' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="text-4xl text-center mb-3">🥜</div>
                <h2 className="font-display text-2xl text-foreground text-center mb-2">
                  Pass Them Forward
                </h2>
                <p className="text-sm text-muted-foreground text-center mb-6 leading-relaxed">
                  You upgraded — now make another fan's night. Donate your old seats to someone at{' '}
                  <span className="font-bold text-foreground">{event?.title || 'the event'}</span>.
                </p>

                <div className="space-y-3 mb-6">
                  {[
                    { icon: '🎲', text: 'A fan is selected by weighted draw — active fans get better odds' },
                    { icon: '✨', text: 'They receive your seats instantly with a surprise notification' },
                    { icon: '🏆', text: 'You earn +150 Peanut Points and community reputation' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-2xl"
                      style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.15)' }}>
                      <span className="text-lg flex-shrink-0">{item.icon}</span>
                      <p className="text-sm text-muted-foreground leading-snug">{item.text}</p>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setStep('details')}
                  className="w-full py-4 rounded-full font-black text-sm flex items-center justify-center gap-2"
                  style={{
                    background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
                    color: '#fff',
                    boxShadow: '0 0 24px rgba(191,95,255,0.3)',
                  }}>
                  <Heart className="w-4 h-4" /> Donate My Seats
                </button>

                <button onClick={onClose}
                  className="w-full py-3 mt-2 text-sm text-muted-foreground font-semibold">
                  Maybe later
                </button>
              </motion.div>
            )}

            {step === 'details' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <h2 className="font-display text-2xl text-foreground mb-1">Seat Details</h2>
                <p className="text-sm text-muted-foreground mb-5">Which seats are you leaving behind?</p>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-1.5 block">Section *</label>
                    <input
                      value={section}
                      onChange={e => setSection(e.target.value)}
                      placeholder="e.g. 118"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-1.5 block">Row</label>
                    <input
                      value={row}
                      onChange={e => setRow(e.target.value)}
                      placeholder="e.g. G"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-1.5 block">Seat Numbers (optional)</label>
                  <input
                    value={seats}
                    onChange={e => setSeats(e.target.value)}
                    placeholder="e.g. 12, 13"
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary"
                  />
                </div>

                <div className="mb-4">
                  <label className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-1.5 block">Message to recipient (optional)</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="e.g. Enjoy the show! Great view from here 🎶"
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary resize-none"
                  />
                </div>

                <label className="flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer mb-5"
                  style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      background: isAnonymous ? '#BF5FFF' : 'transparent',
                      border: `2px solid ${isAnonymous ? '#BF5FFF' : 'hsl(var(--border))'}`,
                    }}
                    onClick={() => setIsAnonymous(v => !v)}>
                    {isAnonymous && <span className="text-white text-[10px] font-black">✓</span>}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Donate anonymously</p>
                    <p className="text-[10px] text-muted-foreground">Recipient sees "A fan upgraded your night"</p>
                  </div>
                </label>

                <button
                  onClick={handleDonate}
                  disabled={loading || !section}
                  className="w-full py-4 rounded-full font-black text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{
                    background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
                    color: '#fff',
                    boxShadow: section ? '0 0 24px rgba(191,95,255,0.3)' : 'none',
                  }}>
                  {loading
                    ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    : <><Heart className="w-4 h-4" /> Confirm Donation</>
                  }
                </button>
              </motion.div>
            )}

            {step === 'done' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-4"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: [0, 1.3, 1] }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="text-6xl mb-4"
                >
                  🥜
                </motion.div>
                <h2 className="font-display text-3xl mb-2" style={{ color: '#BF5FFF' }}>You're a Fan Hero</h2>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  Your seats are in the pool. A lucky fan will be selected and notified. You've earned{' '}
                  <span className="font-black text-foreground">+150 Peanut Points</span> for your generosity.
                </p>
                <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full mx-auto w-fit mb-6"
                  style={{ background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.3)' }}>
                  <Zap className="w-3.5 h-3.5" style={{ color: '#BF5FFF' }} />
                  <span className="text-xs font-black" style={{ color: '#BF5FFF' }}>+150 pts · Fan Hero progress</span>
                </div>
                <button onClick={onClose}
                  className="w-full py-3.5 rounded-full font-black text-sm"
                  style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))' }}>
                  Done
                </button>
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}