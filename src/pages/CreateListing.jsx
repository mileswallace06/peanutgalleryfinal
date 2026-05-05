import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle, Upload, Zap } from 'lucide-react';

const STEPS = ['Event', 'Seats', 'Price', 'Done'];

function StepBar({ current }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.slice(0, 3).map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center gap-1 flex-1">
            <div className="flex items-center gap-1.5 flex-1">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                style={{
                  background: done ? '#00FF87' : active ? 'rgba(191,95,255,0.3)' : 'rgba(255,255,255,0.07)',
                  color: done ? '#0D0B14' : active ? '#BF5FFF' : 'rgba(255,255,255,0.3)',
                  border: active ? '1px solid rgba(191,95,255,0.5)' : done ? 'none' : '1px solid rgba(255,255,255,0.1)',
                  boxShadow: active ? '0 0 10px rgba(191,95,255,0.4)' : 'none',
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className="text-[11px] font-semibold"
                style={{ color: active ? '#fff' : done ? '#00FF87' : 'rgba(255,255,255,0.3)' }}
              >
                {label}
              </span>
            </div>
            {i < 2 && (
              <div
                className="h-px flex-1 mx-1"
                style={{ background: done ? '#00FF8740' : 'rgba(255,255,255,0.08)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const inputClass = `w-full px-4 py-3.5 rounded-2xl text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40`;
const inputStyle = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
};

export default function CreateListing() {
  const [searchParams] = useSearchParams();
  const preselectedEventId = searchParams.get('event_id');

  const [step, setStep] = useState(preselectedEventId ? 1 : 0);
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);

  const [form, setForm] = useState({
    event_id: preselectedEventId || '',
    section: '',
    row: '',
    seats: '',
    quantity: '1',
    tier: '',
    asking_price: '',
    original_price: '',
    transfer_method: 'email_transfer',
    proof_url: '',
  });

  useEffect(() => {
    base44.entities.Event.filter({ status: 'upcoming' })
      .then(res => setEvents(res.filter(e => e.status !== 'ended')))
      .catch(console.error)
      .finally(() => setLoadingEvents(false));
  }, []);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleProofUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingProof(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    set('proof_url', file_url);
    setUploadingProof(false);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    const res = await base44.functions.invoke('submitListing', {
      event_id: form.event_id,
      section: form.section,
      row: form.row,
      seats: form.seats || undefined,
      quantity: parseInt(form.quantity) || 1,
      tier: form.tier || undefined,
      asking_price: parseFloat(form.asking_price),
      original_price: form.original_price ? parseFloat(form.original_price) : undefined,
      transfer_method: form.transfer_method,
      proof_url: form.proof_url || undefined,
    });
    setFlagged(res.data.flagged);
    setSubmitting(false);
    setDone(true);
  };

  const selectedEvent = events.find(e => e.id === form.event_id);

  // ── Success screen ────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: 'rgba(0,255,135,0.12)', border: '1px solid rgba(0,255,135,0.3)', boxShadow: '0 0 32px rgba(0,255,135,0.2)' }}
        >
          <CheckCircle className="w-10 h-10" style={{ color: '#00FF87' }} />
        </div>
        <h1 className="font-display text-4xl mb-2" style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          {flagged ? 'Under Review' : "You're Live!"}
        </h1>
        <p className="text-muted-foreground text-sm mb-1 mt-2">
          {flagged ? 'Your listing is being reviewed and will go live shortly.' : 'Your listing is now live and visible to buyers.'}
        </p>
        {!flagged && (
          <p className="text-xs mb-8" style={{ color: 'rgba(0,255,135,0.7)' }}>Buyers can see it right now ⚡</p>
        )}
        {flagged && <div className="mb-8" />}
        <div className="flex flex-col gap-3">
          <Link
            to="/my-sales"
            className="inline-flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm"
            style={{ background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14', boxShadow: '0 0 18px rgba(0,232,122,0.22)' }}
          >
            View My Listings
          </Link>
          <button
            onClick={() => {
              setDone(false); setStep(0);
              setForm({ event_id: '', section: '', row: '', seats: '', quantity: '1', tier: '', asking_price: '', original_price: '', transfer_method: 'email_transfer', proof_url: '' });
            }}
            className="inline-flex items-center justify-center gap-2 py-3 rounded-full font-semibold text-sm"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}
          >
            List Another
          </button>
        </div>
      </div>
    );
  }

  const canNext0 = !!form.event_id;
  const canNext1 = !!form.section && !!form.row;
  const canSubmit = !!form.asking_price && parseFloat(form.asking_price) > 0;

  return (
    <div className="max-w-lg mx-auto px-4 py-8 pb-32">
      <Link to="/my-sales" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-3xl" style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Sell Tickets
        </h1>
        <p className="text-xs text-muted-foreground mt-1">3 quick steps · under a minute</p>
      </div>

      <StepBar current={step} />

      {/* ── Step 0: Pick Event ── */}
      {step === 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium mb-3">Which event?</p>
          {loadingEvents ? (
            <div className="h-14 rounded-2xl animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No upcoming events found.</p>
          ) : (
            events.map(ev => (
              <button
                key={ev.id}
                onClick={() => set('event_id', ev.id)}
                className="w-full text-left px-4 py-3.5 rounded-2xl transition-all"
                style={{
                  background: form.event_id === ev.id ? 'rgba(191,95,255,0.12)' : 'rgba(255,255,255,0.04)',
                  border: form.event_id === ev.id ? '1px solid rgba(191,95,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  boxShadow: form.event_id === ev.id ? '0 0 16px rgba(191,95,255,0.15)' : 'none',
                }}
              >
                <div className="font-bold text-sm text-foreground">{ev.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {ev.venue}{ev.city ? `, ${ev.city}` : ''}
                  {ev.date && <> · {new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* ── Step 1: Seat Info ── */}
      {step === 1 && (
        <div className="space-y-4">
          {selectedEvent && (
            <div className="px-4 py-2.5 rounded-2xl text-xs text-muted-foreground mb-1"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              🎫 {selectedEvent.title}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Section *</label>
              <input type="text" value={form.section} onChange={e => set('section', e.target.value)}
                placeholder="118" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Row *</label>
              <input type="text" value={form.row} onChange={e => set('row', e.target.value)}
                placeholder="G" className={inputClass} style={inputStyle} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Seats</label>
              <select value={form.quantity} onChange={e => set('quantity', e.target.value)}
                className={inputClass} style={{ ...inputStyle, appearance: 'none' }}>
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} seat{n > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Seat #s <span className="opacity-50">(optional)</span></label>
              <input type="text" value={form.seats} onChange={e => set('seats', e.target.value)}
                placeholder="4, 5" className={inputClass} style={inputStyle} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-2">Level <span className="opacity-50">(optional)</span></label>
            <div className="grid grid-cols-4 gap-2">
              {['floor','lower','mid','upper'].map(t => (
                <button key={t} type="button" onClick={() => set('tier', form.tier === t ? '' : t)}
                  className="py-2.5 rounded-xl text-xs font-bold capitalize transition-all"
                  style={{
                    background: form.tier === t ? 'rgba(191,95,255,0.15)' : 'rgba(255,255,255,0.04)',
                    border: form.tier === t ? '1px solid rgba(191,95,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
                    color: form.tier === t ? '#BF5FFF' : 'rgba(255,255,255,0.45)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Price & Proof ── */}
      {step === 2 && (
        <div className="space-y-5">
          {/* Price — visual hero */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Set your price per ticket</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-2xl" style={{ color: '#00FF87' }}>$</span>
              <input
                type="number" min="1" step="1"
                value={form.asking_price}
                onChange={e => set('asking_price', e.target.value)}
                placeholder="0"
                className="w-full pl-10 pr-4 rounded-2xl font-black focus:outline-none focus:ring-2 focus:ring-primary/40"
                style={{
                  fontSize: 'clamp(2rem, 10vw, 2.8rem)',
                  paddingTop: '1rem', paddingBottom: '1rem',
                  background: 'rgba(0,255,135,0.05)',
                  border: '1px solid rgba(0,255,135,0.25)',
                  color: '#fff',
                  letterSpacing: '-0.02em',
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">Buyers see the total at checkout.</p>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Face value <span className="opacity-50">(optional · shows savings badge)</span></label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">$</span>
              <input type="number" min="1" step="1" value={form.original_price}
                onChange={e => set('original_price', e.target.value)}
                placeholder="0" className={`${inputClass} pl-8`} style={inputStyle} />
            </div>
          </div>

          {/* Proof upload */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">
              Ticket screenshot or PDF <span className="opacity-50">(optional · earns Verified badge)</span>
            </label>
            {form.proof_url ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                style={{ background: 'rgba(0,255,135,0.08)', border: '1px solid rgba(0,255,135,0.25)' }}>
                <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#00FF87' }} />
                <span className="text-sm font-semibold" style={{ color: '#00FF87' }}>Uploaded ✓</span>
                <button onClick={() => set('proof_url', '')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Remove</button>
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-6 cursor-pointer transition-all ${uploadingProof ? 'opacity-70' : ''}`}
                style={{ border: '1.5px dashed rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                {uploadingProof
                  ? <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  : <Upload className="w-5 h-5 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">{uploadingProof ? 'Uploading…' : 'Tap to upload'}</span>
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleProofUpload} disabled={uploadingProof} />
              </label>
            )}
          </div>

          {/* Transfer method */}
          <div>
            <label className="block text-xs text-muted-foreground mb-2">How will you transfer?</label>
            <div className="space-y-2">
              {[
                { value: 'email_transfer', label: '📧 Email transfer' },
                { value: 'platform_transfer', label: '📲 App transfer' },
                { value: 'in_person', label: '🤝 In person at venue' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => set('transfer_method', opt.value)}
                  className="w-full text-left px-4 py-3.5 rounded-2xl transition-all"
                  style={{
                    background: form.transfer_method === opt.value ? 'rgba(191,95,255,0.1)' : 'rgba(255,255,255,0.04)',
                    border: form.transfer_method === opt.value ? '1px solid rgba(191,95,255,0.35)' : '1px solid rgba(255,255,255,0.08)',
                    color: form.transfer_method === opt.value ? '#fff' : 'rgba(255,255,255,0.55)',
                  }}
                >
                  <span className="text-sm font-semibold">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3 mt-8">
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            className="flex items-center gap-1.5 px-5 py-3 rounded-full text-sm font-semibold transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        {step < 2 && (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={(step === 0 && !canNext0) || (step === 1 && !canNext1)}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-30"
            style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff', boxShadow: '0 0 18px rgba(191,95,255,0.25)' }}
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        )}
        {step === 2 && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting || uploadingProof}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-30"
            style={{ background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14', boxShadow: '0 0 18px rgba(0,232,122,0.22)' }}
          >
            {submitting
              ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Listing…</>
              : <><Zap className="w-4 h-4" /> List My Tickets</>
            }
          </button>
        )}
      </div>
    </div>
  );
}