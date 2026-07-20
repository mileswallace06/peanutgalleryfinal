/** Problem — badge, broken headline, body. Stark and minimal. */
import { CanvasBadge, CanvasHeadline, CanvasBody, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function Problem({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.pink} size={400} style={{ top: '20%', left: '60%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <CanvasBadge u={u} color={NEON.pink} style={{ marginBottom: 28 * u }}>{content.badge || 'The Problem'}</CanvasBadge>
        <CanvasHeadline u={u} broken size={84} style={{ marginBottom: 24 * u }}>{content.headline}</CanvasHeadline>
        {content.body && <CanvasBody u={u} style={{ maxWidth: '85%' }}>{content.body}</CanvasBody>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}