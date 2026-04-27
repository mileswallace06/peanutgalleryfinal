import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, ArrowRight, CheckCircle, Upload, DollarSign, MapPin } from 'lucide-react';

const STEPS = ['Event', 'Seats', 'Price & Proof'];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors ${
            i < current ? 'bg-accent text-accent-foreground' :
            i === current ? 'bg-primary text-primary-foreground' :
            'bg-muted text-muted-foreground'
          }`}>
            {i < current ? <CheckCircle className="w-4 h-4" /> : i + 1}
          </div>
          <span className={`text-xs font-medium hidden sm:inline ${i === current ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
          {i < STEPS.length - 1 && <div className={`h-px w-6 sm:w-10 ${i < current ? 'bg-accent' : 'bg-border'}`} />}
        </div>
      ))}
    </div>
  );
}

export default function CreateListing() {
  const [step, setStep] = useState(0);
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);

  const [form, setForm] = useState({
    event_id: '',
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
    const me = await base44.auth.me();
    await base44.entities.Listing.create({
      event_id: form.event_id,
      seller_email: me.email,
      section: form.section,
      row: form.row,
      seats: form.seats || undefined,
      quantity: parseInt(form.quantity) || 1,
      tier: form.tier || undefined,
      asking_price: parseFloat(form.asking_price),
      original_price: form.original_price ? parseFloat(form.original_price) : undefined,
      transfer_method: form.transfer_method,
      proof_url: form.proof_url || undefined,
      proof_status: 'pending_review',
      status: 'active',
    });
    setSubmitting(false);
    setDone(true);
  };

  // ── Success screen ────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-9 h-9 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Listing Submitted!</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Your tickets are pending review. Once approved, they'll appear live to buyers within minutes.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/my-sales" className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors">
            View My Listings
          </Link>
          <button
            onClick={() => { setDone(false); setStep(0); setForm({ event_id:'', section:'', row:'', seats:'', quantity:'1', tier:'', asking_price:'', original_price:'', transfer_method:'email_transfer', proof_url:'' }); }}
            className="inline-flex items-center justify-center gap-2 border border-border px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-muted transition-colors"
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
    <div className="max-w-lg mx-auto px-4 py-8">
      <Link to="/my-sales" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> My Sales
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">List Your Upgrade</h1>
        <p className="text-sm text-muted-foreground mt-1">Fill in 3 quick steps — takes under 60 seconds.</p>
      </div>

      <StepIndicator current={step} />

      {/* ── Step 0: Pick Event ── */}
      {step === 0 && (
        <div className="space-y-4">
          <label className="block font-semibold text-sm mb-1">Which event are you selling tickets for?</label>
          {loadingEvents ? (
            <div className="h-12 bg-muted rounded-xl animate-pulse" />
          ) : (
            <div className="space-y-2">
              {events.map(ev => (
                <button
                  key={ev.id}
                  onClick={() => set('event_id', ev.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                    form.event_id === ev.id
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border bg-white hover:border-primary/40'
                  }`}
                >
                  <div className="font-semibold text-sm">{ev.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {ev.venue}{ev.city ? `, ${ev.city}` : ''}
                    {ev.date && <> · {new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>}
                  </div>
                </button>
              ))}
              {events.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No upcoming events found.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 1: Seat Info ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 bg-secondary rounded-xl px-4 py-2.5 text-sm text-muted-foreground mb-2">
            <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
            Enter exactly what's printed on your ticket.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Section <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={form.section}
                onChange={e => set('section', e.target.value)}
                placeholder="e.g. 118"
                className="w-full px-3 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Row <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={form.row}
                onChange={e => set('row', e.target.value)}
                placeholder="e.g. G"
                className="w-full px-3 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Number of Seats</label>
              <select
                value={form.quantity}
                onChange={e => set('quantity', e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} seat{n > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Seat Numbers <span className="text-muted-foreground font-normal">(optional)</span></label>
              <input
                type="text"
                value={form.seats}
                onChange={e => set('seats', e.target.value)}
                placeholder="e.g. 4, 5"
                className="w-full px-3 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Tier <span className="text-muted-foreground font-normal">(optional)</span></label>
            <div className="grid grid-cols-4 gap-2">
              {['floor','lower','mid','upper'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('tier', form.tier === t ? '' : t)}
                  className={`py-2 rounded-xl border text-xs font-semibold capitalize transition-all ${
                    form.tier === t ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-muted-foreground hover:border-primary/40'
                  }`}
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
          <div>
            <label className="block font-semibold text-sm mb-1 flex items-center gap-1">
              <DollarSign className="w-4 h-4 text-primary" /> Your asking price <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">$</span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.asking_price}
                onChange={e => set('asking_price', e.target.value)}
                placeholder="0"
                className="w-full pl-7 pr-4 py-3 rounded-xl border border-border text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Per ticket. Buyers see the total at checkout.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Original face value <span className="text-muted-foreground font-normal">(optional — shows savings badge)</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.original_price}
                onChange={e => set('original_price', e.target.value)}
                placeholder="0"
                className="w-full pl-7 pr-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-sm mb-1 flex items-center gap-1">
              <Upload className="w-4 h-4 text-primary" /> Ticket screenshot or PDF
              <span className="text-muted-foreground font-normal text-xs ml-1">(optional but speeds up approval)</span>
            </label>
            {form.proof_url ? (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                <span className="text-sm text-green-800 font-medium">Proof uploaded ✓</span>
                <button onClick={() => set('proof_url', '')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Remove</button>
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-6 cursor-pointer transition-colors ${uploadingProof ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}>
                {uploadingProof ? (
                  <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Upload className="w-6 h-6 text-muted-foreground" />
                )}
                <span className="text-sm font-medium text-muted-foreground">
                  {uploadingProof ? 'Uploading…' : 'Tap to upload screenshot or PDF'}
                </span>
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleProofUpload} disabled={uploadingProof} />
              </label>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-2">How will you transfer the tickets?</label>
            <div className="space-y-2">
              {[
                { value: 'email_transfer', label: '📧 Email transfer', sub: 'You\'ll forward the Ticketmaster / AXS transfer email' },
                { value: 'platform_transfer', label: '📲 Platform transfer', sub: 'Transfer via the ticketing app directly' },
                { value: 'in_person', label: '🤝 In person', sub: 'Meet at the venue and hand off' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('transfer_method', opt.value)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                    form.transfer_method === opt.value
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border bg-white hover:border-primary/40'
                  }`}
                >
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{opt.sub}</div>
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
            className="flex items-center gap-2 border border-border px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
        {step < 2 && (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={(step === 0 && !canNext0) || (step === 1 && !canNext1)}
            className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        )}
        {step === 2 && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting || uploadingProof}
            className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {submitting
              ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Submitting…</>
              : <><CheckCircle className="w-4 h-4" /> Submit Listing</>
            }
          </button>
        )}
      </div>
    </div>
  );
}