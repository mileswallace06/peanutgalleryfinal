/**
 * Design Elements + Text Treatments
 * --------------------------------------------------------------------
 * Reusable visual building blocks for composition rendering.
 * All inline-styled for html2canvas compatibility.
 *
 * Design Elements: AccentLine, BackgroundNumeral, GlassPanel, Spotlight,
 *   CornerGradient, ImageLayer, FloatingPill, NumberBlock, GrainOverlay
 *
 * Text Treatments: OutlinedText, DropCapText, OversizedPunctuation,
 *   VerticalText, GradientWords
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS, neonToRgb } from '@/lib/marketingTokens';
import { TREATMENTS } from '@/lib/marketing/visualAssets';

// ── Design Elements ──────────────────────────────────────────────────────

/** Thin gradient accent line — horizontal or vertical. */
export function AccentLine({ u = 1, orientation = 'horizontal', color = NEON.purple, length = 120, thickness = 2, style }) {
  const rgb = neonToRgb(color);
  const dir = orientation === 'horizontal' ? '90deg' : '180deg';
  return (
    <div style={{
      width: orientation === 'horizontal' ? length * u : thickness * u,
      height: orientation === 'horizontal' ? thickness * u : length * u,
      background: `linear-gradient(${dir}, ${color}, rgba(${rgb}, 0.3), transparent)`,
      borderRadius: thickness * u,
      ...style,
    }} />
  );
}

/** Huge faint numeral/letter behind content — adds depth and visual interest. */
export function BackgroundNumeral({ u = 1, children, size = 600, color = NEON.purple, opacity = 0.05, style }) {
  const rgb = neonToRgb(color);
  return (
    <div style={{
      position: 'absolute',
      fontFamily: FONTS.display,
      fontSize: size * u,
      lineHeight: 0.8,
      color: `rgba(${rgb}, ${opacity})`,
      pointerEvents: 'none',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      ...style,
    }}>{children}</div>
  );
}

/** Refined frosted glass panel. */
export function GlassPanel({ u = 1, children, style }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.07)',
      backdropFilter: 'blur(24px) saturate(180%)',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 28 * u,
      boxShadow: `0 ${8 * u}px ${32 * u}px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)`,
      ...style,
    }}>{children}</div>
  );
}

/** Cone of light from top — dramatic spotlight effect. */
export function Spotlight({ u = 1, color = NEON.purple, width = 600, opacity = 0.12, style }) {
  const rgb = neonToRgb(color);
  return (
    <div style={{
      position: 'absolute',
      top: '-5%', left: '50%',
      transform: 'translateX(-50%)',
      width: width * u, height: '90%',
      background: `linear-gradient(180deg, rgba(${rgb}, ${opacity}) 0%, rgba(${rgb}, ${opacity * 0.3}) 50%, transparent 80%)`,
      clipPath: 'polygon(35% 0%, 65% 0%, 100% 100%, 0% 100%)',
      pointerEvents: 'none',
      ...style,
    }} />
  );
}

/** Radial gradient emanating from a corner. */
export function CornerGradient({ u = 1, corner = 'top-right', color = NEON.purple, size = 500, opacity = 0.15, style }) {
  const rgb = neonToRgb(color);
  const positions = {
    'top-right': { top: `-10%`, right: `-10%` },
    'top-left': { top: `-10%`, left: `-10%` },
    'bottom-right': { bottom: `-10%`, right: `-10%` },
    'bottom-left': { bottom: `-10%`, left: `-10%` },
  };
  return (
    <div style={{
      position: 'absolute',
      width: size * u, height: size * u,
      borderRadius: '50%',
      background: `radial-gradient(circle, rgba(${rgb}, ${opacity}) 0%, transparent 65%)`,
      pointerEvents: 'none',
      ...positions[corner],
      ...style,
    }} />
  );
}

/** Photographic background layer with treatment overlay. */
export function ImageLayer({ u = 1, src, treatment = 'darken', overlayOpacity = 0.65, style }) {
  if (!src) return null;
  return (
    <>
      <img src={src} alt="" crossOrigin="anonymous"
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          filter: TREATMENTS[treatment] || TREATMENTS.darken,
          transform: treatment === 'blur' ? 'scale(1.15)' : 'none',
          ...style,
        }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, rgba(5,3,8,${overlayOpacity * 0.5}) 0%, rgba(5,3,8,${overlayOpacity}) 100%)`,
        pointerEvents: 'none',
      }} />
    </>
  );
}

/** Small glass pill with icon/text — lighter than CanvasBadge. */
export function FloatingPill({ u = 1, children, color = NEON.cyan, style }) {
  const rgb = neonToRgb(color);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6 * u,
      padding: `${6 * u}px ${14 * u}px`,
      borderRadius: 999,
      background: 'rgba(255,255,255,0.08)',
      backdropFilter: 'blur(12px)',
      border: `1px solid rgba(${rgb}, 0.25)`,
      fontFamily: FONTS.body,
      fontSize: 13 * u,
      fontWeight: 700,
      color: color,
      letterSpacing: '0.15em',
      textTransform: 'uppercase',
      ...style,
    }}>{children}</div>
  );
}

/** Large numeral in a styled container. */
export function NumberBlock({ u = 1, children, color = NEON.green, style }) {
  const rgb = neonToRgb(color);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 50 * u, height: 50 * u,
      borderRadius: 14 * u,
      background: `rgba(${rgb}, 0.12)`,
      border: `1px solid rgba(${rgb}, 0.3)`,
      fontFamily: FONTS.display,
      fontSize: 28 * u,
      color: color,
      ...style,
    }}>{children}</div>
  );
}

// ── Text Treatments ──────────────────────────────────────────────────────

/** Outlined text — transparent fill, neon stroke. */
export function OutlinedText({ u = 1, children, size = 80, color = NEON.cyan, strokeWidth = 2, style }) {
  return (
    <span style={{
      fontFamily: FONTS.display,
      fontSize: size * u,
      lineHeight: 1.05,
      textTransform: 'uppercase',
      WebkitTextStroke: `${strokeWidth * u}px ${color}`,
      WebkitTextFillColor: 'transparent',
      letterSpacing: '0.01em',
      display: 'block',
      wordBreak: 'break-word',
      ...style,
    }}>{children}</span>
  );
}

/** Body text with oversized drop cap first letter. */
export function DropCapText({ u = 1, children, color = NEON.purple, size = 24, capSize = 80, style }) {
  const text = typeof children === 'string' ? children : '';
  const firstChar = text.charAt(0);
  const rest = text.slice(1);
  const rgb = neonToRgb(color);
  return (
    <p style={{
      fontFamily: FONTS.body, fontSize: size * u, fontWeight: 400,
      lineHeight: 1.55, color: TEXT.body, margin: 0, ...style,
    }}>
      <span style={{
        fontFamily: FONTS.display, fontSize: capSize * u,
        float: 'left', lineHeight: 0.85, marginRight: 12 * u, marginTop: 4 * u,
        background: `linear-gradient(135deg, ${color}, rgba(${rgb}, 0.6))`,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>{firstChar}</span>
      {rest}
    </p>
  );
}

/** Huge decorative punctuation mark — for pull quotes. */
export function OversizedPunctuation({ u = 1, char = '\u201C', size = 200, color = NEON.purple, opacity = 0.2, style }) {
  const rgb = neonToRgb(color);
  return (
    <div style={{
      fontFamily: FONTS.display, fontSize: size * u, lineHeight: 0.7,
      color: `rgba(${rgb}, ${opacity})`,
      pointerEvents: 'none', userSelect: 'none',
      ...style,
    }}>{char}</div>
  );
}

/** Rotated vertical text — for side rails and editorial accents. */
export function VerticalText({ u = 1, children, size = 14, color = NEON.cyan, style }) {
  return (
    <div style={{
      transform: 'rotate(-90deg)',
      transformOrigin: 'center center',
      whiteSpace: 'nowrap',
      fontFamily: FONTS.body, fontSize: size * u, fontWeight: 900,
      letterSpacing: '0.3em', textTransform: 'uppercase',
      color: color,
      ...style,
    }}>{children}</div>
  );
}