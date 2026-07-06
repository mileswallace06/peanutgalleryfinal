/** Quote — huge quote text, author, lots of whitespace. */
import { CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { FONTS, NEON, NEON_RGB, TEXT } from '@/lib/marketingTokens';

export default function Quote({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={400} style={{ top: '10%', left: '10%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <span style={{
          fontFamily: FONTS.display,
          fontSize: 160 * u, lineHeight: 0.7,
          color: 'rgba(191,95,255,0.25)', display: 'block', marginBottom: 10 * u,
        }}>“</span>
        <p style={{
          fontFamily: FONTS.body, fontSize: 42 * u, fontWeight: 600,
          lineHeight: 1.35, color: TEXT.white, margin: 0, marginBottom: 30 * u,
        }}>{content.quote_text || content.headline}</p>
        {content.author && (
          <p style={{
            fontFamily: FONTS.body, fontSize: 26 * u, fontWeight: 500,
            color: NEON.cyan, margin: 0,
          }}>— {content.author}</p>
        )}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}