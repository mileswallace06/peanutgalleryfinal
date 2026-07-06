/**
 * Marketing Studio Dashboard
 * --------------------------------------------------------------------
 * Admin-only landing page. Large tiles for each creation flow + history.
 * Uses the exact same design language as WhyPeanutGallery / Me tab:
 *   - .dark:rave-bg page background
 *   - font-display headlines
 *   - SectionLabel pattern (line + text)
 *   - Neon-accented tiles with rgba(NEON, 0.06) backgrounds
 *   - Same pill/button/card patterns
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { Sparkles, Image, Layers, Megaphone, Quote, BarChart3, Star, User, Smartphone, RefreshCw, History, FolderOpen, LayoutTemplate } from 'lucide-react';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';
import HistoryList from '@/components/marketing/HistoryList';

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

function SectionLabel({ children, color = NEON.purple }) {
  return (
    <p className="text-[10px] font-black tracking-widest uppercase mb-4 flex items-center gap-2" style={{ color }}>
      <span className="w-4 h-px inline-block" style={{ background: color }} />
      {children}
    </p>
  );
}

export default function MarketingStudio() {
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const list = await base44.entities.MarketingAsset.list('-created_date', 100);
      setAssets(list || []);
    } catch (e) {
      // entity might not exist yet
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoadingAuth && user && isAdmin(user)) {
      loadAssets();
    }
  }, [isLoadingAuth, user]);

  if (isLoadingAuth) {
    return <div className="min-h-full flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!user || !isAdmin(user)) {
    return <Navigate to="/events" replace />;
  }

  return (
    <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg min-h-full"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>

      {/* Hero */}
      <div className="mb-10">
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

      {/* Create tiles */}
      <div className="mb-10">
        <SectionLabel color={NEON.cyan}>Create</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          {TILES.map(tile => {
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