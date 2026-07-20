/** Announcement — badge, headline, subheadline, CTA. */
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasCTA, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function Announcement({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.pink} size={400} style={{ top: '15%', right: '15%' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={300} style={{ bottom: '20%', left: '10%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {content.badge && <CanvasBadge u={u} color={NEON.pink} style={{ marginBottom: 28 * u }}>{content.badge}</CanvasBadge>}
        <CanvasHeadline u={u} size={80} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>
        {content.subheadline && <CanvasSubheadline u={u} color={TEXT.muted} style={{ maxWidth: '85%', marginBottom: 36 * u }}>{content.subheadline}</CanvasSubheadline>}
        {content.cta && <CanvasCTA u={u}>{content.cta}</CanvasCTA>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}