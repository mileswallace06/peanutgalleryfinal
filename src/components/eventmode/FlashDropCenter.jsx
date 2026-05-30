/**
 * FlashDropCenter — the main Flash Drop section.
 * Shows active, pending (scheduled), and recently completed drops.
 * One-tap entry, instant result reveal.
 */
import FlashDropCard from '@/components/flashdrops/FlashDropCard';
import { motion, AnimatePresence } from 'framer-motion';

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
          <span className="text-lg">🎁</span>
          <h2 className="font-black text-sm text-foreground uppercase tracking-wide">Flash Drops</h2>
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
        <div className="rounded-2xl px-5 py-8 text-center"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)' }}>
          <p className="text-3xl mb-2">🎁</p>
          <p className="text-sm font-bold text-foreground mb-1">No active Flash Drops</p>
          <p className="text-xs text-muted-foreground mb-3">Upgraded your seat? Drop your old ones free for a fellow fan.</p>
          <button onClick={onDropSeats}
            className="text-xs px-4 py-2 rounded-full font-bold"
            style={{ background: 'rgba(255,230,0,0.12)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
            ⚡ Create First Drop
          </button>
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
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wide">⏰ Upcoming</p>
          {pendingDrops.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
              style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.2)' }}>
              <span className="text-sm">⏰</span>
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
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wide">✅ Just Completed</p>
          {recentDrops.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
              style={{ background: 'rgba(0,255,135,0.04)', border: '1px solid rgba(0,255,135,0.15)' }}>
              <span className="text-sm">🎁</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">Sec {d.section}{d.row ? ` · Row ${d.row}` : ''}</p>
                <p className="text-xs text-muted-foreground">{d.entry_count || 0} entered · Won by {d.winner_name || 'a fan'}</p>
              </div>
              <span className="text-[10px] font-bold" style={{ color: '#00FF87' }}>🎉 Done</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}