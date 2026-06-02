/**
 * UpgradeFeed — sorted upgrade listings with price drop callouts.
 */
import { Link } from 'react-router-dom';
import { ArrowUpRight, TrendingDown, Bell, Share2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';

function confidenceColor(score) {
  if (!score) return '#888';
  if (score >= 80) return '#00FF87';
  if (score >= 55) return '#FFE600';
  return '#FF8C00';
}

export default function UpgradeFeed({ listings, eventId, loading }) {
  const sorted = [...listings].sort((a, b) => {
    // price drops first, then cheapest
    const aDrop = a.original_price && a.original_price > a.asking_price;
    const bDrop = b.original_price && b.original_price > b.asking_price;
    if (aDrop && !bDrop) return -1;
    if (!aDrop && bDrop) return 1;
    return a.asking_price - b.asking_price;
  });

  if (loading) return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl animate-pulse bg-muted" />)}
    </div>
  );

  if (sorted.length === 0) return (
    <div className="rounded-2xl px-5 py-8 text-center space-y-4"
      style={{ background: 'rgba(0,255,135,0.03)', border: '1px dashed rgba(0,255,135,0.18)' }}>
      <p className="text-3xl">⚡</p>
      <div>
        <p className="font-black text-sm text-foreground">No Upgrades Yet</p>
        <p className="text-xs text-muted-foreground mt-1.5 max-w-[220px] mx-auto leading-relaxed">
          Fans inside the venue can list seat upgrades once the event begins.
        </p>
      </div>
      <div className="flex flex-col gap-2 items-center">
        <button
          className="flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm transition-all active:scale-95"
          style={{ background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
          <Bell className="w-3.5 h-3.5" />
          Notify Me When One Appears
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs transition-all active:scale-95"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}
          onClick={() => navigator.share?.({ title: 'Peanut Gallery', text: 'Get seat upgrades at the show!', url: window.location.href }).catch(() => {})}>
          <Share2 className="w-3 h-3" />
          Share PG With Friends At This Event
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {sorted.map((l, i) => {
        const isPriceDrop = l.original_price && l.original_price > l.asking_price;
        const savings = isPriceDrop ? Math.round(l.original_price - l.asking_price) : 0;
        const isNew = l.created_date && Date.now() - new Date(l.created_date) < 600000; // 10 min

        return (
          <motion.div key={l.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
            <Link to={`/events/${eventId}`}
              className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:scale-98"
              style={{
                background: isPriceDrop ? 'rgba(255,45,120,0.05)' : 'rgba(255,255,255,0.04)',
                border: isPriceDrop ? '1px solid rgba(255,45,120,0.2)' : '1px solid rgba(255,255,255,0.08)',
              }}>
              {isPriceDrop && <TrendingDown className="w-4 h-4 flex-shrink-0" style={{ color: '#FF2D78' }} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-foreground">
                    Sec {l.section}{l.row ? ` · Row ${l.row}` : ''}
                  </p>
                  {isNew && (
                    <span className="text-[8px] font-black px-1 py-0.5 rounded-full" style={{ background: 'rgba(0,255,135,0.15)', color: '#00FF87' }}>NEW</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {l.quantity} ticket{l.quantity !== 1 ? 's' : ''} ·{' '}
                  {l.created_date ? formatDistanceToNow(new Date(l.created_date), { addSuffix: true }) : ''}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-black text-base" style={{ color: isPriceDrop ? '#FF2D78' : '#00FF87' }}>${l.asking_price}</p>
                {isPriceDrop && (
                  <p className="text-[10px] text-muted-foreground">
                    <span className="line-through">${l.original_price}</span>
                    <span className="ml-1 font-bold" style={{ color: '#FF2D78' }}>-${savings}</span>
                  </p>
                )}
                <div className="flex items-center justify-end gap-0.5 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: confidenceColor(l.transfer_confidence_score) }} />
                </div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}