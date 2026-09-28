import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Armchair, ArrowLeft, Check, ChevronDown, ChevronRight, ImagePlus, Loader2, Search, Ticket, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createFanPostTasks, fanPostProblem, hasFanPostDraft } from './fanPostDraft';
import './fan-post-composer.css';

const emptyDraft = { type: 'post', text: '', event: null, photo: '', before: '', after: '', fromSection: '', fromRow: '', toSection: '', toRow: '' };

export default function FanPostComposer({ user, events, eventsLoading = false, eventsError = false, onReloadEvents, onClose, onPosted, triggerRef }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [view, setView] = useState('compose');
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState({});
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [myEventIds, setMyEventIds] = useState([]);
  const mounted = useRef(true);
  const closeButton = useRef(null);
  const searchInput = useRef(null);
  const tasks = useRef(null);
  if (!tasks.current) tasks.current = createFanPostTasks({
    upload: args => base44.integrations.Core.UploadFile(args),
    createPost: payload => base44.entities.FanPost.create(payload),
  });
  const patch = values => setDraft(current => ({ ...current, ...values }));
  const isFlex = draft.type === 'seat_flex';
  const anyUpload = Object.values(uploading).some(Boolean);
  const problem = fanPostProblem(user, draft);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!isFlex || !user?.email) return;
    let active = true;
    base44.functions.invoke('getPurchaseParticipantView', { action: 'list_mine', perspective: 'buyer' })
      .then(result => { if (active) setMyEventIds((result?.data?.purchases || []).map(purchase => purchase.event_id).filter(Boolean)); })
      .catch(() => { /* Event search remains available without ticket ordering. */ });
    return () => { active = false; };
  }, [isFlex, user?.email]);
  useEffect(() => {
    if (view === 'events') searchInput.current?.focus();
  }, [view]);

  const requestClose = () => {
    if (sharing) return;
    if (hasFanPostDraft(draft) || anyUpload) setDiscardOpen(true);
    else onClose();
  };
  const uploadPhoto = async (file, slot) => {
    if (!file || sharing || uploading[slot] || tasks.current.isSharing() || tasks.current.isUploading(slot)) return;
    setError('');
    setUploading(current => ({ ...current, [slot]: true }));
    try {
      const url = await tasks.current.uploadPhoto(file, slot);
      if (mounted.current && url) patch({ [slot]: url });
    } catch {
      if (mounted.current) setError('That photo didn’t upload. Your draft is still here — try the photo again.');
    } finally {
      if (mounted.current) setUploading(current => ({ ...current, [slot]: false }));
    }
  };
  const share = async event => {
    event.preventDefault();
    if (sharing || tasks.current.isSharing() || anyUpload || problem) return;
    setSharing(true);
    setError('');
    let result;
    try {
      result = await tasks.current.share(user, draft);
    } catch {
      if (mounted.current) setError('We couldn’t confirm your post was shared. Your draft is saved here. Check your connection before trying again.');
    }
    if (result?.status === 'posted') {
      onPosted();
      return;
    }
    if (mounted.current) setSharing(false);
  };
  const eventMatches = events.filter(event => !query.trim() || [event.title, event.venue, event.city]
    .some(value => value?.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((left, right) => Number(myEventIds.includes(right.id)) - Number(myEventIds.includes(left.id)));

  return <>
    <Dialog.Root open onOpenChange={open => { if (!open) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="pg-composer-backdrop" />
        <Dialog.Content className="pg-ticket-app pg-post-composer"
          onOpenAutoFocus={event => { event.preventDefault(); closeButton.current?.focus(); }}
          onCloseAutoFocus={event => { event.preventDefault(); triggerRef?.current?.focus(); }}
          onEscapeKeyDown={event => { event.preventDefault(); view === 'events' ? setView('compose') : requestClose(); }}
          onPointerDownOutside={event => { event.preventDefault(); requestClose(); }}>
          <form onSubmit={share} className="pg-composer-form">
            <header className="pg-composer-header">
              <button ref={closeButton} type="button" className="pg-composer-icon-button" aria-label={view === 'events' ? 'Back to post' : 'Close post composer'} disabled={sharing}
                onClick={() => view === 'events' ? setView('compose') : requestClose()}>
                {view === 'events' ? <ArrowLeft size={21} /> : <X size={21} />}
              </button>
              <Dialog.Title>{view === 'events' ? 'Tag an event' : 'New post'}</Dialog.Title>
              {view === 'compose' ? <button type="submit" className="pg-composer-share" disabled={Boolean(problem) || sharing || anyUpload}>
                {sharing ? <><Loader2 size={15} className="animate-spin" /> Sharing…</> : 'Share'}
              </button> : <span className="pg-composer-header-spacer" />}
            </header>
            <Dialog.Description className="sr-only">Share a photo or a thought with Fan Zone. Choose Seat Flex for before and after views.</Dialog.Description>
            <div className="pg-composer-scroll" aria-busy={sharing}>
              {view === 'events' ? <>
                <label className="pg-composer-search"><Search size={18} /><input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search events, venues or cities" aria-label="Search events" /></label>
                <p className="pg-composer-hint">{isFlex ? 'Choose the event you upgraded at.' : 'Add context to your post. Tagging an event is optional.'}</p>
                {eventsLoading ? <p className="pg-composer-empty" role="status">Loading events…</p> : eventsError ? <div className="pg-composer-empty"><p role="alert">We couldn’t load events.</p><button type="button" className="pg-composer-keep" onClick={onReloadEvents}>Try again</button></div> : eventMatches.length ? <div className="pg-composer-event-list">{eventMatches.map(event => <button type="button" key={event.id} className="pg-composer-event-option"
                  onClick={() => { patch({ event }); setView('compose'); setQuery(''); }}>
                  {event.image_url ? <img src={event.image_url} alt="" /> : <span className="pg-composer-event-placeholder"><Ticket size={20} /></span>}
                  <span><strong>{event.title}</strong><small>{[event.venue, event.city].filter(Boolean).join(' · ')}{myEventIds.includes(event.id) ? ' · Your ticket' : ''}</small></span>
                  {draft.event?.id === event.id ? <Check size={17} /> : <ChevronRight size={17} />}
                </button>)}</div> : <p className="pg-composer-empty">{query.trim() ? 'No matching events. Try an artist, venue or city.' : 'No events are available to tag right now.'}</p>}
              </> : <>
                <div className="pg-composer-kind" role="group" aria-label="Post type">
                  <button type="button" aria-pressed={!isFlex} disabled={sharing || anyUpload} onClick={() => patch({ type: 'post' })}><ImagePlus size={17} /> Post</button>
                  <button type="button" aria-pressed={isFlex} disabled={sharing || anyUpload} onClick={() => patch({ type: 'seat_flex' })}><Armchair size={17} /> Seat Flex</button>
                </div>
                <p className="pg-composer-hint">{isFlex ? 'Show the difference a better seat makes.' : 'Your view. Your people. Your moment.'}</p>
                <div className={isFlex ? 'pg-composer-photos is-pair' : 'pg-composer-photos'}>
                  {isFlex ? <>
                    <ComposerPhoto slot="before" label="Before" url={draft.before} uploading={uploading.before} disabled={sharing} onFile={uploadPhoto} onRemove={() => patch({ before: '' })} />
                    <ComposerPhoto slot="after" label="After" url={draft.after} uploading={uploading.after} disabled={sharing} onFile={uploadPhoto} onRemove={() => patch({ after: '' })} />
                  </> : <ComposerPhoto slot="photo" label="Add a photo" url={draft.photo} uploading={uploading.photo} disabled={sharing} onFile={uploadPhoto} onRemove={() => patch({ photo: '' })} />}
                </div>
                <div className="pg-composer-caption">
                  <label htmlFor="fan-post-caption">{isFlex ? 'Add a caption' : 'What’s happening?'}</label>
                  <textarea id="fan-post-caption" value={draft.text} onChange={event => patch({ text: event.target.value })} placeholder={isFlex ? 'Tell the story behind your new view…' : 'Write a caption or share a thought…'} maxLength={280} rows={3} disabled={sharing} />
                  <span>{draft.text.length}/280</span>
                </div>
                <div className="pg-composer-event-tag">
                  <button type="button" disabled={sharing} onClick={() => setView('events')}><Ticket size={18} /><span><strong>{draft.event?.title || 'Tag an event'}</strong><small>{draft.event ? [draft.event.venue, draft.event.city].filter(Boolean).join(' · ') : isFlex ? 'Required for Seat Flex' : 'Optional'}</small></span><ChevronRight size={17} /></button>
                  {draft.event && <button type="button" className="pg-composer-icon-button" disabled={sharing} onClick={() => patch({ event: null })} aria-label="Remove tagged event"><X size={17} /></button>}
                </div>
                {isFlex && <details className="pg-composer-seat-details"><summary>Seat details <span>Optional</span><ChevronDown size={16} /></summary>
                  <div className="pg-composer-seat-grid">{[['fromSection', 'From section', 6], ['fromRow', 'From row', 4], ['toSection', 'To section', 6], ['toRow', 'To row', 4]].map(([key, label, maxLength]) => <label key={key}>{label}<input value={draft[key]} onChange={event => patch({ [key]: event.target.value })} maxLength={maxLength} disabled={sharing} /></label>)}</div>
                </details>}
                {error && <p className="pg-composer-error" role="alert">{error}</p>}
                <p className="pg-composer-status" role="status">{anyUpload ? 'Uploading your photo. Share will be ready when it finishes.' : sharing ? 'Sharing your post…' : isFlex && problem ? problem : 'Your post will appear in Fan Zone.'}</p>
              </>}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <AlertDialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
      <AlertDialog.Portal><AlertDialog.Overlay className="pg-composer-discard-backdrop" /><AlertDialog.Content className="pg-ticket-app pg-composer-discard">
        <AlertDialog.Title>Discard this post?</AlertDialog.Title><AlertDialog.Description>Your caption and photo selections will be cleared.</AlertDialog.Description>
        <div><AlertDialog.Cancel className="pg-composer-keep">Keep editing</AlertDialog.Cancel><AlertDialog.Action className="pg-composer-discard-action" onClick={onClose}>Discard</AlertDialog.Action></div>
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}

function ComposerPhoto({ slot, label, url, uploading, disabled, onFile, onRemove }) {
  const input = useRef(null);
  return <div className={`pg-composer-photo${url ? ' has-photo' : ''}`}>
    {url ? <><img src={url} alt={slot === 'before' ? 'Before-seat photo preview' : slot === 'after' ? 'After-seat photo preview' : 'Post photo preview'} /><span className="pg-composer-photo-label">{slot === 'photo' ? 'Photo' : label}</span><button type="button" className="pg-composer-photo-remove" disabled={disabled || uploading} aria-label={`Remove ${slot === 'photo' ? 'photo' : `${label.toLowerCase()} photo`}`} onClick={onRemove}><X size={17} /></button></> : <button type="button" className="pg-composer-photo-add" disabled={disabled || uploading} onClick={() => input.current?.click()}>
      {uploading ? <Loader2 size={25} className="animate-spin" /> : <ImagePlus size={25} />}<strong>{uploading ? 'Uploading…' : label}</strong><small>{slot === 'photo' ? 'Or just write something below' : 'Add a photo'}</small>
    </button>}
    <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label={`Choose ${slot === 'photo' ? 'photo' : `${label.toLowerCase()} photo`}`} disabled={disabled || uploading}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file, slot); }} />
  </div>;
}
