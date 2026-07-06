/**
 * Canvas Primitives
 * --------------------------------------------------------------------
 * Inline-style components for the export canvas (html2canvas).
 * These use the EXACT same design tokens as the rest of Peanut Gallery.
 *
 * Why separate from app UI components?
 *   - html2canvas requires inline styles (not Tailwind classes) at
 *     fixed pixel dimensions
 *   - The canvas renders at 1080px+ width, not responsive
 *   - Every value comes from marketingTokens.js which mirrors index.css
 *
 * `u` = canvasWidth / 1080 — proportional scaling unit.
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS, PG_LOGO_URL, SHADOWS, neonToRgb } from '@/lib/marketingTokens';

/** Official PG logo — same image URL used in RouteFallback + Landing. */
export function CanvasLogo({ u = 1, size = 44, showWordmark = true, style }) {
  const s = size * u;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 * u, ...style }}>
      <img
        src={PG_LOGO_URL}
        alt="Peanut Gallery"
        crossOrigin="anonymous"
        style={{
          width: s, height: s, borderRadius: 12 * u,
          objectFit: 'cover', flexShrink: 0,
          boxShadow: `0 ${2*u}px ${8*u}px rgba(0,0,0,0.3)`,
        }}
      />
      {showWordmark && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontFamily: FONTS.display,
            fontSize: s * 0.32,
            background: GRADIENTS.brand,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            textTransform: 'lowercase',
            letterSpacing: '0.01em',
          }}>peanut</span>
          <span style={{
            fontFamily: FONTS.body,
            fontSize: s * 0.14,
            fontWeight: 900,
            letterSpacing: '0.3em',
            color: TEXT.muted,
            textTransform: 'uppercase',
          }}>Gallery</span>
        </div>
      )}
    </div>
  );
}

/** Pill badge — exact pattern from Onboarding.jsx tagStyle. */
export function CanvasBadge({ u = 1, children, color = NEON.cyan, style }) {
  const rgb = neonToRgb(color);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6 * u,
      padding: `${8 * u}px ${18 * u}px`,
      borderRadius: 999,
      fontFamily: FONTS.body,
      fontSize: 16 * u,
      fontWeight: 900,
      letterSpacing: '0.2em',
      textTransform: 'uppercase',
      color: color,
      background: `rgba(${rgb}, 0.12)`,
      border: `1px solid rgba(${rgb}, 0.35)`,
      ...style,
    }}>{children}</span>
  );
}

/**
 * Display headline — exact pattern from Onboarding.jsx headlineWords.
 * Black Han Sans, gradient text, tight leading, uppercase.
 * Includes broken-text treatment when triggered.
 * Auto-wraps long text with proper line height.
 */
export function CanvasHeadline({ u = 1, children, gradient = true, align = 'left', broken = false, size = 80, style }) {
  const isBroken = broken;
  const grad = isBroken ? GRADIENTS.broken : GRADIENTS.headline;

  const text = (
    <span style={{
      fontFamily: FONTS.display,
      fontSize: size * u,
      lineHeight: 1.05,
      letterSpacing: '0.01em',
      textTransform: 'uppercase',
      ...(gradient ? {
        background: grad,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      } : { color: TEXT.white }),
      display: 'block',
      wordBreak: 'break-word',
      overflowWrap: 'break-word',
    }}>{children}</span>
  );

  if (!isBroken) {
    return <div style={{ textAlign: align, ...style }}>{text}</div>;
  }

  // Broken text: render with relative wrapper for crack overlay
  return (
    <div style={{ position: 'relative', display: 'inline-block', textAlign: align, ...style }}>
      {text}
      <CrackOverlay u={u} />
    </div>
  );
}

/** Subheadline — DM Sans medium, white. */
export function CanvasSubheadline({ u = 1, children, align = 'left', color = TEXT.body, size = 34, style }) {
  return (
    <p style={{
      fontFamily: FONTS.body,
      fontSize: size * u,
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
export function CanvasBody({ u = 1, children, align = 'left', color = TEXT.muted, size = 24, style }) {
  return (
    <p style={{
      fontFamily: FONTS.body,
      fontSize: size * u,
      fontWeight: 400,
      lineHeight: 1.55,
      color: color,
      textAlign: align,
      margin: 0,
      ...style,
    }}>{children}</p>
  );
}

/** CTA button — exact pattern from Landing.jsx "Create Account". */
export function CanvasCTA({ u = 1, children, gradient = GRADIENTS.cta_primary, textColor = TEXT.dark, style }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8 * u,
      padding: `${18 * u}px ${40 * u}px`,
      borderRadius: 999,
      fontFamily: FONTS.body,
      fontSize: 26 * u,
      fontWeight: 900,
      letterSpacing: '0.04em',
      color: textColor,
      background: gradient,
      boxShadow: SHADOWS.cta_glow(NEON.cyan),
      ...style,
    }}>{children}</div>
  );
}

/** Glassmorphism card — exact pattern from index.css .glass-card. */
export function CanvasGlassCard({ u = 1, children, style }) {
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

/** Screenshot frame — device-like border around an image. */
export function CanvasScreenshotFrame({ u = 1, src, style }) {
  if (!src) return null;
  return (
    <div style={{
      borderRadius: 20 * u,
      overflow: 'hidden',
      border: `1px solid rgba(255,255,255,0.15)`,
      boxShadow: SHADOWS.screenshot,
      ...style,
    }}>
      <img src={src} alt="" crossOrigin="anonymous" style={{ display: 'block', width: '100%', height: 'auto' }} />
    </div>
  );
}

/** Divider — thin gradient line. */
export function CanvasDivider({ u = 1, style }) {
  return (
    <div style={{
      height: 1.5 * u,
      background: 'linear-gradient(90deg, transparent, rgba(191,95,255,0.4), rgba(255,45,120,0.3), transparent)',
      ...style,
    }} />
  );
}

/** Soft radial glow — positioned absolutely (same as .rave-bg layers). */
export function CanvasGlow({ u = 1, rgb = NEON_RGB.purple, size = 300, style }) {
  return (
    <div style={{
      position: 'absolute',
      width: size * u, height: size * u,
      borderRadius: '50%',
      background: `radial-gradient(circle, rgba(${rgb},0.18) 0%, transparent 70%)`,
      pointerEvents: 'none',
      ...style,
    }} />
  );
}

/** Large statistic — huge number + label + explanation. */
export function CanvasStatBlock({ u = 1, number, label, explanation, gradient = GRADIENTS.stat, style }) {
  return (
    <div style={{ ...style }}>
      <div style={{
        fontFamily: FONTS.display,
        fontSize: 140 * u,
        lineHeight: 0.9,
        background: gradient,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}>{number}</div>
      {label && (
        <p style={{
          fontFamily: FONTS.body, fontSize: 36 * u, fontWeight: 700,
          color: TEXT.white, marginTop: 12 * u, margin: 0,
        }}>{label}</p>
      )}
      {explanation && (
        <p style={{
          fontFamily: FONTS.body, fontSize: 20 * u, fontWeight: 400,
          color: TEXT.muted, marginTop: 8 * u, margin: 0,
        }}>{explanation}</p>
      )}
    </div>
  );
}

/** Footer lockup — logo + handle, bottom of graphic. */
export function CanvasFooter({ u = 1, handle = '@peanutgallery' }) {
  return (
    <div style={{
      position: 'absolute', bottom: 50 * u, left: 70 * u, right: 70 * u,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <CanvasLogo u={u} size={36} />
      <span style={{
        fontFamily: FONTS.body, fontSize: 18 * u, fontWeight: 500,
        color: TEXT.faint, letterSpacing: '0.05em',
      }}>{handle}</span>
    </div>
  );
}

// ── Broken text crack overlay ───────────────────────────────────────────
// Premium glass fracture: hairline crack + minimal floating fragments.
// The text itself remains crisp — only overlays are added.
function CrackOverlay({ u = 1 }) {
  return (
    <>
      {/* Main hairline crack */}
      <div style={{
        position: 'absolute',
        top: '8%', left: '38%',
        width: 1.5 * u, height: '84%',
        background: 'linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.6) 25%, rgba(255,255,255,0.15) 55%, rgba(255,255,255,0.4) 75%, transparent 100%)',
        transform: 'rotate(4deg)',
        pointerEvents: 'none',
      }} />
      {/* Branch crack */}
      <div style={{
        position: 'absolute',
        top: '35%', left: '42%',
        width: 1 * u, height: '30%',
        background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.3), transparent)',
        transform: 'rotate(-12deg)',
        pointerEvents: 'none',
      }} />
      {/* Glass fragment 1 — small floating shard */}
      <div style={{
        position: 'absolute',
        top: '15%', right: '8%',
        width: 12 * u, height: 12 * u,
        background: 'rgba(255,255,255,0.05)',
        border: `1px solid rgba(255,255,255,0.2)`,
        transform: 'rotate(22deg)',
        borderRadius: 2 * u,
        pointerEvents: 'none',
      }} />
      {/* Glass fragment 2 — tiny shard */}
      <div style={{
        position: 'absolute',
        bottom: '5%', left: '15%',
        width: 7 * u, height: 7 * u,
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid rgba(255,255,255,0.12)`,
        transform: 'rotate(-15deg)',
        borderRadius: 1.5 * u,
        pointerEvents: 'none',
      }} />
      {/* Glass fragment 3 — micro shard */}
      <div style={{
        position: 'absolute',
        top: '60%', right: '20%',
        width: 5 * u, height: 5 * u,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid rgba(255,255,255,0.15)`,
        transform: 'rotate(45deg)',
        borderRadius: 1 * u,
        pointerEvents: 'none',
      }} />
    </>
  );
}