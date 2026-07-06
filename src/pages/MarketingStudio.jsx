/**
 * Marketing Studio Dashboard
 * --------------------------------------------------------------------
 * Admin-only landing page for the Marketing Studio.
 * Large tiles for each creation flow + history of saved assets.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { Sparkles, Image, Layers, Megaphone, Quote, BarChart3, Star, User, Smartphone, FolderOpen, History, Trash2, Copy, Download, RefreshCw, Heart } from 'lucide-react';

const TILES = [
  { id: 'social_graphic', label: 'Create Social Graphic', desc: 'Single Instagram-ready graphic', icon: Image, color: 'cyan', route: '/marketing-studio/builder' },
  { id: 'carousel', label: 'Create Carousel', desc: 'Multi-slide story sequence', icon: Layers, color: 'purple', route: null, soon: true },
  { id: 'announcement', label: 'Create Announcement', desc: 'News or update graphic', icon: Megaphone, color: 'pink', route: '/marketing-studio/builder?type=announcement' },
  { id: 'quote', label: 'Create Quote', desc: 'Bold quote with whitespace', icon: Quote, color: 'cyan', route: '/marketing-studio/builder?type=quote' },
  { id: 'statistic', label: 'Create Statistic', desc: 'Big number, big impact', icon: BarChart3, color: 'green', route: '/marketing-studio/builder?type=statistic' },
  { id: 'feature_spotlight', label: 'Create Feature Spotlight', desc: 'Highlight a product feature', icon: Star, color: 'purple', route: '/marketing-studio/builder?type=feature_spotlight' },
  { id: 'founder_story', label: 'Create Founder Story', desc: 'Personal narrative post', icon: User, color: 'pink', route: '/marketing-studio/builder?type=founder_story' },
  { id: 'mockup', label: 'Create Mockup', desc: 'Screenshots in device frames', icon: Smartphone, color: 'cyan', route: null, soon: true },
  { id: 'brand_assets', label: 'Brand Assets', desc: 'Logos, gradients, icons', icon: FolderOpen, color: 'green', route: null, soon: true },
  { id: 'templates', label: 'Templates', desc: 'Saved reusable layouts', icon: Layers, color: 'purple', route: null, soon: true },
];

const COLOR_MAP = {
  cyan: { rgb: '0,200,255', hex: '#00C8FF' },
  purple: { rgb: '191,95,255', hex: '#BF5FFF' },
  pink: { rgb: '255,45,120', hex: '#FF2D78' },
  green: { rgb: '0,255,135', hex: '#00FF87' },
  yellow: { rgb: '255,230,0', hex: '#FFE600' },
};

export default function MarketingStudio() {
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | favorites | templates

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

  const handleDelete = async (id) => {
    if (!confirm('Delete this asset?')) return;
    await base44.entities.MarketingAsset.delete(id);
    setAssets(prev => prev.filter(a => a.id !== id));
  };

  const handleToggleFavorite = async (asset) => {
    const updated = await base44.entities.MarketingAsset.update(asset.id, { is_favorite: !asset.is_favorite });
    setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, is_favorite: !a.is_favorite } : a));
  };

  const handleDuplicate = async (asset) => {
    const { id, created_date, updated_date, created_by_id, ...rest } = asset;
    const dup = await base44.entities.MarketingAsset.create({
      ...rest,
      title: `${asset.title} (Copy)`,
      is_favorite: false,
      is_template: false,
    });
    setAssets(prev => [dup, ...prev]);
  };

  const filtered = assets.filter(a => {
    if (filter === 'favorites') return a.is_favorite;
    if (filter === 'templates') return a.is_template;
    return true;
  });

  return (
    <div className="pb-28 dark:rave-bg min-h-full" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="px-4 pt-6 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5" style={{ color: 'var(--neon-purple)' }} />
          <span className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Admin Only</span>
        </div>
        <h1 className="font-display text-3xl text-foreground mb-1">Marketing Studio</h1>
        <p className="text-sm text-muted-foreground">On-brand content creation. Every export looks like Peanut Gallery.</p>
      </div>

      {/* Tiles */}
      <div className="px-4 mt-6">
        <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-3">Create</p>
        <div className="grid grid-cols-2 gap-3">
          {TILES.map(tile => {
            const c = COLOR_MAP[tile.color];
            const Icon = tile.icon;
            return (
              <button
                key={tile.id}
                onClick={() => tile.route ? navigate(tile.route) : null}
                disabled={tile.soon}
                className="relative flex flex-col items-start gap-3 p-4 rounded-2xl transition-all active:scale-[0.97] text-left disabled:opacity-50"
                style={{
                  background: `rgba(${c.rgb}, 0.06)`,
                  border: `1px solid rgba(${c.rgb}, 0.2)`,
                }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `rgba(${c.rgb}, 0.12)` }}>
                  <Icon className="w-5 h-5" style={{ color: c.hex }} />
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground leading-tight">{tile.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{tile.desc}</p>
                </div>
                {tile.soon && (
                  <span className="absolute top-2 right-2 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase"
                    style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>Soon</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* History */}
      <div className="px-4 mt-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">History</p>
          </div>
          <button onClick={loadAssets} disabled={loading}>
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mb-4">
          {[
            { id: 'all', label: 'All' },
            { id: 'favorites', label: '♥ Favorites' },
            { id: 'templates', label: 'Templates' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
              style={filter === f.id
                ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
                : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-3">No saved assets yet.</p>
            <Link to="/marketing-studio/builder"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full font-black text-xs"
              style={{ background: 'linear-gradient(135deg, var(--neon-cyan), var(--neon-green))', color: 'var(--gradient-btn-text)' }}>
              <Sparkles className="w-3.5 h-3.5" /> Create Your First Graphic
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(asset => (
              <AssetHistoryCard key={asset.id} asset={asset} onDelete={handleDelete} onDuplicate={handleDuplicate} onToggleFavorite={handleToggleFavorite} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetHistoryCard({ asset, onDelete, onDuplicate, onToggleFavorite }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
      <div className="flex gap-3 p-3">
        {/* Thumbnail */}
        <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: '#050308' }}>
          {asset.thumbnail_url ? (
            <img src={asset.thumbnail_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <Image className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-foreground truncate">{asset.title}</p>
          <p className="text-[10px] text-muted-foreground capitalize">{asset.graphic_type?.replace(/_/g, ' ')} · {asset.canvas_preset}</p>
          <div className="flex gap-1.5 mt-2">
            <button onClick={() => navigate(`/marketing-studio/builder?edit=${asset.id}`)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
              style={{ background: 'rgba(0,200,255,0.1)', color: 'var(--neon-cyan)', border: '1px solid rgba(0,200,255,0.2)' }}>
              Edit
            </button>
            <button onClick={() => onDuplicate(asset)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
              style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
              <Copy className="w-3 h-3" /> Dup
            </button>
            <button onClick={() => onToggleFavorite(asset)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
              style={{ background: asset.is_favorite ? 'rgba(255,45,120,0.12)' : 'hsl(var(--muted))', color: asset.is_favorite ? 'var(--neon-pink)' : 'hsl(var(--muted-foreground))' }}>
              <Heart className={`w-3 h-3 ${asset.is_favorite ? 'fill-current' : ''}`} />
            </button>
            <button onClick={() => onDelete(asset.id)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold text-destructive"
              style={{ background: 'rgba(255,0,0,0.06)' }}>
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}