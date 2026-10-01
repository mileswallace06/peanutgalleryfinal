import { useState } from 'react';
import { X, Zap, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import './fan-gifts-ticket.css';

const DELIVERY_METHODS = [
  { value: 'ticket_transfer', label: 'Ticket Transfer', desc: 'Transfer via ticketing app (TM, SeatGeek, etc.)' },
  { value: 'account_transfer', label: 'Account Transfer', desc: 'Transfer full account access' },
  { value: 'seller_contact', label: 'Direct Contact', desc: 'Winner contacts you to arrange handoff' },
  { value: 'manual_release', label: 'Manual Release', desc: "You'll physically hand off at the gate" },
];

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
  const [ownershipListingId, setOwnershipListingId] = useState('');
  const [ownershipProofUrl, setOwnershipProofUrl] = useState('');
  const [ownershipProofUploading, setOwnershipProofUploading] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState('ticket_transfer');
  const [userListings, setUserListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [createdDrop, setCreatedDrop] = useState(null);

  // Load user's existing listings for this event (ownership verification)
  const loadUserListings = async () => {
    if (!event?.id || !user?.email) return;
    const listings = await base44.entities.Listing.filter({ event_id: event.id, seller_email: user.email, status: 'active' }).catch(() => []);
    setUserListings(listings);
    // Auto-select if there's one matching section
    const match = listings.find(l => l.section === section);
    if (match) setOwnershipListingId(match.id);
  };

  const handleProofUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setOwnershipProofUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setOwnershipProofUrl(file_url);
    setOwnershipProofUploading(false);
  };

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
      ownership_listing_id: ownershipListingId || null,
      ownership_proof_url: ownershipProofUrl || null,
      ownership_delivery_method: deliveryMethod,
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
      <motion.div className="pg-fan-gifts pg-gift-sheet-layer fixed inset-0 z-50 flex flex-col justify-end"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="pg-gift-sheet-backdrop absolute inset-0" onClick={onClose} />
        <motion.div
          className="pg-gift-sheet relative"
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}>

          <div className="flex justify-center pt-3 pb-2">
            <div className="pg-gift-sheet-handle w-10 h-1" />
          </div>
          <button onClick={onClose} className="pg-gift-button pg-gift-sheet-close absolute top-4 right-4 p-2" aria-label="Close fan gift form">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="px-5 pt-1 pb-4">
            {/* Top accent */}
            <div className="pg-gift-sheet-heading flex items-center gap-2 mb-4">
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
                    className="pg-gift-type pg-gift-type-immediate p-4 text-left space-y-2 transition-all active:scale-95">
                    <span className="text-2xl">⚡</span>
                    <p className="font-black text-sm text-foreground">Immediate Drop</p>
                    <p className="text-xs text-muted-foreground">Seats go live right now. Entry window opens instantly.</p>
                  </button>
                  <button onClick={() => { setDropType('scheduled'); setStep('details'); }}
                    className="pg-gift-type pg-gift-type-scheduled p-4 text-left space-y-2 transition-all active:scale-95">
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
                        className={`pg-gift-choice pg-gift-choice-yellow flex-1 py-2 text-xs font-bold transition-all${windowSecs === o.value ? ' is-selected' : ''}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="pg-gift-choice flex items-center gap-3 px-4 py-3 cursor-pointer">
                  <div className={`pg-gift-checkbox w-5 h-5 flex items-center justify-center flex-shrink-0${isAnonymous ? ' is-selected' : ''}`}
                    onClick={() => setIsAnonymous(v => !v)}>
                    {isAnonymous && <span className="text-[10px] font-black">✓</span>}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Drop anonymously</p>
                    <p className="text-[10px] text-muted-foreground">Shown as "A generous fan"</p>
                  </div>
                </label>

                {/* Ownership Verification */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block">Verify You Own This Seat</label>
                  {userListings.length === 0 && (
                    <button type="button" onClick={loadUserListings}
                      className="pg-gift-link text-xs underline">
                      Check my listings for this event
                    </button>
                  )}
                  {userListings.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground">Link an existing listing:</p>
                      {userListings.map(l => (
                        <button key={l.id} onClick={() => setOwnershipListingId(l.id)}
                          className={`pg-gift-choice pg-gift-choice-mint w-full flex items-center justify-between px-3 py-2 text-xs transition-all${ownershipListingId === l.id ? ' is-selected' : ''}`}>
                          <span>Sec {l.section}{l.row ? ` Row ${l.row}` : ''}</span>
                          <span className="font-bold">${l.asking_price}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">Or upload proof:</div>
                  {ownershipProofUrl ? (
                    <div className="pg-gift-uploaded flex items-center gap-2 text-xs px-3 py-2">
                      ✓ Proof uploaded
                      <button onClick={() => setOwnershipProofUrl('')} className="ml-auto text-muted-foreground">Remove</button>
                    </div>
                  ) : (
                    <label className="pg-gift-upload flex items-center gap-2 px-3 py-2 cursor-pointer text-xs text-muted-foreground">
                      {ownershipProofUploading ? <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> : '📎'}
                      {ownershipProofUploading ? 'Uploading…' : 'Upload ticket screenshot'}
                      <input type="file" accept="image/*" className="hidden" onChange={handleProofUpload} disabled={ownershipProofUploading} />
                    </label>
                  )}
                </div>

                {/* Delivery Method */}
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">How Will Winner Receive Seat?</label>
                  <div className="space-y-1.5">
                    {DELIVERY_METHODS.map(m => (
                      <button key={m.value} onClick={() => setDeliveryMethod(m.value)}
                        className={`pg-gift-choice w-full flex items-start gap-3 px-3 py-2.5 text-left transition-all${deliveryMethod === m.value ? ' is-selected' : ''}`}>
                        <div>
                          <p className="text-xs font-bold text-foreground">{m.label}</p>
                          <p className="text-[10px] text-muted-foreground">{m.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={() => setStep('type')} className="pg-gift-button flex-1 py-3 text-sm font-bold">Back</button>
                  {dropType === 'scheduled' ? (
                    <button onClick={() => setStep('schedule')} disabled={!section}
                      className="pg-gift-button pg-gift-button-primary flex-1 py-3 text-sm font-black disabled:opacity-40">
                      Next: Schedule
                    </button>
                  ) : (
                    <button onClick={handleCreate} disabled={!section || loading}
                      className="pg-gift-button pg-gift-button-yellow flex-1 py-3 text-sm font-black disabled:opacity-40 flex items-center justify-center gap-2">
                      {loading ? <span className="pg-gift-spinner w-4 h-4 border-2 rounded-full animate-spin" /> : <><Zap className="w-4 h-4" /> Drop Now</>}
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
                      className={`pg-gift-choice px-3 py-2.5 text-xs font-semibold text-left transition-all${scheduledLabel === o.label ? ' is-selected' : ''}`}>
                      <Clock className="w-3 h-3 inline mr-1.5 opacity-60" />{o.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">You'll manually activate this drop when the moment arrives from your My Tickets page.</p>
                <div className="flex gap-3">
                  <button onClick={() => setStep('details')} className="pg-gift-button flex-1 py-3 text-sm font-bold">Back</button>
                  <button onClick={handleCreate} disabled={!scheduledLabel || loading}
                    className="pg-gift-button pg-gift-button-primary flex-1 py-3 text-sm font-black disabled:opacity-40 flex items-center justify-center gap-2">
                    {loading ? <span className="pg-gift-spinner w-4 h-4 border-2 rounded-full animate-spin" /> : <><Clock className="w-4 h-4" /> Schedule Drop</>}
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
                <button onClick={onClose} className="pg-gift-button w-full py-3.5 font-black text-sm">
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
