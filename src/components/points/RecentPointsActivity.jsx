import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const ACTION_META = {
  // Setup
  profile_completed:           { emoji: '👤', label: 'Profile completed' },
  stripe_connected:            { emoji: '🏦', label: 'Stripe payouts connected' },

  // One-time bonuses
  first_purchase:              { emoji: '🌟', label: 'First purchase bonus' },
  first_sale:                  { emoji: '🌟', label: 'First sale bonus' },
  first_instant_listing:       { emoji: '🌟', label: 'First Instant Listing bonus' },

  // Marketplace
  purchase:                    { emoji: '🎟️', label: 'Ticket purchase' },
  sale_completed:              { emoji: '💸', label: 'Sale completed' },
  instant_listing_verified:    { emoji: '⚡', label: 'Instant Listing verified' },
  instant_listing_sold:        { emoji: '⚡', label: 'Instant Listing sold' },
  live_upgrade_purchase:       { emoji: '📈', label: 'Live upgrade bought' },
  live_upgrade_sale:           { emoji: '📈', label: 'Live upgrade sold' },

  // Speed
  seller_transfer_15min:       { emoji: '🚀', label: 'Lightning transfer (15 min)' },
  seller_transfer_1hr:         { emoji: '⚡', label: 'Fast transfer (1 hr)' },
  buyer_confirm_15min:         { emoji: '🚀', label: 'Quick confirm (15 min)' },
  buyer_confirm_1hr:           { emoji: '⚡', label: 'Fast confirm (1 hr)' },
  instant_fulfillment_clean:   { emoji: '✅', label: 'PG instant fulfillment' },

  // Community
  feedback_left:               { emoji: '📝', label: 'Helpful feedback' },
  fan_zone_post:               { emoji: '📸', label: 'Fan Zone post' },
  beta_bug_report:             { emoji: '🐛', label: 'Bug report (verified)' },
  critical_bug_report:         { emoji: '🐛', label: 'Critical bug report' },

  // Referrals
  referral_signup:             { emoji: '🔗', label: 'Referral signed up' },
  referral_first_transaction:  { emoji: '🔗', label: 'Referral first transaction' },
  referral_verified_seller:    { emoji: '🔗', label: 'Referral became seller' },

  // Penalties
  failed_transfer:             { emoji: '⚠️', label: 'Failed transfer' },
  confirmed_fraud:             { emoji: '🚫', label: 'Fraud confirmed' },
  seller_dispute:              { emoji: '⚠️', label: 'Seller dispute' },
  repeated_cancellation:       { emoji: '⚠️', label: 'Repeated cancellation' },
  abusive_behavior:            { emoji: '🚫', label: 'Abusive behavior' },

  // Special
  achievement_unlock:          { emoji: '🏆', label: 'Achievement unlocked' },
  trust_bonus:                 { emoji: '🛡️', label: 'Trust milestone' },
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