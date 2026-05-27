import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Trophy, Zap, Shield, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getRankForPoints, TRUST_BADGE_DEFS } from '@/lib/peanutPoints';
import { motion } from 'framer-motion';

const TABS = [
  { id: 'points',  label: '🥜 Top Fans',       sort: 'lifetime_points' },
  { id: 'sellers', label: '💸 Top Sellers',     sort: 'total_sales' },
  { id: 'instant', label: '⚡ Instant Sellers', sort: 'total_instant_listings' },
];

function MedalIcon({ rank }) {
  if (rank === 1) return <span className="text-2xl">🥇</span>;
  if (rank === 2) return <span className="text-2xl">🥈</span>;
  if (rank === 3) return <span className="text-2xl">🥉</span>;
  return <span className="text-base font-black text-muted-foreground w-7 text-center">{rank}</span>;
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
        // Filter out users with 0 value
        setUsers(data.filter(u => (u[activeTab.sort] || 0) > 0));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  const activeTab = TABS.find(t => t.id === tab);

  return (
    <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>

      {/* Back */}
      <Link to="/me" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      {/* Hero */}
      <div className="mb-7">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black mb-3"
          style={{ background: 'rgba(255,230,0,0.12)', border: '1px solid rgba(255,230,0,0.3)', color: '#FFE600' }}>
          🏆 Fan Leaderboard
        </div>
        <h1 className="font-display leading-none mb-1"
          style={{ fontSize: 'clamp(2rem, 9vw, 3rem)', background: 'linear-gradient(135deg, #FFE600, #FF8C00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Top Fans
        </h1>
        <p className="text-sm text-muted-foreground">Earn 🥜 Peanut Points to climb the ranks.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-shrink-0 px-4 py-2 rounded-full text-xs font-black transition-all"
            style={tab === t.id
              ? { background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.4)', color: '#FFE600' }
              : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }
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
          <p className="text-sm">No rankings yet — be the first!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u, i) => {
            const rank = getRankForPoints(u.lifetime_points || 0);
            const isMe = u.email === currentUser?.email;
            const val = tab === 'points'
              ? `${(u.lifetime_points || 0).toLocaleString()} pts`
              : tab === 'sellers'
              ? `${u.total_sales || 0} sales`
              : `${u.total_instant_listings || 0} instant`;

            return (
              <motion.div key={u.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl"
                style={{
                  background: isMe
                    ? 'rgba(191,95,255,0.12)'
                    : i === 0 ? 'rgba(255,230,0,0.06)'
                    : 'hsl(var(--card))',
                  border: isMe
                    ? '1px solid rgba(191,95,255,0.4)'
                    : i === 0 ? '1px solid rgba(255,230,0,0.25)'
                    : '1px solid hsl(var(--border))',
                }}>

                <div className="w-8 flex-shrink-0 flex justify-center">
                  <MedalIcon rank={i + 1} />
                </div>

                {/* Avatar */}
                <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center font-black text-sm overflow-hidden"
                  style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff' }}>
                  {u.avatar_url
                    ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                    : (u.full_name || u.email || '?')[0].toUpperCase()
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-sm text-foreground truncate">
                      {u.full_name || 'Fan'}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0"
                      style={{ background: `${rank.color}15`, color: rank.color, border: `1px solid ${rank.color}40` }}>
                      {rank.emoji} {rank.rank}
                    </span>
                    {isMe && <span className="text-[9px] font-black text-primary">You</span>}
                  </div>
                  {/* Trust badges preview */}
                  {(u.trust_badges || []).length > 0 && (
                    <div className="flex gap-1 mt-0.5">
                      {(u.trust_badges || []).slice(0, 2).map(key => {
                        const def = TRUST_BADGE_DEFS[key];
                        return def ? (
                          <span key={key} className="text-[9px]" title={def.label}>{def.emoji}</span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>

                <span className="font-black text-sm flex-shrink-0" style={{ color: i === 0 ? '#FFE600' : 'hsl(var(--foreground))' }}>
                  {val}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* My rank footer (if not in top 25) */}
      {currentUser && !loading && users.length > 0 && !users.find(u => u.email === currentUser.email) && (
        <div className="mt-6 px-4 py-3.5 rounded-2xl text-center"
          style={{ background: 'rgba(191,95,255,0.08)', border: '1px solid rgba(191,95,255,0.25)' }}>
          <p className="text-xs text-muted-foreground mb-0.5">Your rank</p>
          <p className="font-black text-sm" style={{ color: '#BF5FFF' }}>
            {currentUser.peanut_rank || 'Rookie Fan'} · {(currentUser.lifetime_points || 0).toLocaleString()} pts
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Keep earning points to climb the board!</p>
        </div>
      )}
    </div>
  );
}