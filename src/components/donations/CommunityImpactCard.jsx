/**
 * CommunityImpactCard — shows on the Me page.
 * Displays a fan's donation history, community badges, and impact stats.
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Heart, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';

const COMMUNITY_BADGES = {
  fan_hero:       { label: 'Fan Hero',          emoji: '🥜', color: '#BF5FFF', desc: 'First seat donation' },
  community_mvp:  { label: 'Community MVP',     emoji: '🏆', color: '#FFE600', desc: '5 seat donations' },
  upgrade_angel:  { label: 'Upgrade Angel',     emoji: '😇', color: '#00C8FF', desc: '10 seat donations' },
  live_legend:    { label: 'Live Event Legend', emoji: '⚡', color: '#00FF87', desc: 'Active at 5+ live events' },
};

export default function CommunityImpactCard({ userEmail }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userEmail) return;
    Promise.all([
      base44.entities.SeatDonation.filter({ donor_email: userEmail }),
      base44.entities.SeatDonation.filter({ winner_email: userEmail }),
    ]).then(([donated, received]) => {
      const acceptedDonations = donated.filter(d => d.donation_status === 'accepted' || d.donation_status === 'completed');
      const badges = [];
      if (donated.length >= 1)  badges.push('fan_hero');
      if (donated.length >= 5)  badges.push('community_mvp');
      if (donated.length >= 10) badges.push('upgrade_angel');

      setStats({
        donated: donated.length,
        accepted: acceptedDonations.length,
        received: received.filter(d => d.donation_status === 'accepted').length,
        badges,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [userEmail]);

  if (loading) return null;
  if (!stats || (stats.donated === 0 && stats.received === 0)) return null;

  return (
    <div className="rounded-2xl overflow-hidden mb-5"
      style={{
        background: 'linear-gradient(135deg, rgba(191,95,255,0.08) 0%, rgba(255,45,120,0.06) 100%)',
        border: '1px solid rgba(191,95,255,0.25)',
      }}>

      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4" style={{ color: '#FF2D78' }} />
          <span className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Community Impact</span>
        </div>
        <Link to="/leaderboard?tab=community" className="text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors">
          Leaderboard →
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 divide-x px-2 pb-3" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {[
          { label: 'Donated', val: stats.donated,  emoji: '🎁' },
          { label: 'Accepted', val: stats.accepted, emoji: '✅' },
          { label: 'Received', val: stats.received, emoji: '🎉' },
        ].map((s, i) => (
          <div key={i} className="flex flex-col items-center py-3"
            style={{ borderRightWidth: i < 2 ? '1px' : '0', borderColor: 'rgba(255,255,255,0.08)' }}>
            <span className="text-base">{s.emoji}</span>
            <span className="font-black text-lg text-foreground leading-none mt-0.5">{s.val}</span>
            <span className="text-[9px] text-muted-foreground mt-0.5">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Badges */}
      {stats.badges.length > 0 && (
        <>
          <div className="h-px mx-5" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="px-5 py-3">
            <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-2">
              <Award className="w-3 h-3 inline mr-1" />Community Badges
            </p>
            <div className="flex flex-wrap gap-1.5">
              {stats.badges.map(key => {
                const def = COMMUNITY_BADGES[key];
                if (!def) return null;
                return (
                  <motion.span
                    key={key}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    title={def.desc}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold cursor-default"
                    style={{ background: `${def.color}15`, border: `1px solid ${def.color}40`, color: def.color }}>
                    {def.emoji} {def.label}
                  </motion.span>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* CTA if no donations yet */}
      {stats.donated === 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Upgrade during a live event and donate your old seats to earn the{' '}
            <span className="font-bold" style={{ color: '#BF5FFF' }}>Fan Hero</span> badge and +150 🥜 Peanut Points.
          </p>
        </div>
      )}
    </div>
  );
}