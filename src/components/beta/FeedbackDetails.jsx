import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router-dom';
import { ArrowUpRight, X } from 'lucide-react';
import { FEEDBACK_CATEGORIES } from '@/lib/feedbackInbox';
import { identifyFeedbackPage } from '@/lib/feedbackPage';

export default function FeedbackDetails({ note, onClose, triggerRef }) {
  const page = identifyFeedbackPage(note?.page);
  const submitted = new Date(note?.created_date);
  const validDate = Number.isFinite(submitted.getTime());
  return (
    <Dialog.Root open={!!note} onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/75" />
        <Dialog.Content
          className="fixed left-1/2 z-[111] flex w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-xl"
          style={{ top: 'calc(var(--app-safe-top) + 0.75rem)', maxHeight: 'calc(100dvh - var(--app-safe-top) - env(safe-area-inset-bottom, 0px) - 1.5rem)' }}
          onCloseAutoFocus={event => { event.preventDefault(); triggerRef.current?.focus({ preventScroll: true }); }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border p-4">
            <div className="pt-2">
              <Dialog.Title className="text-xl font-bold">Feedback details</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-muted-foreground">The submitted note and its recorded page.</Dialog.Description>
            </div>
            <Dialog.Close className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400" aria-label="Close feedback details">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-4 space-y-5">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Originating page</h3>
              <p className="mt-2 text-lg font-bold text-purple-400">{page.name}</p>
              {page.path && <p className="mt-1 text-sm font-mono [overflow-wrap:anywhere]">{page.path}</p>}
            </div>
            <dl className="grid grid-cols-1 gap-3 text-sm">
              <div><dt className="text-muted-foreground">Category</dt><dd className="font-bold">{FEEDBACK_CATEGORIES[note?.feedback_type] || 'Feedback'}</dd></div>
              <div><dt className="text-muted-foreground">Submitted</dt><dd><time dateTime={validDate ? submitted.toISOString() : undefined}>{validDate ? submitted.toLocaleString() : 'Submission time unavailable'}</time></dd></div>
            </dl>
            <div><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Message</h3><p data-feedback-message className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{note?.message || 'No message included.'}</p></div>
          </div>
          <div className="flex-shrink-0 border-t border-border p-4 space-y-3">
            <p className="text-xs text-muted-foreground">Only the page path was saved. Original searches, filters and screen state are unavailable.</p>
            {page.href && <Dialog.Close asChild><Link to={page.href} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-purple-400 px-4 py-3 text-sm font-bold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400">Open reported page <ArrowUpRight className="h-4 w-4" /></Link></Dialog.Close>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
