/**
 * GraphicCanvas — renders the full-size graphic at actual pixel dimensions.
 * This element is what html2canvas captures for export.
 * The parent wraps it in a CSS transform: scale() for preview.
 */
import { PGBackground } from './PGBrand';
import { renderLayout } from './GraphicLayouts';

export default function GraphicCanvas({ canvasRef, preset, graphicType, content, theme }) {
  const u = preset.w / 1080;
  return (
    <div ref={canvasRef} style={{ width: preset.w, height: preset.h, flexShrink: 0, position: 'relative' }}>
      <PGBackground u={u} theme={theme}>
        {renderLayout(graphicType, { content, u, w: preset.w, h: preset.h })}
      </PGBackground>
    </div>
  );
}