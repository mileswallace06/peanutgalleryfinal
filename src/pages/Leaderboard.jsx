import { PageIntro } from '@/components/ClarityUI';
import '@/components/member-surfaces.css';
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { getRankForPoints, TRUST_BADGE_DEFS, getTrustColor } from '@/lib/peanutPoints';
import { motion } from 'framer-motion';

const TABS = [
  { id: 'points',   label: '🥜 Top Fans',            sort: 'lifetime_points',        valFn: u => `${(u.lifetime_points || 0).toLocaleString()} pts` },
  { id: 'sellers',  label: '💸 Trusted Sellers',      sort: 'total_sales',            valFn: u => `${u.total_sales || 0} sales` },
  { id: 'instant',  label: '⚡ Instant Pros',          sort: 'total_instant_listings', valFn: u => `${u.total_instant_listings || 0} instant` },
  { id: 'upgrades', label: '📈 Live Upgrade Regulars', sort: 'total_live_upgrades',    valFn: u => `${u.total_live_upgrades || 0} upgrades` },
];

function MedalIcon({ rank }) {
  if (rank === 1) return <span className="text-2xl">🥇</span>;
  if (rank === 2) return <span className="text-2xl">🥈</span>;
  if (rank === 3) return <span className="text-2xl">🥉</span>;
  return <span className="text-sm font-black text-muted-foreground w-7 text-center tabular-nums">{rank}</span>;
}

export default function Leaderboard() {
  const [tab, setTab] = useState('points');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const activeTab = TABS.find(t => t.id === tab);
    base44.entities.User.list(`-${activeTab.sort}`, 25)
      .then(data => {
        // Exclude: zero value, admins on test data, confirmed fraud
        setUsers(data.filter(u =>
          (u[activeTab.sort] || 0) > 0 &&
          (u.confirmed_fraud_count || 0) === 0
        ));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  const activeTab = TABS.find(t => t.id === tab);

  return (
    <div className="pg-secondary-page pg-guide-page pg-guide-leaderboard">
      <PageIntro backTo="/me" backLabel="Back" eyebrow="🏆 Fan Leaderboard"
        title="Top Fans"
        description="Earn 🥜 Peanut Points through real marketplace activity." />

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="pg-leaderboard-tab flex-shrink-0 px-4 py-2 text-xs font-black transition-all"
            style={tab === t.id
              ? { background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.4)', color: 'var(--neon-yellow)' }
              : { background: 'var(--pg-surface)', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }
            }>
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-5xl mb-3">🥜</div>
          <p className="text-sm font-semibold text-foreground mb-1">No rankings yet — be the first!</p>
          {/* UX-7: Contextual CTAs per leaderboard tab */}
          {tab === 'points' && <Link to="/events" className="text-xs text-primary underline mt-2 inline-block">Browse Events →</Link>}
          {tab === 'sellers' && <Link to="/create-listing" className="text-xs text-primary underline mt-2 inline-block">Create a Listing →</Link>}
          {tab === 'instant' && <Link to="/instant-listings" className="text-xs text-primary underline mt-2 inline-block">Learn about Instant Listings →</Link>}
          {tab === 'upgrades' && <Link to="/upgrades" className="text-xs text-primary underline mt-2 inline-block">Find Live Events →</Link>}
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u, i) => {
            const rankTier = getRankForPoints(u.lifetime_points || 0);
            const isMe    = u.email === currentUser?.email;
            const isHof   = (u.lifetime_points || 0) >= 9200;
            const val     = activeTab.valFn(u);
            const trustScore = u.trust_score || 50;
            const trustClr  = getTrustColor(trustScore);

            return (
              <motion.div key={u.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="pg-leaderboard-row flex items-center gap-3 px-4 py-3.5 rounded-2xl"
                style={{
                  background: isHof  ? 'rgba(255,230,0,0.08)'
                    : isMe           ? 'rgba(191,95,255,0.12)'
                    : i === 0        ? 'rgba(255,230,0,0.05)'
                    : 'var(--pg-surface)',
                  border: isHof  ? '1px solid rgba(255,230,0,0.35)'
                    : isMe       ? '1px solid rgba(191,95,255,0.4)'
                    : i === 0    ? '1px solid rgba(255,230,0,0.2)'
                    : '1px solid hsl(var(--border))',
                }}>

                {/* Rank number */}
                <div className="w-8 flex-shrink-0 flex justify-center">
                  <MedalIcon rank={i + 1} />
                </div>

                {/* Avatar */}
                <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center font-black text-sm overflow-hidden"
                  style={{ background: 'var(--pg-violet)', color: 'var(--pg-ink)' }}>
                  {u.avatar_url
                    ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                    : (u.full_name || '?')[0].toUpperCase()
                  }
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-sm text-foreground truncate">
                      {u.full_name || 'Fan'}
                    </span>
                    {isHof && <span className="text-[10px]">🏆</span>}
                    <span className="pg-leaderboard-ink text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0"
                      style={{ '--rank-color': rankTier.color, background: `${rankTier.color}15`, border: `1px solid ${rankTier.color}40` }}>
                      {rankTier.emoji} {rankTier.rank}
                    </span>
                    {isMe && <span className="text-[9px] font-black text-primary">You</span>}
                  </div>

                  {/* Trust badges (first 3) + trust score */}
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    {(u.trust_badges || []).slice(0, 3).map(key => {
                      const def = TRUST_BADGE_DEFS[key];
                      return def ? (
                        <span key={key} className="text-[9px]" title={def.label}>{def.emoji}</span>
                      ) : null;
                    })}
                    <span className="pg-leaderboard-ink text-[9px] font-bold" style={{ '--rank-color': trustClr }}>
                      ⬡ {trustScore}
                    </span>
                  </div>
                </div>

                {/* Value */}
                <span className="pg-leaderboard-ink font-black text-sm flex-shrink-0"
                  style={{ '--rank-color': isHof ? '#FFE600' : i === 0 ? '#FFE600' : 'hsl(var(--foreground))' }}>
                  {val}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* My rank footer (if not in top 25) */}
      {currentUser && !loading && !users.find(u => u.email === currentUser.email) && (
        <div className="mt-6 px-4 py-3.5 rounded-2xl text-center"
          style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.25)' }}>
          <p className="text-xs text-muted-foreground mb-0.5">Your rank</p>
          <p className="font-black text-sm" style={{ color: 'var(--neon-purple)' }}>
            {currentUser.peanut_rank || 'Rookie Fan'} · {(currentUser.lifetime_points || 0).toLocaleString()} pts
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Earn more points through real marketplace activity to climb the board.</p>
        </div>
      )}
    </div>
  );
}