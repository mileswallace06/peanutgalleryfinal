/**
 * Version History
 * --------------------------------------------------------------------
 * Every AI edit creates a snapshot. Users can:
 *   - View before/after comparison (intent diff)
 *   - Restore a previous version
 *   - Favorite a version
 *   - Branch from any version (restore + continue editing)
 *   - Name versions
 *
 * Creative work is iterative — every edit is recoverable.
 */
import { useState } from 'react';
import { History, RotateCcw, Star, GitBranch, Pencil, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { INTENT_DIMENSIONS, diffIntents } from '@/lib/marketing/creativeIntent';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

export default function VersionHistory({ versions = [], currentIntent = {}, onRestore, onFavorite, onName }) {
  const [expandedId, setExpandedId] = useState(null);
  const [editingNameId, setEditingNameId] = useState(null);
  const [nameDraft, setNameDraft] = useState('');

  if (versions.length === 0) return null;

  const sorted = [...versions].reverse();

  const toggleExpand = (id) => setExpandedId(expandedId === id ? null : id);

  const startNaming = (version) => {
    setEditingNameId(version.id);
    setNameDraft(version.name || '');
  };

  const saveName = (version) => {
    onName(version.id, nameDraft.trim() || null);
    setEditingNameId(null);
  };

  return (
    <div className="pt-2 border-t border-border">
      <div className="flex items-center gap-1.5 mb-2">
        <History className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
          Version History ({versions.length})
        </span>
      </div>

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {sorted.map((version, i) => {
          const isExpanded = expandedId === version.id;
          const isLatest = i === 0;
          const diff = diffIntents(version.snapshot.creative_intent, currentIntent);
          const hasDiff = Object.keys(diff).length > 0;

          return (
            <div key={version.id} className="rounded-lg overflow-hidden" style={{ background: 'hsl(var(--card))' }}>
              {/* Version row */}
              <div className="flex items-start gap-2 p-2.5">
                <button
                  onClick={() => toggleExpand(version.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {version.is_favorite && <Star className="w-2.5 h-2.5 flex-shrink-0" style={{ color: NEON.yellow, fill: NEON.yellow }} />}
                    <span className="text-[10px] font-bold text-foreground truncate">
                      {version.name || `"${version.instruction}"`}
                    </span>
                    {isLatest && (
                      <span className="px-1 py-0.5 rounded-full text-[7px] font-black flex-shrink-0" style={{ background: `rgba(${NEON_RGB.green}, 0.15)`, color: NEON.green }}>
                        CURRENT
                      </span>
                    )}
                  </div>
                  {!version.name && (
                    <p className="text-[9px] text-muted-foreground truncate italic">→ {version.summary}</p>
                  )}
                  {version.name && (
                    <p className="text-[9px] text-muted-foreground truncate">"{version.instruction}"</p>
                  )}
                </button>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => onFavorite(version.id)}
                    className="p-1 rounded transition-colors hover:bg-muted"
                    title="Favorite"
                  >
                    <Star className="w-3 h-3" style={version.is_favorite ? { color: NEON.yellow, fill: NEON.yellow } : { color: 'hsl(var(--muted-foreground))' }} />
                  </button>
                  {!isLatest && (
                    <button
                      onClick={() => onRestore(version.id)}
                      className="p-1 rounded transition-colors hover:bg-muted"
                      title="Restore"
                    >
                      <RotateCcw className="w-3 h-3" style={{ color: NEON.cyan }} />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded: before/after comparison + naming */}
              {isExpanded && (
                <div className="px-2.5 pb-2.5 space-y-2 border-t border-border pt-2">
                  {/* Name editor */}
                  {editingNameId === version.id ? (
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={nameDraft}
                        onChange={e => setNameDraft(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveName(version)}
                        placeholder="Version name..."
                        className="flex-1 px-2 py-1 rounded-lg text-[10px] bg-background border border-border outline-none focus:border-primary"
                        autoFocus
                      />
                      <button onClick={() => saveName(version)} className="p-1 rounded transition-colors hover:bg-muted">
                        <Check className="w-3 h-3" style={{ color: NEON.green }} />
                      </button>
                      <button onClick={() => setEditingNameId(null)} className="p-1 rounded transition-colors hover:bg-muted">
                        <X className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startNaming(version)}
                      className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="w-2.5 h-2.5" /> {version.name ? 'Rename' : 'Name this version'}
                    </button>
                  )}

                  {/* Intent at this version */}
                  <div>
                    <p className="text-[8px] font-bold tracking-widest uppercase text-muted-foreground mb-1">Intent at this version</p>
                    {Object.keys(version.snapshot.creative_intent).length > 0 ? (
                      <div className="space-y-0.5">
                        {Object.entries(version.snapshot.creative_intent).map(([key, val]) => {
                          const dimDef = INTENT_DIMENSIONS[key];
                          const changed = diff[key];
                          return (
                            <div key={key} className="flex items-center justify-between text-[9px]">
                              <span className="text-muted-foreground">{dimDef?.label || key}:</span>
                              <span className="font-bold" style={{ color: changed ? NEON.pink : 'hsl(var(--foreground))' }}>
                                {String(val)}
                                {changed && changed.new !== val && <span className="text-muted-foreground ml-1">→ {changed.new || 'none'}</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[9px] text-muted-foreground italic">No active intent (concept defaults)</p>
                    )}
                  </div>

                  {/* Branch button */}
                  {!isLatest && (
                    <button
                      onClick={() => onRestore(version.id)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[9px] font-bold transition-all active:scale-95 w-full justify-center"
                      style={{ background: `rgba(${NEON_RGB.cyan}, 0.08)`, border: `1px solid rgba(${NEON_RGB.cyan}, 0.2)`, color: NEON.cyan }}
                    >
                      <GitBranch className="w-3 h-3" /> Branch from this version
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}