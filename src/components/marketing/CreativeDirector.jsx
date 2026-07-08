/**
 * Creative Director — Conversational Workspace
 * --------------------------------------------------------------------
 * The primary interface for the Marketing Studio.
 *
 * Philosophy:
 *   - The conversation IS the product. Everything else supports it.
 *   - No panels. No property editors. Just you and your Creative Director.
 *   - Click an element → describe a change → it changes.
 *   - The AI proactively observes, explains what it changed, and
 *     understands aesthetic references.
 *   - Version history is the conversation. Locks and reset are tucked away.
 *
 * This feels like sitting beside an elite designer, pointing at the
 * screen and saying "make that better."
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Sparkles, Send, Loader2, MousePointerClick, X, Star, RotateCcw,
  ChevronDown, ChevronUp, Lock, Eye, Lightbulb, Check, MessageSquare,
} from 'lucide-react';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';
import { getElementLabel } from '@/lib/marketing/elementRegistry';
import { GLOBAL_SUGGESTIONS, ELEMENT_SUGGESTIONS } from '@/lib/marketing/creativeConversation';

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

export default function CreativeDirector({
  // Context
  concept, executionStyle, currentIntent = {}, currentLocks = {},
  directionDescription = '', creativeVersions = [], observations = [],

  // Element selection
  editMode = false, selectedElement = null,
  onToggleEditMode, onDeselectElement,

  // Actions
  onApplyEdit, onApplyElementEdit, onRestoreVersion, onFavoriteVersion,
  onToggleLock, onReset,

  // State
  isApplying = false,
}) {
  const [instruction, setInstruction] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Derive conversation messages from versions + observations
  const messages = useMemo(() => {
    const msgs = [];
    for (const v of creativeVersions) {
      msgs.push({ type: 'user', text: v.instruction, id: v.id + '_u', timestamp: v.timestamp });
      msgs.push({
        type: 'ai', text: v.explanation || v.summary,
        direction: v.direction_description, id: v.id + '_a',
        timestamp: v.timestamp, versionId: v.id, isFavorite: v.is_favorite,
      });
    }
    for (const obs of observations) {
      msgs.push({ type: 'observation', ...obs });
    }
    msgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return msgs;
  }, [creativeVersions, observations]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isApplying]);

  // Focus input when element is selected
  useEffect(() => {
    if (selectedElement && inputRef.current) {
      inputRef.current.focus();
    }
  }, [selectedElement]);

  const handleSend = () => {
    if (!instruction.trim() || isApplying) return;
    if (editMode && selectedElement) {
      onApplyElementEdit(selectedElement, instruction.trim());
    } else {
      onApplyEdit(instruction.trim());
    }
    setInstruction('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && selectedElement) {
      onDeselectElement();
    }
  };

  const handleSuggestion = (suggestionInstruction) => {
    if (isApplying) return;
    if (editMode && selectedElement) {
      onApplyElementEdit(selectedElement, suggestionInstruction);
    } else {
      onApplyEdit(suggestionInstruction);
    }
  };

  const suggestions = editMode && selectedElement
    ? (ELEMENT_SUGGESTIONS[selectedElement] || [])
    : GLOBAL_SUGGESTIONS;

  const placeholder = editMode && selectedElement
    ? `What would you like to change about the ${getElementLabel(selectedElement).toLowerCase()}?`
    : editMode
      ? 'Click an element to edit it, or describe a change...'
      : 'Describe a direction... e.g. "Make it feel like an Apple keynote"';

  const lockedCount = Object.values(currentLocks).filter(Boolean).length;

  return (
    <div className="flex flex-col h-[440px] lg:h-[640px] rounded-2xl overflow-hidden"
      style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border flex-shrink-0">
        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: `rgba(${NEON_RGB.pink}, 0.12)` }}>
          <Sparkles className="w-3.5 h-3.5" style={{ color: NEON.pink }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground leading-tight">Creative Director</p>
          <p className="text-[9px] text-muted-foreground leading-tight">
            {editMode ? 'Edit mode — click to edit' : 'Describe or click to edit'}
          </p>
        </div>
        <button
          onClick={onToggleEditMode}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black transition-all active:scale-95 flex-shrink-0"
          style={editMode
            ? { background: NEON.pink, color: '#fff' }
            : { background: `rgba(${NEON_RGB.pink}, 0.08)`, border: `1px solid rgba(${NEON_RGB.pink}, 0.2)`, color: NEON.pink }}
        >
          <MousePointerClick className="w-3 h-3" />
          {editMode ? 'Editing' : 'Edit Mode'}
        </button>
      </div>

      {/* Selected element indicator */}
      {editMode && selectedElement && (
        <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0"
          style={{ background: `rgba(${NEON_RGB.pink}, 0.06)`, borderBottom: `1px solid rgba(${NEON_RGB.pink}, 0.15)` }}>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: NEON.pink }} />
          <span className="text-[10px] font-bold text-foreground">
            Editing: {getElementLabel(selectedElement)}
          </span>
          <button onClick={onDeselectElement} className="ml-auto p-0.5 rounded hover:bg-muted transition-colors">
            <X className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !isApplying && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
              style={{ background: `rgba(${NEON_RGB.purple}, 0.1)` }}>
              <MessageSquare className="w-5 h-5" style={{ color: NEON.purple }} />
            </div>
            <p className="text-xs text-foreground font-bold mb-1">Your Creative Director is ready</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed max-w-[220px]">
              Describe a direction, toggle Edit Mode to click elements, or try a suggestion below.
            </p>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onRestore={onRestoreVersion}
            onFavorite={onFavoriteVersion}
          />
        ))}

        {isApplying && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 px-3 py-2 rounded-2xl rounded-bl-md"
              style={{ background: 'hsl(var(--muted))' }}>
              <Loader2 className="w-3 h-3 animate-spin" style={{ color: NEON.pink }} />
              <span className="text-[10px] text-muted-foreground">
                {editMode && selectedElement
                  ? `Adjusting the ${getElementLabel(selectedElement).toLowerCase()}...`
                  : 'Thinking...'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border space-y-2 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="flex-1 px-3 py-2 rounded-xl text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors resize-none max-h-24"
            style={{ minHeight: 36 }}
          />
          <button
            onClick={handleSend}
            disabled={isApplying || !instruction.trim()}
            className="flex items-center justify-center w-9 h-9 rounded-xl transition-all active:scale-95 disabled:opacity-30 flex-shrink-0"
            style={{ background: NEON.pink, color: '#fff' }}
          >
            {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Quick suggestions */}
        <div className="flex flex-wrap gap-1">
          {suggestions.slice(0, 6).map((s, i) => (
            <button
              key={i}
              onClick={() => handleSuggestion(s.instruction)}
              disabled={isApplying}
              className="px-2 py-1 rounded-lg text-[9px] font-bold transition-all active:scale-95 disabled:opacity-30"
              style={{ background: `rgba(${NEON_RGB.pink}, 0.06)`, border: `1px solid rgba(${NEON_RGB.pink}, 0.12)`, color: NEON.pink }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Advanced toggle */}
        <div className="flex items-center justify-between pt-0.5">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Advanced
            {lockedCount > 0 && (
              <span className="ml-0.5 px-1 py-0.5 rounded-full text-[7px]"
                style={{ background: `rgba(${NEON_RGB.yellow}, 0.15)`, color: NEON.yellow }}>
                {lockedCount} locked
              </span>
            )}
          </button>
          <button
            onClick={onReset}
            disabled={isApplying}
            className="text-[9px] font-bold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          >
            Reset direction
          </button>
        </div>

        {showAdvanced && (
          <div className="space-y-2 pt-1 border-t border-border">
            <div>
              <p className="text-[8px] font-bold tracking-widest uppercase text-muted-foreground mb-1 flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Protect from changes
              </p>
              <div className="flex flex-wrap gap-1">
                {LOCK_LABELS.map(({ key, label }) => {
                  const isLocked = currentLocks[key];
                  return (
                    <button
                      key={key}
                      onClick={() => onToggleLock(key)}
                      className="px-1.5 py-0.5 rounded-lg text-[8px] font-bold transition-all active:scale-95 flex items-center gap-0.5"
                      style={isLocked
                        ? { background: `rgba(${NEON_RGB.yellow}, 0.1)`, border: `1px solid rgba(${NEON_RGB.yellow}, 0.3)`, color: NEON.yellow }
                        : { background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
                    >
                      {isLocked && <Lock className="w-2 h-2" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────────
function MessageBubble({ message, onRestore, onFavorite }) {
  if (message.type === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3 py-1.5 rounded-2xl rounded-br-md text-[11px] text-white leading-snug"
          style={{ background: NEON.pink }}>
          {message.text}
        </div>
      </div>
    );
  }

  if (message.type === 'observation') {
    const config = {
      suggestion: { color: NEON.cyan, rgb: NEON_RGB.cyan, icon: Lightbulb, label: 'Observation' },
      insight: { color: NEON.purple, rgb: NEON_RGB.purple, icon: Eye, label: 'Insight' },
      praise: { color: NEON.green, rgb: NEON_RGB.green, icon: Check, label: 'Working well' },
    };
    const cfg = config[message.severity] || config.suggestion;
    const Icon = cfg.icon;
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] px-3 py-1.5 rounded-2xl rounded-bl-md"
          style={{ background: `rgba(${cfg.rgb}, 0.06)`, border: `1px solid rgba(${cfg.rgb}, 0.12)` }}>
          <div className="flex items-center gap-1 mb-0.5">
            <Icon className="w-2.5 h-2.5" style={{ color: cfg.color }} />
            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
          </div>
          <p className="text-[11px] text-foreground leading-snug">{message.text}</p>
        </div>
      </div>
    );
  }

  // AI response
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] px-3 py-1.5 rounded-2xl rounded-bl-md"
        style={{ background: 'hsl(var(--muted))' }}>
        <p className="text-[11px] text-foreground leading-snug">{message.text}</p>
        {message.direction && (
          <p className="text-[9px] text-muted-foreground italic mt-1 leading-tight">{message.direction}</p>
        )}
        {message.versionId && (
          <div className="flex gap-1 mt-1.5">
            <button
              onClick={() => onFavorite(message.versionId)}
              className="p-0.5 rounded transition-opacity"
              style={{ opacity: message.isFavorite ? 1 : 0.3 }}
            >
              <Star className="w-2.5 h-2.5"
                style={message.isFavorite
                  ? { color: NEON.yellow, fill: NEON.yellow }
                  : { color: 'hsl(var(--muted-foreground))' }} />
            </button>
            <button
              onClick={() => onRestore(message.versionId)}
              className="p-0.5 rounded transition-opacity opacity-30 hover:opacity-100"
              title="Restore this version"
            >
              <RotateCcw className="w-2.5 h-2.5" style={{ color: NEON.cyan }} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}