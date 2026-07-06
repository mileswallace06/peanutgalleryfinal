/**
 * Marketing Mockup Generator
 * Places screenshots inside device frames (iPhone, laptop, billboard, etc.)
 *
 * Improvements:
 *   - Shared UI primitives
 *   - Save success/error states
 *   - Better empty state when no screenshot uploaded
 *   - Retina-quality export
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Download, Smartphone, Type, AlertCircle, Check, ImagePlus } from 'lucide-react';
import AssetUploader from '@/components/marketing/AssetUploader';
import ExportPanel from '@/components/marketing/ExportPanel';
import { MOCKUP_TYPES } from '@/components/marketing/canvas/DeviceMockups';
import { SectionLabel, FormField, LoadingSpinner, PanelSwitcher, ThemePicker } from '@/components/marketing/shared/UiPrimitives';
import { usePreviewScale, useCanvasCapture } from '@/components/marketing/shared/hooks';
import { NEON, NEON_RGB, THEMES, GRADIENTS, TEXT, FONTS, PG_LOGO_URL } from '@/lib/marketingTokens';

const CANVAS_PRESETS = {
  '1080x1350': { w: 1080, h: 1350, label: 'Portrait 4:5' },
  '1080x1080': { w: 1080, h: 1080, label: 'Square 1:1' },
  '1920x1080': { w: 1920, h: 1080, label: 'Landscape 16:9' },
  'story':     { w: 1080, h: 1920, label: 'Story 9:16' },
};

const PANELS = [
  { id: 'device', label: 'Device & Canvas', icon: Smartphone },
  { id: 'content', label: 'Content', icon: Type },
  { id: 'export', label: 'Theme & Export', icon: Download },
];

export default function MarketingMockup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isLoadingAuth } = useAuth();

  const [canvasPreset, setCanvasPreset] = useState('1080x1350');
  const [mockupType, setMockupType] = useState('iphone');
  const [theme, setTheme] = useState('dark');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [badge, setBadge] = useState('');
  const [assetTitle, setAssetTitle] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [mobilePanel, setMobilePanel] = useState('device');

  const preset = CANVAS_PRESETS[canvasPreset];
  const { previewRef, scale: previewScale } = usePreviewScale(preset, 0.5);
  const canvasRef = useRef(null);
  const capture = useCanvasCapture(preset);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId) {
      base44.entities.MarketingAsset.get(editId).then(asset => {
        if (asset && asset.asset_type === 'mockup') {
          setEditingId(asset.id);
          setAssetTitle(asset.title);
          setCanvasPreset(asset.canvas_preset || '1080x1350');
          setTheme(asset.theme || 'dark');
          setMockupType(asset.graphic_type || 'iphone');
          setScreenshotUrl(asset.content?.image_url || '');
          setHeadline(asset.content?.headline || '');
          setSubheadline(asset.content?.subheadline || '');
          setBadge(asset.content?.badge || '');
        }
      }).catch(() => {});
    }
  }, [searchParams]);

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

      const title = assetTitle.trim() || `${mockupType} mockup`;
      const payload = {
        title, asset_type: 'mockup', graphic_type: mockupType,
        canvas_preset: canvasPreset, theme,
        content: { image_url: screenshotUrl, headline, subheadline, badge },
        thumbnail_url: thumbnailUrl, created_by_email: user?.email,
      };

      if (editingId) {
        await base44.entities.MarketingAsset.update(editingId, payload);
      } else {
        const created = await base44.entities.MarketingAsset.create(payload);
        setEditingId(created.id);
      }
      setSaved(true);
      setTimeout(() => navigate('/marketing-studio'), 600);
    } catch (e) {
      setSaveError(e.message || 'Failed to save. Please try again.');
    }
    setSaving(false);
  };

  if (isLoadingAuth) return <LoadingSpinner />;
  if (!user || !isAdmin(user)) return <Navigate to="/events" replace />;

  const MockupComponent = MOCKUP_TYPES[mockupType]?.Component;
  const u = preset.w / 1080;

  return (
    <div className="pb-28 dark:rave-bg min-h-full flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-border sticky top-0 z-30 frosted-bar">
        <button onClick={() => navigate('/marketing-studio')} aria-label="Back to Marketing Studio"
          className="p-1.5 -ml-1.5 rounded-lg transition-colors hover:bg-muted">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <input type="text" value={assetTitle} onChange={e => setAssetTitle(e.target.value)}
            placeholder="Untitled mockup"
            className="font-display text-base text-foreground bg-transparent border-none outline-none w-full placeholder:text-muted-foreground" />
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
          width: preset.w * previewScale, height: preset.h * previewScale,
          position: 'relative', borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{
            transform: `scale(${previewScale})`, transformOrigin: 'top left',
            position: 'absolute', top: 0, left: 0,
          }}>
            {/* Canvas — renders at full pixel size for html2canvas */}
            <div ref={canvasRef} style={{ width: preset.w, height: preset.h, position: 'relative' }}>
              <div style={{
                width: '100%', height: '100%',
                background: THEMES[theme] || THEMES.dark,
                position: 'relative', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: 70 * u, gap: 40 * u,
              }}>
                {/* Glow */}
                <div style={{
                  position: 'absolute', width: 500 * u, height: 500 * u, borderRadius: '50%',
                  background: `radial-gradient(circle, rgba(${NEON_RGB.purple},0.15) 0%, transparent 70%)`,
                  top: '20%', left: '50%', transform: 'translateX(-50%)',
                  pointerEvents: 'none',
                }} />

                {/* Badge */}
                {badge && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6 * u,
                    padding: `${8 * u}px ${18 * u}px`, borderRadius: 999,
                    fontFamily: FONTS.body, fontSize: 16 * u, fontWeight: 900,
                    letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: NEON.cyan,
                    background: `rgba(${NEON_RGB.cyan}, 0.12)`,
                    border: `1px solid rgba(${NEON_RGB.cyan}, 0.35)`,
                    position: 'relative', zIndex: 1,
                  }}>{badge}</span>
                )}

                {/* Headline */}
                {headline && (
                  <span style={{
                    fontFamily: FONTS.display, fontSize: 64 * u, lineHeight: 1.0,
                    textTransform: 'uppercase', textAlign: 'center',
                    background: GRADIENTS.headline,
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                    position: 'relative', zIndex: 1, maxWidth: '85%',
                  }}>{headline}</span>
                )}

                {/* Subheadline */}
                {subheadline && (
                  <p style={{
                    fontFamily: FONTS.body, fontSize: 28 * u, fontWeight: 500,
                    lineHeight: 1.3, color: TEXT.muted, textAlign: 'center',
                    margin: 0, position: 'relative', zIndex: 1, maxWidth: '75%',
                  }}>{subheadline}</p>
                )}

                {/* Mockup or empty state */}
                {screenshotUrl && MockupComponent ? (
                  <div style={{ position: 'relative', zIndex: 1 }}>
                    <MockupComponent u={u} src={screenshotUrl} />
                  </div>
                ) : (
                  <div style={{
                    position: 'relative', zIndex: 1,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 * u,
                    padding: `${40 * u}px ${60 * u}px`,
                    borderRadius: 16 * u,
                    border: `2px dashed rgba(255,255,255,0.15)`,
                    color: TEXT.faint,
                  }}>
                    <ImagePlus style={{ width: 32 * u, height: 32 * u }} />
                    <span style={{ fontFamily: FONTS.body, fontSize: 14 * u }}>Upload a screenshot in the Content tab</span>
                  </div>
                )}

                {/* Footer */}
                <div style={{
                  position: 'absolute', bottom: 50 * u, left: 70 * u, right: 70 * u,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <img src={PG_LOGO_URL} alt="Peanut Gallery" crossOrigin="anonymous" style={{
                    width: 36 * u, height: 36 * u, borderRadius: 8 * u, objectFit: 'cover',
                  }} />
                  <span style={{
                    fontFamily: FONTS.body, fontSize: 18 * u, fontWeight: 500,
                    color: TEXT.faint, letterSpacing: '0.05em',
                  }}>@peanutgallery</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PanelSwitcher panels={PANELS} active={mobilePanel} onChange={setMobilePanel} />

      {/* Panels */}
      <div className="px-4 space-y-4">
        {mobilePanel === 'device' && (
          <div className="space-y-4">
            <div>
              <SectionLabel color={NEON.cyan}>Device Frame</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(MOCKUP_TYPES).map(([key, m]) => (
                  <button key={key} onClick={() => setMockupType(key)}
                    className="py-3 rounded-xl text-xs font-bold transition-all active:scale-95"
                    style={mockupType === key
                      ? { background: `rgba(${NEON_RGB.cyan}, 0.12)`, border: `1px solid rgba(${NEON_RGB.cyan}, 0.4)`, color: NEON.cyan }
                      : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel color={NEON.purple}>Canvas Size</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CANVAS_PRESETS).map(([key, p]) => (
                  <button key={key} onClick={() => setCanvasPreset(key)}
                    className="flex flex-col items-center gap-1 py-3 rounded-xl transition-all active:scale-95"
                    style={canvasPreset === key
                      ? { background: `rgba(${NEON_RGB.purple}, 0.12)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.4)` }
                      : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                    <span className="text-[10px] font-bold text-foreground">{p.label}</span>
                    <span className="text-[8px] text-muted-foreground">{p.w}×{p.h}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {mobilePanel === 'content' && (
          <div className="space-y-4">
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <SectionLabel color={NEON.green}>Content</SectionLabel>
              <FormField label="Badge" value={badge} onChange={setBadge} placeholder="e.g. NEW FEATURE" maxLength={30} />
              <FormField label="Headline" value={headline} onChange={setHeadline} placeholder="Your headline" multiline maxLength={100} />
              <FormField label="Subheadline" value={subheadline} onChange={setSubheadline} placeholder="Supporting line" multiline maxLength={150} />
              <div className="pt-2 border-t border-border">
                <AssetUploader label="Screenshot" value={screenshotUrl} onChange={setScreenshotUrl} />
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

            <ExportPanel canvasRef={canvasRef} preset={preset} fileName={`pg-mockup-${mockupType}`} />

            <button onClick={handleSave} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-black transition-all active:scale-95 disabled:opacity-50"
              style={{ background: `rgba(${NEON_RGB.purple}, 0.12)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.3)`, color: NEON.purple }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Update Mockup' : 'Save to History'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}