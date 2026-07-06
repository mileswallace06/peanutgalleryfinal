/**
 * Templates — browse, search, duplicate, and use saved templates.
 * Templates are MarketingAssets with is_template=true.
 *
 * Improvements:
 *   - Shared UI primitives
 *   - Loading skeleton
 *   - Better empty state
 *   - Asset type badge on cards
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { ArrowLeft, Search, Copy, Edit2, Image as ImageIcon, RefreshCw, Plus, AlertCircle } from 'lucide-react';
import { NEON, NEON_RGB, GRADIENTS, TEXT } from '@/lib/marketingTokens';
import { SectionLabel, LoadingSpinner } from '@/components/marketing/shared/UiPrimitives';
import { formatDistanceToNow } from 'date-fns';

export default function MarketingTemplates() {
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await base44.entities.MarketingAsset.filter({ is_template: true }, '-created_date', 100);
      setTemplates(list || []);
    } catch (e) {
      setError('Failed to load templates');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoadingAuth && user && isAdmin(user)) {
      loadTemplates();
    }
  }, [isLoadingAuth, user]);

  if (isLoadingAuth) return <LoadingSpinner />;
  if (!user || !isAdmin(user)) return <Navigate to="/events" replace />;

  const filtered = templates.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.title?.toLowerCase().includes(q) ||
           t.graphic_type?.toLowerCase().includes(q) ||
           t.asset_type?.toLowerCase().includes(q);
  });

  const handleDuplicate = async (template) => {
    setBusyId(template.id);
    try {
      const { id, created_date, updated_date, created_by_id, created_by_email, is_template, ...rest } = template;
      const created = await base44.entities.MarketingAsset.create({
        ...rest,
        title: `${template.title} (Copy)`,
        is_template: false,
        is_favorite: false,
        created_by_email: created_by_email,
      });
      const route = created.asset_type === 'carousel' ? '/marketing-studio/carousel'
        : created.asset_type === 'mockup' ? '/marketing-studio/mockup'
        : '/marketing-studio/builder';
      navigate(`${route}?edit=${created.id}`);
    } catch (e) {
      setError('Failed to duplicate template');
    }
    setBusyId(null);
  };

  const handleUse = (template) => {
    const route = template.asset_type === 'carousel' ? '/marketing-studio/carousel'
      : template.asset_type === 'mockup' ? '/marketing-studio/mockup'
      : '/marketing-studio/builder';
    navigate(`${route}?edit=${template.id}`);
  };

  const getAssetTypeLabel = (asset) => {
    if (asset.asset_type === 'carousel') return 'Carousel';
    if (asset.asset_type === 'mockup') return 'Mockup';
    return asset.graphic_type?.replace(/_/g, ' ') || 'Graphic';
  };

  return (
    <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg min-h-full"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>

      <button onClick={() => navigate('/marketing-studio')}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Studio
      </button>

      {/* Hero */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black mb-4"
          style={{ background: `rgba(${NEON_RGB.cyan}, 0.12)`, border: `1px solid rgba(${NEON_RGB.cyan}, 0.3)`, color: NEON.cyan }}>
          📋 Template Library
        </div>
        <h1 className="font-display leading-none mb-3"
          style={{
            fontSize: 'clamp(2.4rem, 10vw, 3.5rem)',
            background: `linear-gradient(135deg, ${NEON.cyan}, ${NEON.green})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
          Templates
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
          Save any graphic as a template to reuse later. Duplicate, edit, or start fresh from a template.
        </p>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <SectionLabel color={NEON.purple}>
          {filtered.length} Template{filtered.length !== 1 ? 's' : ''}
        </SectionLabel>
        <button onClick={loadTemplates} disabled={loading} aria-label="Refresh templates"
          className="p-1.5 rounded-lg transition-colors hover:bg-muted">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-destructive mb-4"
          style={{ background: 'rgba(255,0,0,0.06)' }}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl p-3 flex gap-3 animate-pulse" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="w-16 h-16 rounded-xl" style={{ background: 'hsl(var(--muted))' }} />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded" style={{ background: 'hsl(var(--muted))' }} />
                <div className="h-3 w-1/2 rounded" style={{ background: 'hsl(var(--muted))' }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 px-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ background: `rgba(${NEON_RGB.cyan}, 0.08)`, border: `1px solid rgba(${NEON_RGB.cyan}, 0.15)` }}>
            <ImageIcon className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-bold text-foreground mb-1">
            {search ? 'No matching templates' : 'No templates yet'}
          </p>
          <p className="text-xs text-muted-foreground mb-4 max-w-[220px] mx-auto">
            {search
              ? 'Try a different search term.'
              : 'Save any graphic as a template from the History tab to reuse it later.'}
          </p>
          {!search && (
            <button onClick={() => navigate('/marketing-studio/builder')}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full font-black text-xs"
              style={{ background: GRADIENTS.cta_primary, color: TEXT.dark }}>
              <Plus className="w-3.5 h-3.5" /> Create a Graphic
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(template => (
            <div key={template.id} className="rounded-2xl overflow-hidden transition-all"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', opacity: busyId === template.id ? 0.6 : 1 }}>
              <div className="flex gap-3 p-3">
                <button onClick={() => handleUse(template)} className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: '#050308' }}>
                  {template.thumbnail_url ? (
                    <img src={template.thumbnail_url} alt={template.title} className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-foreground truncate">{template.title}</p>
                  <p className="text-[10px] text-muted-foreground capitalize mb-0.5">{getAssetTypeLabel(template)} · {template.canvas_preset}</p>
                  {template.created_date && (
                    <p className="text-[9px] text-muted-foreground">{formatDistanceToNow(new Date(template.created_date), { addSuffix: true })}</p>
                  )}
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={() => handleUse(template)} disabled={busyId === template.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50"
                      style={{ background: `rgba(${NEON_RGB.green}, 0.12)`, color: NEON.green, border: `1px solid rgba(${NEON_RGB.green}, 0.2)` }}>
                      <Edit2 className="w-3 h-3" /> Use
                    </button>
                    <button onClick={() => handleDuplicate(template)} disabled={busyId === template.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50"
                      style={{ background: `rgba(${NEON_RGB.cyan}, 0.1)`, color: NEON.cyan, border: `1px solid rgba(${NEON_RGB.cyan}, 0.2)` }}>
                      <Copy className="w-3 h-3" /> Duplicate
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