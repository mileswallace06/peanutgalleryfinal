import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Search, Camera, ImagePlus, ChevronRight, ArrowLeft } from 'lucide-react';

// step: 'event' | 'photos' | 'caption'
export default function SeatFlexSheet({ user, onClose, onPosted }) {
  const [step, setStep] = useState('event');

  // event selection
  const [myPurchases, setMyPurchases] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loadingEvents, setLoadingEvents] = useState(true);

  // photos
  const [beforeUrl, setBeforeUrl] = useState('');
  const [afterUrl, setAfterUrl] = useState('');
  const [uploadingBefore, setUploadingBefore] = useState(false);
  const [uploadingAfter, setUploadingAfter] = useState(false);

  // caption
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoadingEvents(true);
      const [purchases, events] = await Promise.all([
        base44.entities.Purchase.filter({ buyer_email: user?.email }),
        base44.entities.Event.list('date', 100),
      ]);
      setMyPurchases(purchases);
      setAllEvents(events.filter(e => e.status !== 'ended'));
      setLoadingEvents(false);
    };
    load().catch(() => setLoadingEvents(false));
  }, [user]);

  const myEventIds = new Set(myPurchases.map(p => p.event_id).filter(Boolean));
  const myEvents = allEvents.filter(e => myEventIds.has(e.id));
  const otherEvents = allEvents.filter(e => !myEventIds.has(e.id));

  const filteredMine = myEvents.filter(e =>
    !query || e.title?.toLowerCase().includes(query.toLowerCase()) || e.venue?.toLowerCase().includes(query.toLowerCase())
  );
  const filteredOther = otherEvents.filter(e =>
    !query || e.title?.toLowerCase().includes(query.toLowerCase()) || e.venue?.toLowerCase().includes(query.toLowerCase())
  );

  const handleUpload = async (file, which) => {
    if (!file) return;
    if (which === 'before') setUploadingBefore(true);
    else setUploadingAfter(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    if (which === 'before') { setBeforeUrl(file_url); setUploadingBefore(false); }
    else { setAfterUrl(file_url); setUploadingAfter(false); }
  };

  const handleSubmit = async () => {
    if (!caption.trim() && !beforeUrl && !afterUrl) return;
    setSubmitting(true);
    await base44.entities.FanPost.create({
      author_email: user?.email || '',
      author_name: user?.full_name || user?.email || 'Fan',
      text: caption.trim() || '💺 Seat Flex!',
      post_type: 'seat_flex',
      event_id: selectedEvent?.id || null,
      event_title: selectedEvent?.title || null,
      before_photo_url: beforeUrl || null,
      after_photo_url: afterUrl || null,
      reactions: { fire: [], eyes: [], peanut: [] },
    });
    setSubmitting(false);
    onPosted();
  };

  const canGoPhotos = !!selectedEvent;
  const canGoCaption = beforeUrl || afterUrl;

  return (
    <div
      className="relative z-10 rounded-t-3xl px-5 pt-5 pb-10 max-h-[85vh] flex flex-col"
      style={{ background: 'hsl(255 12% 9%)', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      {/* Handle */}
      <div className="w-10 h-1 rounded-full mx-auto mb-5 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />

      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          {step !== 'event' && (
            <button onClick={() => setStep(step === 'caption' ? 'photos' : 'event')} className="mr-1">
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
          <span className="text-xl">💺</span>
          <h2 className="font-black text-base text-foreground">
            {step === 'event' ? 'Pick your event' : step === 'photos' ? 'Before & After' : 'Add a caption'}
          </h2>
        </div>
        <button onClick={onClose}><X className="w-5 h-5 text-muted-foreground" /></button>
      </div>

      {/* Step indicator */}
      <div className="flex gap-1.5 mb-5 flex-shrink-0">
        {['event', 'photos', 'caption'].map((s, i) => (
          <div key={s} className="h-1 flex-1 rounded-full transition-all"
            style={{ background: ['event','photos','caption'].indexOf(step) >= i ? '#66FFFF' : 'rgba(255,255,255,0.1)' }} />
        ))}
      </div>

      {/* ── Step: Event ── */}
      {step === 'event' && (
        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search events…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
          </div>

          {loadingEvents ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
            ))
          ) : (
            <>
              {filteredMine.length > 0 && (
                <div>
                  <p className="text-[10px] font-black tracking-widest uppercase mb-2" style={{ color: '#66FFFF' }}>
                    🎟️ My Tickets
                  </p>
                  <div className="space-y-2">
                    {filteredMine.map(ev => <EventRow key={ev.id} event={ev} onSelect={() => { setSelectedEvent(ev); setStep('photos'); }} />)}
                  </div>
                </div>
              )}
              {filteredOther.length > 0 && (
                <div>
                  <p className="text-[10px] font-black tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    All Events
                  </p>
                  <div className="space-y-2">
                    {filteredOther.map(ev => <EventRow key={ev.id} event={ev} onSelect={() => { setSelectedEvent(ev); setStep('photos'); }} />)}
                  </div>
                </div>
              )}
              {filteredMine.length === 0 && filteredOther.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No events found.</p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Step: Photos ── */}
      {step === 'photos' && (
        <div className="flex-1 flex flex-col space-y-5 min-h-0">
          <p className="text-xs text-muted-foreground -mt-1 flex-shrink-0">
            Show the upgrade — where you started vs where you ended up.
          </p>
          <div className="grid grid-cols-2 gap-3 flex-shrink-0">
            <PhotoSlot
              label="Before 📍"
              url={beforeUrl}
              uploading={uploadingBefore}
              onFile={f => handleUpload(f, 'before')}
              onClear={() => setBeforeUrl('')}
              color="#FF99CC"
            />
            <PhotoSlot
              label="After 🚀"
              url={afterUrl}
              uploading={uploadingAfter}
              onFile={f => handleUpload(f, 'after')}
              onClear={() => setAfterUrl('')}
              color="#66FFFF"
            />
          </div>
          <div className="mt-auto flex-shrink-0">
            <button
              disabled={!canGoCaption}
              onClick={() => setStep('caption')}
              className="w-full py-3.5 rounded-2xl font-black text-sm disabled:opacity-30 flex items-center justify-center gap-2"
              style={{ background: '#66FFFF', color: '#0a0510' }}
            >
              Next: Add Caption <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Caption ── */}
      {step === 'caption' && (
        <div className="flex-1 flex flex-col space-y-4 min-h-0">
          {/* Photo preview row */}
          <div className="flex gap-3 flex-shrink-0">
            {beforeUrl && <img src={beforeUrl} alt="before" className="w-24 h-20 rounded-xl object-cover flex-shrink-0" />}
            {afterUrl && <img src={afterUrl} alt="after" className="w-24 h-20 rounded-xl object-cover flex-shrink-0" />}
          </div>
          <textarea
            autoFocus
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Describe your upgrade… (optional)"
            maxLength={280}
            rows={3}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none leading-relaxed flex-shrink-0"
          />
          <div className="h-px flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <p className="text-xs text-muted-foreground flex-shrink-0">📍 {selectedEvent?.title}</p>
          <div className="mt-auto flex-shrink-0">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3.5 rounded-2xl font-black text-sm disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #FF99CC, #66FFFF)', color: '#0a0510' }}
            >
              {submitting ? 'Posting…' : '💺 Post Seat Flex'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ event, onSelect }) {
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98]"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {event.image_url && <img src={event.image_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground truncate">{event.title}</p>
        <p className="text-xs text-muted-foreground truncate">
          {event.venue}{event.city ? `, ${event.city}` : ''}
          {event.date && <> · {new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

function PhotoSlot({ label, url, uploading, onFile, onClear, color }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-black tracking-wide" style={{ color }}>{label}</p>
      {url ? (
        <div className="relative rounded-2xl overflow-hidden aspect-square">
          <img src={url} alt={label} className="w-full h-full object-cover" />
          <button
            onClick={onClear}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.7)' }}
          >
            <X className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      ) : (
        <label
          className="flex flex-col items-center justify-center gap-2 rounded-2xl aspect-square cursor-pointer transition-all"
          style={{ border: `1.5px dashed ${color}55`, background: `${color}08` }}
        >
          {uploading ? (
            <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color }} />
          ) : (
            <>
              <ImagePlus className="w-6 h-6" style={{ color }} />
              <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>Photo / Camera</span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => onFile(e.target.files[0])}
            disabled={uploading}
          />
        </label>
      )}
    </div>
  );
}