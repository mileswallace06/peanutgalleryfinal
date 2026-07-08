/**
 * Creative Edit Panel
 * --------------------------------------------------------------------
 * Conversational design control. The user types a natural-language
 * instruction, the AI returns Creative Intent (semantic), the Intent
 * Translator converts it to rendering modifications, and the graphic
 * re-renders immediately.
 *
 * The AI thinks like a Creative Director: emotion, story, hierarchy,
 * atmosphere, energy. It does NOT specify implementation details.
 *
 * Includes:
 *   - Instruction input + Apply button
 *   - Quick edit presets (intent-focused, not override-focused)
 *   - Current Creative Intent display (transparency)
 *   - Creative Locks (protect design categories from AI edits)
 *   - System Regeneration (regenerate just background, typography, etc.)
 *   - Version History (snapshots with restore, favorite, branch, name)
 */
import { useState } from 'react';
import { Wand2, Loader2, ChevronDown, ChevronUp, Send, Sparkles, RefreshCw, Lock } from 'lucide-react';
import { QUICK_EDITS } from '@/lib/marketing/creativeEdit';
import { INTENT_DIMENSIONS, REGENERATABLE_SYSTEMS, hasActiveIntent } from '@/lib/marketing/creativeIntent';
import CreativeLocks from './CreativeLocks';
import VersionHistory from './VersionHistory';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

export default function CreativeEditPanel({
  creativeIntent = {},
  creativeLocks = {},
  creativeVersions = [],
  onApplyEdit,
  onRegenerateSystem,
  onToggleLock,
  onRestoreVersion,
  onFavoriteVersion,
  onNameVersion,
  onReset,
  isApplying = false,
  regeneratingSystem = null,
}) {
  const [open, setOpen] = useState(true);
  const [instruction, setInstruction] = useState('');
  const [showLocks, setShowLocks] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);

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

  const activeDims = Object.entries(creativeIntent).filter(([, v]) => v != null && v !== '');
  const hasIntent = hasActiveIntent(creativeIntent);
  const lockedCount = Object.values(creativeLocks).filter(Boolean).length;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: `rgba(${NEON_RGB.pink}, 0.04)`, border: `1px solid rgba(${NEON_RGB.pink}, 0.15)` }}>
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-muted/50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4" style={{ color: NEON.pink }} />
          <span className="text-sm font-bold text-foreground">Creative Edit</span>
          {hasIntent && (
            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-black" style={{ background: `rgba(${NEON_RGB.green}, 0.15)`, color: NEON.green }}>
              {activeDims.length} ACTIVE
            </span>
          )}
          {lockedCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-black flex items-center gap-0.5" style={{ background: `rgba(${NEON_RGB.yellow}, 0.15)`, color: NEON.yellow }}>
              <Lock className="w-2 h-2" /> {lockedCount}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: NEON.pink }}>
            Describe a creative change — the AI thinks like a Creative Director
          </p>

          {/* Instruction input */}
          <div className="flex gap-2">
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Make this feel more premium and give the headline more dominance..."
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
              Apply
            </button>
          </div>

          {/* Quick edits */}
          <div>
            <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground mb-1.5">Quick Edits</p>
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
          </div>

          {/* Current Creative Intent display */}
          {hasIntent && (
            <div className="rounded-xl p-3" style={{ background: 'hsl(var(--card))' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="w-2.5 h-2.5" style={{ color: NEON.purple }} />
                <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: NEON.purple }}>Current Creative Intent</span>
              </div>
              <div className="space-y-0.5">
                {activeDims.map(([key, val]) => {
                  const dimDef = INTENT_DIMENSIONS[key];
                  return (
                    <div key={key} className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">{dimDef?.label || key}</span>
                      <span className="font-bold text-foreground">{String(val)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Creative Locks toggle */}
          <button
            onClick={() => setShowLocks(!showLocks)}
            className="flex items-center gap-1.5 text-[10px] font-bold transition-colors"
            style={{ color: lockedCount > 0 ? NEON.yellow : 'hsl(var(--muted-foreground))' }}
          >
            <Lock className="w-3 h-3" />
            Creative Locks {lockedCount > 0 && `(${lockedCount} locked)`}
            {showLocks ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showLocks && (
            <CreativeLocks locks={creativeLocks} onToggle={onToggleLock} />
          )}

          {/* System Regeneration toggle */}
          <button
            onClick={() => setShowRegenerate(!showRegenerate)}
            className="flex items-center gap-1.5 text-[10px] font-bold transition-colors"
            style={{ color: showRegenerate ? NEON.cyan : 'hsl(var(--muted-foreground))' }}
          >
            <RefreshCw className="w-3 h-3" />
            Regenerate Individual Systems
            {showRegenerate ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showRegenerate && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(REGENERATABLE_SYSTEMS).map(([key, def]) => {
                const isRegenerating = regeneratingSystem === key;
                return (
                  <button
                    key={key}
                    onClick={() => onRegenerateSystem(key)}
                    disabled={isApplying || !!regeneratingSystem}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: `rgba(${NEON_RGB.cyan}, 0.08)`, border: `1px solid rgba(${NEON_RGB.cyan}, 0.15)`, color: NEON.cyan }}
                  >
                    {isRegenerating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                    {def.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Version History */}
          <VersionHistory
            versions={creativeVersions}
            currentIntent={creativeIntent}
            onRestore={onRestoreVersion}
            onFavorite={onFavoriteVersion}
            onName={onNameVersion}
          />

          {/* Reset */}
          {hasIntent && (
            <button
              onClick={onReset}
              disabled={isApplying}
              className="text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset all creative intent
            </button>
          )}
        </div>
      )}
    </div>
  );
}