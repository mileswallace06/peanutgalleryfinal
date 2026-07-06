/**
 * Marketing Mockup Generator
 * --------------------------------------------------------------------
 * Places screenshots inside device frames (iPhone, laptop, billboard, etc.)
 * The user uploads a screenshot and selects a device — the system handles
 * the frame, shadows, and composition.
 *
 * Uses the same PG design patterns as the rest of the app.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { ArrowLeft, Save, Loader2, Download, Smartphone, Type, Palette } from 'lucide-react';
import AssetUploader from '@/components/marketing/AssetUploader';
import ExportPanel from '@/components/marketing/ExportPanel';
import { MOCKUP_TYPES } from '@/components/marketing/canvas/DeviceMockups';
import { NEON, NEON_RGB, THEMES, GRADIENTS, TEXT, FONTS, PG_LOGO_URL } from '@/lib/marketingTokens';

const CANVAS_PRESETS = {
  '1080x1350': { w: 1080, h: 1350, label: 'Portrait 4:5' },
  '1080x1080': { w: 1080, h: 1080, label: 'Square 1:1' },
  '1920x1080': { w: 1920, h: 1080, label: 'Landscape 16:9' },
  'story':     { w: 1080, h: 1920, label: 'Story 9:16' },
};

function SectionLabel({ children, color = NEON.cyan }) {
  return (
    <p className="text-[10px] font-black tracking-widest uppercase mb-3 flex items-center gap-2" style={{ color }}>
      <span className="w-4 h-px inline-block" style={{ background: color }} />
      {children}
    </p>
  );
}

function FormField({ label, value, onChange, placeholder, multiline = false, rows = 2 }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-muted-foreground block mb-1">{label}</label>
      {multiline ? (
        <textarea value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
          className="w-full px-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:border-primary" />
      ) : (
        <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full px-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary" />
      )}
    </div>
  );
}

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
  const [mobilePanel, setMobilePanel] = useState('device');

  const previewRef = useRef(null);
  const canvasRef = useRef(null);
  const [previewScale, setPreviewScale] = useState(0.3);

  const preset = CANVAS_PRESETS[canvasPreset];

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

  useEffect(() => {
    const updateScale = () => {
      if (previewRef.current) {
        const containerWidth = previewRef.current.offsetWidth - 32;
        const scale = Math.min(containerWidth / preset.w, 0.5);
        setPreviewScale(Math.max(0.1, scale));
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [canvasPreset, preset]);

  const captureCanvas = async () => {
    if (!canvasRef.current) return null;
    return await html2canvas(canvasRef.current, {
      width: preset.w, height: preset.h, scale: 1,
      backgroundColor: '#050308', useCORS: true, logging: false,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let thumbnailUrl = null;
      try {
        const canvas = await captureCanvas();
        if (canvas) thumbnailUrl = canvas.toDataURL('image/jpeg', 0.6);
      } catch (_) {}

      const title = assetTitle || `${mockupType} mockup`;
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

  const MockupComponent = MOCKUP_TYPES[mockupType]?.Component;
  const u = preset.w / 1080;

  return (
    <div className="pb-28 dark:rave-bg min-h-full flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-border sticky top-0 z-30 frosted-bar">
        <button onClick={() => navigate('/marketing-studio')} className="p-1.5 -ml-1.5">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <input type="text" value={assetTitle} onChange={e => setAssetTitle(e.target.value)}
            placeholder="Untitled mockup"
            className="font-display text-base text-foreground bg-transparent border-none outline-none w-full placeholder:text-muted-foreground" />
        </div>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-black"
          style={{ background: GRADIENTS.cta_primary, color: TEXT.dark }}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
        </button>
      </div>

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

                {/* Mockup */}
                {screenshotUrl && MockupComponent && (
                  <div style={{ position: 'relative', zIndex: 1 }}>
                    <MockupComponent u={u} src={screenshotUrl} />
                  </div>
                )}

                {/* Footer */}
                <div style={{
                  position: 'absolute', bottom: 50 * u, left: 70 * u, right: 70 * u,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <img src={PG_LOGO_URL} alt="" crossOrigin="anonymous" style={{
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

      {/* Mobile panel switcher */}
      <div className="flex gap-2 px-4 mb-3">
        {[
          { id: 'device', label: 'Device & Canvas', icon: Smartphone },
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
              <FormField label="Badge" value={badge} onChange={setBadge} placeholder="e.g. NEW FEATURE" />
              <FormField label="Headline" value={headline} onChange={setHeadline} placeholder="Your headline" multiline />
              <FormField label="Subheadline" value={subheadline} onChange={setSubheadline} placeholder="Supporting line" multiline />
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
              <div className="flex gap-2 flex-wrap">
                {Object.entries(THEMES).map(([key, _]) => {
                  const themeColors = { dark: NEON.purple, dark_purple: NEON.purple, dark_green: NEON.green, dark_cyan: NEON.cyan, dark_pink: NEON.pink };
                  const color = themeColors[key] || NEON.purple;
                  return (
                    <button key={key} onClick={() => setTheme(key)}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all active:scale-95"
                      style={theme === key
                        ? { background: 'hsl(var(--background))', border: `2px solid ${color}` }
                        : { background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                      <span className="w-4 h-4 rounded-full" style={{ background: color }} />
                      <span className="text-xs font-bold text-foreground capitalize">{key.replace('dark_', '')}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <ExportPanel canvasRef={canvasRef} preset={preset} fileName={`pg-mockup-${mockupType}`} />

            <button onClick={handleSave} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-black transition-all active:scale-95"
              style={{ background: `rgba(${NEON_RGB.purple}, 0.12)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.3)`, color: NEON.purple }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Update Mockup' : 'Save to History'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}