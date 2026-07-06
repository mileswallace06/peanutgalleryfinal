/**
 * Brand Assets — PG brand reference page.
 * Shows the official Peanut Gallery design system: colors, gradients,
 * logo, typography, and spacing.
 *
 * Improvements:
 *   - Shared UI primitives
 *   - Better color swatch grid (responsive)
 *   - Gradient preview as actual CSS
 */
import { useNavigate, Navigate } from 'react-router-dom';
import { ArrowLeft, Copy, Check } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { NEON, NEON_RGB, GRADIENTS, FONTS, PG_LOGO_URL, TEXT } from '@/lib/marketingTokens';
import { SectionLabel, LoadingSpinner } from '@/components/marketing/shared/UiPrimitives';
import { useAuth } from '@/lib/AuthContext';
import { isAdmin } from '@/lib/isAdmin';

function CopyableSwatch({ name, value, type = 'color' }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = () => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };
  const isGradient = type === 'gradient';
  return (
    <button onClick={handleCopy}
      className="flex flex-col items-center gap-2 p-3 rounded-2xl transition-all active:scale-95"
      style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
      <div
        className={isGradient ? 'w-full h-12 rounded-xl' : 'w-12 h-12 rounded-xl'}
        style={isGradient ? { background: value } : { background: value, boxShadow: `0 0 16px ${value}40` }}
      />
      <div className="text-center">
        <p className="text-[10px] font-bold text-foreground capitalize">{name}</p>
        <p className="text-[9px] text-muted-foreground font-mono">{value.length > 30 ? value.slice(0, 28) + '...' : value}</p>
      </div>
      {copied
        ? <Check className="w-3 h-3" style={{ color: NEON.green }} />
        : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

export default function MarketingBrandAssets() {
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();

  if (isLoadingAuth) return <LoadingSpinner />;
  if (!user || !isAdmin(user)) return <Navigate to="/events" replace />;

  return (
    <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg min-h-full"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>

      <button onClick={() => navigate('/marketing-studio')}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Studio
      </button>

      {/* Hero */}
      <div className="mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black mb-4"
          style={{ background: `rgba(${NEON_RGB.purple}, 0.12)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.3)`, color: NEON.purple }}>
          🎨 Brand Reference
        </div>
        <h1 className="font-display leading-none mb-3"
          style={{
            fontSize: 'clamp(2.4rem, 10vw, 3.5rem)',
            background: GRADIENTS.brand,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
          Brand<br />Assets
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
          The official Peanut Gallery design system. Every Marketing Studio graphic uses these exact values. Tap any color or gradient to copy.
        </p>
      </div>

      {/* Logo */}
      <div className="mb-10">
        <SectionLabel color={NEON.green}>Official Logo</SectionLabel>
        <div className="rounded-2xl p-6 flex flex-col items-center gap-4"
          style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          <img src={PG_LOGO_URL} alt="Peanut Gallery Logo" className="h-16 w-auto rounded-2xl" />
          <div className="text-center">
            <p className="font-display text-2xl" style={{
              background: GRADIENTS.brand,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>peanut</p>
            <p className="text-[10px] font-black tracking-[0.3em] text-muted-foreground">GALLERY</p>
          </div>
        </div>
      </div>

      {/* Colors */}
      <div className="mb-10">
        <SectionLabel color={NEON.cyan}>Neon Palette</SectionLabel>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(NEON).map(([name, hex]) => (
            <CopyableSwatch key={name} name={name} value={hex} type="color" />
          ))}
        </div>
      </div>

      {/* Gradients */}
      <div className="mb-10">
        <SectionLabel color={NEON.pink}>Gradients</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(GRADIENTS).map(([name, gradient]) => (
            <CopyableSwatch key={name} name={name} value={gradient} type="gradient" />
          ))}
        </div>
      </div>

      {/* Typography */}
      <div className="mb-10">
        <SectionLabel color={NEON.yellow}>Typography</SectionLabel>
        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-2">Display Font</p>
            <p className="font-display text-3xl text-foreground mb-1">Black Han Sans</p>
            <p className="text-xs text-muted-foreground">Used for all headlines, logo text, and display elements. Always uppercase.</p>
            <p className="text-[10px] text-muted-foreground mt-2 font-mono">{FONTS.display}</p>
          </div>
          <div className="rounded-2xl p-5" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-2">Body Font</p>
            <p className="text-xl font-bold text-foreground mb-1" style={{ fontFamily: FONTS.body }}>DM Sans</p>
            <p className="text-xs text-muted-foreground">Used for all body copy, subheadlines, badges, and UI text.</p>
            <p className="text-[10px] text-muted-foreground mt-2 font-mono">{FONTS.body}</p>
          </div>
        </div>
      </div>

      {/* Design Rules */}
      <div className="mb-10 rounded-2xl p-5"
        style={{ background: `rgba(${NEON_RGB.green}, 0.06)`, border: `1px solid rgba(${NEON_RGB.green}, 0.2)` }}>
        <SectionLabel color={NEON.green}>Design Rules</SectionLabel>
        <div className="space-y-2">
          {[
            'Always use Black Han Sans for headlines — never substitute fonts',
            'Always use the official PG logo — never generate or substitute logos',
            'Always use the neon palette — never invent new colors',
            'Headlines are large, uppercase, with tight leading',
            'Backgrounds are dark, elegant, minimal — never busy or textured',
            'Pills use rgba(NEON, 0.12) background with rgba(NEON, 0.35) border',
            'CTAs use gradient backgrounds with dark text (#0D0B14)',
            'Every graphic includes the PG logo footer + @peanutgallery handle',
          ].map((rule, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span style={{ color: NEON.green, fontWeight: 900 }}>✓</span>
              <span>{rule}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}