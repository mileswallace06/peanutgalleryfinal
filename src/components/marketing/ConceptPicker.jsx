/**
 * ConceptPicker — Multi-Concept Generation
 * --------------------------------------------------------------------
 * Shows 3 composition concepts with different visual approaches.
 * The user picks one, or shuffles to see more.
 * "What is the strongest visual way to communicate this message?"
 */
import { useState, useMemo } from 'react';
import { Shuffle, Check, Sparkles, Wand2 } from 'lucide-react';
import GraphicCanvas from './canvas/GraphicCanvas';
import { getRankedCompositions } from '@/lib/marketing/compositionEngine';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

export default function ConceptPicker({ content, graphicType, theme, preset, selectedId, onSelect }) {
  const [shuffleOffset, setShuffleOffset] = useState(0);

  const ranked = useMemo(() => getRankedCompositions(content, graphicType), [content, graphicType]);

  const concepts = useMemo(() => {
    const result = [];
    const usedClusters = new Set();
    const usedIds = new Set();

    for (let i = shuffleOffset; i < ranked.length + shuffleOffset && result.length < 3; i++) {
      const comp = ranked[i % ranked.length];
      if (usedIds.has(comp.id)) continue;
      if (!usedClusters.has(comp.cluster) || result.length >= 2) {
        result.push(comp);
        usedClusters.add(comp.cluster);
        usedIds.add(comp.id);
      }
    }
    for (const comp of ranked) {
      if (result.length >= 3) break;
      if (!usedIds.has(comp.id)) { result.push(comp); usedIds.add(comp.id); }
    }
    return result.slice(0, 3);
  }, [ranked, shuffleOffset]);

  const thumbScale = 105 / preset.w;
  const thumbHeight = preset.h * thumbScale;
  const autoId = ranked[0]?.id;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5" style={{ color: NEON.purple }} />
          <span className="text-[10px] font-black tracking-widest uppercase" style={{ color: NEON.purple }}>
            Concepts
          </span>
        </div>
        <button
          onClick={() => setShuffleOffset(prev => prev + 1)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
          style={{ background: `rgba(${NEON_RGB.purple}, 0.08)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.2)`, color: NEON.purple }}
        >
          <Shuffle className="w-3 h-3" /> Shuffle
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {concepts.map(concept => {
          const isSelected = selectedId === concept.id;
          const isAuto = !selectedId && concept.id === autoId;
          const highlight = isSelected || isAuto;
          return (
            <button
              key={concept.id}
              onClick={() => onSelect(isSelected ? null : concept.id)}
              className="flex flex-col items-center gap-1.5 transition-all active:scale-95"
            >
              <div
                className="relative w-full rounded-lg overflow-hidden transition-all"
                style={{
                  height: thumbHeight,
                  border: highlight
                    ? `2px solid ${isSelected ? NEON.green : NEON.purple}`
                    : '1px solid hsl(var(--border))',
                  boxShadow: isSelected ? `0 0 12px rgba(${NEON_RGB.green}, 0.25)` : 'none',
                }}
              >
                <div
                  style={{
                    transform: `scale(${thumbScale})`,
                    transformOrigin: 'top left',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                  }}
                >
                  <GraphicCanvas
                    preset={preset}
                    graphicType={graphicType}
                    content={content}
                    theme={theme}
                    compositionId={concept.id}
                  />
                </div>
                {highlight && (
                  <div
                    className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: isSelected ? NEON.green : NEON.purple }}
                  >
                    <Check className="w-3 h-3" style={{ color: '#000' }} />
                  </div>
                )}
              </div>
              <span
                className="text-[9px] font-bold text-center leading-tight"
                style={{ color: highlight ? (isSelected ? NEON.green : NEON.purple) : 'hsl(var(--muted-foreground))' }}
              >
                {concept.name}
              </span>
            </button>
          );
        })}
      </div>

      {selectedId ? (
        <button
          onClick={() => onSelect(null)}
          className="mt-2 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset to auto-select
        </button>
      ) : (
        <p className="mt-2 text-[9px] text-muted-foreground flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5" /> Auto-selected based on your content
        </p>
      )}
    </div>
  );
}