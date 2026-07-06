/** Fan Story — badge, headline, quote-style body, author. Warm, personal. */
import { CanvasBadge, CanvasHeadline, CanvasBody, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { FONTS, NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function FanStory({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.pink} size={400} style={{ top: '10%', left: '15%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <CanvasBadge u={u} color={NEON.pink} style={{ marginBottom: 28 * u }}>{content.badge || 'Fan Story'}</CanvasBadge>
        <CanvasHeadline u={u} size={56} style={{ marginBottom: 24 * u }}>{content.headline}</CanvasHeadline>
        {content.body && <CanvasBody u={u} style={{ maxWidth: '85%', marginBottom: 28 * u }}>{content.body}</CanvasBody>}
        {content.author && (
          <p style={{
            fontFamily: FONTS.body, fontSize: 26 * u, fontWeight: 600,
            color: NEON.pink, margin: 0,
          }}>— {content.author}</p>
        )}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}