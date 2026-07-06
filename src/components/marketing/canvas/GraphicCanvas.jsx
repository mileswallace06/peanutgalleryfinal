/**
 * GraphicCanvas — renders the full-size graphic at actual pixel dimensions.
 * This is the element html2canvas captures for export.
 * The parent wraps it in a CSS transform: scale() for preview.
 *
 * Uses the layout registry — the system chooses the layout based on
 * graphic_type. The user never positions elements.
 */
import { THEMES } from '@/lib/marketingTokens';
import * as Layouts from './layouts';

export function renderLayout(graphicType, props) {
  const Layout = Layouts[graphicType] || Layouts.IndustryTruth;
  return <Layout {...props} />;
}

export default function GraphicCanvas({ canvasRef, preset, graphicType, content, theme = 'dark' }) {
  const u = preset.w / 1080;
  return (
    <div ref={canvasRef} style={{ width: preset.w, height: preset.h, flexShrink: 0, position: 'relative' }}>
      <div style={{
        width: '100%', height: '100%',
        background: THEMES[theme] || THEMES.dark,
        position: 'relative', overflow: 'hidden',
      }}>
        {renderLayout(graphicType, { content, u, w: preset.w, h: preset.h })}
      </div>
    </div>
  );
}