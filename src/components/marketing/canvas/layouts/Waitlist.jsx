/** Waitlist — badge, headline, subheadline, CTA. Urgent tone. */
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasCTA, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB, GRADIENTS, TEXT } from '@/lib/marketingTokens';

export default function Waitlist({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={500} style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <CanvasBadge u={u} color={NEON.purple} style={{ marginBottom: 32 * u }}>{content.badge || 'Waitlist'}</CanvasBadge>
        <CanvasHeadline u={u} align="center" size={72} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>
        {content.subheadline && <CanvasSubheadline u={u} align="center" color={TEXT.muted} style={{ maxWidth: '80%', marginBottom: 36 * u }}>{content.subheadline}</CanvasSubheadline>}
        {content.cta && <CanvasCTA u={u} gradient={GRADIENTS.cta_purple} textColor={TEXT.white}>{content.cta}</CanvasCTA>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}