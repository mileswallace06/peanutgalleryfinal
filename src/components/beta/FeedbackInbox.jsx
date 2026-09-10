import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, ChevronRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { FEEDBACK_CATEGORIES, loadFeedbackPage } from '@/lib/feedbackInbox';
import { identifyFeedbackPage } from '@/lib/feedbackPage';
import FeedbackDetails from './FeedbackDetails';

export default function FeedbackInbox({ user }) {
  const [category, setCategory] = useState('all');
  const [selectedNote, setSelectedNote] = useState(null);
  const detailTrigger = useRef(null);
  const [hideDetails, setHideDetails] = useState(false);
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
    <section aria-label="Feedback inbox" aria-busy={loading} className="px-4 py-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-xl text-foreground">Feedback inbox</h2>
        <button onClick={() => load()} disabled={loading} className="flex items-center gap-2 min-h-11 px-2 text-sm text-purple-400 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <p className="text-sm text-muted-foreground">Notes sent from the app · Newest first</p>
      <div role="group" aria-label="Feedback categories" className="flex flex-wrap gap-2">
        {Object.entries({ all: 'All', ...FEEDBACK_CATEGORIES }).map(([key, label]) => (
          <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}
            className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${category === key ? 'border-purple-400/50 bg-purple-400/15 text-purple-400' : 'border-border text-muted-foreground'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p aria-live="polite">{rows.length} {rows.length === 1 ? 'note' : 'notes'} loaded{hasMore ? ' · More available' : ''}</p>
        <button onClick={() => setHideDetails(value => !value)} aria-pressed={hideDetails} className="min-h-11 px-2 underline">
          {hideDetails ? 'Show note details' : 'Hide note details'}
        </button>
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-400/30 p-4 text-sm text-foreground">
        Could not load feedback. <button onClick={() => load(rows.length === 0)} className="underline">Try again</button>
      </div>}
      {!loading && !error && rows.length === 0 && <p className="text-sm text-muted-foreground py-8">{category === 'all' ? 'No feedback has been submitted yet.' : 'No feedback in this category yet.'}</p>}
      <div className="space-y-3">
        {rows.map(row => {
          const page = identifyFeedbackPage(row.page);
          const submitted = new Date(row.created_date);
          const validDate = Number.isFinite(submitted.getTime());
          return <article key={row.id} aria-label="Feedback note">
            <button type="button" aria-haspopup="dialog" aria-label={`View ${FEEDBACK_CATEGORIES[row.feedback_type] || 'Feedback'} feedback from ${page.name}`}
              onClick={event => { detailTrigger.current = event.currentTarget; setSelectedNote(row); }}
              className="w-full rounded-2xl border border-border bg-card p-4 space-y-3 text-left transition-colors hover:border-purple-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400">
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span className="font-bold text-purple-400">{FEEDBACK_CATEGORIES[row.feedback_type] || row.feedback_type || 'Feedback'}{row.submitter_user_id === user.id && <span className="ml-2 text-muted-foreground font-normal">· Your note</span>}</span>
              <time dateTime={validDate ? submitted.toISOString() : undefined} className="text-muted-foreground">
                {validDate ? submitted.toLocaleString() : 'Submission time unavailable'}
              </time>
            </div>
            {hideDetails ? <p className="text-sm text-muted-foreground italic">Note details hidden</p> : <>
              <p data-feedback-page className="text-sm font-bold text-purple-400 [overflow-wrap:anywhere]">{page.name}{page.path && <span className="font-normal text-foreground"> · {page.path}</span>}</p>
              <p data-feedback-message className="text-sm text-foreground whitespace-pre-wrap line-clamp-3 [overflow-wrap:anywhere]">{row.message || 'No message included.'}</p>
            </>}
            <span className="flex items-center justify-between gap-2 text-xs font-bold text-muted-foreground">View details <ChevronRight className="h-4 w-4" /></span>
            </button>
          </article>;
        })}
      </div>
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading feedback…</p>}
      {hasMore && !error && <button disabled={loading} onClick={() => load(false)} className="w-full rounded-xl border border-border py-3 text-sm font-bold text-foreground disabled:opacity-50">Load more</button>}
      <FeedbackDetails note={selectedNote} onClose={() => setSelectedNote(null)} triggerRef={detailTrigger} />
    </section>
  );
}
