import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { FEEDBACK_CATEGORIES, loadFeedbackPage } from '@/lib/feedbackInbox';

export default function FeedbackInbox({ user }) {
  const [category, setCategory] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offset = useRef(0);
  const request = useRef(0);
  const load = useCallback(async (reset = true) => {
    const generation = ++request.current;
    setLoading(true);
    setError(false);
    if (reset) { setRows([]); offset.current = 0; setHasMore(false); }
    try {
      const page = await loadFeedbackPage(base44, user, category, offset.current);
      if (request.current !== generation) return;
      offset.current += page.rows.length;
      setRows(previous => [...new Map([...previous, ...page.rows].map(row => [row.id, row])).values()]);
      setHasMore(page.hasMore);
    } catch {
      if (request.current === generation) setError(true);
    } finally {
      if (request.current === generation) setLoading(false);
    }
  }, [user, category]);
  useEffect(() => {
    load();
    return () => { request.current++; };
  }, [load]);

  return (
    <section aria-label="Feedback inbox" className="px-4 py-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-xl text-foreground">Feedback inbox</h2>
        <button onClick={() => load()} disabled={loading} className="flex items-center gap-2 text-sm text-purple-400 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <label className="flex items-center gap-3 text-sm text-muted-foreground">
        Category
        <select aria-label="Feedback category" value={category} onChange={e => setCategory(e.target.value)} className="rounded-lg border border-border bg-background text-foreground p-2">
          <option value="all">All feedback</option>
          {Object.entries(FEEDBACK_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {error && <div role="alert" className="rounded-xl border border-red-400/30 p-4 text-sm text-foreground">
        Could not load feedback. <button onClick={() => load(rows.length === 0)} className="underline">Try again</button>
      </div>}
      {!loading && !error && rows.length === 0 && <p className="text-sm text-muted-foreground py-8">No feedback in this category yet.</p>}
      <div className="space-y-3">
        {rows.map(row => {
          const submitted = new Date(row.created_date);
          const validDate = Number.isFinite(submitted.getTime());
          return <article key={row.id} className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span className="font-bold text-purple-400">{FEEDBACK_CATEGORIES[row.feedback_type] || row.feedback_type || 'Feedback'}</span>
              <time dateTime={validDate ? submitted.toISOString() : undefined} className="text-muted-foreground">
                {validDate ? submitted.toLocaleString() : 'Submission time unavailable'}
              </time>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">{row.message || 'No message included.'}</p>
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Page: {row.page || 'Unknown page'}</p>
          </article>;
        })}
      </div>
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading feedback…</p>}
      {hasMore && !error && <button disabled={loading} onClick={() => load(false)} className="w-full rounded-xl border border-border py-3 text-sm font-bold text-foreground disabled:opacity-50">Load more</button>}
    </section>
  );
}
