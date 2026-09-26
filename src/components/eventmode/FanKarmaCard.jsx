/**
 * FanKarmaCard — shows the user's Fan Karma / points earned tonight,
 * plus a mini leaderboard of top donors for this event.
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Trophy } from 'lucide-react';
import { loadFanGifts } from '@/lib/fanGiftRead';

export default function FanKarmaCard({ eventId, user }) {
  const [myPoints, setMyPoints] = useState(null);
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      user?.email
        ? base44.entities.PointsActivity.filter({ user_email: user.email, reference_id: eventId }).catch(() => [])
        : Promise.resolve([]),
      loadFanGifts(eventId),
    ]).then(([points, view]) => {
      if (cancelled) return;
      const earned = points.reduce((s, p) => s + (p.points || 0), 0);
      setMyPoints(earned);

      // Grouping happens on the server; member responses contain no donor keys.
      setLeaders(view.leaders);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [eventId, user?.email, reload]);

  if (loading) return <div className="h-24 rounded-2xl animate-pulse bg-muted" />;

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(255,230,0,0.05)', border: '1px solid rgba(255,230,0,0.2)' }}>
      <div className="h-0.5" style={{ background: 'linear-gradient(90deg, #FFE600, #FF8C00, #BF5FFF)' }} />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-4 h-4" style={{ color: '#FFE600' }} />
          <h3 className="font-black text-sm text-foreground uppercase tracking-wide">Fan Karma</h3>
          {myPoints !== null && myPoints > 0 && (
            <span className="ml-auto text-xs font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,230,0,0.15)', color: '#FFE600' }}>
              +{myPoints} pts tonight
            </span>
          )}
        </div>

        {loadError ? (
          <div role="alert" className="text-xs text-muted-foreground space-y-2">
            <p>Fan Karma couldn’t load.</p>
            <button onClick={() => setReload(value => value + 1)} className="font-semibold underline">Try again</button>
          </div>
        ) : leaders.length === 0 ? (
          <p className="text-xs text-muted-foreground">No Flash Drops yet tonight. Be the first to donate! 🎁</p>
        ) : (
          <div className="space-y-1.5">
            {leaders.map((donor, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-base w-5 text-center">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                </span>
                <span className="flex-1 text-xs font-semibold text-foreground truncate">{donor.name}</span>
                <span className="text-xs text-muted-foreground">{donor.drops} drop{donor.drops !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 pt-2 border-t grid grid-cols-3 gap-1 text-center text-[10px]"
          style={{ borderColor: 'rgba(255,230,0,0.15)' }}>
          <div><p className="font-black text-sm" style={{ color: '#FFE600' }}>+100</p><p className="text-muted-foreground">Flash Drop</p></div>
          <div><p className="font-black text-sm" style={{ color: '#FF8C00' }}>+250</p><p className="text-muted-foreground">Lower Bowl</p></div>
          <div><p className="font-black text-sm" style={{ color: '#BF5FFF' }}>+500</p><p className="text-muted-foreground">Premium</p></div>
        </div>
      </div>
    </div>
  );
}
