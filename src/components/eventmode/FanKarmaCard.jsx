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

  if (loading) return <div className="pg-seat-offer-skeleton animate-pulse" aria-label="Loading Fan Karma" />;

  return (
    <section className="pg-karma-panel">
      <header className="pg-karma-heading"><Trophy size={22} /><h2 className="pg-section-title">Fan Karma</h2>
        {myPoints !== null && myPoints > 0 && <span>+{myPoints} pts tonight</span>}
      </header>
      {loadError ? <div role="alert" className="pg-state"><p>Fan Karma couldn’t load.</p><button onClick={() => setReload(value => value + 1)} className="pg-action">Try again</button></div>
        : leaders.length === 0 ? <div className="pg-state"><p>No Flash Drops yet tonight. Be the first to donate.</p></div>
        : <div className="pg-ticket pg-karma-ticket">{leaders.map((donor, i) => <div key={i} className="pg-karma-leader">
          <span className="pg-karma-rank">{String(i + 1).padStart(2, '0')}</span><strong>{donor.name}</strong><span>{donor.drops} drop{donor.drops !== 1 ? 's' : ''}</span>
        </div>)}</div>}
      <div className="pg-karma-points">
        <div><strong>+100</strong><span>Flash Drop</span></div>
        <div><strong>+250</strong><span>Lower Bowl</span></div>
        <div><strong>+500</strong><span>Premium</span></div>
      </div>
    </section>
  );
}
