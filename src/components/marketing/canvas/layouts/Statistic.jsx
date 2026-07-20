/** Statistic — huge number, supporting sentence, tiny explanation. */
import { CanvasBadge, CanvasStatBlock, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

export default function Statistic({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.green} size={450} style={{ top: '20%', left: '50%', transform: 'translateX(-50%)' }} />
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        {content.badge && <CanvasBadge u={u} color={NEON.green} style={{ marginBottom: 36 * u }}>{content.badge}</CanvasBadge>}
        <CanvasStatBlock
          u={u}
          number={content.stat_number || '0'}
          label={content.stat_label}
          explanation={content.stat_explanation}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        />
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}