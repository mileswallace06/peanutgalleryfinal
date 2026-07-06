/**
 * Creative Edit Panel
 * --------------------------------------------------------------------
 * Conversational design control. The user types a natural-language
 * instruction, the AI converts it to structured designOverrides,
 * and the graphic re-renders immediately.
 *
 * Includes: instruction input, apply button, quick edit presets,
 * edit history with undo, and reset all.
 */
import { useState } from 'react';
import { Wand2, Loader2, ChevronDown, ChevronUp, Undo2, RotateCcw, Send, History } from 'lucide-react';
import { QUICK_EDITS } from '@/lib/marketing/creativeEdit';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

export default function CreativeEditPanel({
  editHistory = [],
  onApplyEdit,
  onUndo,
  onReset,
  isApplying = false,
  hasOverrides = false,
}) {
  const [open, setOpen] = useState(true);
  const [instruction, setInstruction] = useState('');

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
          {hasOverrides && (
            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-black" style={{ background: `rgba(${NEON_RGB.green}, 0.15)`, color: NEON.green }}>
              ACTIVE
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: NEON.pink }}>
            Describe a design change — the AI adjusts the current graphic
          </p>

          {/* Instruction input */}
          <div className="flex gap-2">
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Make the headline bigger and move the text lower..."
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

          {/* History + actions */}
          {editHistory.length > 0 && (
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <History className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
                    Edit History ({editHistory.length})
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={onUndo}
                    disabled={isApplying}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors hover:bg-muted disabled:opacity-40"
                    style={{ color: NEON.cyan }}
                  >
                    <Undo2 className="w-3 h-3" /> Undo
                  </button>
                  <button
                    onClick={onReset}
                    disabled={isApplying}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors hover:bg-muted disabled:opacity-40"
                    style={{ color: NEON.pink }}
                  >
                    <RotateCcw className="w-3 h-3" /> Reset
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {[...editHistory].reverse().map((entry, i) => (
                  <div key={i} className="px-2.5 py-2 rounded-lg" style={{ background: 'hsl(var(--card))' }}>
                    <p className="text-[10px] font-bold text-foreground truncate">"{entry.instruction}"</p>
                    <p className="text-[9px] text-muted-foreground italic leading-tight">→ {entry.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reset when overrides exist but history is empty (e.g. loaded from saved asset) */}
          {hasOverrides && editHistory.length === 0 && (
            <button
              onClick={onReset}
              disabled={isApplying}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-colors hover:bg-muted"
              style={{ color: NEON.pink }}
            >
              <RotateCcw className="w-3 h-3" /> Reset all edits
            </button>
          )}
        </div>
      )}
    </div>
  );
}