/**
 * Marketing Carousel Builder
 * --------------------------------------------------------------------
 * Creates multi-slide Instagram carousels. Each slide is a full graphic
 * with its own graphic type and content.
 *
 * Features:
 *   - 5 / 7 / 10 slide presets
 *   - Per-slide content editing
 *   - AI carousel copy generator (generates all slide copy at once)
 *   - Slide reordering (move left/right)
 *   - Live preview of current slide
 *   - Export current slide or all slides
 *   - Save to history
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
import { ArrowLeft, Save, Loader2, Plus, ChevronLeft, ChevronRight, Trash2, Type, Palette, Layers, Download, Wand2 } from 'lucide-react';
import CarouselCanvas from '@/components/marketing/canvas/CarouselCanvas';
import CopyAssistant from '@/components/marketing/CopyAssistant';
import ExportPanel, { exportCanvasToImage } from '@/components/marketing/ExportPanel';
import { CANVAS_PRESETS, GRAPHIC_TYPES, NEON, NEON_RGB, THEMES, GRADIENTS, TEXT } from '@/lib/marketingTokens';

const EMPTY_SLIDE = {
  graphic_type: 'announcement',
  content: { headline: '', subheadline: '', body: '', cta: '', badge: '' },
};

const SLIDE_PRESETS = {
  5: ['Hook', 'Problem', 'Solution', 'How It Works', 'CTA'],
  7: ['Hook', 'Problem', 'Why It Matters', 'Current Industry', 'How PG Fixes It', 'The Future', 'CTA'],
  10: ['Hook', 'The Problem', 'Why It Matters', 'Current Industry', 'The Gap', 'How PG Fixes It', 'Key Feature', 'Proof', 'The Future', 'CTA'],
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

export default function MarketingCarousel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isLoadingAuth } = useAuth();

  const [canvasPreset, setCanvasPreset] = useState('1080x1080');
  const [theme, setTheme] = useState('dark');
  const [slides, setSlides] = useState([
    { ...EMPTY_SLIDE, graphic_type: 'announcement', content: { headline: 'Slide 1', subheadline: '', body: '', cta: '', badge: 'Hook' } },
    { ...EMPTY_SLIDE, graphic_type: 'problem', content: { headline: 'Slide 2', subheadline: '', body: '', cta: '', badge: 'Problem' } },
    { ...EMPTY_SLIDE, graphic_type: 'industry_truth', content: { headline: 'Slide 3', subheadline: '', body: '', cta: '', badge: 'Solution' } },
    { ...EMPTY_SLIDE, graphic_type: 'feature_spotlight', content: { headline: 'Slide 4', subheadline: '', body: '', cta: '', badge: 'How It Works' } },
    { ...EMPTY_SLIDE, graphic_type: 'launch', content: { headline: 'Slide 5', subheadline: '', body: '', cta: 'Get Started', badge: 'CTA' } },
  ]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [assetTitle, setAssetTitle] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mobilePanel, setMobilePanel] = useState('slides');
  const [exportingAll, setExportingAll] = useState(false);

  const previewRef = useRef(null);
  const canvasRef = useRef(null);
  const [previewScale, setPreviewScale] = useState(0.3);

  const preset = CANVAS_PRESETS[canvasPreset];

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId) {
      base44.entities.MarketingAsset.get(editId).then(asset => {
        if (asset && asset.asset_type === 'carousel') {
          setEditingId(asset.id);
          setAssetTitle(asset.title);
          setCanvasPreset(asset.canvas_preset || '1080x1080');
          setTheme(asset.theme || 'dark');
          setSlides(asset.content?.slides || slides);
        }
      }).catch(() => {});
    }
  }, [searchParams]);

  useEffect(() => {
    const updateScale = () => {
      if (previewRef.current) {
        const containerWidth = previewRef.current.offsetWidth - 32;
        const scale = Math.min(containerWidth / preset.w, 0.45);
        setPreviewScale(Math.max(0.1, scale));
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [canvasPreset, preset]);

  const updateSlideContent = useCallback((field, value) => {
    setSlides(prev => prev.map((s, i) => i === currentSlide ? { ...s, content: { ...s.content, [field]: value } } : s));
  }, [currentSlide]);

  const updateSlideType = (type) => {
    setSlides(prev => prev.map((s, i) => i === currentSlide ? { ...s, graphic_type: type } : s));
  };

  const addSlide = () => {
    setSlides(prev => [...prev, { ...EMPTY_SLIDE, content: { headline: `Slide ${prev.length + 1}`, badge: '', body: '', cta: '', subheadline: '' } }]);
    setCurrentSlide(slides.length);
  };

  const removeSlide = (index) => {
    if (slides.length <= 1) return;
    setSlides(prev => prev.filter((_, i) => i !== index));
    setCurrentSlide(Math.max(0, index - 1));
  };

  const moveSlide = (index, dir) => {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= slides.length) return;
    setSlides(prev => {
      const arr = [...prev];
      [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
      return arr;
    });
    setCurrentSlide(newIndex);
  };

  const applySlidePreset = (count) => {
    const labels = SLIDE_PRESETS[count];
    const types = ['announcement', 'problem', 'industry_truth', 'feature_spotlight', 'launch', 'milestone', 'announcement', 'statistic', 'quote', 'launch'];
    const newSlides = labels.map((label, i) => ({
      ...EMPTY_SLIDE,
      graphic_type: types[i] || 'announcement',
      content: { headline: label, subheadline: '', body: '', cta: i === labels.length - 1 ? 'Get Started' : '', badge: label },
    }));
    setSlides(newSlides);
    setCurrentSlide(0);
  };

  const handleAIApply = (field, value) => {
    // When AI applies to carousel, update the current slide
    updateSlideContent(field, value);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let thumbnailUrl = null;
      try {
        const canvas = await html2canvas(canvasRef.current, {
          width: preset.w, height: preset.h, scale: 1,
          backgroundColor: '#050308', useCORS: true, logging: false,
        });
        thumbnailUrl = canvas.toDataURL('image/jpeg', 0.6);
      } catch (_) {}

      const title = assetTitle || 'Untitled carousel';
      const payload = {
        title, asset_type: 'carousel', graphic_type: 'announcement',
        canvas_preset: canvasPreset, theme,
        content: { slides },
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

  const handleExportAll = async () => {
    setExportingAll(true);
    for (let i = 0; i < slides.length; i++) {
      setCurrentSlide(i);
      // Wait for re-render
      await new Promise(r => setTimeout(r, 300));
      try {
        await exportCanvasToImage(canvasRef, preset, 'png', `pg-carousel-slide${i + 1}`);
      } catch (e) {
        console.error(`Export slide ${i + 1} failed:`, e);
      }
    }
    setExportingAll(false);
  };

  if (isLoadingAuth) {
    return <div className="min-h-full flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!user || !isAdmin(user)) {
    return <Navigate to="/events" replace />;
  }

  const slide = slides[currentSlide];

  return (
    <div className="pb-28 dark:rave-bg min-h-full flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-border sticky top-0 z-30 frosted-bar">
        <button onClick={() => navigate('/marketing-studio')} className="p-1.5 -ml-1.5">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <input type="text" value={assetTitle} onChange={e => setAssetTitle(e.target.value)}
            placeholder="Untitled carousel"
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
            <CarouselCanvas canvasRef={canvasRef} preset={preset} slides={slides} theme={theme} slideIndex={currentSlide} />
          </div>
        </div>
      </div>

      {/* Slide navigation */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <SectionLabel color={NEON.purple}>Slide {currentSlide + 1} of {slides.length}</SectionLabel>
          <div className="flex-1" />
          <button onClick={() => moveSlide(currentSlide, -1)} disabled={currentSlide === 0}
            className="p-1.5 rounded-lg disabled:opacity-30" style={{ background: 'hsl(var(--card))' }}>
            <ChevronLeft className="w-4 h-4 text-foreground" />
          </button>
          <button onClick={() => moveSlide(currentSlide, 1)} disabled={currentSlide === slides.length - 1}
            className="p-1.5 rounded-lg disabled:opacity-30" style={{ background: 'hsl(var(--card))' }}>
            <ChevronRight className="w-4 h-4 text-foreground" />
          </button>
          <button onClick={() => removeSlide(currentSlide)} disabled={slides.length <= 1}
            className="p-1.5 rounded-lg disabled:opacity-30 text-destructive" style={{ background: 'hsl(var(--card))' }}>
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={addSlide}
            className="p-1.5 rounded-lg" style={{ background: `rgba(${NEON_RGB.green}, 0.12)`, color: NEON.green }}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {/* Slide thumbnails strip */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {slides.map((s, i) => (
            <button key={i} onClick={() => setCurrentSlide(i)}
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold transition-all"
              style={i === currentSlide
                ? { background: `rgba(${NEON_RGB.purple}, 0.2)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.5)`, color: NEON.purple }
                : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile panel switcher */}
      <div className="flex gap-2 px-4 mb-3">
        {[
          { id: 'slides', label: 'Slide Setup', icon: Layers },
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
        {mobilePanel === 'slides' && (
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
              <SectionLabel color={NEON.purple}>Slide Presets</SectionLabel>
              <div className="flex gap-2">
                {[5, 7, 10].map(count => (
                  <button key={count} onClick={() => applySlidePreset(count)}
                    className="flex-1 py-3 rounded-xl text-xs font-bold transition-all active:scale-95"
                    style={{ background: `rgba(${NEON_RGB.purple}, 0.06)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.2)`, color: NEON.purple }}>
                    {count} Slides
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel color={NEON.pink}>Current Slide Type</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {GRAPHIC_TYPES.map(gt => (
                  <button key={gt.id} onClick={() => updateSlideType(gt.id)}
                    className="flex flex-col items-center gap-1 py-2 px-1 rounded-xl transition-all active:scale-95"
                    style={slide?.graphic_type === gt.id
                      ? { background: `rgba(${NEON_RGB.pink}, 0.12)`, border: `1px solid rgba(${NEON_RGB.pink}, 0.4)` }
                      : { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                    <span className="text-base">{gt.icon}</span>
                    <span className="text-[8px] font-bold text-foreground text-center leading-tight">{gt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {mobilePanel === 'content' && (
          <div className="space-y-4">
            <CopyAssistant content={slide?.content || {}} onApply={handleAIApply} />

            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <SectionLabel color={NEON.green}>Slide {currentSlide + 1} Content</SectionLabel>
              <FormField label="Badge" value={slide?.content?.badge} onChange={v => updateSlideContent('badge', v)} placeholder="e.g. Hook" />
              <FormField label="Headline" value={slide?.content?.headline} onChange={v => updateSlideContent('headline', v)} placeholder="Slide headline" multiline />
              <FormField label="Subheadline" value={slide?.content?.subheadline} onChange={v => updateSlideContent('subheadline', v)} placeholder="Supporting line" multiline />
              <FormField label="Body" value={slide?.content?.body} onChange={v => updateSlideContent('body', v)} placeholder="Body text" multiline rows={3} />
              <FormField label="CTA" value={slide?.content?.cta} onChange={v => updateSlideContent('cta', v)} placeholder="Call to action" />
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

            <ExportPanel canvasRef={canvasRef} preset={preset} fileName={`pg-carousel-slide${currentSlide + 1}`} />

            <button onClick={handleExportAll} disabled={exportingAll}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-black transition-all active:scale-95"
              style={{ background: `rgba(${NEON_RGB.green}, 0.12)`, border: `1px solid rgba(${NEON_RGB.green}, 0.3)`, color: NEON.green }}>
              {exportingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exportingAll ? `Exporting... (${currentSlide + 1}/${slides.length})` : `Export All ${slides.length} Slides`}
            </button>

            <button onClick={handleSave} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-black transition-all active:scale-95"
              style={{ background: `rgba(${NEON_RGB.purple}, 0.12)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.3)`, color: NEON.purple }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Update Carousel' : 'Save to History'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}