/**
 * Creative Edit Panel — Conversational Design Director
 * --------------------------------------------------------------------
 * The user talks to a Creative Director, not a graphics engine.
 *
 * Philosophy:
 *   - Creative Intent dimensions are internal — never exposed to users
 *   - The AI explains the current direction in natural language
 *   - Quick edits are plain-English creative directions, not technical controls
 *   - Locks and regeneration exist but are tucked away, not front-and-center
 *   - Version history is lightweight — restore/favorite, not a debugger
 *
 * If a feature requires the user to understand the rendering engine,
 * it is too complicated. The renderer should be intelligent enough
 * that users think in ideas, not implementation.
 */
import { useState } from 'react';
import { Wand2, Loader2, ChevronDown, ChevronUp, Send, Sparkles, Lock, RefreshCw, RotateCcw, Star, MessageCircle } from 'lucide-react';
import { QUICK_EDITS } from '@/lib/marketing/creativeEdit';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

export default function CreativeEditPanel({
  directionSummary = '',
  creativeLocks = {},
  creativeVersions = [],
  onApplyEdit,
  onRegenerateSystem,
  onToggleLock,
  onRestoreVersion,
  onFavoriteVersion,
  onReset,
  isApplying = false,
  regeneratingSystem = null,
}) {
  const [instruction, setInstruction] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleApply = () => {
    if (!instruction.trim() || isApplying) return;
    onApplyEdit(instruction.trim());
    setInstruction('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleApply();
    }
  };

  const lockedCount = Object.values(creativeLocks).filter(Boolean).length;
  const favoriteVersions = creativeVersions.filter(v => v.is_favorite);
  const recentVersions = [...creativeVersions].reverse().slice(0, 5);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: `rgba(${NEON_RGB.pink}, 0.04)`, border: `1px solid rgba(${NEON_RGB.pink}, 0.15)` }}>
      {/* Header */}
      <div className="px-4 py-3.5 flex items-center gap-2">
        <MessageCircle className="w-4 h-4" style={{ color: NEON.pink }} />
        <span className="text-sm font-bold text-foreground">Creative Director</span>
        {isApplying && <Loader2 className="w-3 h-3 animate-spin" style={{ color: NEON.pink }} />}
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Current Direction — natural language, not raw intent dimensions */}
        {directionSummary && (
          <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: 'hsl(var(--card))' }}>
            <Sparkles className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: NEON.purple }} />
            <div>
              <p className="text-[9px] font-bold tracking-widest uppercase mb-0.5" style={{ color: NEON.purple }}>Current Direction</p>
              <p className="text-[11px] text-foreground leading-snug italic">{directionSummary}</p>
            </div>
          </div>
        )}

        {/* Conversation input */}
        <div className="flex gap-2">
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a creative change... e.g. 'Make it feel like an Apple keynote'"
            rows={2}
            className="flex-1 px-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors resize-none"
          />
          <button
            onClick={handleApply}
            disabled={isApplying || !instruction.trim()}
            className="flex items-center justify-center gap-1.5 px-4 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-40 flex-shrink-0"
            style={{ background: NEON.pink, color: '#ffffff' }}
          >
            {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Quick creative directions — plain English, not technical */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_EDITS.map(qe => (
            <button
              key={qe.label}
              onClick={() => onApplyEdit(qe.instruction)}
              disabled={isApplying}
              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `rgba(${NEON_RGB.pink}, 0.08)`, border: `1px solid rgba(${NEON_RGB.pink}, 0.15)`, color: NEON.pink }}
            >
              {qe.label}
            </button>
          ))}
        </div>

        {/* Recent edits — lightweight, conversational */}
        {recentVersions.length > 0 && (
          <div className="space-y-1">
            {recentVersions.map((version) => (
              <div key={version.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg group" style={{ background: 'hsl(var(--card))' }}>
                <p className="flex-1 text-[10px] text-foreground leading-tight truncate">
                  <span className="text-muted-foreground">"{version.instruction}"</span>
                  <span className="text-foreground"> → {version.summary}</span>
                </p>
                <button
                  onClick={() => onFavoriteVersion(version.id)}
                  className="p-1 rounded transition-opacity flex-shrink-0"
                  style={{ opacity: version.is_favorite ? 1 : 0.3 }}
                >
                  <Star className="w-2.5 h-2.5" style={version.is_favorite ? { color: NEON.yellow, fill: NEON.yellow } : { color: 'hsl(var(--muted-foreground))' }} />
                </button>
                <button
                  onClick={() => onRestoreVersion(version.id)}
                  className="p-1 rounded transition-opacity flex-shrink-0 opacity-30 group-hover:opacity-100"
                  title="Restore this version"
                >
                  <RotateCcw className="w-2.5 h-2.5" style={{ color: NEON.cyan }} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Favorite versions — quick access to saved directions */}
        {favoriteVersions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] font-bold text-muted-foreground">Saved:</span>
            {favoriteVersions.map(v => (
              <button
                key={v.id}
                onClick={() => onRestoreVersion(v.id)}
                className="px-2 py-1 rounded-lg text-[9px] font-bold transition-all active:scale-95"
                style={{ background: `rgba(${NEON_RGB.yellow}, 0.08)`, border: `1px solid rgba(${NEON_RGB.yellow}, 0.2)`, color: NEON.yellow }}
              >
                <Star className="w-2 h-2 inline mr-1" style={{ fill: NEON.yellow }} />
                {v.name || v.instruction.slice(0, 20)}
              </button>
            ))}
          </div>
        )}

        {/* Advanced — tucked away, not front-and-center */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Advanced
          {lockedCount > 0 && <span className="ml-1 px-1 py-0.5 rounded-full text-[7px]" style={{ background: `rgba(${NEON_RGB.yellow}, 0.15)`, color: NEON.yellow }}>{lockedCount} locked</span>}
        </button>

        {showAdvanced && (
          <div className="space-y-3 pt-1 border-t border-border">
            {/* Locks — protect specific aspects from AI changes */}
            <div>
              <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Protect from changes
              </p>
              <div className="flex flex-wrap gap-1">
                {LOCK_LABELS.map(({ key, label }) => {
                  const isLocked = creativeLocks[key];
                  return (
                    <button
                      key={key}
                      onClick={() => onToggleLock(key)}
                      className="px-2 py-1 rounded-lg text-[9px] font-bold transition-all active:scale-95 flex items-center gap-0.5"
                      style={isLocked
                        ? { background: `rgba(${NEON_RGB.yellow}, 0.1)`, border: `1px solid rgba(${NEON_RGB.yellow}, 0.3)`, color: NEON.yellow }
                        : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
                    >
                      {isLocked && <Lock className="w-2 h-2" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Regenerate — start fresh on a specific aspect */}
            <div>
              <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
                <RefreshCw className="w-2.5 h-2.5" /> Start fresh on
              </p>
              <div className="flex flex-wrap gap-1">
                {REGEN_LABELS.map(({ key, label }) => {
                  const isRegenerating = regeneratingSystem === key;
                  return (
                    <button
                      key={key}
                      onClick={() => onRegenerateSystem(key)}
                      disabled={isApplying || !!regeneratingSystem}
                      className="px-2 py-1 rounded-lg text-[9px] font-bold transition-all active:scale-95 disabled:opacity-40 flex items-center gap-0.5"
                      style={{ background: `rgba(${NEON_RGB.cyan}, 0.08)`, border: `1px solid rgba(${NEON_RGB.cyan}, 0.15)`, color: NEON.cyan }}
                    >
                      {isRegenerating ? <Loader2 className="w-2 h-2 animate-spin" /> : <RefreshCw className="w-2 h-2" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Reset */}
            <button
              onClick={onReset}
              disabled={isApplying}
              className="text-[9px] font-bold text-muted-foreground hover:text-foreground transition-colors"
            >
              Start over with creative direction
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline label maps — avoids importing the full system definitions
// which would expose technical structure in the component.
const LOCK_LABELS = [
  { key: 'layout', label: 'Layout' },
  { key: 'typography', label: 'Type' },
  { key: 'background', label: 'Background' },
  { key: 'colors', label: 'Colors' },
  { key: 'decorative', label: 'Decor' },
  { key: 'imagery', label: 'Imagery' },
  { key: 'logo', label: 'Logo' },
  { key: 'cta', label: 'CTA' },
];

const REGEN_LABELS = [
  { key: 'background', label: 'Background' },
  { key: 'typography', label: 'Type' },
  { key: 'decorations', label: 'Decor' },
  { key: 'layout', label: 'Layout' },
  { key: 'colors', label: 'Colors' },
  { key: 'hierarchy', label: 'Focus' },
  { key: 'cta', label: 'CTA' },
];