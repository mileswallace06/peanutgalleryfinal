/**
 * Marketing Studio Dashboard
 * Admin-only landing page. Large tiles for each creation flow + history.
 *
 * Improvements:
 *   - Loading skeleton instead of spinner
 *   - Stats summary (total assets, favorites, templates)
 *   - Quick recent assets strip
 *   - Better responsive grid
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { Sparkles, Image, Layers, Megaphone, Quote, BarChart3, Star, User, Smartphone, History, FolderOpen, LayoutTemplate, Heart, FileText, TrendingUp, AlertCircle, RefreshCw } from 'lucide-react';
import { NEON, NEON_RGB, GRADIENTS, TEXT } from '@/lib/marketingTokens';
import HistoryList from '@/components/marketing/HistoryList';
import { SectionLabel, LoadingSpinner } from '@/components/marketing/shared/UiPrimitives';
import { formatDistanceToNow } from 'date-fns';

const TILES = [
  { id: 'social_graphic', label: 'Social Graphic', desc: 'Single Instagram-ready graphic', icon: Image, color: NEON.cyan, rgb: NEON_RGB.cyan, route: '/marketing-studio/builder' },
  { id: 'carousel', label: 'Carousel', desc: 'Multi-slide story sequence', icon: Layers, color: NEON.purple, rgb: NEON_RGB.purple, route: '/marketing-studio/carousel' },
  { id: 'announcement', label: 'Announcement', desc: 'News or update graphic', icon: Megaphone, color: NEON.pink, rgb: NEON_RGB.pink, route: '/marketing-studio/builder?type=announcement' },
  { id: 'quote', label: 'Quote', desc: 'Bold quote with whitespace', icon: Quote, color: NEON.cyan, rgb: NEON_RGB.cyan, route: '/marketing-studio/builder?type=quote' },
  { id: 'statistic', label: 'Statistic', desc: 'Big number, big impact', icon: BarChart3, color: NEON.green, rgb: NEON_RGB.green, route: '/marketing-studio/builder?type=statistic' },
  { id: 'feature_spotlight', label: 'Feature Spotlight', desc: 'Highlight a product feature', icon: Star, color: NEON.purple, rgb: NEON_RGB.purple, route: '/marketing-studio/builder?type=feature_spotlight' },
  { id: 'founder_story', label: 'Founder Story', desc: 'Personal narrative post', icon: User, color: NEON.pink, rgb: NEON_RGB.pink, route: '/marketing-studio/builder?type=founder_story' },
  { id: 'mockup', label: 'Mockup', desc: 'Screenshots in device frames', icon: Smartphone, color: NEON.cyan, rgb: NEON_RGB.cyan, route: '/marketing-studio/mockup' },
  { id: 'brand_assets', label: 'Brand Assets', desc: 'Colors, gradients, logo, fonts', icon: FolderOpen, color: NEON.green, rgb: NEON_RGB.green, route: '/marketing-studio/brand-assets' },
  { id: 'templates', label: 'Templates', desc: 'Saved reusable layouts', icon: LayoutTemplate, color: NEON.purple, rgb: NEON_RGB.purple, route: '/marketing-studio/templates' },
];

function StatsBar({ assets }) {
  const stats = [
    { label: 'Total', value: assets.length, icon: FileText, color: NEON.cyan, rgb: NEON_RGB.cyan },
    { label: 'Favorites', value: assets.filter(a => a.is_favorite).length, icon: Heart, color: NEON.pink, rgb: NEON_RGB.pink },
    { label: 'Templates', value: assets.filter(a => a.is_template).length, icon: LayoutTemplate, color: NEON.purple, rgb: NEON_RGB.purple },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 mb-6">
      {stats.map(s => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="rounded-2xl p-3 flex flex-col items-center"
            style={{ background: `rgba(${s.rgb}, 0.06)`, border: `1px solid rgba(${s.rgb}, 0.15)` }}>
            <Icon className="w-4 h-4 mb-1" style={{ color: s.color }} />
            <span className="font-display text-xl text-foreground leading-none">{s.value}</span>
            <span className="text-[9px] font-bold text-muted-foreground mt-0.5">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function RecentAssets({ assets, onNavigate }) {
  const recent = assets.slice(0, 4);
  if (recent.length === 0) return null;
  return (
    <div className="mb-6">
      <SectionLabel color={NEON.cyan}>Recent</SectionLabel>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {recent.map(asset => (
          <button key={asset.id} onClick={() => onNavigate(asset)}
            className="flex-shrink-0 w-24 rounded-xl overflow-hidden transition-all active:scale-95"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <div className="w-full aspect-square flex items-center justify-center" style={{ background: '#050308' }}>
              {asset.thumbnail_url
                ? <img src={asset.thumbnail_url} alt={asset.title} className="w-full h-full object-cover" />
                : <Image className="w-5 h-5 text-muted-foreground" />}
            </div>
            <div className="p-2">
              <p className="text-[10px] font-bold text-foreground truncate">{asset.title}</p>
              <p className="text-[8px] text-muted-foreground">{asset.created_date ? formatDistanceToNow(new Date(asset.created_date)) : ''}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg min-h-full" style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>
      <div className="mb-10">
        <div className="h-7 w-28 rounded-full mb-4 animate-pulse" style={{ background: 'hsl(var(--muted))' }} />
        <div className="h-14 w-3/4 rounded-2xl mb-3 animate-pulse" style={{ background: 'hsl(var(--muted))' }} />
        <div className="h-4 w-5/6 rounded-lg animate-pulse" style={{ background: 'hsl(var(--muted))' }} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-10">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: 'hsl(var(--muted))' }} />
        ))}
      </div>
    </div>
  );
}

export default function MarketingStudio() {
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await base44.entities.MarketingAsset.list('-created_date', 100);
      setAssets(list || []);
    } catch (e) {
      setLoadError('Failed to load assets. Pull to refresh or try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoadingAuth && user && isAdmin(user)) {
      loadAssets();
    }
  }, [isLoadingAuth, user]);

  if (isLoadingAuth) return <LoadingSpinner />;
  if (!user || !isAdmin(user)) return <Navigate to="/events" replace />;
  if (loading) return <DashboardSkeleton />;

  if (loadError && assets.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg min-h-full flex flex-col items-center justify-center"
        style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: `rgba(${NEON_RGB.pink}, 0.08)`, border: `1px solid rgba(${NEON_RGB.pink}, 0.15)` }}>
          <AlertCircle className="w-6 h-6" style={{ color: NEON.pink }} />
        </div>
        <p className="text-sm font-bold text-foreground mb-1">Couldn't load assets</p>
        <p className="text-xs text-muted-foreground mb-4 text-center max-w-[220px]">{loadError}</p>
        <button onClick={loadAssets}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full font-black text-xs"
          style={{ background: GRADIENTS.cta_primary, color: TEXT.dark }}>
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const navigateToAsset = (asset) => {
    if (asset.asset_type === 'carousel') navigate(`/marketing-studio/carousel?edit=${asset.id}`);
    else if (asset.asset_type === 'mockup') navigate(`/marketing-studio/mockup?edit=${asset.id}`);
    else navigate(`/marketing-studio/builder?edit=${asset.id}`);
  };

  return (
    <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg min-h-full"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>

      {/* Hero */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black mb-4"
          style={{ background: `rgba(${NEON_RGB.purple}, 0.12)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.3)`, color: NEON.purple }}>
          <Sparkles className="w-3 h-3" /> Admin Only
        </div>
        <h1 className="font-display leading-none mb-3"
          style={{
            fontSize: 'clamp(2.4rem, 10vw, 3.5rem)',
            background: `linear-gradient(135deg, ${NEON.purple}, ${NEON.pink}, ${NEON.yellow})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
          Marketing<br />Studio
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
          On-brand content creation. Every export looks like Peanut Gallery — same typography, gradients, and design language as the app itself.
        </p>
      </div>

      {/* Stats */}
      <StatsBar assets={assets} />

      {/* Recent quick-access */}
      <RecentAssets assets={assets} onNavigate={navigateToAsset} />

      {/* Create tiles */}
      <div className="mb-10">
        <SectionLabel color={NEON.cyan}>Create</SectionLabel>

        {/* Primary CTA — full-width hero */}
        {(() => {
          const tile = TILES[0];
          const Icon = tile.icon;
          return (
            <button
              onClick={() => navigate(tile.route)}
              className="w-full flex items-center gap-4 p-5 rounded-2xl transition-all active:scale-[0.98] text-left mb-3"
              style={{ background: GRADIENTS.cta_primary, border: 'none' }}
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(0,0,0,0.12)' }}>
                <Icon className="w-6 h-6" style={{ color: TEXT.dark }} />
              </div>
              <div className="flex-1">
                <p className="font-display text-lg leading-tight" style={{ color: TEXT.dark }}>{tile.label}</p>
                <p className="text-xs mt-0.5" style={{ color: TEXT.dark, opacity: 0.65 }}>{tile.desc}</p>
              </div>
            </button>
          );
        })()}

        {/* Secondary tiles */}
        <div className="grid grid-cols-2 gap-3">
          {TILES.slice(1).map(tile => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.id}
                onClick={() => navigate(tile.route)}
                className="flex flex-col items-start gap-3 p-4 rounded-2xl transition-all active:scale-[0.97] text-left"
                style={{
                  background: `rgba(${tile.rgb}, 0.06)`,
                  border: `1px solid rgba(${tile.rgb}, 0.2)`,
                }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `rgba(${tile.rgb}, 0.12)` }}>
                  <Icon className="w-5 h-5" style={{ color: tile.color }} />
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground leading-tight">{tile.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{tile.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* History */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-muted-foreground" />
          <SectionLabel color={NEON.green}>History</SectionLabel>
        </div>
        <HistoryList assets={assets} onRefresh={loadAssets} loading={loading} />
      </div>
    </div>
  );
}