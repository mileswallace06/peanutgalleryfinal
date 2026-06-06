/**
 * FlashDropCenter — the main Flash Drop section.
 * Shows active, pending (scheduled), and recently completed drops.
 * One-tap entry, instant result reveal.
 */
import FlashDropCard from '@/components/flashdrops/FlashDropCard';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Gift, Clock, CheckCircle2 } from 'lucide-react';

export default function FlashDropCenter({ drops, user, listings, loading, onDropSeats, onWinnerSelected }) {
  const activeDrops = drops.filter(d => d.status === 'active');
  const pendingDrops = drops.filter(d => d.status === 'pending');
  const recentDrops = drops.filter(d =>
    d.status === 'winner_selected' &&
    d.winner_selected_at &&
    Date.now() - new Date(d.winner_selected_at) < 5 * 60 * 1000
  );

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-bold text-sm text-foreground uppercase tracking-wide">Fan Gifts</h2>
          {activeDrops.length > 0 && (
            <motion.span
              key={activeDrops.length}
              initial={{ scale: 1.3 }}
              animate={{ scale: 1 }}
              className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(255,45,120,0.2)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.4)' }}>
              {activeDrops.length} LIVE
            </motion.span>
          )}
        </div>
        <button
          onClick={onDropSeats}
          className="text-xs px-3 py-1.5 rounded-full font-bold transition-all active:scale-95"
          style={{ background: 'rgba(255,230,0,0.1)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
          + Drop Seats
        </button>
      </div>

      {/* Active Drops */}
      {loading ? (
        <div className="h-48 rounded-2xl animate-pulse bg-muted" />
      ) : activeDrops.length === 0 ? (
        <div className="rounded-2xl px-5 py-6 text-center space-y-3"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <Gift className="w-5 h-5 mx-auto opacity-20" />
          <div>
            <p className="font-semibold text-sm text-foreground">No fan gifts yet</p>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-[220px] mx-auto leading-relaxed">
              Fans can offer unused seats to others during the event.
            </p>
          </div>
          <div className="flex flex-col gap-2 items-center">
            <button
              className="flex items-center gap-2 px-5 py-2.5 rounded-full font-medium text-sm transition-all active:scale-95"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <Bell className="w-3.5 h-3.5" />
              Notify me
            </button>
            <button onClick={onDropSeats}
              className="text-xs px-4 py-2 rounded-full font-medium transition-all active:scale-95"
              style={{ background: 'transparent', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>
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
      {pendingDrops.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</p>
          </div>
          {pendingDrops.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Clock className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">Sec {d.section}{d.row ? ` · Row ${d.row}` : ''}</p>
                <p className="text-xs text-muted-foreground">{d.scheduled_label || 'Scheduled'}</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: '#BF5FFF', background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.3)' }}>
                Queued
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recently completed */}
      {recentDrops.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-muted-foreground" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Just Completed</p>
          </div>
          {recentDrops.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
              style={{ background: 'rgba(0,255,135,0.04)', border: '1px solid rgba(0,255,135,0.15)' }}>
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#00FF87' }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">Sec {d.section}{d.row ? ` · Row ${d.row}` : ''}</p>
                <p className="text-xs text-muted-foreground">{d.entry_count || 0} entered · Won by {d.winner_name || 'a fan'}</p>
              </div>
              <span className="text-[10px] font-semibold" style={{ color: '#00FF87' }}>Gifted</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}