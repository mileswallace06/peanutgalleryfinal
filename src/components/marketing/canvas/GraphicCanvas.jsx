/**
 * GraphicCanvas — renders the full-size graphic at actual pixel dimensions.
 * This is the element html2canvas captures for export.
 * The parent wraps it in a CSS transform: scale() for preview.
 *
 * Uses the Creative Concept system — the AI Concept Director analyzes
 * the content's story and emotion, then selects the strongest Creative
 * Concept (a complete art direction system). The user can override via
 * the ConceptPicker (conceptId prop).
 * Legacy composition system retained as backwards-compat fallback.
 */
import { THEMES, FONTS, TEXT } from '@/lib/marketingTokens';
import { getBestComposition } from '@/lib/marketing/compositionEngine';
import { COMPOSITION_COMPONENTS } from './compositions';
import { CONCEPT_RENDERERS } from './concepts';
import { quickSuggest } from '@/lib/marketing/conceptSelector';

export function renderLayout(graphicType, props) {
  const { content, compositionId, conceptId } = props;

  // ── Creative Concept system (primary) ──
  // A concept is a complete art direction — not a layout.
  // If a concept is selected (or saved on the asset), render it.
  const cid = conceptId || content?.concept_id;
  if (cid && CONCEPT_RENDERERS[cid]) {
    const ConceptComp = CONCEPT_RENDERERS[cid];
    return <ConceptComp {...props} />;
  }

  // ── Auto-select a concept if none chosen ──
  // The quickSuggest heuristic picks the best concept for this content.
  if (!compositionId && !content?.composition_variant) {
    const suggestions = quickSuggest(content, graphicType);
    if (suggestions.length > 0 && CONCEPT_RENDERERS[suggestions[0].conceptId]) {
      const ConceptComp = CONCEPT_RENDERERS[suggestions[0].conceptId];
      return <ConceptComp {...props} />;
    }
  }

  // ── Legacy composition fallback (backwards compat for saved assets) ──
  const selectedId = compositionId || content?.composition_variant || getBestComposition(content, graphicType);
  const Comp = COMPOSITION_COMPONENTS[selectedId] || COMPOSITION_COMPONENTS.massive_left;
  return <Comp {...props} />;
}

export default function GraphicCanvas({ canvasRef, preset, graphicType, content, theme = 'dark', compositionId, conceptId }) {
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
        {renderLayout(graphicType, { content, u, w: preset.w, h: preset.h, compositionId, conceptId })}
      </div>
    </div>
  );
}