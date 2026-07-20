/** Founder Story — photo, badge, headline, body, signature. */
import { CanvasBadge, CanvasHeadline, CanvasBody, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { FONTS, NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function FounderStory({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={400} style={{ top: '10%', left: '5%' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 28 * u }}>
        {content.image_url && (
          <div style={{
            width: 120 * u, height: 120 * u, borderRadius: '50%',
            overflow: 'hidden', border: `3px solid rgba(191,95,255,0.4)`,
            boxShadow: `0 0 ${32*u}px rgba(191,95,255,0.3)`,
            flexShrink: 0,
          }}>
            <img src={content.image_url} alt="" crossOrigin="anonymous" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}
        {content.badge && <CanvasBadge u={u} color={NEON.purple}>{content.badge}</CanvasBadge>}
        <CanvasHeadline u={u} size={56} style={{ marginBottom: 0 }}>{content.headline}</CanvasHeadline>
        {content.body && <CanvasBody u={u} style={{ maxWidth: '85%' }}>{content.body}</CanvasBody>}
        {content.signature && (
          <p style={{
            fontFamily: FONTS.body, fontSize: 30 * u, fontWeight: 600,
            fontStyle: 'italic', color: NEON.cyan, margin: 0,
          }}>{content.signature}</p>
        )}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}