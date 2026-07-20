/** Ticket Tip — badge, headline, body. Helpful, concise. */
import { CanvasBadge, CanvasHeadline, CanvasBody, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function TicketTip({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.yellow} size={400} style={{ top: '15%', right: '20%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <CanvasBadge u={u} color={NEON.yellow} style={{ marginBottom: 28 * u }}>{content.badge || 'Ticket Tip'}</CanvasBadge>
        <CanvasHeadline u={u} size={60} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>
        {content.body && <CanvasBody u={u} style={{ maxWidth: '85%' }}>{content.body}</CanvasBody>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}