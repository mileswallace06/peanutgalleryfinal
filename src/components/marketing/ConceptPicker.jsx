/**
 * Concept Picker — Creative Concept Selection
 * --------------------------------------------------------------------
 * Shows AI-recommended Creative Concepts, each with its inspiration,
 * story, emotion, and visual metaphor.
 *
 * The user picks a VISUAL WORLD — not a layout.
 * "I want this to feel like an Apple keynote."
 * NOT "I'll place the headline at x=80."
 */
import { useState, useEffect, useMemo } from 'react';
import { Shuffle, Check, Sparkles, Wand2, Loader2, Lightbulb } from 'lucide-react';
import GraphicCanvas from './canvas/GraphicCanvas';
import { CONCEPT_LIBRARY, CONCEPT_FAMILIES, CONCEPT_FAMILY_LABELS, getConceptById } from '@/lib/marketing/conceptLibrary';
import { recommendConcepts, quickSuggest } from '@/lib/marketing/conceptSelector';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

export default function ConceptPicker({ content, graphicType, theme, preset, selectedId, onSelect }) {
  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(0);

  // Quick local suggestions for instant display
  const quickRecs = useMemo(() => quickSuggest(content, graphicType), [content, graphicType]);

  // Fetch AI recommendations (async, non-blocking)
  useEffect(() => {
    let cancelled = false;
    setAiLoading(true);
    recommendConcepts(content, graphicType, 3)
      .then(recs => {
        if (!cancelled && recs.length > 0) {
          setAiRecommendations(recs);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAiLoading(false); });
    return () => { cancelled = true; };
  }, [content, graphicType]);

  // The concepts to show as cards
  const displayConcepts = useMemo(() => {
    if (aiRecommendations.length > 0) {
      return aiRecommendations.map(r => ({
        ...getConceptById(r.conceptId),
        reason: r.reason,
        fitScore: r.fitScore,
        isAiRecommended: true,
      })).filter(Boolean);
    }
    // Fallback to quick suggestions
    return quickRecs.map(r => ({
      ...getConceptById(r.conceptId),
      reason: r.reason,
      fitScore: r.fitScore,
      isAiRecommended: false,
    })).filter(Boolean);
  }, [aiRecommendations, quickRecs]);

  // Browse pool — all concepts, shuffled
  const browseConcepts = useMemo(() => {
    const shuffled = [...CONCEPT_LIBRARY];
    // Simple shuffle based on seed
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (shuffleSeed * 7 + i * 13) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [shuffleSeed]);

  const thumbScale = 100 / preset.w;
  const thumbHeight = preset.h * thumbScale;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5" style={{ color: NEON.purple }} />
          <span className="text-[10px] font-black tracking-widest uppercase" style={{ color: NEON.purple }}>
            Creative Concept
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

      {/* AI Recommended Concepts */}
      <div className="space-y-2 mb-4">
        {displayConcepts.map(concept => {
          const isSelected = selectedId === concept.id;
          return (
            <button
              key={concept.id}
              onClick={() => onSelect(isSelected ? null : concept.id)}
              className="w-full text-left rounded-xl overflow-hidden transition-all active:scale-[0.98]"
              style={{
                border: isSelected
                  ? `2px solid ${NEON.green}`
                  : `1px solid hsl(var(--border))`,
                background: isSelected ? `rgba(${NEON_RGB.green}, 0.05)` : 'hsl(var(--card))',
                boxShadow: isSelected ? `0 0 12px rgba(${NEON_RGB.green}, 0.15)` : 'none',
              }}
            >
              <div className="flex gap-3 p-2.5">
                {/* Mini preview thumbnail */}
                <div className="flex-shrink-0 rounded-lg overflow-hidden relative" style={{ width: 60, height: thumbHeight, border: '1px solid hsl(var(--border))' }}>
                  <div style={{ transform: `scale(${thumbScale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
                    <GraphicCanvas preset={preset} graphicType={graphicType} content={content} theme={theme} conceptId={concept.id} />
                  </div>
                </div>

                {/* Concept metadata */}
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {concept.isAiRecommended && (
                      <Sparkles className="w-2.5 h-2.5 flex-shrink-0" style={{ color: NEON.purple }} />
                    )}
                    <span className="text-xs font-bold text-foreground truncate">{concept.name}</span>
                    {isSelected && <Check className="w-3 h-3 flex-shrink-0 ml-auto" style={{ color: NEON.green }} />}
                  </div>
                  <p className="text-[9px] text-muted-foreground mb-1 italic truncate">
                    Inspired by {concept.inspiration}
                  </p>
                  <p className="text-[9px] text-muted-foreground leading-tight line-clamp-2">
                    {concept.emotion}
                  </p>
                  {concept.reason && (
                    <p className="text-[8px] mt-1 leading-tight line-clamp-2" style={{ color: `rgba(${NEON_RGB.purple}, 0.8)` }}>
                      {concept.reason}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Browse all concepts */}
      <button
        onClick={() => setShowAll(!showAll)}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold transition-all"
        style={{
          background: showAll ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
          color: showAll ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
        }}
      >
        <Lightbulb className="w-3 h-3" />
        {showAll ? 'Hide all concepts' : `Browse all ${CONCEPT_LIBRARY.length} concepts`}
      </button>

      {showAll && (
        <div className="mt-3 space-y-3">
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
                    const isSelected = selectedId === concept.id;
                    return (
                      <button
                        key={concept.id}
                        onClick={() => { onSelect(isSelected ? null : concept.id); setShowAll(false); }}
                        className="text-left rounded-lg p-2 transition-all active:scale-95"
                        style={{
                          border: isSelected ? `2px solid ${NEON.green}` : '1px solid hsl(var(--border))',
                          background: isSelected ? `rgba(${NEON_RGB.green}, 0.05)` : 'hsl(var(--card))',
                        }}
                      >
                        <span className="text-[10px] font-bold text-foreground block truncate">{concept.name}</span>
                        <span className="text-[8px] text-muted-foreground italic block truncate">{concept.inspiration}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedId ? (
        <button
          onClick={() => onSelect(null)}
          className="mt-3 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset to auto-select
        </button>
      ) : (
        <p className="mt-3 text-[9px] text-muted-foreground flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5" /> AI selects the best concept based on your content's story & emotion
        </p>
      )}
    </div>
  );
}