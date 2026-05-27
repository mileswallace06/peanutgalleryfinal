import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Zap } from 'lucide-react';

const ACTION_META = {
  purchase:                  { emoji: '🎟️', label: 'Bought tickets' },
  first_purchase:            { emoji: '🌟', label: 'First purchase bonus' },
  sale_completed:            { emoji: '💸', label: 'Sale completed' },
  instant_listing_verified:  { emoji: '⚡', label: 'Instant listing verified' },
  quick_buyer_confirm:       { emoji: '⚡', label: 'Quick confirm bonus' },
  quick_seller_fulfill:      { emoji: '🚀', label: 'Fast fulfillment bonus' },
  referral_success:          { emoji: '🔗', label: 'Referral bonus' },
  live_event_activity:       { emoji: '🎶', label: 'Live event activity' },
  feedback_left:             { emoji: '📝', label: 'Feedback left' },
  achievement_unlock:        { emoji: '🏆', label: 'Achievement unlocked' },
  dispute_penalty:           { emoji: '⚠️', label: 'Dispute penalty' },
  trust_bonus:               { emoji: '🛡️', label: 'Trust milestone' },
};

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function RecentPointsActivity({ userEmail }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userEmail) return;
    base44.entities.PointsActivity.filter({ user_email: userEmail }, '-created_date', 10)
      .then(setActivities)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userEmail]);

  if (loading) return (
    <div className="flex justify-center py-4">
      <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (activities.length === 0) return (
    <p className="text-xs text-muted-foreground px-1 py-2">
      No point activity yet. Buy or sell tickets to start earning 🥜 Peanut Points!
    </p>
  );

  return (
    <div className="space-y-2">
      {activities.map(a => {
        const meta = ACTION_META[a.action] || { emoji: '🥜', label: a.action };
        const isNeg = a.points < 0;
        return (
          <div key={a.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <span className="text-lg w-7 text-center flex-shrink-0">{meta.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{a.description || meta.label}</p>
              <p className="text-[10px] text-muted-foreground">{timeAgo(a.created_date)}</p>
            </div>
            <span className="font-black text-sm flex-shrink-0"
              style={{ color: isNeg ? '#FF2D78' : '#00FF87' }}>
              {isNeg ? '' : '+'}{a.points} pts
            </span>
          </div>
        );
      })}
    </div>
  );
}