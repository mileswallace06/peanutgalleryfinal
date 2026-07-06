/** Launch — centered badge, headline, subheadline, CTA. */
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasCTA, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function Launch({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.green} size={500} style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={350} style={{ top: '15%', right: '15%' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <CanvasBadge u={u} color={NEON.green} style={{ marginBottom: 32 * u }}>{content.badge || 'Now Live'}</CanvasBadge>
        <CanvasHeadline u={u} align="center" size={72} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>
        {content.subheadline && <CanvasSubheadline u={u} align="center" color={TEXT.muted} style={{ maxWidth: '80%', marginBottom: 36 * u }}>{content.subheadline}</CanvasSubheadline>}
        {content.cta && <CanvasCTA u={u}>{content.cta}</CanvasCTA>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}