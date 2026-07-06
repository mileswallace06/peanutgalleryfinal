/**
 * CarouselCanvas — renders a multi-slide carousel at actual pixel dimensions.
 * Each slide is a full graphic canvas with its own content + graphic type.
 * Used for preview and export (one image per slide).
 */
import { THEMES } from '@/lib/marketingTokens';
import { renderLayout } from './GraphicCanvas';

export default function CarouselCanvas({ canvasRef, preset, slides, theme = 'dark', slideIndex = 0 }) {
  const u = preset.w / 1080;
  const slide = slides[slideIndex];

  if (!slide) return null;

  return (
    <div ref={canvasRef} style={{ width: preset.w, height: preset.h, flexShrink: 0, position: 'relative' }}>
      <div style={{
        width: '100%', height: '100%',
        background: THEMES[theme] || THEMES.dark,
        position: 'relative', overflow: 'hidden',
      }}>
        {renderLayout(slide.graphic_type || 'announcement', { content: slide.content || {}, u, w: preset.w, h: preset.h })}

        {/* Slide number indicator */}
        <div style={{
          position: 'absolute', top: 40 * u, right: 40 * u,
          fontFamily: "'DM Sans', sans-serif", fontSize: 16 * u, fontWeight: 900,
          color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em',
        }}>
          {slideIndex + 1} / {slides.length}
        </div>
      </div>
    </div>
  );
}