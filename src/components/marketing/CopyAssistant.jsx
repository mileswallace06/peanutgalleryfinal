/**
 * CopyAssistant — AI-powered content generation.
 * Uses InvokeLLM to help write headlines, captions, CTAs, etc.
 * The AI generates COPY only — never artwork or layouts.
 */
import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

const ACTIONS = [
  { id: 'headline', label: '✍️ Write Headline', desc: 'Generate a bold headline from a topic' },
  { id: 'rewrite', label: '🔄 Rewrite Headline', desc: 'Improve your existing headline' },
  { id: 'shorten', label: '✂️ Shorten Copy', desc: 'Tighten your subheadline/body' },
  { id: 'expand', label: '📈 Expand Copy', desc: 'Add depth to your body copy' },
  { id: 'cta', label: '🔘 Generate CTA', desc: 'Create a call-to-action' },
  { id: 'ig_caption', label: '📸 Instagram Caption', desc: 'Full caption for Instagram' },
  { id: 'li_caption', label: '💼 LinkedIn Caption', desc: 'Professional LinkedIn post' },
  { id: 'x_post', label: '𝕏 X Post', desc: 'Concise post for X/Twitter' },
  { id: 'hashtags', label: '#️⃣ Hashtags', desc: 'Relevant hashtags' },
];

function buildPrompt(action, context) {
  const brand = `You are the in-house copywriter for Peanut Gallery, a fan-first ticket marketplace. Brand voice: bold, confident, modern, premium, trustworthy. No hype-bro language. No emojis in headlines. Headlines should be punchy and short (3-7 words). Subheadlines should be one sentence.`;
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
    default:
      return `${brand}\n\nGenerate copy about: ${ctx}\n\nReturn JSON: { "options": ["option1"] }`;
  }
}

export default function CopyAssistant({ content, onApply }) {
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
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-muted/50"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: 'var(--neon-purple)' }} />
          <span className="text-sm font-bold text-foreground">AI Copy Assistant</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[10px] text-muted-foreground">AI helps with copy only — layouts always follow Peanut Gallery's design system.</p>

          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="Topic or context (optional)..."
            className="w-full px-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground"
          />

          <div className="grid grid-cols-2 gap-2">
            {ACTIONS.map(a => (
              <button
                key={a.id}
                onClick={() => runAction(a.id)}
                disabled={loading !== null}
                className="flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl text-left transition-all active:scale-95 disabled:opacity-50"
                style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.2)' }}
              >
                <span className="text-xs font-bold text-foreground">{a.label}</span>
                <span className="text-[9px] text-muted-foreground leading-tight">{a.desc}</span>
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
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
                <div key={i} className="flex items-start gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'hsl(var(--muted))' }}>
                  <p className="flex-1 text-sm text-foreground">{opt}</p>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => applyText(opt, 'headline')} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: 'rgba(0,255,135,0.12)', color: 'var(--neon-green)' }}>Headline</button>
                    <button onClick={() => applyText(opt, 'subheadline')} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: 'rgba(0,200,255,0.12)', color: 'var(--neon-cyan)' }}>Sub</button>
                    <button onClick={() => copyToClipboard(opt)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--card))' }}>Copy</button>
                  </div>
                </div>
              ))}
              {results.data?.caption && (
                <div className="px-3 py-2.5 rounded-xl" style={{ background: 'hsl(var(--muted))' }}>
                  <p className="text-sm text-foreground whitespace-pre-wrap mb-2">{results.data.caption}</p>
                  <button onClick={() => copyToClipboard(results.data.caption)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--card))' }}>Copy to clipboard</button>
                </div>
              )}
              {results.data?.hashtags && (
                <div className="px-3 py-2.5 rounded-xl" style={{ background: 'hsl(var(--muted))' }}>
                  <p className="text-sm text-foreground mb-2">{results.data.hashtags.join(' ')}</p>
                  <button onClick={() => copyToClipboard(results.data.hashtags.join(' '))} className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground" style={{ background: 'hsl(var(--card))' }}>Copy all</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}