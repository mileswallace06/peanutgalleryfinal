/** Venue Spotlight — badge, headline, body, image. Stadium-focused. */
import { CanvasBadge, CanvasHeadline, CanvasBody, CanvasScreenshotFrame, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function VenueSpotlight({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.green} size={400} style={{ top: '15%', left: '10%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <CanvasBadge u={u} color={NEON.green} style={{ marginBottom: 28 * u }}>{content.badge || 'Venue Spotlight'}</CanvasBadge>
        <CanvasHeadline u={u} size={60} style={{ marginBottom: 18 * u }}>{content.headline}</CanvasHeadline>
        {content.body && <CanvasBody u={u} style={{ maxWidth: '80%', marginBottom: 28 * u }}>{content.body}</CanvasBody>}
      </div>
      {content.image_url && (
        <div style={{ position: 'relative', zIndex: 1 }}>
          <CanvasScreenshotFrame u={u} src={content.image_url} />
        </div>
      )}
      <CanvasFooter u={u} />
    </div>
  );
}