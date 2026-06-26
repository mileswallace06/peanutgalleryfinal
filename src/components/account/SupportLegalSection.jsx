import { HelpCircle, FileText, ShieldCheck, Cookie, Mail, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
// Icon is used dynamically via destructuring from LINKS array

const EXTERNAL_LINKS = [
  {
    icon: HelpCircle,
    label: 'Help Center',
    desc: 'FAQs, guides, and how-tos',
    href: 'mailto:experience@peanutgallery.store?subject=Help Request',
    color: '#00C8FF',
  },
  {
    icon: Mail,
    label: 'Contact Support',
    desc: 'Email us about any issue',
    href: 'mailto:experience@peanutgallery.store',
    color: '#BF5FFF',
  },
];

const INTERNAL_LINKS = [
  { icon: FileText, label: 'Terms of Service', desc: 'How Peanut Gallery works', to: '/terms', color: '#FF8C00' },
  { icon: ShieldCheck, label: 'Privacy Policy', desc: 'How we handle your data', to: '/privacy', color: '#00FF87' },
  { icon: Cookie, label: 'Cookie Policy', desc: 'How we use cookies & storage', to: '/cookies', color: '#00C8FF' },
];

export default function SupportLegalSection() {
  const navigate = useNavigate();
  return (
    <section>
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Support &amp; Legal</h3>
      <div className="rounded-2xl overflow-hidden divide-y divide-border" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        {EXTERNAL_LINKS.map(({ icon: Icon, label, desc, href, color }) => (
          <a key={label} href={href} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 transition-all active:scale-[0.98]">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${color}18`, border: `1px solid ${color}33` }}>
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-[11px] text-muted-foreground">{desc}</p>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          </a>
        ))}
        {INTERNAL_LINKS.map(({ icon: Icon, label, desc, to, color }) => (
          <button key={label} onClick={() => navigate(to)}
            className="w-full flex items-center gap-3 px-4 py-3.5 transition-all active:scale-[0.98] text-left">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${color}18`, border: `1px solid ${color}33` }}>
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