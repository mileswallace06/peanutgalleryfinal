/**
 * LiveActivityBar — animated pulse of live stats.
 * Shows upgrades, drops, price drops, new listings.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';

export default function LiveActivityBar({ drops, listings }) {
  const [tick, setTick] = useState(0);

  // Pulse every 8s to re-animate
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 8000);
    return () => clearInterval(id);
  }, []);

  const activeDrops = drops.filter(d => d.status === 'active').length;
  const upgradeCount = listings.length;
  const priceDrops = listings.filter(l => l.original_price && l.original_price > l.asking_price).length;
  const recentListings = listings.filter(l => l.created_date && Date.now() - new Date(l.created_date) < 15 * 60 * 1000).length;

  const stats = [
    { icon: '⚡', value: upgradeCount, label: 'Upgrades', color: '#00C8FF', show: true },
    { icon: '🎁', value: activeDrops, label: 'Flash Drops', color: '#BF5FFF', pulse: activeDrops > 0, show: true },
    { icon: '🔥', value: priceDrops, label: 'Price Drops', color: '#FF2D78', show: priceDrops > 0 },
    { icon: '📈', value: recentListings, label: 'Listed Recently', color: '#00FF87', show: recentListings > 0 },
  ].filter(s => s.show);

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.07 }}
          className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl relative overflow-hidden"
          style={{
            background: `${s.color}10`,
            border: `1px solid ${s.color}30`,
            minWidth: '110px',
          }}>
          {s.pulse && (
            <motion.div
              key={`pulse-${tick}`}
              className="absolute inset-0 rounded-xl"
              style={{ background: `${s.color}15` }}
              initial={{ opacity: 0.5, scale: 0.95 }}
              animate={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
          <span className="text-base">{s.icon}</span>
          <div className="relative z-10">
            <p className="font-black text-base leading-none" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[9px] text-muted-foreground leading-none mt-0.5">{s.label}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}