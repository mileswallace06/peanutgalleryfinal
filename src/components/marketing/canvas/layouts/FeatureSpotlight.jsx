/** Feature Spotlight — badge, headline, paragraph, screenshot, CTA. */
import { CanvasBadge, CanvasHeadline, CanvasBody, CanvasCTA, CanvasScreenshotFrame, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function FeatureSpotlight({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={400} style={{ top: '5%', right: '10%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {content.badge && <CanvasBadge u={u} color={NEON.purple} style={{ marginBottom: 24 * u }}>{content.badge}</CanvasBadge>}
        <CanvasHeadline u={u} size={64} style={{ marginBottom: 18 * u }}>{content.headline}</CanvasHeadline>
        {content.body && <CanvasBody u={u} style={{ maxWidth: '85%', marginBottom: 24 * u }}>{content.body}</CanvasBody>}
      </div>
      {content.image_url && (
        <div style={{ position: 'relative', zIndex: 1, marginBottom: 20 * u }}>
          <CanvasScreenshotFrame u={u} src={content.image_url} />
        </div>
      )}
      {content.cta && (
        <div style={{ position: 'relative', zIndex: 1, marginBottom: 30 * u }}>
          <CanvasCTA u={u}>{content.cta}</CanvasCTA>
        </div>
      )}
      <CanvasFooter u={u} />
    </div>
  );
}