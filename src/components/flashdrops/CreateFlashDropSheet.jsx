import { useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Zap, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { loadEligibleFlashDropListings, ownershipLookupMessage } from '@/lib/flashDropOwnership';
import { useUpgradeClock } from '@/hooks/useUpgradeClock';
import { checkListingEvent, listingEventEligibility } from '../../../base44/shared/listingEventEligibility.js';
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

export default function CreateFlashDropSheet({ event, user, onClose, onCreated, onEventChecked }) {
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
  const [ownershipProofError, setOwnershipProofError] = useState('');
  const proofUploadRequest = useRef(0);
  const proofUploadInFlight = useRef(false);
  const [deliveryMethod, setDeliveryMethod] = useState('ticket_transfer');
  const [userListings, setUserListings] = useState([]);
  const [ownershipLookup, setOwnershipLookup] = useState('idle');
  const lookupRequest = useRef(0);
  const lookupInFlight = useRef(false);
  const [loading, setLoading] = useState(false);
  const [createdDrop, setCreatedDrop] = useState(null);
  const fieldId = useId();
  const closeButton = useRef(null);
  const returnFocusTo = useRef(null);
  const sheet = useRef(null);
  const heading = useRef(null);
  const previousStep = useRef(step);
  const submitting = useRef(false);
  const [submitError, setSubmitError] = useState('');
  const [checkedEvent, setCheckedEvent] = useState(null);
  const currentEvent = checkedEvent?.id === event?.id ? checkedEvent : event;
  const nowMs = useUpgradeClock(currentEvent);
  const creationClosed = !listingEventEligibility(currentEvent, nowMs).allowed;

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    sheet.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    lookupRequest.current += 1;
    lookupInFlight.current = false;
    setUserListings([]);
    setOwnershipListingId('');
    setOwnershipLookup('idle');
    return () => { lookupRequest.current += 1; lookupInFlight.current = false; };
  }, [event?.id, user?.email]);

  useEffect(() => {
    proofUploadRequest.current += 1;
    proofUploadInFlight.current = false;
    setOwnershipProofUrl('');
    setOwnershipProofUploading(false);
    setOwnershipProofError('');
    return () => {
      proofUploadRequest.current += 1;
      proofUploadInFlight.current = false;
    };
  }, [event?.id, user?.email]);

  // Failures and empty results are different. The participant view authorizes
  // the current user's records; matching a listing is not ownership approval.
  const loadUserListings = async () => {
    if (lookupInFlight.current) return;
    if (!event?.id || !user?.email) { setOwnershipLookup('error'); return; }
    const requestId = ++lookupRequest.current;
    lookupInFlight.current = true;
    setOwnershipLookup('loading');
    setOwnershipListingId('');
    setUserListings([]);
    try {
      const listings = await loadEligibleFlashDropListings(base44, event.id);
      if (requestId !== lookupRequest.current) return;
      setUserListings(listings);
      setOwnershipLookup(listings.length ? 'populated' : 'empty');
    } catch {
      if (requestId === lookupRequest.current) setOwnershipLookup('error');
    } finally {
      if (requestId === lookupRequest.current) lookupInFlight.current = false;
    }
  };

  const handleProofUpload = async (e) => {
    const file = e.currentTarget.files?.[0];
    // Clearing the native selection lets the same file trigger change on retry.
    e.currentTarget.value = '';
    if (!file || proofUploadInFlight.current) return;
    const request = ++proofUploadRequest.current;
    proofUploadInFlight.current = true;
    setOwnershipProofError('');
    setOwnershipProofUploading(true);
    try {
      const result = await base44.integrations.Core.UploadFile({ file });
      if (request !== proofUploadRequest.current) return;
      if (typeof result?.file_url !== 'string' || !result.file_url.trim()) throw new Error('Upload response unavailable');
      setOwnershipProofUrl(result.file_url);
    } catch {
      if (request === proofUploadRequest.current) setOwnershipProofError('We could not upload your proof. Your seat details are saved in this form. Choose the same file or another image to retry.');
    } finally {
      if (request === proofUploadRequest.current) {
        proofUploadInFlight.current = false;
        setOwnershipProofUploading(false);
      }
    }
  };

  const handleCreate = async () => {
    if (submitting.current || !section) return;
    if (!user?.email) { setSubmitError('Sign in before creating a fan gift.'); return; }
    if (!listingEventEligibility(currentEvent, Date.now()).allowed) {
      setSubmitError('Fan gifts are closed for this event.');
      return;
    }
    submitting.current = true;
    setLoading(true);
    setSubmitError('');
    try {
    const fresh = await checkListingEvent(base44, event.id);
    if (fresh.event) { setCheckedEvent(fresh.event); onEventChecked?.(fresh.event); }
    if (!fresh.allowed) { setSubmitError(fresh.code === 'EVENT_ENDED' ? 'Fan gifts are closed for this event.' : fresh.message); return; }
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
    if (res?.data?.success) {
      setCreatedDrop(res.data.drop);
      setStep('done');
      onCreated?.(res.data.drop);
    } else setSubmitError('The fan gift could not be created. Please retry.');
    } catch { setSubmitError('We could not check this event or create the fan gift. Your form is still here; please retry.'); }
    finally { submitting.current = false; setLoading(false); }
  };

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="pg-gift-sheet-backdrop" />
        <Dialog.Content ref={sheet} className="pg-ticket-app pg-fan-gifts pg-gift-sheet"
          onOpenAutoFocus={focusEvent => {
            focusEvent.preventDefault();
            returnFocusTo.current = document.activeElement;
            closeButton.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={focusEvent => {
            focusEvent.preventDefault();
            if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus({ preventScroll: true });
          }}>

          <div className="flex justify-center pt-3 pb-2">
            <div className="pg-gift-sheet-handle w-10 h-1" />
          </div>
          <Dialog.Close ref={closeButton} className="pg-gift-button pg-gift-sheet-close absolute top-4 right-4 p-2" aria-label="Close fan gift form">
            <X className="w-4 h-4 text-muted-foreground" />
          </Dialog.Close>

          <div className="px-5 pt-1 pb-4">
            {/* Top accent */}
            <div className="pg-gift-sheet-heading flex items-center gap-2 mb-4">
              <span className="text-2xl">⚡</span>
              <div>
                <Dialog.Title ref={heading} tabIndex={-1} className="font-black text-lg text-foreground leading-none">Create Flash Drop<span className="sr-only"> — {step === 'type' ? 'Choose drop type' : step === 'details' ? 'Seat details' : step === 'schedule' ? 'Schedule' : 'Complete'}</span></Dialog.Title>
                <Dialog.Description className="text-xs text-muted-foreground">{event?.title}</Dialog.Description>
              </div>
            </div>

            {submitError && <p role="alert" className="pg-gift-panel p-3 mb-3 text-sm">{submitError}</p>}
            {creationClosed && step !== 'done' && <div role="status" className="pg-gift-panel p-4 space-y-2">
              <h3 className="font-bold">Fan gifts are closed for this event.</h3>
              <p className="text-sm">This event has ended or is no longer open for new fan gifts. Close this form to return to its history.</p>
            </div>}
            {!creationClosed && listingEventEligibility(currentEvent, nowMs).timing?.status === 'unknown' && <p role="status" className="text-sm text-muted-foreground mb-3">The event time is unconfirmed. Check the event details before offering your seats.</p>}

            {/* Step: Type */}
            {step === 'type' && !creationClosed && (
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
            {step === 'details' && !creationClosed && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Seat Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`${fieldId}-section`} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Section *</label>
                    <input id={`${fieldId}-section`} aria-required="true" value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. 118"
                      className="pg-control-input w-full px-3 py-2.5 rounded-xl text-sm outline-none" />
                  </div>
                  <div>
                    <label htmlFor={`${fieldId}-row`} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Row</label>
                    <input id={`${fieldId}-row`} value={row} onChange={e => setRow(e.target.value)} placeholder="e.g. G"
                      className="pg-control-input w-full px-3 py-2.5 rounded-xl text-sm outline-none" />
                  </div>
                  <div>
                    <label htmlFor={`${fieldId}-seats`} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Seats</label>
                    <input id={`${fieldId}-seats`} value={seats} onChange={e => setSeats(e.target.value)} placeholder="e.g. 12, 13"
                      className="pg-control-input w-full px-3 py-2.5 rounded-xl text-sm outline-none" />
                  </div>
                  <div>
                    <label htmlFor={`${fieldId}-quantity`} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Quantity</label>
                    <input id={`${fieldId}-quantity`} type="number" min="1" max="10" value={quantity} onChange={e => setQuantity(+e.target.value)}
                      className="pg-control-input w-full px-3 py-2.5 rounded-xl text-sm outline-none" />
                  </div>
                </div>

                <div>
                  <label htmlFor={`${fieldId}-message`} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Message (optional)</label>
                  <input id={`${fieldId}-message`} value={message} onChange={e => setMessage(e.target.value)} placeholder="Enjoy the show! 🎶"
                    className="pg-control-input w-full px-3 py-2.5 rounded-xl text-sm outline-none" />
                </div>

                <fieldset>
                  <legend className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Entry Window</legend>
                  <div className="flex gap-2">
                    {WINDOW_OPTIONS.map(o => (
                      <button key={o.value} onClick={() => setWindowSecs(o.value)} aria-pressed={windowSecs === o.value}
                        className={`pg-gift-choice pg-gift-choice-yellow flex-1 py-2 text-xs font-bold transition-all${windowSecs === o.value ? ' is-selected' : ''}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="pg-gift-choice flex items-center gap-3 px-4 py-3 cursor-pointer">
                  <input type="checkbox" className="pg-gift-checkbox w-5 h-5 flex-shrink-0"
                    checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)} />
                  <div>
                    <p className="text-sm font-bold text-foreground">Drop anonymously</p>
                    <p className="text-[10px] text-muted-foreground">Shown as "A generous fan"</p>
                  </div>
                </label>

                {/* Ownership Verification */}
                <fieldset className="space-y-2">
                  <legend className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block">Verify You Own This Seat</legend>
                  <button type="button" onClick={loadUserListings} disabled={ownershipLookup === 'loading'}
                    aria-describedby={`${fieldId}-ownership-status`} className="pg-gift-link min-h-11 text-xs underline disabled:opacity-60">
                    {ownershipLookup === 'loading' ? 'Checking listings…' : ownershipLookup === 'error' ? 'Retry listing check' : ownershipLookup === 'idle' ? 'Check my listings for this event' : 'Check listings again'}
                  </button>
                  <p id={`${fieldId}-ownership-status`} role="status" aria-live="polite" aria-atomic="true" className="text-xs text-muted-foreground">
                    {ownershipLookupMessage(ownershipLookup, userListings.length)}
                  </p>
                  {userListings.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground">Link an existing listing:</p>
                      {userListings.map(l => (
                        <button key={l.id} onClick={() => setOwnershipListingId(l.id)} aria-pressed={ownershipListingId === l.id}
                          className={`pg-gift-choice pg-gift-choice-mint w-full flex items-center justify-between px-3 py-2 text-xs transition-all${ownershipListingId === l.id ? ' is-selected' : ''}`}>
                          <span>Sec {l.section}{l.row ? ` Row ${l.row}` : ''}{l.seats ? ` · Seats ${l.seats}` : ''}</span>
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
                      <input type="file" accept="image/*" className="sr-only" onChange={handleProofUpload} disabled={ownershipProofUploading} />
                    </label>
                  )}
                  {ownershipProofError && <p role="alert" className="text-xs text-foreground">{ownershipProofError}</p>}
                </fieldset>

                {/* Delivery Method */}
                <fieldset>
                  <legend className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">How Will Winner Receive Seat?</legend>
                  <div className="space-y-1.5">
                    {DELIVERY_METHODS.map(m => (
                      <button key={m.value} onClick={() => setDeliveryMethod(m.value)} aria-pressed={deliveryMethod === m.value}
                        className={`pg-gift-choice w-full flex items-start gap-3 px-3 py-2.5 text-left transition-all${deliveryMethod === m.value ? ' is-selected' : ''}`}>
                        <div>
                          <p className="text-xs font-bold text-foreground">{m.label}</p>
                          <p className="text-[10px] text-muted-foreground">{m.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="flex gap-3 pt-1">
                  <button onClick={() => setStep('type')} className="pg-gift-button flex-1 py-3 text-sm font-bold">Back</button>
                  {dropType === 'scheduled' ? (
                    <button onClick={() => setStep('schedule')} disabled={!section}
                      className="pg-gift-button pg-gift-button-primary flex-1 py-3 text-sm font-black disabled:opacity-40">
                      Next: Schedule
                    </button>
                  ) : (
                    <button onClick={handleCreate} disabled={!section || loading || ownershipProofUploading}
                      aria-busy={loading}
                      className="pg-gift-button pg-gift-button-yellow flex-1 py-3 text-sm font-black disabled:opacity-40 flex items-center justify-center gap-2">
                      {loading ? <><span aria-hidden="true" className="pg-gift-spinner w-4 h-4 border-2 rounded-full animate-spin" /> Creating fan gift…</> : <><Zap className="w-4 h-4" /> Drop Now</>}
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {/* Step: Schedule */}
            {step === 'schedule' && !creationClosed && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <p className="text-sm text-muted-foreground">When should this Flash Drop go live?</p>
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                  {SCHEDULE_OPTIONS.map(o => (
                    <button key={o.value} onClick={() => setScheduledLabel(o.label)} aria-pressed={scheduledLabel === o.label}
                      className={`pg-gift-choice px-3 py-2.5 text-xs font-semibold text-left transition-all${scheduledLabel === o.label ? ' is-selected' : ''}`}>
                      <Clock className="w-3 h-3 inline mr-1.5 opacity-60" />{o.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">You'll manually activate this drop when the moment arrives from your My Tickets page.</p>
                <div className="flex gap-3">
                  <button onClick={() => setStep('details')} className="pg-gift-button flex-1 py-3 text-sm font-bold">Back</button>
                  <button onClick={handleCreate} disabled={!scheduledLabel || loading || ownershipProofUploading}
                    aria-busy={loading}
                    className="pg-gift-button pg-gift-button-primary flex-1 py-3 text-sm font-black disabled:opacity-40 flex items-center justify-center gap-2">
                    {loading ? <><span aria-hidden="true" className="pg-gift-spinner w-4 h-4 border-2 rounded-full animate-spin" /> Creating fan gift…</> : <><Clock className="w-4 h-4" /> Schedule Drop</>}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
