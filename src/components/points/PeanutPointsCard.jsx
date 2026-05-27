import { useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Star, ChevronRight, Shield, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  RANKS,
  getRankForPoints,
  getNextRank,
  getLevelProgress,
  getTrustLabel,
  getTrustColor,
  TRUST_BADGE_DEFS,
  ACHIEVEMENT_DEFS,
  RANK_UNLOCKS,
} from '@/lib/peanutPoints';

function ProgressBar({ value, color }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${color}80, ${color})` }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(value * 100)}%` }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
    </div>
  );
}

function TrustBar({ score }) {
  const color = getTrustColor(score);
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${color}80, ${color})` }}
        initial={{ width: 0 }}
        animate={{ width: `${score}%` }}
        transition={{ duration: 1, ease: 'easeOut' }}
      />
    </div>
  );
}

export default function PeanutPointsCard({ user }) {
  const [showUnlocks, setShowUnlocks] = useState(false);

  const lifetimePts  = user?.lifetime_points || 0;
  const currentPts   = user?.peanut_points   || 0;
  const currentRank  = getRankForPoints(lifetimePts);
  const nextRank     = getNextRank(lifetimePts);
  const progress     = getLevelProgress(lifetimePts);
  const achievements = user?.achievements || [];
  const trustBadges  = user?.trust_badges  || [];
  const trustScore   = user?.trust_score   || 50;
  const trustLabel   = getTrustLabel(trustScore);
  const trustColor   = getTrustColor(trustScore);
  const ptsToNext    = nextRank ? nextRank.min - lifetimePts : 0;
  const nextUnlocks  = nextRank ? (RANK_UNLOCKS[nextRank.level] || []) : [];

  const isEmpty = achievements.length === 0 && currentPts === 0 && lifetimePts === 0;

  return (
    <div className="rounded-2xl overflow-hidden mb-5"
      style={{
        background: 'linear-gradient(135deg, rgba(191,95,255,0.12) 0%, rgba(0,200,255,0.08) 100%)',
        border: '1px solid rgba(191,95,255,0.3)',
      }}>

      {/* ── Header: rank + leaderboard link */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-3xl">{currentRank.emoji}</span>
            <div>
              <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Fan Rank</p>
              <p className="font-display text-xl leading-none" style={{ color: currentRank.color }}>
                {currentRank.rank}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Level {currentRank.level}</p>
            </div>
          </div>
          <Link to="/leaderboard"
            className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors mt-1">
            <Trophy className="w-3 h-3" /> Leaderboard <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Points display */}
        <div className="flex items-baseline gap-1.5 mb-3">
          <span className="font-display text-4xl leading-none" style={{ color: currentRank.color }}>
            {currentPts.toLocaleString()}
          </span>
          <span className="text-sm font-bold text-muted-foreground">🥜 pts</span>
          {lifetimePts !== currentPts && (
            <span className="text-[10px] text-muted-foreground ml-1">({lifetimePts.toLocaleString()} lifetime)</span>
          )}
        </div>

        {/* Progress to next rank */}
        {nextRank ? (
          <>
            <ProgressBar value={progress} color={currentRank.color} />
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-muted-foreground">Lv.{currentRank.level}</span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">
                  {ptsToNext.toLocaleString()} pts to <span style={{ color: nextRank.color }}>{nextRank.rank}</span>
                </span>
                {nextUnlocks.length > 0 && (
                  <button onClick={() => setShowUnlocks(v => !v)} className="text-muted-foreground hover:text-foreground">
                    <Info className="w-3 h-3" />
                  </button>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground">Lv.{nextRank.level}</span>
            </div>
            {showUnlocks && nextUnlocks.length > 0 && (
              <div className="mt-2 px-3 py-2 rounded-xl text-[10px] text-muted-foreground"
                style={{ background: `${nextRank.color}10`, border: `1px solid ${nextRank.color}25` }}>
                <span className="font-bold" style={{ color: nextRank.color }}>Unlocks at {nextRank.rank}: </span>
                {nextUnlocks.join(' · ')}
              </div>
            )}
          </>
        ) : (
          <div className="text-[11px] font-bold mt-1" style={{ color: '#FFE600' }}>
            🏆 Hall of Fame — Max Rank Achieved
          </div>
        )}
      </div>

      {/* ── Stats row */}
      <div className="h-px mx-5" style={{ background: 'rgba(255,255,255,0.08)' }} />
      <div className="grid grid-cols-3 divide-x" style={{ '--tw-divide-opacity': 1 }}>
        {[
          { label: 'Sales',     val: user?.total_sales     || 0, emoji: '💸' },
          { label: 'Purchases', val: user?.total_purchases  || 0, emoji: '🎟️' },
          { label: 'Instant',   val: user?.total_instant_listings || 0, emoji: '⚡' },
        ].map((s, i) => (
          <div key={i} className="flex flex-col items-center py-3 px-2"
            style={{ borderColor: 'rgba(255,255,255,0.08)', borderRightWidth: i < 2 ? '1px' : '0' }}>
            <span className="text-sm">{s.emoji}</span>
            <span className="font-black text-base text-foreground leading-none mt-0.5">{s.val}</span>
            <span className="text-[9px] text-muted-foreground mt-0.5">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Trust score */}
      <div className="h-px mx-5" style={{ background: 'rgba(255,255,255,0.08)' }} />
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" style={{ color: trustColor }} />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Trust Score</span>
          </div>
          <div className="text-right">
            <span className="font-black text-sm" style={{ color: trustColor }}>{trustScore}/100</span>
            <span className="text-[9px] text-muted-foreground ml-1.5">{trustLabel}</span>
          </div>
        </div>
        <TrustBar score={trustScore} />

        {/* Trust badges */}
        {trustBadges.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {trustBadges.map(key => {
              const def = TRUST_BADGE_DEFS[key];
              if (!def) return null;
              return (
                <span key={key} title={def.desc}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold cursor-default"
                  style={{ background: `${def.color}15`, border: `1px solid ${def.color}40`, color: def.color }}>
                  {def.emoji} {def.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Achievements */}
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
                  <span key={key} title={def.desc}
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

      {/* ── Empty state */}
      {isEmpty && (
        <div className="px-5 pb-5">
          <p className="text-xs text-muted-foreground">
            Buy or sell tickets to start earning 🥜 Peanut Points and unlock fan ranks.
          </p>
        </div>
      )}
    </div>
  );
}