/**
 * Marketing Builder — Social Graphic Builder
 * The user chooses content; the system chooses the design.
 * No layout controls, no positioning — just content + live preview.
 *
 * Uses shared UI primitives for consistency with other builder pages.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Type, Layout, Download, AlertCircle, Check } from 'lucide-react';
import GraphicCanvas from '@/components/marketing/canvas/GraphicCanvas';
import CopyAssistant from '@/components/marketing/CopyAssistant';
import AssetUploader from '@/components/marketing/AssetUploader';
import ExportPanel from '@/components/marketing/ExportPanel';
import { SectionLabel, FormField, LoadingSpinner, PanelSwitcher, ThemePicker } from '@/components/marketing/shared/UiPrimitives';
import { usePreviewScale, useCanvasCapture } from '@/components/marketing/shared/hooks';
import { CANVAS_PRESETS, GRAPHIC_TYPES, NEON, NEON_RGB, THEMES, GRADIENTS, TEXT } from '@/lib/marketingTokens';

const EMPTY_CONTENT = {
  headline: '', subheadline: '', body: '', cta: '', badge: '',
  stat_number: '', stat_label: '', stat_explanation: '',
  image_url: '', author: '', quote_text: '', signature: '',
};

const PANELS = [
  { id: 'type', label: 'Type & Canvas', icon: Layout },
  { id: 'content', label: 'Content', icon: Type },
  { id: 'export', label: 'Theme & Export', icon: Download },
];

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
  const [mobilePanel, setMobilePanel] = useState('type');
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
        }
      }).catch(() => {});
    }
  }, [searchParams]);

  const updateContent = useCallback((field, value) => {
    setContent(prev => ({ ...prev, [field]: value }));
  }, []);

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
        canvas_preset: canvasPreset, content, theme,
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
          className="p-1.5 -ml-1.5 rounded-lg transition-colors hover:bg-muted">
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
        </div>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-black transition-all active:scale-95 disabled:opacity-50"
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
            <GraphicCanvas canvasRef={canvasRef} preset={preset} graphicType={graphicType} content={content} theme={theme} />
          </div>
        </div>
      </div>

      <PanelSwitcher panels={PANELS} active={mobilePanel} onChange={setMobilePanel} />

      {/* Panels */}
      <div className="px-4 space-y-4">
        {mobilePanel === 'type' && (
          <div className="space-y-4">
            <div>
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

            <div>
              <SectionLabel color={NEON.purple}>Graphic Type</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {GRAPHIC_TYPES.map(gt => (
                  <button key={gt.id} onClick={() => setGraphicType(gt.id)}
                    className="flex flex-col items-center gap-1 py-3 px-1 rounded-xl transition-all active:scale-95"
                    style={graphicType === gt.id
                      ? { background: `rgba(${NEON_RGB.purple}, 0.12)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.4)` }
                      : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                    <span className="text-lg">{gt.icon}</span>
                    <span className="text-[9px] font-bold text-foreground text-center leading-tight">{gt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {mobilePanel === 'content' && (
          <div className="space-y-4">
            <CopyAssistant content={content} onApply={updateContent} />

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
          </div>
        )}

        {mobilePanel === 'export' && (
          <div className="space-y-4">
            <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <SectionLabel color={NEON.pink}>Theme</SectionLabel>
              <ThemePicker theme={theme} onChange={setTheme} />
            </div>

            <ExportPanel canvasRef={canvasRef} preset={preset} fileName={`pg-${graphicType}`} />

            <button onClick={handleSave} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-black transition-all active:scale-95 disabled:opacity-50"
              style={{ background: `rgba(${NEON_RGB.purple}, 0.12)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.3)`, color: NEON.purple }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Update Asset' : 'Save to History'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}