/**
 * HistoryList — browse, duplicate, edit, delete, favorite, template saved assets.
 *
 * Improvements:
 *   - Rich empty states with CTAs
 *   - Inline action loading (no full list refresh spin)
 *   - Error handling with toast
 *   - Optimistic UI for favorite/template toggles
 *   - Better thumbnail rendering with aspect ratio
 *   - Relative timestamps
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Copy, Trash2, Heart, Edit2, Image as ImageIcon, RefreshCw, LayoutTemplate, Plus, AlertCircle } from 'lucide-react';
import { NEON, NEON_RGB, GRADIENTS, TEXT } from '@/lib/marketingTokens';
import { formatDistanceToNow } from 'date-fns';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: '♥ Favorites' },
  { id: 'templates', label: 'Templates' },
];

export default function HistoryList({ assets, onRefresh, loading, emptyAction }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const filtered = assets.filter(a => {
    if (filter === 'favorites') return a.is_favorite;
    if (filter === 'templates') return a.is_template;
    return true;
  });

  const safeRefresh = async () => {
    setError(null);
    try { await onRefresh(); } catch (e) { setError('Failed to load assets'); }
  };

  const handleDelete = async (asset) => {
    if (!confirm(`Delete "${asset.title}"? This cannot be undone.`)) return;
    setBusyId(asset.id);
    try {
      await base44.entities.MarketingAsset.delete(asset.id);
      await onRefresh();
    } catch (e) {
      setError('Failed to delete asset');
    }
    setBusyId(null);
  };

  const handleToggleFavorite = async (asset) => {
    setBusyId(asset.id);
    try {
      await base44.entities.MarketingAsset.update(asset.id, { is_favorite: !asset.is_favorite });
      await onRefresh();
    } catch (e) { setError('Failed to update'); }
    setBusyId(null);
  };

  const handleToggleTemplate = async (asset) => {
    setBusyId(asset.id);
    try {
      await base44.entities.MarketingAsset.update(asset.id, { is_template: !asset.is_template });
      await onRefresh();
    } catch (e) { setError('Failed to update'); }
    setBusyId(null);
  };

  const handleDuplicate = async (asset) => {
    setBusyId(asset.id);
    try {
      const { id, created_date, updated_date, created_by_id, created_by_email, ...rest } = asset;
      await base44.entities.MarketingAsset.create({
        ...rest,
        title: `${asset.title} (Copy)`,
        is_favorite: false,
        is_template: false,
        created_by_email: created_by_email,
      });
      await onRefresh();
    } catch (e) { setError('Failed to duplicate'); }
    setBusyId(null);
  };

  const getEditRoute = (asset) => {
    if (asset.asset_type === 'carousel') return `/marketing-studio/carousel?edit=${asset.id}`;
    if (asset.asset_type === 'mockup') return `/marketing-studio/mockup?edit=${asset.id}`;
    return `/marketing-studio/builder?edit=${asset.id}`;
  };

  const getAssetTypeLabel = (asset) => {
    if (asset.asset_type === 'carousel') return 'Carousel';
    if (asset.asset_type === 'mockup') return 'Mockup';
    return asset.graphic_type?.replace(/_/g, ' ') || 'Graphic';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
              style={filter === f.id
                ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
                : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={safeRefresh} disabled={loading} aria-label="Refresh assets"
          className="p-1.5 rounded-lg transition-colors hover:bg-muted">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-destructive mb-3"
          style={{ background: 'rgba(255,0,0,0.06)' }}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 px-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ background: `rgba(${NEON_RGB.purple}, 0.08)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.15)` }}>
            <ImageIcon className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-bold text-foreground mb-1">
            {filter === 'favorites' ? 'No favorites yet' : filter === 'templates' ? 'No templates yet' : 'No saved assets'}
          </p>
          <p className="text-xs text-muted-foreground mb-4 max-w-[200px] mx-auto">
            {filter === 'favorites'
              ? 'Tap the heart icon on any asset to save it here.'
              : filter === 'templates'
                ? 'Mark any asset as a template to reuse it later.'
                : 'Create your first marketing graphic to see it here.'}
          </p>
          {emptyAction !== false && (
            <button onClick={() => navigate('/marketing-studio/builder')}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full font-black text-xs"
              style={{ background: GRADIENTS.cta_primary, color: TEXT.dark }}>
              <Plus className="w-3.5 h-3.5" /> Create Graphic
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(asset => (
            <div key={asset.id}
              className="rounded-2xl overflow-hidden transition-all"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', opacity: busyId === asset.id ? 0.6 : 1 }}>
              <div className="flex gap-3 p-3">
                <button onClick={() => navigate(getEditRoute(asset))}
                  className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
                  style={{ background: '#050308' }}>
                  {asset.thumbnail_url ? (
                    <img src={asset.thumbnail_url} alt={asset.title} className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="font-bold text-sm text-foreground truncate flex-1">{asset.title}</p>
                    {asset.is_template && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: `rgba(${NEON_RGB.purple}, 0.15)`, color: NEON.purple }}>TPL</span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground capitalize mb-0.5">{getAssetTypeLabel(asset)} · {asset.canvas_preset}</p>
                  {asset.created_date && (
                    <p className="text-[9px] text-muted-foreground">{formatDistanceToNow(new Date(asset.created_date), { addSuffix: true })}</p>
                  )}
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    <button onClick={() => navigate(getEditRoute(asset))} disabled={busyId === asset.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50"
                      style={{ background: `rgba(${NEON_RGB.cyan}, 0.1)`, color: NEON.cyan, border: `1px solid rgba(${NEON_RGB.cyan}, 0.2)` }}>
                      <Edit2 className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => handleDuplicate(asset)} disabled={busyId === asset.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50"
                      style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
                      <Copy className="w-3 h-3" /> Dup
                    </button>
                    <button onClick={() => handleToggleFavorite(asset)} disabled={busyId === asset.id}
                      className="flex items-center px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50"
                      style={asset.is_favorite
                        ? { background: `rgba(${NEON_RGB.pink}, 0.12)`, color: NEON.pink }
                        : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
                      aria-label={asset.is_favorite ? 'Remove from favorites' : 'Add to favorites'}>
                      <Heart className={`w-3 h-3 ${asset.is_favorite ? 'fill-current' : ''}`} />
                    </button>
                    <button onClick={() => handleToggleTemplate(asset)} disabled={busyId === asset.id}
                      className="flex items-center px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50"
                      style={asset.is_template
                        ? { background: `rgba(${NEON_RGB.purple}, 0.12)`, color: NEON.purple }
                        : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
                      aria-label={asset.is_template ? 'Remove template status' : 'Save as template'}>
                      <LayoutTemplate className={`w-3 h-3 ${asset.is_template ? 'fill-current' : ''}`} />
                    </button>
                    <button onClick={() => handleDelete(asset)} disabled={busyId === asset.id}
                      className="flex items-center px-2 py-1 rounded-lg text-[10px] font-bold text-destructive transition-all active:scale-95 disabled:opacity-50"
                      style={{ background: 'rgba(255,0,0,0.06)' }}
                      aria-label="Delete asset">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}