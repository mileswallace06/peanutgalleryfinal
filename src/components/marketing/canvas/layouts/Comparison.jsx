/** Comparison — badge, headline, two-column comparison list. */
import { CanvasBadge, CanvasHeadline, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { FONTS, NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function Comparison({ content, u, w, h }) {
  const items = content.body ? content.body.split('\n').filter(Boolean) : [];
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={400} style={{ top: '10%', right: '15%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {content.badge && <CanvasBadge u={u} color={NEON.cyan} style={{ marginBottom: 28 * u }}>{content.badge}</CanvasBadge>}
        <CanvasHeadline u={u} size={56} style={{ marginBottom: 36 * u }}>{content.headline}</CanvasHeadline>
        <div style={{ display: 'flex', gap: 40 * u }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: FONTS.body, fontSize: 20 * u, fontWeight: 900, color: NEON.green, marginBottom: 16 * u, textTransform: 'uppercase', letterSpacing: '0.1em' }}>🥜 Peanut Gallery</p>
            {left.map((item, i) => (
              <p key={i} style={{ fontFamily: FONTS.body, fontSize: 22 * u, color: TEXT.white, marginBottom: 12 * u, lineHeight: 1.4 }}>✓ {item}</p>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: FONTS.body, fontSize: 20 * u, fontWeight: 900, color: TEXT.faint, marginBottom: 16 * u, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Others</p>
            {right.map((item, i) => (
              <p key={i} style={{ fontFamily: FONTS.body, fontSize: 22 * u, color: TEXT.muted, marginBottom: 12 * u, lineHeight: 1.4 }}>✕ {item}</p>
            ))}
          </div>
        </div>
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}