/**
 * GraphicCanvas — renders the full-size graphic at actual pixel dimensions.
 * This is the element html2canvas captures for export.
 * The parent wraps it in a CSS transform: scale() for preview.
 *
 * Delegates all rendering to the Creative Direction Engine, which
 * interprets the Creative Concept's structured design system data.
 *
 * No per-concept rendering code exists. Every concept is data.
 */
import CreativeDirectionEngine from './CreativeDirectionEngine';
import { quickDirect } from '@/lib/marketing/creativeDirector';

/**
 * renderLayout — compatibility export for CarouselCanvas.
 * Renders a single slide using the Creative Direction Engine.
 */
export function renderLayout(graphicType, props) {
  const { content, conceptId, executionStyleId, u, w, h } = props;

  // If no conceptId is provided, auto-select via heuristic
  let resolvedConceptId = conceptId;
  let resolvedExecId = executionStyleId;
  if (!resolvedConceptId || !resolvedExecId) {
    const auto = quickDirect(content, graphicType);
    if (!resolvedConceptId) resolvedConceptId = auto.concept.id;
    if (!resolvedExecId) resolvedExecId = auto.executionStyle.id;
  }

  return (
    <CreativeDirectionEngine
      conceptId={resolvedConceptId}
      executionStyleId={resolvedExecId}
      content={content}
      preset={{ w, h }}
      creativeIntent={content?.creative_intent}
      creativeLocks={content?.creative_locks}
    />
  );
}

export default function GraphicCanvas({ canvasRef, preset, graphicType, content, theme, conceptId, executionStyleId }) {
  // Auto-select if no concept specified
  let resolvedConceptId = conceptId;
  let resolvedExecId = executionStyleId;
  if (!resolvedConceptId || !resolvedExecId) {
    const auto = quickDirect(content, graphicType);
    if (!resolvedConceptId) resolvedConceptId = auto.concept.id;
    if (!resolvedExecId) resolvedExecId = auto.executionStyle.id;
  }

  return (
    <div ref={canvasRef} style={{ width: preset.w, height: preset.h, flexShrink: 0, position: 'relative' }}>
      <CreativeDirectionEngine
        conceptId={resolvedConceptId}
        executionStyleId={resolvedExecId}
        content={content}
        preset={preset}
        theme={theme}
        creativeIntent={content?.creative_intent}
      creativeLocks={content?.creative_locks}
      />
    </div>
  );
}