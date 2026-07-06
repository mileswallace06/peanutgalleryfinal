/**
 * Creative Direction Picker
 * --------------------------------------------------------------------
 * Shows the AI Creative Director's THREE INDEPENDENT decisions:
 *   1. Creative Strategy — what is this post trying to accomplish?
 *   2. Creative Concept — what visual metaphor communicates that?
 *   3. Execution Style — how should the concept be executed?
 *
 * The user can override any decision independently. Changing the
 * strategy does not change the concept. Changing the concept does
 * not change the execution style. They combine freely.
 */
import { useState, useEffect, useMemo } from 'react';
import { Wand2, Loader2, Sparkles, Check, Shuffle, ChevronDown, Lightbulb } from 'lucide-react';
import GraphicCanvas from './canvas/GraphicCanvas';
import { CREATIVE_STRATEGIES } from '@/lib/marketing/creativeStrategies';
import { CREATIVE_CONCEPTS, CONCEPT_FAMILIES, CONCEPT_FAMILY_LABELS, getConceptById } from '@/lib/marketing/creativeConcepts';
import { EXECUTION_STYLES } from '@/lib/marketing/executionStyles';
import { directCreative, quickDirect } from '@/lib/marketing/creativeDirector';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

export default function ConceptPicker({ content, graphicType, theme, preset, conceptId, executionStyleId, strategyId, onSelect }) {
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAllConcepts, setShowAllConcepts] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(0);

  // Fetch AI recommendations (async, non-blocking)
  useEffect(() => {
    let cancelled = false;
    setAiLoading(true);
    directCreative(content, graphicType)
      .then(result => {
        if (!cancelled && result) {
          setAiResult(result);
          // Auto-apply only if user hasn't manually selected
          if (!conceptId && !executionStyleId && !strategyId) {
            onSelect({
              conceptId: result.concept.id,
              executionStyleId: result.executionStyle.id,
              strategyId: result.strategy.id,
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAiLoading(false); });
    return () => { cancelled = true; };
  }, [content, graphicType]);

  // Quick heuristic for instant display
  const quickResult = useMemo(() => quickDirect(content, graphicType), [content, graphicType]);

  const thumbScale = 100 / preset.w;
  const thumbHeight = preset.h * thumbScale;

  const currentConcept = getConceptById(conceptId);
  const currentStrategy = CREATIVE_STRATEGIES.find(s => s.id === strategyId);
  const currentExec = EXECUTION_STYLES.find(s => s.id === executionStyleId);

  // Browse pool — all concepts, shuffled
  const browseConcepts = useMemo(() => {
    const shuffled = [...CREATIVE_CONCEPTS];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (shuffleSeed * 7 + i * 13) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [shuffleSeed]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5" style={{ color: NEON.purple }} />
          <span className="text-[10px] font-black tracking-widest uppercase" style={{ color: NEON.purple }}>
            Creative Direction
          </span>
          {aiLoading && <Loader2 className="w-3 h-3 animate-spin" style={{ color: NEON.purple }} />}
        </div>
        <button
          onClick={() => setShuffleSeed(s => s + 1)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
          style={{ background: `rgba(${NEON_RGB.purple}, 0.08)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.2)`, color: NEON.purple }}
        >
          <Shuffle className="w-3 h-3" /> Shuffle
        </button>
      </div>

      {/* AI Creative Brief */}
      {aiResult?.creativeBrief && (
        <div className="mb-3 p-3 rounded-xl" style={{ background: `rgba(${NEON_RGB.purple}, 0.06)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.15)` }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="w-2.5 h-2.5" style={{ color: NEON.purple }} />
            <span className="text-[9px] font-black tracking-widest uppercase" style={{ color: NEON.purple }}>Creative Brief</span>
          </div>
          <p className="text-[10px] text-foreground italic leading-tight">{aiResult.creativeBrief}</p>
        </div>
      )}

      {/* ── Decision 1: Creative Strategy ── */}
      <DecisionSection
        label="Creative Strategy"
        color={NEON.cyan}
        current={currentStrategy}
        aiReason={aiResult?.strategy?.reason}
        fallbackReason={quickResult.strategy.reason}
        isAi={!!aiResult}
      >
        <SimpleDropdown
          items={CREATIVE_STRATEGIES}
          selectedId={strategyId}
          onChange={id => onSelect({ strategyId: id })}
        />
      </DecisionSection>

      {/* ── Decision 2: Creative Concept ── */}
      <DecisionSection
        label="Creative Concept"
        color={NEON.purple}
        current={currentConcept}
        aiReason={aiResult?.concept?.reason}
        fallbackReason={quickResult.concept.reason}
        isAi={!!aiResult}
      >
        {/* AI recommended or current concept card with mini preview */}
        <div className="space-y-2">
          {currentConcept && (
            <ConceptCard
              concept={currentConcept}
              isSelected={true}
              onSelect={() => onSelect({ conceptId: null })}
              preset={preset}
              graphicType={graphicType}
              content={content}
              theme={theme}
              executionStyleId={executionStyleId}
              thumbScale={thumbScale}
              thumbHeight={thumbHeight}
              reason={aiResult?.concept?.reason}
            />
          )}

          <button
            onClick={() => setShowAllConcepts(!showAllConcepts)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold transition-all"
            style={{
              background: showAllConcepts ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
              color: showAllConcepts ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
            }}
          >
            <Lightbulb className="w-3 h-3" />
            {showAllConcepts ? 'Hide all concepts' : `Browse all ${CREATIVE_CONCEPTS.length} concepts`}
          </button>

          {showAllConcepts && (
            <div className="mt-2 space-y-3">
              {CONCEPT_FAMILIES.map(family => {
                const familyConcepts = browseConcepts.filter(c => c.family === family);
                if (familyConcepts.length === 0) return null;
                return (
                  <div key={family}>
                    <p className="text-[9px] font-black tracking-widest uppercase text-muted-foreground mb-1.5">
                      {CONCEPT_FAMILY_LABELS[family]}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {familyConcepts.map(concept => {
                        const isSelected = conceptId === concept.id;
                        return (
                          <button
                            key={concept.id}
                            onClick={() => { onSelect({ conceptId: isSelected ? null : concept.id }); setShowAllConcepts(false); }}
                            className="text-left rounded-lg p-2 transition-all active:scale-95"
                            style={{
                              border: isSelected ? `2px solid ${NEON.green}` : '1px solid hsl(var(--border))',
                              background: isSelected ? `rgba(${NEON_RGB.green}, 0.05)` : 'hsl(var(--card))',
                            }}
                          >
                            <span className="text-[10px] font-bold text-foreground block truncate">{concept.name}</span>
                            <span className="text-[8px] text-muted-foreground italic block truncate">{concept.references?.[0] || concept.inspiration}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DecisionSection>

      {/* ── Decision 3: Execution Style ── */}
      <DecisionSection
        label="Execution Style"
        color={NEON.pink}
        current={currentExec}
        aiReason={aiResult?.executionStyle?.reason}
        fallbackReason={quickResult.executionStyle.reason}
        isAi={!!aiResult}
      >
        <SimpleDropdown
          items={EXECUTION_STYLES}
          selectedId={executionStyleId}
          onChange={id => onSelect({ executionStyleId: id })}
        />
      </DecisionSection>

      {/* Reset */}
      {(conceptId || executionStyleId || strategyId) && (
        <button
          onClick={() => onSelect({ conceptId: null, executionStyleId: null, strategyId: null })}
          className="mt-3 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset to AI auto-select
        </button>
      )}
    </div>
  );
}

// ── Decision section wrapper ────────────────────────────────────────────
function DecisionSection({ label, color, current, aiReason, fallbackReason, isAi, children }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-black tracking-widest uppercase" style={{ color }}>
          {label}
        </span>
        {current && (
          <span className="text-[10px] font-bold text-foreground truncate">→ {current.name}</span>
        )}
      </div>
      {(aiReason || fallbackReason) && (
        <p className="text-[9px] text-muted-foreground italic mb-2 leading-tight" style={{ color: isAi ? `rgba(${NEON_RGB.purple}, 0.7)` : undefined }}>
          {isAi && <Sparkles className="w-2 h-2 inline mr-1" style={{ color: NEON.purple }} />}
          {aiReason || fallbackReason}
        </p>
      )}
      {children}
    </div>
  );
}

// ── Simple dropdown for strategy/exec style ─────────────────────────────
function SimpleDropdown({ items, selectedId, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = items.find(i => i.id === selectedId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm bg-background border border-border text-foreground outline-none focus:border-primary transition-colors"
      >
        <span className="font-bold text-xs">{selected?.name || 'Auto-select'}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-border shadow-lg"
          style={{ background: 'hsl(var(--popover))' }}>
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full px-3 py-2.5 text-sm text-left transition-colors hover:bg-muted"
          >
            <span className="font-bold text-muted-foreground">Auto-select</span>
          </button>
          {items.map(item => (
            <button
              key={item.id}
              onClick={() => { onChange(item.id); setOpen(false); }}
              className="w-full px-3 py-2.5 text-sm text-left transition-colors hover:bg-muted"
              style={selectedId === item.id ? { background: `rgba(${NEON_RGB.purple}, 0.08)` } : {}}
            >
              <span className="font-bold text-foreground block">{item.name}</span>
              <span className="text-[9px] text-muted-foreground block leading-tight">{item.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Concept card with mini preview ──────────────────────────────────────
function ConceptCard({ concept, isSelected, onSelect, preset, graphicType, content, theme, executionStyleId, thumbScale, thumbHeight, reason }) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-xl overflow-hidden transition-all active:scale-[0.98]"
      style={{
        border: isSelected ? `2px solid ${NEON.green}` : `1px solid hsl(var(--border))`,
        background: isSelected ? `rgba(${NEON_RGB.green}, 0.05)` : 'hsl(var(--card))',
        boxShadow: isSelected ? `0 0 12px rgba(${NEON_RGB.green}, 0.15)` : 'none',
      }}
    >
      <div className="flex gap-3 p-2.5">
        {/* Mini preview thumbnail */}
        <div className="flex-shrink-0 rounded-lg overflow-hidden relative" style={{ width: 60, height: thumbHeight, border: '1px solid hsl(var(--border))' }}>
          <div style={{ transform: `scale(${thumbScale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
            <GraphicCanvas preset={preset} graphicType={graphicType} content={content} theme={theme} conceptId={concept.id} executionStyleId={executionStyleId} />
          </div>
        </div>

        {/* Concept metadata */}
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            {reason && <Sparkles className="w-2.5 h-2.5 flex-shrink-0" style={{ color: NEON.purple }} />}
            <span className="text-xs font-bold text-foreground truncate">{concept.name}</span>
            {isSelected && <Check className="w-3 h-3 flex-shrink-0 ml-auto" style={{ color: NEON.green }} />}
          </div>
          <p className="text-[9px] text-muted-foreground mb-1 italic truncate">
            Inspired by {concept.references?.join(', ') || concept.inspiration}
          </p>
          <p className="text-[9px] text-muted-foreground leading-tight line-clamp-2">
            {concept.mood}
          </p>
          {reason && (
            <p className="text-[8px] mt-1 leading-tight line-clamp-2" style={{ color: `rgba(${NEON_RGB.purple}, 0.8)` }}>
              {reason}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}