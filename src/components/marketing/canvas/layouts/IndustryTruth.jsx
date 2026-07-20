/** Industry Truth — badge + huge headline + supporting copy, minimal. */
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function IndustryTruth({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={400} style={{ top: '10%', left: '60%' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={350} style={{ bottom: '15%', left: '5%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {content.badge && <CanvasBadge u={u} color={NEON.cyan} style={{ marginBottom: 30 * u }}>{content.badge}</CanvasBadge>}
        <CanvasHeadline u={u} broken size={90} style={{ marginBottom: 24 * u }}>{content.headline}</CanvasHeadline>
        {content.subheadline && <CanvasSubheadline u={u} color={TEXT.muted} style={{ maxWidth: '85%' }}>{content.subheadline}</CanvasSubheadline>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}