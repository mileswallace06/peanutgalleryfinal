/**
 * CopyAssistant — AI-powered content generation.
 * Uses InvokeLLM to help write headlines, captions, CTAs, etc.
 * The AI generates COPY only — never artwork or layouts.
 *
 * Styled with the same patterns as WhyPeanutGallery / InstantListingsGuide:
 *   - SectionLabel with line + text
 *   - Glass cards with rgba(NEON, 0.06) backgrounds
 *   - Neon-accented buttons
 */
import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, Loader2, ChevronDown, ChevronUp, Wand2 } from 'lucide-react';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

const ACTIONS = [
  { id: 'headline', label: 'Write Headline', icon: '✍️' },
  { id: 'rewrite', label: 'Rewrite Headline', icon: '🔄' },
  { id: 'shorten', label: 'Shorten Copy', icon: '✂️' },
  { id: 'expand', label: 'Expand Copy', icon: '📈' },
  { id: 'cta', label: 'Generate CTA', icon: '🔘' },
  { id: 'ig_caption', label: 'Instagram Caption', icon: '📸' },
  { id: 'li_caption', label: 'LinkedIn Post', icon: '💼' },
  { id: 'x_post', label: 'X Post', icon: '𝕏' },
  { id: 'hashtags', label: 'Hashtags', icon: '#️⃣' },
  { id: 'carousel', label: 'Carousel Copy', icon: '🎠' },
  { id: 'hook', label: 'Generate Hook', icon: '🪝' },
  { id: 'announcement', label: 'Announcement', icon: '📢' },
];

function buildPrompt(action, context) {
  const brand = `You are the in-house copywriter for Peanut Gallery, a fan-first ticket marketplace. Brand voice: bold, confident, modern, premium, trustworthy. No hype-bro language. No emojis in headlines. Headlines should be punchy and short (3-7 words). Subheadlines should be one sentence. The brand colors are neon green, cyan, purple, and pink — but you only generate text, not visuals.`;
  const ctx = context.headline || context.body || context.subheadline || context.topic || '(no context provided)';

  switch (action) {
    case 'headline':
      return `${brand}\n\nWrite 5 bold headline options for a marketing graphic about: ${ctx}\n\nReturn JSON: { "options": ["headline1", "headline2", ...] }`;
    case 'rewrite':
      return `${brand}\n\nRewrite this headline to be punchier and more premium. Provide 5 alternatives.\n\nOriginal: ${context.headline || ctx}\n\nReturn JSON: { "options": ["headline1", "headline2", ...] }`;
    case 'shorten':
      return `${brand}\n\nShorten and tighten this copy to be more impactful. Keep the core message.\n\nCopy: ${context.body || context.subheadline || ctx}\n\nReturn JSON: { "options": ["short1", "short2", "short3"] }`;
    case 'expand':
      return `${brand}\n\nExpand this copy with more depth and specificity. Keep it premium and confident.\n\nCopy: ${context.body || context.subheadline || ctx}\n\nReturn JSON: { "options": ["expanded1", "expanded2"] }`;
    case 'cta':
      return `${brand}\n\nGenerate 5 call-to-action button texts (2-4 words each) for a marketing graphic about: ${ctx}\n\nReturn JSON: { "options": ["cta1", "cta2", ...] }`;
    case 'ig_caption':
      return `${brand}\n\nWrite an Instagram caption for a post about: ${ctx}\nInclude a hook, value, and a CTA. 2-4 sentences.\n\nReturn JSON: { "caption": "..." }`;
    case 'li_caption':
      return `${brand}\n\nWrite a LinkedIn post about: ${ctx}\nProfessional, insightful, 3-5 sentences. Include a CTA.\n\nReturn JSON: { "caption": "..." }`;
    case 'x_post':
      return `${brand}\n\nWrite a concise X/Twitter post (max 200 chars) about: ${ctx}\n\nReturn JSON: { "caption": "..." }`;
    case 'hashtags':
      return `${brand}\n\nGenerate 15 relevant hashtags for a post about: ${ctx}\n\nReturn JSON: { "hashtags": ["#tag1", "#tag2", ...] }`;
    case 'carousel':
      return `${brand}\n\nGenerate copy for a 7-slide Instagram carousel about: ${ctx}\nSlide structure: Hook, Problem, Why, Current Industry, How PG Fixes It, Future, CTA.\n\nReturn JSON: { "slides": [{ "headline": "...", "body": "..." }, ...] }`;
    case 'hook':
      return `${brand}\n\nGenerate 5 attention-grabbing hooks for a social media post about: ${ctx}\n\nReturn JSON: { "options": ["hook1", "hook2", ...] }`;
    case 'announcement':
      return `${brand}\n\nWrite an announcement post about: ${ctx}\nInclude a headline, subheadline, and body. 2-3 sentences for body.\n\nReturn JSON: { "headline": "...", "subheadline": "...", "body": "..." }`;
    default:
      return `${brand}\n\nGenerate copy about: ${ctx}\n\nReturn JSON: { "options": ["option1"] }`;
  }
}

export default function CopyAssistant({ content, onApply, targetField = 'headline' }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

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
      setError(e.message || 'Failed to generate copy');
    } finally {
      setLoading(null);
    }
  };

  const applyText = (text, field) => {
    onApply(field, text);
    setResults(null);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: `rgba(${NEON_RGB.purple}, 0.04)`, border: `1px solid rgba(${NEON_RGB.purple}, 0.15)` }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-muted/50"
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
            placeholder="Topic or context (optional)..."
            className="w-full px-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground"
          />

          <div className="grid grid-cols-3 gap-2">
            {ACTIONS.map(a => (
              <button
                key={a.id}
                onClick={() => runAction(a.id)}
                disabled={loading !== null}
                className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-center transition-all active:scale-95 disabled:opacity-50"
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

          {results && (
            <div className="space-y-2">
              {results.data?.options?.map((opt, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'hsl(var(--card))' }}>
                  <p className="flex-1 text-sm text-foreground">{opt}</p>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => applyText(opt, 'headline')} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: `rgba(${NEON_RGB.green}, 0.12)`, color: NEON.green }}>Headline</button>
                    <button onClick={() => applyText(opt, 'subheadline')} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: `rgba(${NEON_RGB.cyan}, 0.12)`, color: NEON.cyan }}>Sub</button>
                    <button onClick={() => copyToClipboard(opt)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>Copy</button>
                  </div>
                </div>
              ))}
              {results.data?.caption && (
                <div className="px-3 py-2.5 rounded-xl" style={{ background: 'hsl(var(--card))' }}>
                  <p className="text-sm text-foreground whitespace-pre-wrap mb-2">{results.data.caption}</p>
                  <button onClick={() => copyToClipboard(results.data.caption)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>Copy to clipboard</button>
                </div>
              )}
              {results.data?.hashtags && (
                <div className="px-3 py-2.5 rounded-xl" style={{ background: 'hsl(var(--card))' }}>
                  <p className="text-sm text-foreground mb-2">{results.data.hashtags.join(' ')}</p>
                  <button onClick={() => copyToClipboard(results.data.hashtags.join(' '))} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>Copy all</button>
                </div>
              )}
              {results.data?.headline && (
                <div className="px-3 py-2.5 rounded-xl space-y-2" style={{ background: 'hsl(var(--card))' }}>
                  <p className="text-sm font-bold text-foreground">{results.data.headline}</p>
                  {results.data.subheadline && <p className="text-sm text-muted-foreground">{results.data.subheadline}</p>}
                  {results.data.body && <p className="text-xs text-muted-foreground">{results.data.body}</p>}
                  <button onClick={() => { applyText(results.data.headline, 'headline'); onApply('subheadline', results.data.subheadline || ''); onApply('body', results.data.body || ''); }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: `rgba(${NEON_RGB.green}, 0.12)`, color: NEON.green }}>Apply all</button>
                </div>
              )}
              {results.data?.slides && (
                <div className="px-3 py-2.5 rounded-xl space-y-3" style={{ background: 'hsl(var(--card))' }}>
                  {results.data.slides.map((s, i) => (
                    <div key={i}>
                      <p className="text-xs font-black tracking-widest uppercase mb-1" style={{ color: NEON.purple }}>Slide {i + 1}</p>
                      <p className="text-sm font-bold text-foreground">{s.headline}</p>
                      <p className="text-xs text-muted-foreground">{s.body}</p>
                    </div>
                  ))}
                  <button onClick={() => copyToClipboard(JSON.stringify(results.data.slides, null, 2))} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--muted))' }}>Copy as JSON</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}