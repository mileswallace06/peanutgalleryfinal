/** Update — badge, headline, body. Informational, clean. */
import { CanvasBadge, CanvasHeadline, CanvasBody, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function Update({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={400} style={{ top: '10%', right: '15%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <CanvasBadge u={u} color={NEON.cyan} style={{ marginBottom: 28 * u }}>{content.badge || 'Update'}</CanvasBadge>
        <CanvasHeadline u={u} size={64} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>
        {content.body && <CanvasBody u={u} style={{ maxWidth: '85%' }}>{content.body}</CanvasBody>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}