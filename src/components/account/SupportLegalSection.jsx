import '@/components/member-surfaces.css';
import { HelpCircle, FileText, ShieldCheck, Cookie, Mail, ExternalLink } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
// Icon is used dynamically via destructuring from LINKS array

const SUPPORT_LINKS = [
  {
    icon: HelpCircle,
    label: 'Help Center',
    desc: 'FAQs, guides, and how-tos',
    to: '/help',
    color: 'var(--neon-cyan)',
  },
  {
    icon: Mail,
    label: 'Contact Support',
    desc: 'Email us about any issue',
    href: 'mailto:experience@peanutgallery.store',
    color: 'var(--neon-purple)',
  },
];

const INTERNAL_LINKS = [
  { icon: FileText, label: 'Terms of Service', desc: 'How Peanut Gallery works', to: '/terms', color: 'var(--neon-orange)' },
  { icon: ShieldCheck, label: 'Privacy Policy', desc: 'How we handle your data', to: '/privacy', color: 'var(--neon-green)' },
  { icon: Cookie, label: 'Cookie Policy', desc: 'How we use cookies & storage', to: '/cookies', color: 'var(--neon-cyan)' },
];

export default function SupportLegalSection() {
  const navigate = useNavigate();
  return (
    <section className="pg-member-section">
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Support &amp; Legal</h3>
      <div className="rounded-xl overflow-hidden divide-y divide-border" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
        {SUPPORT_LINKS.map(({ icon: Icon, label, desc, href, to, color }) => {
          const Action = to ? Link : 'a';
          return (
          <Action key={label} {...(to ? { to } : { href })}
            className="flex items-center gap-3 px-4 py-3.5 transition-all active:scale-[0.98]">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `color-mix(in srgb, ${color} 9%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 22%, transparent)` }}>
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-[11px] text-muted-foreground">{desc}</p>
            </div>
            {!to && <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
          </Action>
          );
        })}
        {INTERNAL_LINKS.map(({ icon: Icon, label, desc, to, color }) => (
          <button key={label} onClick={() => navigate(to)}
            className="w-full flex items-center gap-3 px-4 py-3.5 transition-all active:scale-[0.98] text-left">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `color-mix(in srgb, ${color} 9%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 22%, transparent)` }}>
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-[11px] text-muted-foreground">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
