/**
 * Element Toolbar — Canvas-Native Inline Interaction
 * --------------------------------------------------------------------
 * The canvas is the interface. Not a side panel.
 *
 * When you select an element, this toolbar floats above the canvas
 * with everything you need: identity, quick actions, Ask AI, Explain,
 * and AI responses with confidence + critique.
 *
 * This is Figma, not a chatbot.
 */
import { useState, useEffect, useRef } from 'react';
import {
  X, Send, Loader2, Info, AlertTriangle, Check, Sparkles,
  Maximize2, Minimize2, Bold, Move, Eye, Moon, Crown, Cloud,
  Square, ArrowUp,
} from 'lucide-react';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';
import { getImportanceStyle } from '@/lib/marketing/elementBrain';

const ICON_MAP = {
  Maximize2, Minimize2, Bold, Sparkles, Move, Eye,
  Moon, Crown, Cloud, Square, ArrowUp,
};

const CONFIDENCE_CONFIG = {
  high: { color: NEON.green, rgb: NEON_RGB.green, label: 'Very confident', icon: Check },
  medium: { color: NEON.cyan, rgb: NEON_RGB.cyan, label: 'Pretty confident', icon: Sparkles },
  low: { color: NEON.yellow, rgb: NEON_RGB.yellow, label: 'Not fully confident', icon: Info },
};

export default function ElementToolbar({
  brain, onAskAI, onExplain, onClose, isApplying, aiResponse,
}) {
  const [instruction, setInstruction] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { setInstruction(''); }, [brain.identity.label]);
  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  const importanceStyle = getImportanceStyle(brain.importance);

  const handleSend = async () => {
    if (!instruction.trim() || isApplying) return;
    await onAskAI(instruction.trim());
    setInstruction('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') onClose();
  };

  const handleQuickAction = async (action) => {
    if (isApplying) return;
    await onAskAI(action.instruction);
  };

  const conf = aiResponse?.confidence ? CONFIDENCE_CONFIG[aiResponse.confidence] : null;
  const hasCritique = aiResponse?.critique && aiResponse.critique.reason;

  return (
    <div
      className="absolute z-40 left-1/2 top-3 w-[92%] max-w-md"
      style={{ transform: 'translateX(-50%)', transition: 'opacity 0.15s ease-out' }}
    >
      <div
        className="rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: 'hsl(var(--card))',
          border: `1px solid ${importanceStyle.color}40`,
          boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${importanceStyle.color}15`,
        }}
      >
        {/* Header — element identity */}
        <div
          className="px-3 py-2.5 flex items-center gap-2.5"
          style={{ background: importanceStyle.glow, borderBottom: `1px solid ${importanceStyle.color}20` }}
        >
          <div className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: importanceStyle.color }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black text-foreground leading-tight truncate">{brain.identity.semanticName}</p>
            <p className="text-[9px] text-muted-foreground leading-tight">
              <span style={{ color: importanceStyle.color, fontWeight: 700 }}>{importanceStyle.label}</span>
              {" · "}
              {brain.identity.label}
              {" · "}
              {brain.role.type}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Quick actions */}
        {brain.quickActions.length > 0 && (
          <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-border">
            {brain.quickActions.map((action, i) => {
              const Icon = ICON_MAP[action.icon] || Sparkles;
              return (
                <button
                  key={i}
                  onClick={() => handleQuickAction(action)}
                  disabled={isApplying}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold transition-all active:scale-95 disabled:opacity-30"
                  style={{
                    background: `rgba(${NEON_RGB.pink}, 0.06)`,
                    border: `1px solid rgba(${NEON_RGB.pink}, 0.12)`,
                    color: NEON.pink,
                  }}
                >
                  <Icon className="w-2.5 h-2.5" />
                  {action.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Ask AI input */}
        <div className="px-3 py-2 flex gap-2 items-center border-b border-border">
          <textarea
            ref={inputRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask AI about the ${brain.identity.label.toLowerCase()}...`}
            rows={1}
            className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors resize-none max-h-20"
            style={{ minHeight: 30 }}
          />
          <button
            onClick={handleSend}
            disabled={isApplying || !instruction.trim()}
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-all active:scale-95 disabled:opacity-30 flex-shrink-0"
            style={{ background: NEON.pink, color: '#fff' }}
          >
            {isApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
        </div>

        {/* Explain button */}
        <div className="px-3 py-1.5 border-b border-border">
          <button
            onClick={() => onExplain()}
            disabled={isApplying}
            className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          >
            <Info className="w-3 h-3" />
            Explain this element's role
          </button>
        </div>

        {/* AI Response — confidence + explanation + critique */}
        {aiResponse && (
          <div className="px-3 py-2.5 space-y-2" style={{ background: 'hsl(var(--muted))' }}>
            {conf && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: conf.color }} />
                <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: conf.color }}>
                  {conf.label}
                </span>
                {aiResponse.type === 'edit' && aiResponse.agrees === false && (
                  <span className="text-[9px] font-bold text-destructive flex items-center gap-0.5">
                    <AlertTriangle className="w-2.5 h-2.5" /> Pushing back
                  </span>
                )}
              </div>
            )}

            {aiResponse.explanation && (
              <p className="text-[11px] text-foreground leading-snug">{aiResponse.explanation}</p>
            )}

            {hasCritique && (
              <div
                className="rounded-lg p-2 space-y-1"
                style={{ background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.15)' }}
              >
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" style={{ color: NEON.orange }} />
                  <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: NEON.orange }}>
                    {aiResponse.critique.suggestion ? "Recommend instead" : "Concern"}
                  </span>
                </div>
                <p className="text-[10px] text-foreground leading-snug">{aiResponse.critique.reason}</p>
                {aiResponse.critique.suggestion && (
                  <p className="text-[10px] leading-snug" style={{ color: NEON.cyan }}>
                    {"→ "}{aiResponse.critique.suggestion}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}