import { useState } from 'react';
import { X, Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';

const WINDOW_OPTIONS = [
  { label: '30 seconds', value: 30 },
  { label: '45 seconds', value: 45 },
  { label: '60 seconds', value: 60 },
  { label: '90 seconds', value: 90 },
];

function actionError(error, fallback) {
  return error?.response?.data?.error || error?.data?.error || error?.message || fallback;
}

export default function CreateFlashDropSheet({ event, user, onClose, onCreated }) {
  const [step, setStep] = useState('type'); // type | details | done
  const [section, setSection] = useState('');
  const [row, setRow] = useState('');
  const [seats, setSeats] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [windowSecs, setWindowSecs] = useState(60);
  const [ownershipListingId, setOwnershipListingId] = useState('');
  const [sourcePurchaseId, setSourcePurchaseId] = useState('');
  const [userListings, setUserListings] = useState([]);
  const [userPurchases, setUserPurchases] = useState([]);
  const [ownershipLoading, setOwnershipLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ownershipSelected = Boolean(ownershipListingId || sourcePurchaseId);

  // Load only candidate ownership records. The backend re-verifies every field
  // against private records before any seat or listing mutation.
  const loadUserListings = async () => {
    if (!event?.id || !user?.email) return;
    setOwnershipLoading(true);
    setError('');
    try {
      const [listingRows, purchaseRows] = await Promise.all([
        base44.entities.Listing.filter({ event_id: event.id, seller_email: user.email, status: 'active' }),
        base44.entities.Purchase.filter({ event_id: event.id, buyer_email: user.email, transfer_status: 'completed' }),
      ]);
      const eligibleListings = listingRows.filter(listing =>
        listing.proof_status === 'approved' &&
        listing.transfer_status === 'transfer_confirmed' &&
        ['platform_transfer', 'email_transfer'].includes(listing.transfer_method)
      );

      const completedPurchases = purchaseRows.filter(purchase =>
        purchase.payment_captured === true && purchase.buyer_confirmed === true && purchase.listing_id
      );
      const purchaseOptions = await Promise.all(completedPurchases.map(async purchase => {
        const rows = await base44.entities.Listing.filter({ id: purchase.listing_id });
        const listing = rows[0];
        return listing ? { ...purchase, source_listing: listing } : null;
      }));
      const eligiblePurchases = purchaseOptions.filter(option =>
        option &&
        option.source_listing.transfer_status === 'transfer_confirmed' &&
        ['platform_transfer', 'email_transfer'].includes(option.source_listing.transfer_method)
      );

      setUserListings(eligibleListings);
      setUserPurchases(eligiblePurchases);
      if (eligibleListings.length === 0 && eligiblePurchases.length === 0) {
        setError('No verified transferable ticket was found for this event. Finish listing verification or use a completed purchase first.');
      }
    } catch (loadError) {
      setError(actionError(loadError, 'Could not load your verified tickets. Check your connection and try again.'));
    } finally {
      setOwnershipLoading(false);
    }
  };

  const selectListing = (listing) => {
    setOwnershipListingId(listing.id);
    setSourcePurchaseId('');
    setSection(listing.section || '');
    setRow(listing.row || '');
    setSeats(listing.seats || '');
    setQuantity(listing.quantity || 1);
    setError('');
  };

  const selectPurchase = (purchase) => {
    const listing = purchase.source_listing;
    setSourcePurchaseId(purchase.id);
    setOwnershipListingId('');
    setSection(listing.section || '');
    setRow(listing.row || '');
    setSeats(listing.seats || '');
    setQuantity(listing.quantity || purchase.quantity || 1);
    setError('');
  };

  const handleCreate = async () => {
    if (!section || !ownershipSelected) {
      setError('Select a verified listing or completed purchase before creating the drop.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('flashDrop', {
        action: 'create',
        event_id: event.id,
        section,
        row: row || null,
        seats: seats || null,
        quantity,
        is_anonymous: isAnonymous,
        donor_message: message || null,
        drop_type: 'immediate',
        scheduled_label: null,
        entry_window_seconds: windowSecs,
        ownership_listing_id: ownershipListingId || null,
        source_purchase_id: sourcePurchaseId || null,
        ownership_delivery_method: 'ticket_transfer',
      });
      if (!res?.data?.success) {
        throw new Error(res?.data?.error || 'Flash Drop was not created.');
      }
      setStep('done');
      onCreated?.(res.data.drop);
    } catch (createError) {
      setError(actionError(createError, 'Flash Drop could not be created. Check your connection and try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-50 flex flex-col justify-end"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          className="relative rounded-t-3xl overflow-hidden flex flex-col max-h-[100dvh]"
          style={{ background: 'hsl(var(--card))', border: '1px solid rgba(255,255,255,0.1)', maxHeight: 'calc(100dvh - env(safe-area-inset-top))' }}
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}>

          <div className="flex-shrink-0">
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            <button type="button" onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full" style={{ background: 'hsl(var(--muted))' }}>
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="px-5 pt-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
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
                  <button type="button" onClick={() => setStep('details')}
                    className="rounded-2xl p-4 text-left space-y-2 transition-all active:scale-95"
                    style={{ background: 'rgba(255,230,0,0.08)', border: '1px solid rgba(255,230,0,0.3)' }}>
                    <span className="text-2xl">⚡</span>
                    <p className="font-black text-sm text-foreground">Immediate Drop</p>
                    <p className="text-xs text-muted-foreground">Seats go live right now. Entry window opens instantly.</p>
                  </button>
                  <button type="button" disabled aria-disabled="true"
                    className="rounded-2xl p-4 text-left space-y-2 opacity-50 cursor-not-allowed"
                    style={{ background: 'rgba(191,95,255,0.04)', border: '1px solid rgba(191,95,255,0.15)' }}>
                    <span className="text-2xl">⏰</span>
                    <p className="font-black text-sm text-foreground">Scheduled Drop · Coming Later</p>
                    <p className="text-xs text-muted-foreground">Scheduled activation is not available yet.</p>
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step: Details */}
            {step === 'details' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Seat Details</p>
                {error && (
                  <div role="alert" className="rounded-xl px-3 py-2.5 text-xs" style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.25)', color: '#FF7AA8' }}>
                    {error}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Section *</label>
                    <input value={section} onChange={e => setSection(e.target.value)} readOnly={ownershipSelected} placeholder="e.g. 118"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Row</label>
                    <input value={row} onChange={e => setRow(e.target.value)} readOnly={ownershipSelected} placeholder="e.g. G"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Seats</label>
                    <input value={seats} onChange={e => setSeats(e.target.value)} readOnly={ownershipSelected} placeholder="e.g. 12, 13"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground bg-input border border-border outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">Quantity</label>
                    <input type="number" min="1" max="10" value={quantity} onChange={e => setQuantity(+e.target.value)} readOnly={ownershipSelected}
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
                      <button type="button" key={o.value} onClick={() => setWindowSecs(o.value)}
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

                {/* Ownership Verification */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block">Verified Ticket Required</label>
                  <p className="text-[10px] text-muted-foreground">
                    Screenshots do not verify ownership. Link an approved transferable listing or a completed purchase.
                  </p>
                  <button type="button" onClick={loadUserListings} disabled={ownershipLoading}
                    className="w-full px-3 py-2.5 rounded-xl text-xs font-bold disabled:opacity-50"
                    style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.25)', color: '#D9A6FF' }}>
                    {ownershipLoading ? 'Checking verified tickets…' : 'Load my verified tickets'}
                  </button>
                  {userListings.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground">Approved listings (the sale listing will be paused):</p>
                      {userListings.map(l => (
                        <button type="button" key={l.id} onClick={() => selectListing(l)}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all"
                          style={ownershipListingId === l.id
                            ? { background: 'rgba(0,255,135,0.08)', border: '1px solid rgba(0,255,135,0.3)', color: '#00FF87' }
                            : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'hsl(var(--foreground))' }}>
                          <span>Sec {l.section}{l.row ? ` Row ${l.row}` : ''}</span>
                          <span className="font-bold">${l.asking_price}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {userPurchases.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground">Completed purchases:</p>
                      {userPurchases.map(purchase => {
                        const listing = purchase.source_listing;
                        return (
                          <button type="button" key={purchase.id} onClick={() => selectPurchase(purchase)}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all"
                            style={sourcePurchaseId === purchase.id
                              ? { background: 'rgba(0,255,135,0.08)', border: '1px solid rgba(0,255,135,0.3)', color: '#00FF87' }
                              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'hsl(var(--foreground))' }}>
                            <span>Sec {listing.section}{listing.row ? ` Row ${listing.row}` : ''}</span>
                            <span className="font-bold">Purchased</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Delivery Method */}
                <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.18)' }}>
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1">How Will Winner Receive Seat?</label>
                  <p className="text-xs font-bold text-foreground">Official electronic ticket transfer</p>
                  <p className="text-[10px] text-muted-foreground">Transfer through the ticketing provider. Never share a password, one-time code, or barcode screenshot.</p>
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setStep('type')} className="flex-1 py-3 rounded-2xl text-sm font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>Back</button>
                  <button type="button" onClick={handleCreate} disabled={!section || !ownershipSelected || loading}
                    className="flex-1 py-3 rounded-2xl text-sm font-black disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #FFE600, #FF8C00)', color: '#000' }}>
                    {loading ? <span className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" /> : <><Zap className="w-4 h-4" /> Drop Now</>}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step: Done */}
            {step === 'done' && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-4 space-y-3">
                <div className="text-5xl">⚡</div>
                <h3 className="font-black text-xl text-foreground">Flash Drop is Live!</h3>
                <p className="text-sm text-muted-foreground">Fans have {windowSecs} seconds to enter. Winner selected when the donor closes the drop.</p>
                <button type="button" onClick={onClose} className="w-full py-3.5 rounded-full font-black text-sm" style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))' }}>
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
