/**
 * PG Brand Component Library
 * --------------------------------------------------------------------
 * Reusable design-system components for the Marketing Studio.
 * Every component renders at ACTUAL pixel sizes using a `u` (unit)
 * multiplier = canvasWidth / 1080. This ensures graphics look
 * proportional across all canvas presets and html2canvas captures
 * at full resolution.
 *
 * These mirror Peanut Gallery's onboarding design language EXACTLY:
 *   - Black Han Sans display typography
 *   - DM Sans body typography
 *   - Neon palette (green #00FF87, cyan #00C8FF, purple #BF5FFF, pink #FF2D78)
 *   - Glassmorphism, gradient text, soft glows, pill badges, large radii
 */

export const FONT_DISPLAY = "'Black Han Sans', Impact, sans-serif";
export const FONT_BODY = "'DM Sans', system-ui, sans-serif";

export const PG_COLORS = {
  green: '#00FF87',
  cyan: '#00C8FF',
  purple: '#BF5FFF',
  pink: '#FF2D78',
  yellow: '#FFE600',
  orange: '#FF8C00',
  white: '#FFFFFF',
  muted: 'rgba(255,255,255,0.55)',
  faint: 'rgba(255,255,255,0.35)',
};

const THEME_GRADIENTS = {
  dark: `
    radial-gradient(ellipse 70% 50% at 15% 0%, rgba(191,95,255,0.12), transparent 60%),
    radial-gradient(ellipse 60% 45% at 85% 10%, rgba(255,45,120,0.10), transparent 55%),
    radial-gradient(ellipse 55% 60% at 50% 100%, rgba(0,255,135,0.06), transparent 55%),
    radial-gradient(ellipse 40% 30% at 50% 50%, rgba(0,200,255,0.04), transparent 50%),
    #050308
  `,
  dark_purple: `
    radial-gradient(ellipse 80% 60% at 20% 0%, rgba(191,95,255,0.22), transparent 60%),
    radial-gradient(ellipse 60% 50% at 80% 20%, rgba(132,43,212,0.12), transparent 55%),
    radial-gradient(ellipse 50% 50% at 50% 100%, rgba(191,95,255,0.08), transparent 55%),
    #06030f
  `,
  dark_green: `
    radial-gradient(ellipse 75% 55% at 15% 5%, rgba(0,255,135,0.16), transparent 60%),
    radial-gradient(ellipse 55% 45% at 85% 15%, rgba(0,200,255,0.10), transparent 55%),
    radial-gradient(ellipse 50% 50% at 50% 100%, rgba(0,255,135,0.06), transparent 55%),
    #030806
  `,
  dark_cyan: `
    radial-gradient(ellipse 75% 55% at 15% 5%, rgba(0,200,255,0.16), transparent 60%),
    radial-gradient(ellipse 60% 50% at 85% 20%, rgba(0,255,135,0.08), transparent 55%),
    radial-gradient(ellipse 50% 50% at 50% 100%, rgba(0,200,255,0.06), transparent 55%),
    #030608
  `,
  dark_pink: `
    radial-gradient(ellipse 75% 55% at 20% 0%, rgba(255,45,120,0.18), transparent 60%),
    radial-gradient(ellipse 60% 50% at 80% 15%, rgba(191,95,255,0.12), transparent 55%),
    radial-gradient(ellipse 50% 50% at 50% 100%, rgba(255,45,120,0.06), transparent 55%),
    #0a0306
  `,
};

const BROKEN_WORDS = ['BROKEN', 'SHATTERED', 'FAILED', 'EMPTY', 'DEAD', 'CRACK', 'FRACTURE', 'SHATTER', 'DESTROY', 'RUIN'];

export function detectBrokenText(text) {
  if (!text) return false;
  const upper = text.toUpperCase();
  return BROKEN_WORDS.some(w => upper.includes(w));
}

/** Full-bleed dark background with PG's signature gradient glow layers. */
export function PGBackground({ u = 1, theme = 'dark', children, style }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: THEME_GRADIENTS[theme] || THEME_GRADIENTS.dark,
      position: 'relative', overflow: 'hidden',
      ...style,
    }}>
      {children}
    </div>
  );
}

/** Official PG logo lockup — peanut emoji in gradient circle + wordmark. */
export function PGLogo({ u = 1, size = 'md', showWordmark = true, style }) {
  const sizes = { sm: 32 * u, md: 44 * u, lg: 60 * u };
  const s = sizes[size] || sizes.md;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 * u, ...style }}>
      <div style={{
        width: s, height: s, borderRadius: '50%',
        background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: s * 0.5,
        boxShadow: `0 0 ${24 * u}px rgba(191,95,255,0.45), 0 ${4*u}px ${12*u}px rgba(0,0,0,0.4)`,
        flexShrink: 0,
      }}>🥜</div>
      {showWordmark && (
        <span style={{
          fontFamily: FONT_DISPLAY,
          fontSize: s * 0.30,
          letterSpacing: '0.04em',
          color: '#ffffff',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}>Peanut Gallery</span>
      )}
    </div>
  );
}

/** Pill badge — small uppercase label with neon tint. */
export function PGBadge({ u = 1, children, color = PG_COLORS.cyan, style }) {
  const rgb = color === PG_COLORS.cyan ? '0,200,255'
    : color === PG_COLORS.green ? '0,255,135'
    : color === PG_COLORS.purple ? '191,95,255'
    : color === PG_COLORS.pink ? '255,45,120'
    : color === PG_COLORS.yellow ? '255,230,0'
    : '0,200,255';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6 * u,
      padding: `${8 * u}px ${18 * u}px`,
      borderRadius: 999,
      fontSize: 16 * u,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      fontFamily: FONT_BODY,
      color: color,
      background: `rgba(${rgb}, 0.12)`,
      border: `1px solid rgba(${rgb}, 0.3)`,
      ...style,
    }}>{children}</span>
  );
}

/** Very large display headline with optional gradient and broken-text effect. */
export function PGHeadline({ u = 1, children, gradient = true, align = 'left', broken = false, style }) {
  const isBroken = broken || detectBrokenText(typeof children === 'string' ? children : '');
  const gradientBg = 'linear-gradient(135deg, #BF5FFF 0%, #FF2D78 50%, #FFE600 100%)';
  const brokenBg = 'linear-gradient(135deg, #BF5FFF 0%, #FF2D78 100%)';

  const text = (
    <span style={{
      fontFamily: FONT_DISPLAY,
      fontSize: 80 * u,
      lineHeight: 1.0,
      letterSpacing: '0.01em',
      textTransform: 'uppercase',
      ...(gradient ? {
        background: isBroken ? brokenBg : gradientBg,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      } : { color: '#ffffff' }),
    }}>{children}</span>
  );

  if (!isBroken) {
    return <div style={{ textAlign: align, ...style }}>{text}</div>;
  }

  // Broken text treatment: hairline crack + minimal glass fragment
  return (
    <div style={{ position: 'relative', display: 'inline-block', textAlign: align, ...style }}>
      {text}
      {/* Hairline crack */}
      <div style={{
        position: 'absolute',
        top: '12%', left: '35%',
        width: 1.5 * u, height: '76%',
        background: 'linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.5) 30%, rgba(255,255,255,0.2) 70%, transparent 100%)',
        transform: 'rotate(6deg)',
        pointerEvents: 'none',
      }} />
      {/* Small floating glass fragment */}
      <div style={{
        position: 'absolute',
        top: '18%', right: '12%',
        width: 10 * u, height: 10 * u,
        background: 'rgba(255,255,255,0.06)',
        border: `1px solid rgba(255,255,255,0.18)`,
        transform: 'rotate(22deg)',
        borderRadius: 2 * u,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '8%', left: '18%',
        width: 6 * u, height: 6 * u,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid rgba(255,255,255,0.12)`,
        transform: 'rotate(-15deg)',
        borderRadius: 1.5 * u,
        pointerEvents: 'none',
      }} />
    </div>
  );
}

/** Medium subheadline — DM Sans medium, white. */
export function PGSubheadline({ u = 1, children, align = 'left', color = '#ffffff', style }) {
  return (
    <p style={{
      fontFamily: FONT_BODY,
      fontSize: 34 * u,
      fontWeight: 500,
      lineHeight: 1.3,
      color: color,
      textAlign: align,
      margin: 0,
      ...style,
    }}>{children}</p>
  );
}

/** Body copy — DM Sans regular, muted. */
export function PGBody({ u = 1, children, align = 'left', color = PG_COLORS.muted, style }) {
  return (
    <p style={{
      fontFamily: FONT_BODY,
      fontSize: 24 * u,
      fontWeight: 400,
      lineHeight: 1.55,
      color: color,
      textAlign: align,
      margin: 0,
      ...style,
    }}>{children}</p>
  );
}

/** Gradient pill CTA button. */
export function PGCTA({ u = 1, children, style }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8 * u,
      padding: `${18 * u}px ${40 * u}px`,
      borderRadius: 999,
      fontFamily: FONT_BODY,
      fontSize: 26 * u,
      fontWeight: 700,
      color: '#0D0B14',
      background: 'linear-gradient(135deg, #00C8FF, #00FF87)',
      boxShadow: `0 0 ${28 * u}px rgba(0,200,255,0.3), 0 ${4*u}px ${16*u}px rgba(0,0,0,0.3)`,
      ...style,
    }}>{children}</div>
  );
}

/** Glassmorphism card. */
export function PGGlassCard({ u = 1, children, style }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)',
      backdropFilter: 'blur(20px)',
      border: `1px solid rgba(255,255,255,0.12)`,
      borderRadius: 24 * u,
      padding: 36 * u,
      ...style,
    }}>{children}</div>
  );
}

/** Screenshot frame — device-like glass border around an image. */
export function PGScreenshotFrame({ u = 1, src, style }) {
  if (!src) return null;
  return (
    <div style={{
      borderRadius: 20 * u,
      overflow: 'hidden',
      border: `1px solid rgba(255,255,255,0.15)`,
      boxShadow: `0 ${8*u}px ${40*u}px rgba(0,0,0,0.5), 0 0 ${24*u}px rgba(191,95,255,0.12)`,
      ...style,
    }}>
      <img src={src} alt="" crossOrigin="anonymous" style={{ display: 'block', width: '100%', height: 'auto' }} />
    </div>
  );
}

/** Divider — thin gradient line. */
export function PGDivider({ u = 1, style }) {
  return (
    <div style={{
      height: 1.5 * u,
      background: 'linear-gradient(90deg, transparent, rgba(191,95,255,0.4), rgba(255,45,120,0.3), transparent)',
      ...style,
    }} />
  );
}

/** Soft radial glow accent — positioned absolutely. */
export function PGGlow({ u = 1, color = '191,95,255', size = 300, style }) {
  return (
    <div style={{
      position: 'absolute',
      width: size * u, height: size * u,
      borderRadius: '50%',
      background: `radial-gradient(circle, rgba(${color},0.18) 0%, transparent 70%)`,
      pointerEvents: 'none',
      ...style,
    }} />
  );
}

/** Large statistic block — huge number + label + tiny explanation. */
export function PGStatBlock({ u = 1, number, label, explanation, style }) {
  return (
    <div style={{ ...style }}>
      <div style={{
        fontFamily: FONT_DISPLAY,
        fontSize: 140 * u,
        lineHeight: 0.9,
        background: 'linear-gradient(135deg, #00FF87, #00C8FF)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}>{number}</div>
      {label && (
        <p style={{
          fontFamily: FONT_BODY, fontSize: 36 * u, fontWeight: 700,
          color: '#ffffff', marginTop: 12 * u, margin: 0,
        }}>{label}</p>
      )}
      {explanation && (
        <p style={{
          fontFamily: FONT_BODY, fontSize: 20 * u, fontWeight: 400,
          color: PG_COLORS.muted, marginTop: 8 * u, margin: 0,
        }}>{explanation}</p>
      )}
    </div>
  );
}