import { ShieldCheck } from 'lucide-react';

/**
 * Subtle inline trust badge.
 * variant: 'protected' | 'verified' | 'escrow' | 'secure'
 */
const VARIANTS = {
  protected: { icon: '🛡️', label: 'Protected Transfer', color: '#00FF87' },
  verified:  { icon: null, label: 'Seller Verified', color: '#00C8FF', IconComp: ShieldCheck },
  escrow:    { icon: '🔒', label: 'Payout held until confirmation', color: '#BF5FFF' },
  secure:    { icon: '🔒', label: 'Secure Stripe Payout', color: '#00FF87' },
  pg:        { icon: '🥜', label: 'Protected by Peanut Gallery', color: '#BF5FFF' },
};

export default function TrustBadge({ variant = 'protected', className = '' }) {
  const v = VARIANTS[variant] || VARIANTS.protected;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${className}`}
      style={{ background: `${v.color}12`, color: v.color, border: `1px solid ${v.color}28` }}
    >
      {v.IconComp
        ? <v.IconComp className="w-2.5 h-2.5" />
        : <span>{v.icon}</span>
      }
      {v.label}
    </span>
  );
}