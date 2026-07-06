/**
 * Marketing Builder — Social Graphic Builder
 * --------------------------------------------------------------------
 * The user chooses content; the system chooses the design.
 * No layout controls, no positioning — just content + live preview.
 *
 * Features:
 *   - Canvas presets (1080x1350, 1080x1080, 1920x1080, Story, LinkedIn, X, Facebook)
 *   - Graphic type selection (system auto-layouts)
 *   - Content inputs (headline, subheadline, body, CTA, badge, stat, image)
 *   - Theme selection
 *   - AI Copy Assistant
 *   - Export PNG / JPEG
 *   - Save to history (MarketingAsset entity)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { ArrowLeft, Download, Save, Loader2, Type, Image as ImageIcon, Palette, Layout, X } from 'lucide-react';
import GraphicCanvas from '@/components/marketing/GraphicCanvas';
import CopyAssistant from '@/components/marketing/CopyAssistant';

const CANVAS_PRESETS = {
  '1080x1350': { w: 1080, h: 1350, label: 'Portrait 4:5', icon: '📱' },
  '1080x1080': { w: 1080, h: 1080, label: 'Square 1:1', icon: '⬛' },
  '1920x1080': { w: 1920, h: 1080, label: 'Landscape 16:9', icon: '🖥️' },
  'story':     { w: 1080, h: 1920, label: 'Story 9:16', icon: '📑' },
  'linkedin':  { w: 1200, h: 1200, label: 'LinkedIn', icon: 'in' },
  'x':         { w: 1600, h: 900,  label: 'X / Twitter', icon: '𝕏' },
  'facebook':  { w: 1200, h: 630,  label: 'Facebook', icon: 'f' },
};

const GRAPHIC_TYPES = [
  { id: 'industry_truth', label: 'Industry Truth', icon: '🎯' },
  { id: 'feature_spotlight', label: 'Feature Spotlight', icon: '✨' },
  { id: 'statistic', label: 'Statistic', icon: '📊' },
  { id: 'quote', label: 'Quote', icon: '💬' },
  { id: 'announcement', label: 'Announcement', icon: '📢' },
  { id: 'founder_story', label: 'Founder Story', icon: '👤' },
  { id: 'coming_soon', label: 'Coming Soon', icon: '🔮' },
  { id: 'launch', label: 'Launch', icon: '🚀' },
  { id: 'milestone', label: 'Milestone', icon: '🏆' },
  { id: 'problem', label: 'Problem', icon: '⚠️' },
  { id: 'partnership', label: 'Partnership', icon: '🤝' },
  { id: 'waitlist', label: 'Waitlist', icon: '📋' },
  { id: 'update', label: 'Update', icon: '🔄' },
  { id: 'venue_spotlight', label: 'Venue Spotlight', icon: '🏟️' },
  { id: 'ticket_tip', label: 'Ticket Tip', icon: '🎫' },
  { id: 'fan_story', label: 'Fan Story', icon: '❤️' },
  { id: 'comparison', label: 'Comparison', icon: '⚖️' },
  { id: 'question', label: 'Question', icon: '❓' },
];

const THEMES = [
  { id: 'dark', label: 'Default', color: '#BF5FFF' },
  { id: 'dark_purple', label: 'Purple', color: '#BF5FFF' },
  { id: 'dark_green', label: 'Green', color: '#00FF87' },
  { id: 'dark_cyan', label: 'Cyan', color: '#00C8FF' },
  { id: 'dark_pink', label: 'Pink', color: '#FF2D78' },
];

const EMPTY_CONTENT = {
  headline: '', subheadline: '', body: '', cta: '', badge: '',
  stat_number: '', stat_label: '', stat_explanation: '',
  image_url: '', author: '', quote_text: '', signature: '',
};

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

  const [previewScale, setPreviewScale] = useState(0.35);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [mobilePanel, setMobilePanel] = useState('type'); // type | content | export

  const previewRef = useRef(null);
  const canvasRef = useRef(null);

  const preset = CANVAS_PRESETS[canvasPreset];

  // Load existing asset if editing
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

  // Compute preview scale to fit container
  useEffect(() => {
    const updateScale = () => {
      if (previewRef.current) {
        const containerWidth = previewRef.current.offsetWidth - 32; // padding
        const scale = Math.min(containerWidth / preset.w, 0.5);
        setPreviewScale(Math.max(0.1, scale));
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [canvasPreset, preset]);

  const updateContent = useCallback((field, value) => {
    setContent(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      updateContent('image_url', file_url);
    } catch (e) {}
    setImageUploading(false);
  };

  const captureCanvas = async () => {
    if (!canvasRef.current) return null;
    return await html2canvas(canvasRef.current, {
      width: preset.w,
      height: preset.h,
      scale: 1,
      backgroundColor: '#050308',
      useCORS: true,
      logging: false,
    });
  };

  const handleExport = async (format) => {
    setExporting(true);
    try {
      const canvas = await captureCanvas();
      if (!canvas) return;
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const quality = format === 'jpeg' ? 0.95 : undefined;
      const dataUrl = canvas.toDataURL(mime, quality);
      const link = document.createElement('a');
      link.download = `pg-${graphicType}-${Date.now()}.${format}`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error('Export failed:', e);
    }
    setExporting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Generate thumbnail
      let thumbnailUrl = null;
      try {
        const canvas = await captureCanvas();
        if (canvas) {
          thumbnailUrl = canvas.toDataURL('image/jpeg', 0.6);
        }
      } catch (_) {}

      const title = assetTitle || `${graphicType.replace(/_/g, ' ')} graphic`;
      const payload = {
        title,
        asset_type: 'social_graphic',
        graphic_type: graphicType,
        canvas_preset: canvasPreset,
        content,
        theme,
        thumbnail_url: thumbnailUrl,
        created_by_email: user?.email,
      };

      if (editingId) {
        await base44.entities.MarketingAsset.update(editingId, payload);
      } else {
        const created = await base44.entities.MarketingAsset.create(payload);
        setEditingId(created.id);
      }
      navigate('/marketing-studio');
    } catch (e) {
      console.error('Save failed:', e);
    }
    setSaving(false);
  };

  if (isLoadingAuth) {
    return <div className="min-h-full flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!user || !isAdmin(user)) {
    return <Navigate to="/events" replace />;
  }

  return (
    <div className="pb-28 dark:rave-bg min-h-full flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-border sticky top-0 z-30" style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(24px)' }}>
        <button onClick={() => navigate('/marketing-studio')} className="p-1.5 -ml-1.5">
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black"
          style={{ background: 'linear-gradient(135deg, var(--neon-cyan), var(--neon-green))', color: 'var(--gradient-btn-text)' }}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
        </button>
      </div>

      {/* Live Preview */}
      <div ref={previewRef} className="px-4 py-4 flex justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
        <div style={{
          width: preset.w * previewScale,
          height: preset.h * previewScale,
          position: 'relative',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{
            transform: `scale(${previewScale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0, left: 0,
          }}>
            <GraphicCanvas
              canvasRef={canvasRef}
              preset={preset}
              graphicType={graphicType}
              content={content}
              theme={theme}
            />
          </div>
        </div>
      </div>

      {/* Mobile panel switcher */}
      <div className="flex gap-2 px-4 mb-3">
        {[
          { id: 'type', label: 'Type & Canvas', icon: Layout },
          { id: 'content', label: 'Content', icon: Type },
          { id: 'export', label: 'Theme & Export', icon: Download },
        ].map(p => {
          const Icon = p.icon;
          return (
            <button key={p.id} onClick={() => setMobilePanel(p.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all"
              style={mobilePanel === p.id
                ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
                : { background: 'hsl(var(--card))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }}>
              <Icon className="w-3.5 h-3.5" /> {p.label}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      <div className="px-4 space-y-4">
        {/* TYPE & CANVAS PANEL */}
        {mobilePanel === 'type' && (
          <div className="space-y-4">
            {/* Canvas preset */}
            <div>
              <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-3">Canvas Size</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(CANVAS_PRESETS).map(([key, p]) => (
                  <button key={key} onClick={() => setCanvasPreset(key)}
                    className="flex flex-col items-center gap-1 py-3 rounded-xl transition-all active:scale-95"
                    style={canvasPreset === key
                      ? { background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.4)' }
                      : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                    <span className="text-lg">{p.icon}</span>
                    <span className="text-[9px] font-bold text-foreground">{p.label}</span>
                    <span className="text-[8px] text-muted-foreground">{p.w}×{p.h}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Graphic type */}
            <div>
              <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-3">Graphic Type</p>
              <div className="grid grid-cols-3 gap-2">
                {GRAPHIC_TYPES.map(gt => (
                  <button key={gt.id} onClick={() => setGraphicType(gt.id)}
                    className="flex flex-col items-center gap-1 py-3 px-1 rounded-xl transition-all active:scale-95"
                    style={graphicType === gt.id
                      ? { background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.4)' }
                      : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                    <span className="text-lg">{gt.icon}</span>
                    <span className="text-[9px] font-bold text-foreground text-center leading-tight">{gt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* CONTENT PANEL */}
        {mobilePanel === 'content' && (
          <div className="space-y-4">
            {/* AI Copy Assistant */}
            <CopyAssistant content={content} onApply={updateContent} />

            {/* Content fields */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Content</p>

              <FormField label="Badge Text" value={content.badge} onChange={v => updateContent('badge', v)} placeholder="e.g. INDUSTRY TRUTH" />

              <FormField label="Headline" value={content.headline} onChange={v => updateContent('headline', v)} placeholder="Your main headline" multiline />

              <FormField label="Subheadline" value={content.subheadline} onChange={v => updateContent('subheadline', v)} placeholder="Supporting line" multiline />

              <FormField label="Body" value={content.body} onChange={v => updateContent('body', v)} placeholder="Supporting paragraph" multiline rows={3} />

              <FormField label="CTA" value={content.cta} onChange={v => updateContent('cta', v)} placeholder="e.g. Get Started" />

              {/* Statistic fields */}
              <div className="pt-2 border-t border-border">
                <p className="text-[10px] font-bold text-muted-foreground mb-2">Statistic (optional)</p>
                <FormField label="Number" value={content.stat_number} onChange={v => updateContent('stat_number', v)} placeholder="e.g. 95%" />
                <FormField label="Label" value={content.stat_label} onChange={v => updateContent('stat_label', v)} placeholder="e.g. of transfers succeed" />
                <FormField label="Explanation" value={content.stat_explanation} onChange={v => updateContent('stat_explanation', v)} placeholder="Tiny explanation" />
              </div>

              {/* Quote / Author fields */}
              <div className="pt-2 border-t border-border">
                <p className="text-[10px] font-bold text-muted-foreground mb-2">Quote & Author (optional)</p>
                <FormField label="Quote Text" value={content.quote_text} onChange={v => updateContent('quote_text', v)} placeholder="The quote" multiline />
                <FormField label="Author" value={content.author} onChange={v => updateContent('author', v)} placeholder="Author name" />
                <FormField label="Signature" value={content.signature} onChange={v => updateContent('signature', v)} placeholder="Founder signature" />
              </div>

              {/* Image upload */}
              <div className="pt-2 border-t border-border">
                <p className="text-[10px] font-bold text-muted-foreground mb-2">Image / Screenshot (optional)</p>
                {content.image_url ? (
                  <div className="relative">
                    <img src={content.image_url} alt="" className="w-full rounded-xl" style={{ maxHeight: 120, objectFit: 'cover' }} />
                    <button onClick={() => updateContent('image_url', '')}
                      className="absolute top-1 right-1 p-1 rounded-lg" style={{ background: 'rgba(0,0,0,0.7)' }}>
                      <X className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-1 py-6 rounded-xl cursor-pointer transition-colors hover:bg-muted/50"
                    style={{ border: '1px dashed hsl(var(--border))' }}>
                    {imageUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-muted-foreground" />
                    )}
                    <span className="text-[10px] text-muted-foreground">{imageUploading ? 'Uploading...' : 'Upload image'}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  </label>
                )}
              </div>
            </div>
          </div>
        )}

        {/* THEME & EXPORT PANEL */}
        {mobilePanel === 'export' && (
          <div className="space-y-4">
            {/* Theme */}
            <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex items-center gap-2 mb-3">
                <Palette className="w-4 h-4 text-muted-foreground" />
                <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Theme</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {THEMES.map(t => (
                  <button key={t.id} onClick={() => setTheme(t.id)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all active:scale-95"
                    style={theme === t.id
                      ? { background: 'hsl(var(--background))', border: `2px solid ${t.color}` }
                      : { background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                    <span className="w-4 h-4 rounded-full" style={{ background: t.color }} />
                    <span className="text-xs font-bold text-foreground">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Export */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-muted-foreground" />
                <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Export</p>
              </div>
              {exporting ? (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Rendering at {preset.w}×{preset.h}...</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => handleExport('png')}
                    className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-black transition-all active:scale-95"
                    style={{ background: 'linear-gradient(135deg, var(--neon-cyan), var(--neon-green))', color: 'var(--gradient-btn-text)' }}>
                    <Download className="w-3.5 h-3.5" /> PNG
                  </button>
                  <button onClick={() => handleExport('jpeg')}
                    className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-black transition-all active:scale-95"
                    style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
                    <Download className="w-3.5 h-3.5" /> JPEG
                  </button>
                </div>
              )}
              <p className="text-[9px] text-muted-foreground text-center">Exports at full {preset.w}×{preset.h} resolution</p>
            </div>

            {/* Save */}
            <button onClick={handleSave} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-black transition-all active:scale-95"
              style={{ background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.3)', color: 'var(--neon-purple)' }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Update Asset' : 'Save to History'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, multiline = false, rows = 2 }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-muted-foreground block mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="w-full px-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:border-primary"
        />
      ) : (
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
        />
      )}
    </div>
  );
}