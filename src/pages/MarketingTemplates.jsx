/**
 * Templates — browse, search, duplicate, and use saved templates.
 * Templates are MarketingAssets with is_template=true.
 * Users can save any asset as a template from the history view.
 *
 * Uses the same design patterns as the rest of the app.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { ArrowLeft, Search, Copy, Heart, Edit2, Image as ImageIcon, RefreshCw, Plus } from 'lucide-react';
import { NEON, NEON_RGB, GRADIENTS, TEXT } from '@/lib/marketingTokens';

function SectionLabel({ children, color = NEON.purple }) {
  return (
    <p className="text-[10px] font-black tracking-widest uppercase mb-4 flex items-center gap-2" style={{ color }}>
      <span className="w-4 h-px inline-block" style={{ background: color }} />
      {children}
    </p>
  );
}

export default function MarketingTemplates() {
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const list = await base44.entities.MarketingAsset.filter({ is_template: true }, '-created_date', 100);
      setTemplates(list || []);
    } catch (e) {
      // entity might not exist yet
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoadingAuth && user && isAdmin(user)) {
      loadTemplates();
    }
  }, [isLoadingAuth, user]);

  if (isLoadingAuth) {
    return <div className="min-h-full flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!user || !isAdmin(user)) {
    return <Navigate to="/events" replace />;
  }

  const filtered = templates.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.title?.toLowerCase().includes(q) ||
           t.graphic_type?.toLowerCase().includes(q) ||
           t.asset_type?.toLowerCase().includes(q);
  });

  const handleDuplicate = async (template) => {
    const { id, created_date, updated_date, created_by_id, is_template, ...rest } = template;
    const created = await base44.entities.MarketingAsset.create({
      ...rest,
      title: `${template.title} (Copy)`,
      is_template: false,
      is_favorite: false,
    });
    // Navigate to the editor with the new asset
    const route = created.asset_type === 'carousel' ? '/marketing-studio/carousel'
      : created.asset_type === 'mockup' ? '/marketing-studio/mockup'
      : '/marketing-studio/builder';
    navigate(`${route}?edit=${created.id}`);
  };

  const handleUse = (template) => {
    const route = template.asset_type === 'carousel' ? '/marketing-studio/carousel'
      : template.asset_type === 'mockup' ? '/marketing-studio/mockup'
      : '/marketing-studio/builder';
    navigate(`${route}?edit=${template.id}`);
  };

  const getEditRoute = (asset) => {
    if (asset.asset_type === 'carousel') return `/marketing-studio/carousel?edit=${asset.id}`;
    if (asset.asset_type === 'mockup') return `/marketing-studio/mockup?edit=${asset.id}`;
    return `/marketing-studio/builder?edit=${asset.id}`;
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
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Refresh */}
      <div className="flex items-center justify-between mb-4">
        <SectionLabel color={NEON.purple}>
          {filtered.length} Template{filtered.length !== 1 ? 's' : ''}
        </SectionLabel>
        <button onClick={loadTemplates} disabled={loading}>
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <ImageIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No templates yet.</p>
          <p className="text-xs text-muted-foreground mb-4">Save any graphic as a template from the History tab.</p>
          <button onClick={() => navigate('/marketing-studio/builder')}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full font-black text-xs"
            style={{ background: GRADIENTS.cta_primary, color: TEXT.dark }}>
            <Plus className="w-3.5 h-3.5" /> Create a Graphic
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(template => (
            <div key={template.id} className="rounded-2xl overflow-hidden"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex gap-3 p-3">
                <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: '#050308' }}>
                  {template.thumbnail_url ? (
                    <img src={template.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-foreground truncate">{template.title}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">
                    {template.asset_type?.replace(/_/g, ' ')} · {template.graphic_type?.replace(/_/g, ' ')}
                  </p>
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={() => handleUse(template)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
                      style={{ background: `rgba(${NEON_RGB.green}, 0.12)`, color: NEON.green, border: `1px solid rgba(${NEON_RGB.green}, 0.2)` }}>
                      <Edit2 className="w-3 h-3" /> Use
                    </button>
                    <button onClick={() => handleDuplicate(template)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
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