/**
 * GraphicCanvas — renders the full-size graphic at actual pixel dimensions.
 * This is the element html2canvas captures for export.
 * The parent wraps it in a CSS transform: scale() for preview.
 *
 * Uses the Composition Engine — the system analyzes the content and
 * selects the strongest visual composition automatically. The user
 * can override via the ConceptPicker (compositionId prop).
 */
import { THEMES, FONTS, TEXT } from '@/lib/marketingTokens';
import { getBestComposition } from '@/lib/marketing/compositionEngine';
import { COMPOSITION_COMPONENTS } from './compositions';

export function renderLayout(graphicType, props) {
  const { content, compositionId } = props;
  const selectedId = compositionId || content?.composition_variant || getBestComposition(content, graphicType);
  const Comp = COMPOSITION_COMPONENTS[selectedId] || COMPOSITION_COMPONENTS.massive_left;
  return <Comp {...props} />;
}

export default function GraphicCanvas({ canvasRef, preset, graphicType, content, theme = 'dark', compositionId }) {
  const u = preset.w / 1080;
  return (
    <div ref={canvasRef} style={{ width: preset.w, height: preset.h, flexShrink: 0, position: 'relative' }}>
      <div style={{
        width: '100%', height: '100%',
        background: THEMES[theme] || THEMES.dark,
        position: 'relative', overflow: 'hidden',
        fontFamily: FONTS.body,
        color: TEXT.white,
      }}>
        {renderLayout(graphicType, { content, u, w: preset.w, h: preset.h, compositionId })}
      </div>
    </div>
  );
}