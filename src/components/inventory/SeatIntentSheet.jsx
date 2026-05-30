/**
 * SeatIntentSheet — shown before listing/drop creation.
 * Asks: "What do you want to do with this seat?"
 * Routes to Create Listing or Create Flash Drop accordingly.
 *
 * Props:
 *   event: Event entity
 *   user: current user
 *   seatData: { section, row, seats, quantity } — pre-populated if coming from a purchase
 *   onSell: () => void — route to create listing
 *   onFlashDrop: () => void — route to create flash drop
 *   onClose: () => void
 *   conflictStatus: string|null — inventory_status if blocked
 */
import { motion, AnimatePresence } from 'framer-motion';
import { X, DollarSign, Zap } from 'lucide-react';

export default function SeatIntentSheet({ event, user, seatData, onSell, onFlashDrop, onClose, conflictStatus }) {
  const conflictMessages = {
    in_flash_drop: 'This seat is already in an active Flash Drop. Cancel or let it expire before listing for sale.',
    listed_for_sale: 'This seat is already listed for sale. Remove the listing before creating a Flash Drop.',
    reserved_for_purchase: 'This seat is reserved for an active purchase.',
    claimed_by_winner: 'This seat was already claimed by a Flash Drop winner.',
  };

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-50 flex flex-col justify-end"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          className="relative rounded-t-3xl overflow-hidden"
          style={{ background: 'hsl(var(--card))', border: '1px solid rgba(255,255,255,0.1)', paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}>

          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
          <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full" style={{ background: 'hsl(var(--muted))' }}>
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="px-5 pt-2 pb-2">
            <h2 className="font-black text-xl text-foreground">What do you want to do with this seat?</h2>
            {seatData?.section && (
              <p className="text-xs text-muted-foreground mt-1">
                {event?.title} · Sec {seatData.section}{seatData.row ? ` Row ${seatData.row}` : ''}
              </p>
            )}

            {conflictStatus && conflictMessages[conflictStatus] ? (
              <div className="mt-4 rounded-2xl px-4 py-3"
                style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.3)' }}>
                <p className="text-sm font-bold" style={{ color: '#FF2D78' }}>⚠ Seat Unavailable</p>
                <p className="text-xs text-muted-foreground mt-1">{conflictMessages[conflictStatus]}</p>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <button onClick={onSell}
                  className="w-full flex items-start gap-4 px-5 py-4 rounded-2xl text-left transition-all active:scale-95"
                  style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.25)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(0,255,135,0.15)' }}>
                    <DollarSign className="w-5 h-5" style={{ color: '#00FF87' }} />
                  </div>
                  <div>
                    <p className="font-black text-base text-foreground">Sell It</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Set a price. Buyer pays and receives your ticket. You get paid out.</p>
                  </div>
                </button>

                <button onClick={onFlashDrop}
                  className="w-full flex items-start gap-4 px-5 py-4 rounded-2xl text-left transition-all active:scale-95"
                  style={{ background: 'rgba(255,230,0,0.06)', border: '1px solid rgba(255,230,0,0.25)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(255,230,0,0.15)' }}>
                    <Zap className="w-5 h-5" style={{ color: '#FFE600' }} />
                  </div>
                  <div>
                    <p className="font-black text-base text-foreground">Flash Drop It</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Give it away free. Random winner selected in 30–90 seconds. Earns goodwill + points.</p>
                  </div>
                </button>
              </div>
            )}

            <button onClick={onClose} className="w-full mt-4 py-3 rounded-full text-sm font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>
              Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}