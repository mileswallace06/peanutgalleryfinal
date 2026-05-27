import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Star, ChevronRight, Zap, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RANKS, getRankForPoints, getNextRank, getLevelProgress, TRUST_BADGE_DEFS, ACHIEVEMENT_DEFS } from '@/lib/peanutPoints';

function ProgressBar({ value, color }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${color}99, ${color})` }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(value * 100)}%` }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
    </div>
  );
}

export default function PeanutPointsCard({ user }) {
  const lifetimePts = user?.lifetime_points || 0;
  const currentPts = user?.peanut_points || 0;
  const currentRank = getRankForPoints(lifetimePts);
  const nextRank = getNextRank(lifetimePts);
  const progress = getLevelProgress(lifetimePts);
  const achievements = user?.achievements || [];
  const trustBadges = user?.trust_badges || [];
  const trustScore = user?.trust_score || 50;

  const ptsToNext = nextRank ? nextRank.min - lifetimePts : 0;

  return (
    <div className="rounded-2xl overflow-hidden mb-5"
      style={{
        background: 'linear-gradient(135deg, rgba(191,95,255,0.12) 0%, rgba(0,200,255,0.08) 100%)',
        border: '1px solid rgba(191,95,255,0.3)',
      }}>

      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{currentRank.emoji}</span>
            <div>
              <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Fan Rank</p>
              <p className="font-display text-xl leading-none" style={{ color: currentRank.color }}>
                {currentRank.rank}
              </p>
            </div>
          </div>
          <Link to="/leaderboard" className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors">
            <Trophy className="w-3 h-3" /> Leaderboard <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Points display */}
        <div className="flex items-baseline gap-1.5 mt-3 mb-3">
          <span className="font-display text-4xl leading-none" style={{ color: currentRank.color }}>
            {currentPts.toLocaleString()}
          </span>
          <span className="text-sm font-bold text-muted-foreground">🥜 Peanut Points</span>
        </div>

        {/* Level progress bar */}
        {nextRank ? (
          <>
            <ProgressBar value={progress} color={currentRank.color} />
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-muted-foreground">Level {currentRank.level}</span>
              <span className="text-[10px] text-muted-foreground">
                {ptsToNext.toLocaleString()} pts to {nextRank.rank} ·  Lv.{nextRank.level}
              </span>
            </div>
          </>
        ) : (
          <div className="text-[11px] font-bold mt-1" style={{ color: '#FFE600' }}>
            🏆 Max Rank — Hall of Fame
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-px mx-5" style={{ background: 'rgba(255,255,255,0.08)' }} />

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {[
          { label: 'Lifetime', val: lifetimePts.toLocaleString(), emoji: '⭐' },
          { label: 'Sales', val: user?.total_sales || 0, emoji: '💸' },
          { label: 'Purchases', val: user?.total_purchases || 0, emoji: '🎟️' },
        ].map((s, i) => (
          <div key={i} className="flex flex-col items-center py-3 px-2" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <span className="text-sm">{s.emoji}</span>
            <span className="font-black text-base text-foreground leading-none mt-0.5">{s.val}</span>
            <span className="text-[9px] text-muted-foreground mt-0.5">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Trust score + badges */}
      {(trustScore > 50 || trustBadges.length > 0) && (
        <>
          <div className="h-px mx-5" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" style={{ color: '#00FF87' }} />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Trust Score</span>
              </div>
              <span className="font-black text-sm" style={{ color: trustScore >= 70 ? '#00FF87' : trustScore >= 50 ? '#FFE600' : '#FF2D78' }}>
                {trustScore}/100
              </span>
            </div>
            {/* Trust bar */}
            <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: trustScore >= 70 ? 'linear-gradient(90deg, #00C866, #00FF87)' : trustScore >= 50 ? 'linear-gradient(90deg, #b8a000, #FFE600)' : 'linear-gradient(90deg, #c00030, #FF2D78)' }}
                initial={{ width: 0 }}
                animate={{ width: `${trustScore}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </div>
            {/* Trust badges */}
            {trustBadges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {trustBadges.map(key => {
                  const def = TRUST_BADGE_DEFS[key];
                  if (!def) return null;
                  return (
                    <span key={key}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold"
                      style={{ background: `${def.color}15`, border: `1px solid ${def.color}40`, color: def.color }}>
                      {def.emoji} {def.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Achievements */}
      {achievements.length > 0 && (
        <>
          <div className="h-px mx-5" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="px-5 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
              <Star className="w-3 h-3 inline mr-1" />Achievements ({achievements.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {achievements.map(key => {
                const def = ACHIEVEMENT_DEFS[key];
                if (!def) return null;
                return (
                  <span key={key}
                    title={def.desc}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold cursor-default"
                    style={{ background: 'rgba(255,230,0,0.08)', border: '1px solid rgba(255,230,0,0.25)', color: '#FFE600' }}>
                    {def.emoji} {def.label}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Empty state CTA */}
      {achievements.length === 0 && currentPts === 0 && (
        <div className="px-5 pb-5">
          <p className="text-xs text-muted-foreground">
            Buy or sell tickets to start earning 🥜 Peanut Points and unlock fan ranks.
          </p>
        </div>
      )}
    </div>
  );
}