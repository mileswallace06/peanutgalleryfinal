/**
 * FlashDropCenter — the main Flash Drop section.
 * Shows active, pending (scheduled), and recently completed drops.
 * One-tap entry, instant result reveal.
 */
import FlashDropCard from '@/components/flashdrops/FlashDropCard';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Gift, Clock, CheckCircle2 } from 'lucide-react';
import '@/components/flashdrops/fan-gifts-ticket.css';

export default function FlashDropCenter({ drops, user, listings, loading, loadError, onRetry, onDropSeats, onWinnerSelected }) {
  const activeDrops = drops.filter(d => d.status === 'active');
  const pendingDrops = drops.filter(d => d.status === 'pending');
  const recentDrops = drops.filter(d =>
    d.status === 'winner_selected' &&
    d.winner_selected_at &&
    Date.now() - new Date(d.winner_selected_at) < 5 * 60 * 1000
  );

  return (
    <section className="pg-fan-gifts">
      {/* Section header */}
      <div className="pg-fan-gifts-heading flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-bold text-sm text-foreground uppercase tracking-wide">Fan Gifts</h2>
          {activeDrops.length > 0 && (
            <motion.span
              key={activeDrops.length}
              initial={{ scale: 1.3 }}
              animate={{ scale: 1 }}
              className="pg-gift-stamp pg-gift-stamp-live text-[9px] font-black px-1.5 py-0.5">
              {activeDrops.length} LIVE
            </motion.span>
          )}
        </div>
        <button
          onClick={onDropSeats}
          className="pg-gift-button pg-gift-button-yellow text-xs px-3 py-1.5 font-bold transition-all active:scale-95">
          + Drop Seats
        </button>
      </div>

      {/* Active Drops */}
      {loading ? (
        <div className="pg-gift-panel h-48 animate-pulse" />
      ) : loadError ? (
        <div role="alert" className="pg-gift-panel px-5 py-6 text-center space-y-3">
          <p className="text-sm text-foreground">Fan Gifts couldn’t load. Please try again.</p>
          <button onClick={onRetry} className="text-sm font-semibold underline">Try again</button>
        </div>
      ) : activeDrops.length === 0 ? (
        <div className="pg-gift-panel px-5 py-6 text-center space-y-3">
          <Gift className="w-5 h-5 mx-auto opacity-20" />
          <div>
            <p className="font-semibold text-sm text-foreground">No fan gifts yet</p>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-[220px] mx-auto leading-relaxed">
              Fans can offer unused seats to others during the event.
            </p>
          </div>
          <div className="flex flex-col gap-2 items-center">
            <button
              className="pg-gift-button flex items-center gap-2 px-5 py-2.5 font-medium text-sm transition-all active:scale-95">
              <Bell className="w-3.5 h-3.5" />
              Notify me
            </button>
            <button onClick={onDropSeats}
              className="pg-gift-button text-xs px-4 py-2 font-medium transition-all active:scale-95">
              Offer your seats
            </button>
          </div>
        </div>
      ) : (
        <AnimatePresence>
          <div className="space-y-3">
            {activeDrops.map((drop, i) => (
              <motion.div key={drop.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <FlashDropCard
                  drop={drop}
                  user={user}
                  allListings={listings}
                  onEntered={() => {}}
                  onWinnerSelected={onWinnerSelected}
                />
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* Scheduled/Upcoming drops */}
      {!loadError && pendingDrops.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</p>
          </div>
          {pendingDrops.map(d => (
            <div key={d.id} className="pg-gift-summary flex items-center gap-3 px-4 py-2.5">
              <Clock className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">Sec {d.section}{d.row ? ` · Row ${d.row}` : ''}</p>
                <p className="text-xs text-muted-foreground">{d.scheduled_label || 'Scheduled'}</p>
              </div>
              <span className="pg-gift-stamp pg-gift-stamp-queued text-[10px] font-bold px-2 py-0.5">
                Queued
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recently completed */}
      {!loadError && recentDrops.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-muted-foreground" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Just Completed</p>
          </div>
          {recentDrops.map(d => (
            <div key={d.id} className="pg-gift-summary pg-gift-summary-complete flex items-center gap-3 px-4 py-2.5">
              <CheckCircle2 className="pg-gift-success w-4 h-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">Sec {d.section}{d.row ? ` · Row ${d.row}` : ''}</p>
                <p className="text-xs text-muted-foreground">{d.entry_count || 0} entered · Won by {d.winner_name || 'a fan'}</p>
              </div>
              <span className="pg-gift-success text-[10px] font-semibold">Gifted</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
