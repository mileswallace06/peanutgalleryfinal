/** Coming Soon — centered badge, headline, subheadline. */
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function ComingSoon({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={500} style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <CanvasBadge u={u} color={NEON.cyan} style={{ marginBottom: 32 * u }}>{content.badge || 'Coming Soon'}</CanvasBadge>
        <CanvasHeadline u={u} align="center" size={72} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>
        {content.subheadline && <CanvasSubheadline u={u} align="center" color={TEXT.muted} style={{ maxWidth: '75%' }}>{content.subheadline}</CanvasSubheadline>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}