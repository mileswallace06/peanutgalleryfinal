/**
 * AIVerificationStatus — shows AI proof verification status to seller/buyer.
 * Buyer sees simplified human-readable status only (no raw scores).
 * Seller sees a bit more context.
 */

import { Brain, CheckCircle, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';

const SELLER_STATUS_MAP = {
  pending:                    { label: 'Proof queued for AI review',   color: '#888',    bg: 'rgba(255,255,255,0.05)', icon: Clock, pulse: false },
  processing:                 { label: 'AI reviewing screenshot…',     color: '#BF5FFF', bg: 'rgba(191,95,255,0.08)', icon: Brain, pulse: true },
  verified_high_confidence:   { label: 'Transfer verified ✓',          color: '#00FF87', bg: 'rgba(0,255,135,0.08)',  icon: ShieldCheck, pulse: false },
  verified_medium_confidence: { label: 'Transfer looks valid',         color: '#00C8FF', bg: 'rgba(0,200,255,0.08)',  icon: ShieldCheck, pulse: false },
  needs_human_review:         { label: 'Additional review in progress',color: '#FF8C00', bg: 'rgba(255,140,0,0.08)',  icon: Clock, pulse: true },
  rejected_suspicious:        { label: 'Proof flagged — support reviewing', color: '#FF2D78', bg: 'rgba(255,45,120,0.08)', icon: AlertTriangle, pulse: false },
  failed_processing:          { label: 'AI review failed — manual review queued', color: '#FFE600', bg: 'rgba(255,230,0,0.08)', icon: AlertTriangle, pulse: false },
};

// Buyer only ever sees these 3 simplified states
function getBuyerStatus(purchase) {
  const s = purchase.ai_proof_status;
  if (!s || s === 'pending' || s === 'processing') return null; // don't show anything yet
  if (s === 'verified_high_confidence' || s === 'verified_medium_confidence') {
    return { label: 'Verified Transfer', color: '#00FF87', icon: ShieldCheck };
  }
  if (s === 'needs_human_review' || s === 'failed_processing') {
    return { label: 'Transfer Under Review', color: '#FF8C00', icon: Clock };
  }
  if (s === 'rejected_suspicious') {
    return { label: 'Transfer Under Review', color: '#FF8C00', icon: Clock }; // buyer sees generic state
  }
  return null;
}

export default function AIVerificationStatus({ purchase, role = 'seller' }) {
  if (!purchase.ai_proof_status || purchase.ai_proof_status === 'pending') return null;

  if (role === 'buyer') {
    const buyerStatus = getBuyerStatus(purchase);
    if (!buyerStatus) return null;
    const BuyerIcon = buyerStatus.icon;
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
        style={{ background: `${buyerStatus.color}12`, border: `1px solid ${buyerStatus.color}30`, color: buyerStatus.color }}>
        <BuyerIcon className="w-3 h-3 flex-shrink-0" />
        {buyerStatus.label}
      </div>
    );
  }

  // Seller view
  const cfg = SELLER_STATUS_MAP[purchase.ai_proof_status];
  if (!cfg) return null;
  const StatusIcon = cfg.icon;

  return (
    <div className="rounded-xl px-3 py-2.5 space-y-1" style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}>
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: cfg.color }}>
        <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${cfg.pulse ? 'animate-pulse' : ''}`} />
        {cfg.label}
      </div>
      {purchase.ai_review_notes && purchase.ai_proof_status !== 'verified_high_confidence' && (
        <p className="text-xs text-muted-foreground leading-relaxed">{purchase.ai_review_notes}</p>
      )}
      {purchase.admin_override_status && (
        <div className="text-xs text-muted-foreground mt-1">
          Admin reviewed: <span className="font-semibold text-foreground">{purchase.admin_override_status}</span>
        </div>
      )}
    </div>
  );
}