/** Milestone — badge, stat number, headline, celebratory. */
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { FONTS, NEON, NEON_RGB, GRADIENTS, TEXT } from '@/lib/marketingTokens';

export default function Milestone({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.yellow} size={450} style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <CanvasBadge u={u} color={NEON.yellow} style={{ marginBottom: 32 * u }}>{content.badge || 'Milestone'}</CanvasBadge>
        {content.stat_number && (
          <div style={{
            fontFamily: FONTS.display,
            fontSize: 120 * u, lineHeight: 0.9,
            background: GRADIENTS.milestone,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            marginBottom: 20 * u,
          }}>{content.stat_number}</div>
        )}
        <CanvasHeadline u={u} align="center" size={52} style={{ marginBottom: 0 }}>{content.headline}</CanvasHeadline>
        {content.subheadline && <CanvasSubheadline u={u} align="center" color={TEXT.muted} style={{ maxWidth: '80%', marginTop: 16 * u }}>{content.subheadline}</CanvasSubheadline>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}