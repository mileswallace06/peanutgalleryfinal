// Urgent summary cards at the top of the Command Center

export default function CommandSummaryBar({ purchases, listings, donations, stripeMode, onJump }) {
  const disputes = purchases.filter(p => p.transfer_status === 'disputed').length;
  const failedCaptures = purchases.filter(p => p.payment_capture_failed).length;
  const pendingTransfers = purchases.filter(p => p.transfer_status === 'pending_transfer').length;
  const aiNeedsReview = purchases.filter(p =>
    ['needs_human_review', 'rejected_suspicious', 'failed_processing'].includes(p.ai_proof_status) && !p.admin_override_status
  ).length;
  const suspicious = purchases.filter(p => p.ai_proof_status === 'rejected_suspicious' && !p.admin_override_status).length;
  const autoReview = purchases.filter(p => p.auto_review_flagged && p.transfer_status === 'pending_transfer').length;
  const staleReservations = listings.filter(l => {
    if (!l.reservation_expires_at) return false;
    return new Date(l.reservation_expires_at) < new Date() && l.status === 'active';
  }).length;
  const instantNeedsReview = listings.filter(l => l.listing_mode === 'instant' && l.custody_status === 'pending_pg_verification').length;
  const staleDonations = donations.filter(d => {
    if (d.donation_status !== 'active' && d.donation_status !== 'drawn') return false;
    if (!d.expires_at) return false;
    return new Date(d.expires_at) < new Date();
  }).length;
  const stripeMismatch = stripeMode && !stripeMode.consistent;

  const urgentCount = disputes + failedCaptures + suspicious;
  const reviewCount = aiNeedsReview + autoReview + instantNeedsReview;
  const infoCount = pendingTransfers + staleReservations + staleDonations;

  const cards = [
    {
      label: 'Urgent',
      value: urgentCount,
      detail: [disputes && `${disputes} dispute${disputes !== 1 ? 's' : ''}`, failedCaptures && `${failedCaptures} failed capture${failedCaptures !== 1 ? 's' : ''}`, suspicious && `${suspicious} suspicious`].filter(Boolean).join(' · ') || 'None',
      color: urgentCount > 0 ? '#FF2D78' : '#00FF87',
      bg: urgentCount > 0 ? 'rgba(255,45,120,0.12)' : 'rgba(0,255,135,0.08)',
      border: urgentCount > 0 ? 'rgba(255,45,120,0.4)' : 'rgba(0,255,135,0.25)',
      section: 'issues',
      emoji: urgentCount > 0 ? '🚨' : '✅',
    },
    {
      label: 'Needs Review',
      value: reviewCount,
      detail: [aiNeedsReview && `${aiNeedsReview} AI review`, autoReview && `${autoReview} inactive buyer`, instantNeedsReview && `${instantNeedsReview} instant custody`].filter(Boolean).join(' · ') || 'None',
      color: reviewCount > 0 ? '#FF8C00' : '#00FF87',
      bg: reviewCount > 0 ? 'rgba(255,140,0,0.1)' : 'rgba(0,255,135,0.08)',
      border: reviewCount > 0 ? 'rgba(255,140,0,0.35)' : 'rgba(0,255,135,0.25)',
      section: 'issues',
      emoji: reviewCount > 0 ? '⚠️' : '✅',
    },
    {
      label: 'Pending Transfers',
      value: pendingTransfers,
      detail: `${pendingTransfers} purchase${pendingTransfers !== 1 ? 's' : ''} in escrow`,
      color: pendingTransfers > 0 ? '#00C8FF' : '#888',
      bg: 'rgba(0,200,255,0.08)',
      border: 'rgba(0,200,255,0.2)',
      section: 'stripe',
      emoji: '💳',
    },
    {
      label: 'Stripe',
      value: stripeMismatch ? '⚠️' : stripeMode?.overallMode === 'live' ? '✅' : '🧪',
      detail: stripeMismatch ? 'Key mismatch!' : stripeMode?.overallMode === 'live' ? 'Live mode' : stripeMode?.overallMode === 'test' ? 'Test mode' : 'Unknown',
      color: stripeMismatch ? '#FF2D78' : stripeMode?.overallMode === 'live' ? '#00FF87' : '#FF8C00',
      bg: stripeMismatch ? 'rgba(255,45,120,0.1)' : 'rgba(255,255,255,0.04)',
      border: stripeMismatch ? 'rgba(255,45,120,0.35)' : 'rgba(255,255,255,0.1)',
      section: 'stripe',
      emoji: null,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(card => (
        <button key={card.label}
          onClick={() => onJump(card.section)}
          className="rounded-2xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: card.bg, border: `1px solid ${card.border}` }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-muted-foreground">{card.label}</span>
            {card.emoji && <span className="text-base leading-none">{card.emoji}</span>}
          </div>
          <div className="text-2xl font-black" style={{ color: card.color }}>{card.value}</div>
          <div className="text-[10px] text-muted-foreground mt-1 leading-tight">{card.detail}</div>
        </button>
      ))}
    </div>
  );
}