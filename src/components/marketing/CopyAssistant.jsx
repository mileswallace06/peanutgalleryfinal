/**
 * CopyAssistant — AI-powered content generation.
 * Uses InvokeLLM to help write headlines, captions, CTAs, etc.
 * The AI generates COPY only — never artwork or layouts.
 *
 * Improvements:
 *   - Richer brand context with specific PG differentiators
 *   - Apply to body/subheadline/cta fields, not just headline
 *   - Carousel AI can populate all slides at once
 *   - Better result rendering with apply-to-field buttons
 *   - Action-specific JSON schemas (lighter payloads)
 */
import { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

const BRAND_CONTEXT = `You are the in-house copywriter for Peanut Gallery, a fan-first ticket marketplace where fans buy, sell, and upgrade tickets safely.

Brand voice: bold, confident, modern, premium, trustworthy. Direct, never hype-bro. No emojis in headlines.

Key differentiators to draw from when relevant:
- Escrow-protected payments (buyer funds held until ticket confirmed)
- AI-powered transfer verification
- Fan Drops (free ticket giveaways from the community)
- Live upgrades (upgrade your seats mid-event)
- Instant Transfer listings (PG holds the ticket, delivers instantly)
- Community trust scores and verified sellers
- No bots, no scalpers — real fans only

Headlines: punchy, 3-7 words, uppercase feel. Subheadlines: one sentence. Body: 2-3 sentences max.
The brand uses neon green, cyan, purple, and pink — but you only generate text, not visuals.`;

const ACTIONS = [
  { id: 'headline',      label: 'Headlines',      icon: '✍️', desc: '5 bold headline options' },
  { id: 'rewrite',       label: 'Rewrite',        icon: '🔄', desc: 'Punchier alternatives' },
  { id: 'shorten',       label: 'Shorten',        icon: '✂️', desc: 'Tighten existing copy' },
  { id: 'expand',        label: 'Expand',         icon: '📈', desc: 'Add depth and specificity' },
  { id: 'cta',           label: 'CTA',            icon: '🔘', desc: 'Call-to-action buttons' },
  { id: 'hook',          label: 'Hooks',          icon: '🪝', desc: 'Attention-grabbing openers' },
  { id: 'ig_caption',    label: 'IG Caption',     icon: '📸', desc: 'Instagram caption' },
  { id: 'li_caption',    label: 'LinkedIn',       icon: '💼', desc: 'LinkedIn post' },
  { id: 'x_post',        label: 'X Post',         icon: '𝕏',  desc: 'Concise X/Twitter post' },
  { id: 'hashtags',      label: 'Hashtags',       icon: '#️⃣', desc: '15 relevant tags' },
  { id: 'carousel',      label: 'Carousel',       icon: '🎠', desc: 'Full slide deck copy' },
  { id: 'announcement',  label: 'Announcement',   icon: '📢', desc: 'Headline + sub + body' },
];

function buildPrompt(action, context) {
  const ctx = context.headline || context.body || context.subheadline || context.topic || 'Peanut Gallery ticket marketplace';

  const prompts = {
    headline: `${BRAND_CONTEXT}\n\nWrite 5 bold headline options for a marketing graphic about: ${ctx}\n\nRules: 3-7 words each, no emojis, punchy and confident.\n\nReturn JSON: { "options": ["...", "...", ...] }`,
    rewrite: `${BRAND_CONTEXT}\n\nRewrite this headline to be punchier and more premium. Provide 5 alternatives.\n\nOriginal: ${context.headline || ctx}\n\nReturn JSON: { "options": ["...", "...", ...] }`,
    shorten: `${BRAND_CONTEXT}\n\nShorten and tighten this copy to be more impactful. Keep the core message. Provide 3 options.\n\nCopy: ${context.body || context.subheadline || ctx}\n\nReturn JSON: { "options": ["...", "...", "..."] }`,
    expand: `${BRAND_CONTEXT}\n\nExpand this copy with more depth and specificity. Keep it premium and confident. Provide 2 options.\n\nCopy: ${context.body || context.subheadline || ctx}\n\nReturn JSON: { "options": ["...", "..."] }`,
    cta: `${BRAND_CONTEXT}\n\nGenerate 5 call-to-action button texts (2-4 words each) for a marketing graphic about: ${ctx}\n\nReturn JSON: { "options": ["...", "...", ...] }`,
    hook: `${BRAND_CONTEXT}\n\nGenerate 5 attention-grabbing hooks for a social media post about: ${ctx}\n\nReturn JSON: { "options": ["...", "...", ...] }`,
    ig_caption: `${BRAND_CONTEXT}\n\nWrite an Instagram caption for a post about: ${ctx}\nInclude a hook, value, and a CTA. 2-4 sentences. No hashtags.\n\nReturn JSON: { "caption": "..." }`,
    li_caption: `${BRAND_CONTEXT}\n\nWrite a LinkedIn post about: ${ctx}\nProfessional, insightful, 3-5 sentences. Include a CTA.\n\nReturn JSON: { "caption": "..." }`,
    x_post: `${BRAND_CONTEXT}\n\nWrite a concise X/Twitter post (max 200 chars) about: ${ctx}\n\nReturn JSON: { "caption": "..." }`,
    hashtags: `${BRAND_CONTEXT}\n\nGenerate 15 relevant hashtags for a post about: ${ctx}\nMix broad and niche tags.\n\nReturn JSON: { "hashtags": ["#tag1", "#tag2", ...] }`,
    carousel: `${BRAND_CONTEXT}\n\nGenerate copy for a 7-slide Instagram carousel about: ${ctx}\n\nSlide structure:\n1. Hook — attention grabber\n2. Problem — the pain point\n3. Why It Matters — stakes\n4. Current Industry — how things work now\n5. How PG Fixes It — the solution\n6. The Future — vision\n7. CTA — call to action\n\nFor each slide provide a headline (3-6 words) and body (1-2 sentences).\n\nReturn JSON: { "slides": [{ "headline": "...", "body": "..." }, ...] }`,
    announcement: `${BRAND_CONTEXT}\n\nWrite an announcement about: ${ctx}\nProvide a headline (3-7 words), subheadline (one sentence), and body (2-3 sentences).\n\nReturn JSON: { "headline": "...", "subheadline": "...", "body": "..." }`,
  };

  return prompts[action] || prompts.headline;
}

const FIELD_LABELS = [
  { field: 'headline', label: 'Headline', color: NEON.green, rgb: NEON_RGB.green },
  { field: 'subheadline', label: 'Sub', color: NEON.cyan, rgb: NEON_RGB.cyan },
  { field: 'body', label: 'Body', color: NEON.purple, rgb: NEON_RGB.purple },
  { field: 'cta', label: 'CTA', color: NEON.pink, rgb: NEON_RGB.pink },
];

export default function CopyAssistant({ content, onApply, onApplyCarousel, carouselMode = false }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  // Track which specific item was copied (key string) — not a shared boolean,
  // so only the tapped button shows "✓", not every copy button on screen.
  const [copiedKey, setCopiedKey] = useState(null);
  const copyTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const runAction = async (actionId) => {
    setLoading(actionId);
    setError(null);
    setResults(null);
    try {
      const context = { ...content, topic };
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: buildPrompt(actionId, context),
        response_json_schema: {
          type: 'object',
          properties: {
            options: { type: 'array', items: { type: 'string' } },
            caption: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } },
            slides: { type: 'array', items: { type: 'object', properties: { headline: { type: 'string' }, body: { type: 'string' } } } },
            headline: { type: 'string' },
            subheadline: { type: 'string' },
            body: { type: 'string' },
          },
        },
      });
      setResults({ action: actionId, data: res });
    } catch (e) {
      setError(e.message || 'Failed to generate copy. Please try again.');
    } finally {
      setLoading(null);
    }
  };

  const applyText = (text, field) => {
    onApply(field, text);
  };

  const copyToClipboard = (text, key = 'default') => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 1500);
    }).catch(() => {});
  };

  const applyCarouselSlides = () => {
    if (results.data?.slides && onApplyCarousel) {
      onApplyCarousel(results.data.slides);
      setResults(null);
    }
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: `rgba(${NEON_RGB.purple}, 0.04)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.15)` }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-muted/50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: NEON.purple }} />
          <span className="text-sm font-bold text-foreground">AI Copy Assistant</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: NEON.purple }}>
            AI generates copy only — layouts always follow PG's design system
          </p>

          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="Topic or context (optional — uses your content if empty)..."
            className="w-full px-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />

          <div className="grid grid-cols-3 gap-2">
            {ACTIONS.map(a => (
              <button
                key={a.id}
                onClick={() => runAction(a.id)}
                disabled={loading !== null}
                className="flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-xl text-center transition-all active:scale-95 disabled:opacity-50"
                style={{ background: `rgba(${NEON_RGB.purple}, 0.06)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.15)` }}
              >
                <span className="text-base">{a.icon}</span>
                <span className="text-[9px] font-bold text-foreground leading-tight">{a.label}</span>
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: NEON.purple }} />
              <span className="text-xs text-muted-foreground">Generating...</span>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-xl text-xs text-destructive" style={{ background: 'rgba(255,0,0,0.06)' }}>
              {error}
            </div>
          )}

          {results && !loading && (
            <div className="space-y-2">
              {/* Options list (headline, rewrite, shorten, expand, cta, hook) */}
              {results.data?.options?.map((opt, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'hsl(var(--card))' }}>
                  <p className="flex-1 text-sm text-foreground">{opt}</p>
                  <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
                    {FIELD_LABELS.map(f => (
                      <button key={f.field} onClick={() => applyText(opt, f.field)}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold transition-colors"
                        style={{ background: `rgba(${f.rgb}, 0.12)`, color: f.color }}>
                        {f.label}
                      </button>
                    ))}
                    <button onClick={() => copyToClipboard(opt, `opt-${i}`)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>
                      {copiedKey === `opt-${i}` ? '✓' : 'Copy'}
                    </button>
                  </div>
                </div>
              ))}

              {/* Caption result */}
              {results.data?.caption && (
                <div className="px-3 py-2.5 rounded-xl" style={{ background: 'hsl(var(--card))' }}>
                  <p className="text-sm text-foreground whitespace-pre-wrap mb-2">{results.data.caption}</p>
                  <button onClick={() => copyToClipboard(results.data.caption, 'caption')} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>
                    {copiedKey === 'caption' ? '✓ Copied' : 'Copy to clipboard'}
                  </button>
                </div>
              )}

              {/* Hashtags result */}
              {results.data?.hashtags && (
                <div className="px-3 py-2.5 rounded-xl" style={{ background: 'hsl(var(--card))' }}>
                  <p className="text-sm text-foreground mb-2 break-words">{results.data.hashtags.join(' ')}</p>
                  <button onClick={() => copyToClipboard(results.data.hashtags.join(' '), 'hashtags')} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>
                    {copiedKey === 'hashtags' ? '✓ Copied' : 'Copy all'}
                  </button>
                </div>
              )}

              {/* Announcement result (headline + sub + body) */}
              {results.data?.headline && (
                <div className="px-3 py-2.5 rounded-xl space-y-2" style={{ background: 'hsl(var(--card))' }}>
                  <p className="text-sm font-bold text-foreground">{results.data.headline}</p>
                  {results.data.subheadline && <p className="text-sm text-muted-foreground">{results.data.subheadline}</p>}
                  {results.data.body && <p className="text-xs text-muted-foreground">{results.data.body}</p>}
                  <button onClick={() => { applyText(results.data.headline, 'headline'); applyText(results.data.subheadline || '', 'subheadline'); applyText(results.data.body || '', 'body'); }}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: `rgba(${NEON_RGB.green}, 0.12)`, color: NEON.green }}>
                    Apply all to content
                  </button>
                </div>
              )}

              {/* Carousel slides result */}
              {results.data?.slides && (
                <div className="px-3 py-2.5 rounded-xl space-y-3" style={{ background: 'hsl(var(--card))' }}>
                  {results.data.slides.map((s, i) => (
                    <div key={i}>
                      <p className="text-xs font-black tracking-widest uppercase mb-1" style={{ color: NEON.purple }}>Slide {i + 1}</p>
                      <p className="text-sm font-bold text-foreground">{s.headline}</p>
                      <p className="text-xs text-muted-foreground">{s.body}</p>
                    </div>
                  ))}
                  {carouselMode && onApplyCarousel ? (
                    <button onClick={applyCarouselSlides}
                      className="w-full px-3 py-2 rounded-lg text-xs font-bold"
                      style={{ background: `rgba(${NEON_RGB.green}, 0.12)`, color: NEON.green }}>
                      Populate all slides
                    </button>
                  ) : (
                    <button onClick={() => copyToClipboard(JSON.stringify(results.data.slides, null, 2), 'slides-json')}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>
                      {copiedKey === 'slides-json' ? '✓ Copied' : 'Copy as JSON'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}