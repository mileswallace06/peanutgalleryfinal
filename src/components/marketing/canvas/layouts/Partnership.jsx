/** Partnership — badge, headline, subheadline, dual logos. */
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasLogo, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function Partnership({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={450} style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <CanvasBadge u={u} color={NEON.cyan} style={{ marginBottom: 32 * u }}>{content.badge || 'Partnership'}</CanvasBadge>
        <CanvasHeadline u={u} align="center" size={68} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>
        {content.subheadline && <CanvasSubheadline u={u} align="center" color={TEXT.muted} style={{ maxWidth: '75%', marginBottom: 40 * u }}>{content.subheadline}</CanvasSubheadline>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 * u }}>
          <CanvasLogo u={u} size={40} showWordmark={false} />
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 32 * u, fontWeight: 900, color: TEXT.faint }}>×</span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 28 * u, fontWeight: 700, color: TEXT.white }}>{content.author || 'Partner'}</span>
        </div>
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}