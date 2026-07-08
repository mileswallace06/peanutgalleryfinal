/**
 * Marketing Builder — Social Graphic Builder
 * Responsive design: canvas preview on top, tabbed editing panel below.
 * Content tab: layout dropdown + all text fields with character counters + AI assistant.
 * Style tab: canvas size, theme, export.
 *
 * Uses shared UI primitives for consistency with other builder pages.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Type, Palette, Download, AlertCircle, Check, ChevronDown } from 'lucide-react';
import GraphicCanvas from '@/components/marketing/canvas/GraphicCanvas';
import CopyAssistant from '@/components/marketing/CopyAssistant';
import AssetUploader from '@/components/marketing/AssetUploader';
import ExportPanel from '@/components/marketing/ExportPanel';
import ConceptPicker from '@/components/marketing/ConceptPicker';
import { SectionLabel, FormField, LoadingSpinner, ThemePicker } from '@/components/marketing/shared/UiPrimitives';
import { usePreviewScale, useCanvasCapture } from '@/components/marketing/shared/hooks';
import { CANVAS_PRESETS, GRAPHIC_TYPES, NEON, NEON_RGB, GRADIENTS, TEXT } from '@/lib/marketingTokens';
import CreativeDirector from '@/components/marketing/CreativeDirector';
import { applyCreativeEdit, regenerateSystem, createVersionSnapshot, restoreFromSnapshot, describeDirection } from '@/lib/marketing/creativeEdit';
import { editElement, globalDirect, observeComposition } from '@/lib/marketing/creativeConversation';
import { mergeIntent, defaultLocks, hasActiveIntent } from '@/lib/marketing/creativeIntent';
import { getConceptById } from '@/lib/marketing/creativeConcepts';
import { getExecutionStyleById } from '@/lib/marketing/executionStyles';

const EMPTY_CONTENT = {
  headline: '', subheadline: '', body: '', cta: '', badge: '',
  stat_number: '', stat_label: '', stat_explanation: '',
  image_url: '', author: '', quote_text: '', signature: '',
  creative_intent: null,
  creative_locks: null,
  creative_versions: [],
};

/** Compact layout dropdown — replaces the 3-col grid for a cleaner editing experience. */
function LayoutDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = GRAPHIC_TYPES.find(gt => gt.id === value) || GRAPHIC_TYPES[0];

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm bg-background border border-border text-foreground outline-none focus:border-primary transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-base">{selected.icon}</span>
          <span className="font-bold">{selected.label}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-border shadow-lg"
          style={{ background: 'hsl(var(--popover))' }}>
          {GRAPHIC_TYPES.map(gt => (
            <button
              key={gt.id}
              onClick={() => { onChange(gt.id); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors hover:bg-muted"
              style={value === gt.id ? { background: `rgba(${NEON_RGB.purple}, 0.08)` } : {}}
            >
              <span className="text-base flex-shrink-0">{gt.icon}</span>
              <span className="font-bold text-foreground">{gt.label}</span>
              {value === gt.id && <Check className="w-3.5 h-3.5 ml-auto flex-shrink-0" style={{ color: NEON.green }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tab button for Content/Style switcher. */
function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all"
      style={active
        ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
        : { color: 'hsl(var(--muted-foreground))' }}
    >
      <Icon className="w-3.5 h-3.5" /> {children}
    </button>
  );
}

export default function MarketingBuilder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isLoadingAuth } = useAuth();

  const [canvasPreset, setCanvasPreset] = useState('1080x1350');
  const [graphicType, setGraphicType] = useState(searchParams.get('type') || 'industry_truth');
  const [theme, setTheme] = useState('dark');
  const [content, setContent] = useState(EMPTY_CONTENT);
  const [assetTitle, setAssetTitle] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('content');
  const [conceptId, setConceptId] = useState(null);
  const [executionStyleId, setExecutionStyleId] = useState(null);
  const [strategyId, setStrategyId] = useState(null);
  const [editApplying, setEditApplying] = useState(false);
  const [regeneratingSystem, setRegeneratingSystem] = useState(null);
  const [directionDescription, setDirectionDescription] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState(null);
  const [observations, setObservations] = useState([]);
  const navTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(navTimerRef.current), []);

  const preset = CANVAS_PRESETS[canvasPreset];
  const { previewRef, scale: previewScale } = usePreviewScale(preset, 0.5);
  const canvasRef = useRef(null);
  const capture = useCanvasCapture(preset);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId) {
      base44.entities.MarketingAsset.get(editId).then(asset => {
        if (asset) {
          setEditingId(asset.id);
          setAssetTitle(asset.title);
          setCanvasPreset(asset.canvas_preset || '1080x1350');
          setGraphicType(asset.graphic_type || 'industry_truth');
          setTheme(asset.theme || 'dark');
          setContent({ ...EMPTY_CONTENT, ...(asset.content || {}) });
          setConceptId(asset.content?.concept_id || asset.content?.composition_variant || null);
          setExecutionStyleId(asset.content?.execution_style_id || null);
          setStrategyId(asset.content?.strategy_id || null);
          // Restore the latest direction description from the most recent version, or generate one
          const versions = asset.content?.creative_versions || [];
          const latestVersion = versions[versions.length - 1];
          if (latestVersion?.direction_description) {
            setDirectionDescription(latestVersion.direction_description);
          } else {
            setDirectionDescription(describeDirection(asset.content?.creative_intent || {}));
          }
        }
      }).catch(() => {});
    }
  }, [searchParams]);

  const updateContent = useCallback((field, value) => {
    setContent(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Creative Edit handlers (intent-based) ───────────────────────────────
  const currentIntent = content.creative_intent || {};
  const currentLocks = content.creative_locks || defaultLocks();

  const handleApplyEdit = async (instruction) => {
    setEditApplying(true);
    try {
      const concept = getConceptById(conceptId);
      const execStyle = getExecutionStyleById(executionStyleId);
      const result = await globalDirect(instruction, {
        concept: concept ? { name: concept.name, mood: concept.mood, visualLanguage: concept.visualLanguage } : null,
        executionStyle: execStyle ? { name: execStyle.name } : null,
        currentIntent,
        lockedSystems: currentLocks,
        content,
        directionDescription,
      });

      const newIntent = mergeIntent(currentIntent, result.intent || {});
      const desc = result.direction_description || describeDirection(newIntent, concept?.name);
      const version = createVersionSnapshot(instruction, result.summary, {
        creative_intent: currentIntent,
        creative_locks: currentLocks,
        concept_id: conceptId,
        execution_style_id: executionStyleId,
        strategy_id: strategyId,
      }, desc, result.explanation);

      setDirectionDescription(desc);
      setContent(prev => ({
        ...prev,
        creative_intent: newIntent,
        creative_versions: [...(prev.creative_versions || []), version],
      }));
    } catch (e) {
      console.error('Creative edit failed:', e);
    }
    setEditApplying(false);
  };

  const handleElementEdit = async (elementId, instruction) => {
    setEditApplying(true);
    try {
      const concept = getConceptById(conceptId);
      const execStyle = getExecutionStyleById(executionStyleId);
      const result = await editElement(elementId, instruction, {
        concept: concept ? { name: concept.name, mood: concept.mood, visualLanguage: concept.visualLanguage } : null,
        executionStyle: execStyle ? { name: execStyle.name } : null,
        currentIntent,
        lockedSystems: currentLocks,
        content,
        directionDescription,
      });

      const newIntent = mergeIntent(currentIntent, result.intent || {});
      const desc = result.direction_description || describeDirection(newIntent, concept?.name);
      const version = createVersionSnapshot(instruction, result.summary, {
        creative_intent: currentIntent,
        creative_locks: currentLocks,
        concept_id: conceptId,
        execution_style_id: executionStyleId,
        strategy_id: strategyId,
      }, desc, result.explanation);

      setDirectionDescription(desc);
      setContent(prev => ({
        ...prev,
        creative_intent: newIntent,
        creative_versions: [...(prev.creative_versions || []), version],
      }));
    } catch (e) {
      console.error('Element edit failed:', e);
    }
    setEditApplying(false);
  };

  // ── Proactive observations — AI reviews the composition like a senior designer ──
  useEffect(() => {
    const concept = getConceptById(conceptId);
    if (!concept) return;
    if (!content.headline && !content.badge && !content.cta && !content.quote_text) return;

    const timer = setTimeout(() => {
      const execStyle = getExecutionStyleById(executionStyleId);
      observeComposition({
        concept: { name: concept.name, mood: concept.mood },
        executionStyle: execStyle ? { name: execStyle.name } : null,
        currentIntent: content.creative_intent || {},
        content,
        directionDescription,
      }).then(obs => {
        if (obs && obs.length > 0) {
          setObservations(prev => {
            const existing = new Set(prev.map(o => o.text));
            const newOnes = obs.filter(o => !existing.has(o.text));
            if (newOnes.length === 0) return prev;
            return [...prev.slice(-2), ...newOnes];
          });
        }
      }).catch(() => {});
    }, 3000);

    return () => clearTimeout(timer);
  }, [conceptId, executionStyleId, directionDescription, content]);

  const handleRegenerateSystem = async (systemKey) => {
    setRegeneratingSystem(systemKey);
    try {
      const concept = getConceptById(conceptId);
      const execStyle = getExecutionStyleById(executionStyleId);
      const result = await regenerateSystem(systemKey, {
        content,
        concept: concept ? { name: concept.name } : null,
        executionStyle: execStyle ? { name: execStyle.name } : null,
        currentIntent,
      });

      const newIntent = mergeIntent(currentIntent, result.intent || {});
      const desc = result.direction_description || describeDirection(newIntent, concept?.name);
      const version = createVersionSnapshot(`Regenerate ${systemKey}`, result.summary, {
        creative_intent: currentIntent,
        creative_locks: currentLocks,
        concept_id: conceptId,
        execution_style_id: executionStyleId,
        strategy_id: strategyId,
      }, desc);

      setDirectionDescription(desc);
      setContent(prev => ({
        ...prev,
        creative_intent: newIntent,
        creative_versions: [...(prev.creative_versions || []), version],
      }));
    } catch (e) {
      console.error('System regeneration failed:', e);
    }
    setRegeneratingSystem(null);
  };

  const handleToggleLock = (systemKey) => {
    setContent(prev => ({
      ...prev,
      creative_locks: { ...currentLocks, [systemKey]: !currentLocks[systemKey] },
    }));
  };

  const handleRestoreVersion = (versionId) => {
    const version = (content.creative_versions || []).find(v => v.id === versionId);
    if (!version) return;
    const restored = restoreFromSnapshot(version);
    if (!restored) return;
    setContent(prev => ({ ...prev, creative_intent: restored.creative_intent, creative_locks: restored.creative_locks }));
    setConceptId(restored.concept_id);
    setExecutionStyleId(restored.execution_style_id);
    setStrategyId(restored.strategy_id);
    setDirectionDescription(version.direction_description || describeDirection(restored.creative_intent));
  };

  const handleFavoriteVersion = (versionId) => {
    setContent(prev => ({
      ...prev,
      creative_versions: (prev.creative_versions || []).map(v =>
        v.id === versionId ? { ...v, is_favorite: !v.is_favorite } : v
      ),
    }));
  };

  const handleNameVersion = (versionId, name) => {
    setContent(prev => ({
      ...prev,
      creative_versions: (prev.creative_versions || []).map(v =>
        v.id === versionId ? { ...v, name } : v
      ),
    }));
  };

  const handleResetEdits = () => {
    const version = createVersionSnapshot('Reset', 'Cleared all creative intent', {
      creative_intent: currentIntent,
      creative_locks: currentLocks,
      concept_id: conceptId,
      execution_style_id: executionStyleId,
      strategy_id: strategyId,
    });
    setDirectionDescription('');
    setContent(prev => ({
      ...prev,
      creative_intent: null,
      creative_locks: defaultLocks(),
      creative_versions: [...(prev.creative_versions || []), version],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      let thumbnailUrl = null;
      try {
        const canvas = await capture(canvasRef);
        if (canvas) thumbnailUrl = canvas.toDataURL('image/jpeg', 0.6);
      } catch (_) {}

      const title = assetTitle.trim() || `${graphicType.replace(/_/g, ' ')} graphic`;
      const payload = {
        title, asset_type: 'social_graphic', graphic_type: graphicType,
        canvas_preset: canvasPreset, content: { ...content, concept_id: conceptId, execution_style_id: executionStyleId, strategy_id: strategyId }, theme,
        thumbnail_url: thumbnailUrl, created_by_email: user?.email,
      };

      if (editingId) {
        await base44.entities.MarketingAsset.update(editingId, payload);
      } else {
        const created = await base44.entities.MarketingAsset.create(payload);
        setEditingId(created.id);
      }
      setSaved(true);
      navTimerRef.current = setTimeout(() => navigate('/marketing-studio'), 600);
    } catch (e) {
      setSaveError(e.message || 'Failed to save. Please try again.');
    }
    setSaving(false);
  };

  if (isLoadingAuth) return <LoadingSpinner />;
  if (!user || !isAdmin(user)) return <Navigate to="/events" replace />;

  return (
    <div className="pb-28 dark:rave-bg min-h-full flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-border sticky top-0 z-30 frosted-bar">
        <button onClick={() => navigate('/marketing-studio')} aria-label="Back to Marketing Studio"
          className="p-1.5 -ml-1.5 rounded-lg transition-colors hover:bg-muted flex-shrink-0">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={assetTitle}
            onChange={e => setAssetTitle(e.target.value)}
            placeholder="Untitled graphic"
            className="font-display text-base text-foreground bg-transparent border-none outline-none w-full placeholder:text-muted-foreground"
          />
          <p className="text-[10px] text-muted-foreground">{preset.label} · {preset.w}×{preset.h}</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-black transition-all active:scale-95 disabled:opacity-50 flex-shrink-0"
          style={{ background: saved ? NEON.green : GRADIENTS.cta_primary, color: TEXT.dark }}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>

      {saveError && (
        <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-destructive"
          style={{ background: 'rgba(255,0,0,0.06)' }}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {saveError}
        </div>
      )}

      {/* Live Preview */}
      <div ref={previewRef} className="px-4 py-4 flex justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
        <div style={{
          width: preset.w * previewScale,
          height: preset.h * previewScale,
          position: 'relative', borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{
            transform: `scale(${previewScale})`, transformOrigin: 'top left',
            position: 'absolute', top: 0, left: 0,
          }}>
            <GraphicCanvas canvasRef={canvasRef} preset={preset} graphicType={graphicType} content={content} theme={theme} conceptId={conceptId} executionStyleId={executionStyleId} editMode={editMode} selectedElement={selectedElement} onSelectElement={setSelectedElement} />
          </div>
        </div>
      </div>

      {/* Creative Director — the conversation is the product */}
      <div className="px-4 pt-2 pb-4">
        <CreativeDirector
          concept={getConceptById(conceptId)}
          executionStyle={getExecutionStyleById(executionStyleId)}
          currentIntent={currentIntent}
          currentLocks={currentLocks}
          directionDescription={directionDescription || describeDirection(currentIntent, getConceptById(conceptId)?.name)}
          creativeVersions={content.creative_versions || []}
          observations={observations}
          editMode={editMode}
          selectedElement={selectedElement}
          onToggleEditMode={() => { setEditMode(!editMode); setSelectedElement(null); }}
          onDeselectElement={() => setSelectedElement(null)}
          onApplyEdit={handleApplyEdit}
          onApplyElementEdit={handleElementEdit}
          onRestoreVersion={handleRestoreVersion}
          onFavoriteVersion={handleFavoriteVersion}
          onToggleLock={handleToggleLock}
          onReset={handleResetEdits}
          isApplying={editApplying}
        />
      </div>

      {/* Tab switcher — Content / Style */}
      <div className="flex gap-1 px-4 py-2 border-b border-border sticky top-[57px] z-20 frosted-bar">
        <TabButton active={activeTab === 'content'} onClick={() => setActiveTab('content')} icon={Type}>
          Content
        </TabButton>
        <TabButton active={activeTab === 'style'} onClick={() => setActiveTab('style')} icon={Palette}>
          Style
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="px-4 py-4 space-y-4">
        {activeTab === 'content' && (
          <>
            {/* Layout dropdown */}
            <div>
              <SectionLabel color={NEON.purple}>Layout</SectionLabel>
              <LayoutDropdown value={graphicType} onChange={setGraphicType} />
            </div>

            {/* Concept Picker — multi-concept generation */}
            <ConceptPicker
              content={content}
              graphicType={graphicType}
              theme={theme}
              preset={preset}
              conceptId={conceptId}
              executionStyleId={executionStyleId}
              strategyId={strategyId}
              onSelect={(changes) => {
                if (changes.conceptId !== undefined) setConceptId(changes.conceptId);
                if (changes.executionStyleId !== undefined) setExecutionStyleId(changes.executionStyleId);
                if (changes.strategyId !== undefined) setStrategyId(changes.strategyId);
              }}
            />

            {/* AI Copy Assistant */}
            <CopyAssistant content={content} onApply={updateContent} />

            {/* Content fields */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <SectionLabel color={NEON.green}>Content</SectionLabel>

              <FormField label="Badge Text" value={content.badge} onChange={v => updateContent('badge', v)} placeholder="e.g. INDUSTRY TRUTH" maxLength={30} />
              <FormField label="Headline" value={content.headline} onChange={v => updateContent('headline', v)} placeholder="Your main headline" multiline maxLength={100} />
              <FormField label="Subheadline" value={content.subheadline} onChange={v => updateContent('subheadline', v)} placeholder="Supporting line" multiline maxLength={150} />
              <FormField label="Body" value={content.body} onChange={v => updateContent('body', v)} placeholder="Supporting paragraph" multiline rows={3} maxLength={500} />
              <FormField label="CTA" value={content.cta} onChange={v => updateContent('cta', v)} placeholder="e.g. Get Started" maxLength={30} />

              <div className="pt-2 border-t border-border">
                <p className="text-[10px] font-bold text-muted-foreground mb-2">Statistic (optional)</p>
                <FormField label="Number" value={content.stat_number} onChange={v => updateContent('stat_number', v)} placeholder="e.g. 95%" maxLength={20} />
                <FormField label="Label" value={content.stat_label} onChange={v => updateContent('stat_label', v)} placeholder="e.g. of transfers succeed" maxLength={60} />
                <FormField label="Explanation" value={content.stat_explanation} onChange={v => updateContent('stat_explanation', v)} placeholder="Tiny explanation" maxLength={100} />
              </div>

              <div className="pt-2 border-t border-border">
                <p className="text-[10px] font-bold text-muted-foreground mb-2">Quote & Author (optional)</p>
                <FormField label="Quote Text" value={content.quote_text} onChange={v => updateContent('quote_text', v)} placeholder="The quote" multiline maxLength={200} />
                <FormField label="Author" value={content.author} onChange={v => updateContent('author', v)} placeholder="Author name" maxLength={50} />
                <FormField label="Signature" value={content.signature} onChange={v => updateContent('signature', v)} placeholder="Founder signature" maxLength={50} />
              </div>

              <div className="pt-2 border-t border-border">
                <AssetUploader label="Image / Screenshot (optional)" value={content.image_url} onChange={v => updateContent('image_url', v)} />
              </div>
            </div>
          </>
        )}

        {activeTab === 'style' && (
          <>
            {/* Canvas size */}
            <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <SectionLabel color={NEON.cyan}>Canvas Size</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(CANVAS_PRESETS).map(([key, p]) => (
                  <button key={key} onClick={() => setCanvasPreset(key)}
                    className="flex flex-col items-center gap-1 py-3 rounded-xl transition-all active:scale-95"
                    style={canvasPreset === key
                      ? { background: `rgba(${NEON_RGB.cyan}, 0.12)`, border: `1px solid rgba(${NEON_RGB.cyan}, 0.4)` }
                      : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                    <span className="text-[10px] font-bold text-foreground">{p.label}</span>
                    <span className="text-[8px] text-muted-foreground">{p.w}×{p.h}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Theme */}
            <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <SectionLabel color={NEON.pink}>Theme</SectionLabel>
              <ThemePicker theme={theme} onChange={setTheme} />
            </div>

            {/* Export */}
            <ExportPanel canvasRef={canvasRef} preset={preset} fileName={`pg-${graphicType}`} />

            {/* Save button */}
            <button onClick={handleSave} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-black transition-all active:scale-95 disabled:opacity-50"
              style={{ background: `rgba(${NEON_RGB.purple}, 0.12)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.3)`, color: NEON.purple }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Update Asset' : 'Save to History'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}