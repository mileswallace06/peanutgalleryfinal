/**
 * HistoryList — browse, duplicate, edit, delete, favorite saved assets.
 * Uses the same card patterns as the rest of the app.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Copy, Trash2, Heart, Edit2, Image as ImageIcon, RefreshCw, LayoutTemplate } from 'lucide-react';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

export default function HistoryList({ assets, onRefresh, loading }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');

  const filtered = assets.filter(a => {
    if (filter === 'favorites') return a.is_favorite;
    if (filter === 'templates') return a.is_template;
    return true;
  });

  const handleDelete = async (id) => {
    if (!confirm('Delete this asset?')) return;
    await base44.entities.MarketingAsset.delete(id);
    onRefresh();
  };

  const handleToggleFavorite = async (asset) => {
    await base44.entities.MarketingAsset.update(asset.id, { is_favorite: !asset.is_favorite });
    onRefresh();
  };

  const handleToggleTemplate = async (asset) => {
    await base44.entities.MarketingAsset.update(asset.id, { is_template: !asset.is_template });
    onRefresh();
  };

  const handleDuplicate = async (asset) => {
    const { id, created_date, updated_date, created_by_id, ...rest } = asset;
    await base44.entities.MarketingAsset.create({
      ...rest,
      title: `${asset.title} (Copy)`,
      is_favorite: false,
      is_template: false,
    });
    onRefresh();
  };

  const getEditRoute = (asset) => {
    if (asset.asset_type === 'carousel') return `/marketing-studio/carousel?edit=${asset.id}`;
    if (asset.asset_type === 'mockup') return `/marketing-studio/mockup?edit=${asset.id}`;
    return `/marketing-studio/builder?edit=${asset.id}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
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
        <button onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No saved assets yet.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(asset => (
            <div key={asset.id} className="rounded-2xl overflow-hidden" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex gap-3 p-3">
                <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: '#050308' }}>
                  {asset.thumbnail_url ? (
                    <img src={asset.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-foreground truncate">{asset.title}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{asset.graphic_type?.replace(/_/g, ' ')} · {asset.canvas_preset}</p>
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={() => navigate(getEditRoute(asset))}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
                      style={{ background: `rgba(${NEON_RGB.cyan}, 0.1)`, color: NEON.cyan, border: `1px solid rgba(${NEON_RGB.cyan}, 0.2)` }}>
                      <Edit2 className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => handleDuplicate(asset)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
                      style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
                      <Copy className="w-3 h-3" /> Dup
                    </button>
                    <button onClick={() => handleToggleFavorite(asset)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
                      style={asset.is_favorite
                        ? { background: `rgba(${NEON_RGB.pink}, 0.12)`, color: NEON.pink }
                        : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
                      <Heart className={`w-3 h-3 ${asset.is_favorite ? 'fill-current' : ''}`} />
                    </button>
                    <button onClick={() => handleToggleTemplate(asset)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
                      style={asset.is_template
                        ? { background: `rgba(${NEON_RGB.purple}, 0.12)`, color: NEON.purple }
                        : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
                      <LayoutTemplate className={`w-3 h-3 ${asset.is_template ? 'fill-current' : ''}`} />
                    </button>
                    <button onClick={() => handleDelete(asset.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold text-destructive"
                      style={{ background: 'rgba(255,0,0,0.06)' }}>
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