import { useState } from 'react';
import { X, Zap, Gift, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';

const SCHEDULE_OPTIONS = [
  { label: 'Halftime', value: 'halftime' },
  { label: 'End of 1st Quarter', value: 'q1_end' },
  { label: 'End of 3rd Quarter', value: 'q3_end' },
  { label: '2nd Period', value: 'period_2' },
  { label: '3rd Period', value: 'period_3' },
  { label: '3rd Inning', value: 'inning_3' },
  { label: '7th Inning', value: 'inning_7' },
  { label: 'Opening Act End', value: 'opening_act_end' },
  { label: 'After 1st Song', value: 'song_1' },
  { label: 'Mid-show Break', value: 'midshow' },
];

const WINDOW_OPTIONS = [
  { label: '30 seconds', value: 30 },
  { label: '45 seconds', value: 45 },
  { label: '60 seconds', value: 60 },
  { label: '90 seconds', value: 90 },
];

export default function CreateFlashDropSheet({ event, user, onClose, onCreated }) {
  const [step, setStep] = useState('type'); // type | details | schedule | done
  const [dropType, setDropType] = useState('immediate');
  const [section, setSection] = useState('');
  const [row, setRow] = useState('');
  const [seats, setSeats] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [scheduledLabel, setScheduledLabel] = useState('');
  const [windowSecs, setWindowSecs] = useState(60);
  const [loading, setLoading] = useState(false);
  const [createdDrop, setCreatedDrop] = useState(null);

  const handleCreate = async () => {
    if (!section) return;
    setLoading(true);
    const res = await base44.functions.invoke('flashDrop', {
      action: 'create',
      event_id: event.id,
      section,
      row: row || null,
      seats: seats || null,
      quantity,
      is_anonymous: isAnonymous,
      donor_message: message || null,
      drop_type: dropType,
      scheduled_label: scheduledLabel || null,
      entry_window_seconds: windowSecs,
    });
    setLoading(false);
    if (res?.data?.success) {
      setCreatedDrop(res.data.drop);
      setStep('done');
      onCreated?.(res.data.drop);
    }
  };

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-50 flex flex-col justify-end"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          className="relative rounded-t-3xl overflow-hidden"
          style={{ background: 'hsl(var(--card))', border: '1px solid rgba(255,255,255,0.1)', paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}>

          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
          <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full" style={{ background: 'hsl(var(--muted))' }}>
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="px-5 pt-1 pb-4">
            {/* Top accent */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">⚡</span>
              <div>
                <h2 className="font-black text-lg text-foreground leading-none">Create Flash Drop</h2>
                <p className="text-xs text-muted-foreground">{event?.title}</p>
              </div>
            </div>

            {/* Step: Type */}
            {step === 'type' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <p className="text-sm text-muted-foreground">How do you want to drop these seats?</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => { setDropType('immediate'); setStep('details'); }}
                    className="rounded-2xl p-4 text-left space-y-2 transition-all active:scale-95"
                    style={{ background: 'rgba(255,230,0,0.08)', border: '1px solid rgba(255,230,0,0.3)' }}>
                    <span className="text-2xl">⚡</span>
                    <p className="font-black text-sm text-foreground">Immediate Drop</p>
                    <p className="text-xs text-muted-foreground">Seats go live right now. Entry window opens instantly.</p>
                  </button>
                  <button onClick={() => { setDropType('scheduled'); setStep('details'); }}
                    className="rounded-2xl p-4 text-left space-y-2 transition-all active:scale-95"
                    style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.3)' }}>
                    <span className="text-2xl">⏰</span>
                    <p className="font-black text-sm text-foreground">Scheduled Drop</p>
                    <p className="text-xs text-muted-foreground">Drop at halftime, a quarter, or a specific moment.</p>
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step: Details */}
            {step === 'details' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Seat Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Section *</label>
                    <input value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. 118"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Row</label>
                    <input value={row} onChange={e => setRow(e.target.value)} placeholder="e.g. G"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Seats</label>
                    <input value={seats} onChange={e => setSeats(e.target.value)} placeholder="e.g. 12, 13"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Quantity</label>
                    <input type="number" min="1" max="10" value={quantity} onChange={e => setQuantity(+e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Message (optional)</label>
                  <input value={message} onChange={e => setMessage(e.target.value)} placeholder="Enjoy the show! 🎶"
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary" />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Entry Window</label>
                  <div className="flex gap-2">
                    {WINDOW_OPTIONS.map(o => (
                      <button key={o.value} onClick={() => setWindowSecs(o.value)}
                        className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                        style={windowSecs === o.value
                          ? { background: 'rgba(255,230,0,0.15)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.4)' }
                          : { background: 'rgba(255,255,255,0.05)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.1)' }}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer"
                  style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                  <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: isAnonymous ? '#BF5FFF' : 'transparent', border: `2px solid ${isAnonymous ? '#BF5FFF' : 'hsl(var(--border))'}` }}
                    onClick={() => setIsAnonymous(v => !v)}>
                    {isAnonymous && <span className="text-white text-[10px] font-black">✓</span>}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Drop anonymously</p>
                    <p className="text-[10px] text-muted-foreground">Shown as "A generous fan"</p>
                  </div>
                </label>

                <div className="flex gap-3 pt-1">
                  <button onClick={() => setStep('type')} className="flex-1 py-3 rounded-2xl text-sm font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>Back</button>
                  {dropType === 'scheduled' ? (
                    <button onClick={() => setStep('schedule')} disabled={!section}
                      className="flex-1 py-3 rounded-2xl text-sm font-black disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff' }}>
                      Next: Schedule
                    </button>
                  ) : (
                    <button onClick={handleCreate} disabled={!section || loading}
                      className="flex-1 py-3 rounded-2xl text-sm font-black disabled:opacity-40 flex items-center justify-center gap-2"
                      style={{ background: 'linear-gradient(135deg, #FFE600, #FF8C00)', color: '#000' }}>
                      {loading ? <span className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" /> : <><Zap className="w-4 h-4" /> Drop Now</>}
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {/* Step: Schedule */}
            {step === 'schedule' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <p className="text-sm text-muted-foreground">When should this Flash Drop go live?</p>
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                  {SCHEDULE_OPTIONS.map(o => (
                    <button key={o.value} onClick={() => setScheduledLabel(o.label)}
                      className="px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition-all"
                      style={scheduledLabel === o.label
                        ? { background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.4)' }
                        : { background: 'rgba(255,255,255,0.04)', color: 'hsl(var(--foreground))', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <Clock className="w-3 h-3 inline mr-1.5 opacity-60" />{o.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">You'll manually activate this drop when the moment arrives from your My Tickets page.</p>
                <div className="flex gap-3">
                  <button onClick={() => setStep('details')} className="flex-1 py-3 rounded-2xl text-sm font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>Back</button>
                  <button onClick={handleCreate} disabled={!scheduledLabel || loading}
                    className="flex-1 py-3 rounded-2xl text-sm font-black disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff' }}>
                    {loading ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <><Clock className="w-4 h-4" /> Schedule Drop</>}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step: Done */}
            {step === 'done' && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-4 space-y-3">
                <div className="text-5xl">{dropType === 'immediate' ? '⚡' : '⏰'}</div>
                <h3 className="font-black text-xl text-foreground">
                  {dropType === 'immediate' ? 'Flash Drop is Live!' : 'Drop Scheduled!'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {dropType === 'immediate'
                    ? `Fans have ${windowSecs} seconds to enter. Winner selected instantly.`
                    : `Your drop is queued for ${scheduledLabel}. Activate it manually when the moment arrives.`}
                </p>
                <button onClick={onClose} className="w-full py-3.5 rounded-full font-black text-sm" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))' }}>
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