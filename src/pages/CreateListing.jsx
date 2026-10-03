import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle, Upload, Zap, Shield } from 'lucide-react';
import InstantTransferAgreement from '@/components/listings/InstantTransferAgreement';
import { isAdmin as checkIsAdmin } from '@/lib/isAdmin';
import NotificationPermissionPrompt from '@/components/NotificationPermissionPrompt';
import { MIN_LISTING_PRICE_CONFIG, formatFeeBreakdown, ACTIVE_FEE_MODEL_ID, FEE_MODELS } from '@/lib/feeEngine';
import SellerTransferAttestation from '@/components/events/SellerTransferAttestation';
import SellingEventPicker from '@/components/listings/SellingEventPicker';
import SellingEventSummary from '@/components/listings/SellingEventSummary';
import { isCanonicalEventId } from '@/lib/resolveSellingEvent';
import { PageIntro, Disclosure } from '@/components/ClarityUI';
import './transaction-clarity.css';

const STEPS = ['Event', 'Seats', 'Price & review'];
function StepBar({ current }) {
  return <ol aria-label="Selling steps" className="pg-listing-steps">
    {STEPS.map((label, index) => <li key={label} aria-current={index === current ? 'step' : undefined} className={index <= current ? 'is-reached' : ''}>
      <span className="pg-listing-step-number">{index < current ? <CheckCircle size={16} aria-hidden="true" /> : index + 1}</span>
      <span>{label}</span>
    </li>)}
  </ol>;
}

const inputClass = `w-full px-4 py-3.5 rounded-2xl text-base font-medium text-foreground scroll-mb-40 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40`;
const inputStyle = {
  background: 'hsl(var(--input))',
  border: '1px solid hsl(var(--border))',
};

export default function CreateListing() {
  const [searchParams] = useSearchParams();
  const preselectedEventId = searchParams.get('event_id');
  const preselectedQuery = searchParams.get('tab') === 'search' ? searchParams.get('q') || '' : '';
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [savedAsDraft, setSavedAsDraft] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [user, setUser] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const selectedEventRef = useRef(null);
  const stepHeading = useRef(null);
  const [attestationDone, setAttestationDone] = useState(false);
  const [attestationData, setAttestationData] = useState(null);
  const [attestationBlocked, setAttestationBlocked] = useState(false);
  const [listingMode, setListingMode] = useState('standard'); // 'standard' | 'instant_transfer_ready'
  const [itrAgreementDone, setItrAgreementDone] = useState(false);
  const [pgTransferProofUrl, setPgTransferProofUrl] = useState('');
  const [pgTransferNotes, setPgTransferNotes] = useState('');
  const [uploadingPgProof, setUploadingPgProof] = useState(false);

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
    base44.auth.me({ fresh: true }).catch(() => base44.auth.me()).then(setUser).catch(() => {});
  }, []);
  useEffect(() => {
    if (step > 0) { stepHeading.current?.scrollIntoView({ block: 'start' }); stepHeading.current?.focus({ preventScroll: true }); }
  }, [step]);
  const acceptEvent = useCallback(event => {
    if (!isCanonicalEventId(event.id)) return;
    if (selectedEventRef.current?.id !== event.id) {
      setForm({ event_id: event.id, section: '', row: '', seats: '', quantity: '1', tier: '', asking_price: '', original_price: '', transfer_method: 'email_transfer', proof_url: '' });
      setAttestationDone(false); setAttestationData(null); setAttestationBlocked(false);
      setListingMode('standard'); setItrAgreementDone(false); setPgTransferProofUrl(''); setPgTransferNotes('');
    } else setForm(previous => ({ ...previous, event_id: event.id }));
    selectedEventRef.current = event;
    setSelectedEvent(event);
    setStep(1);
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

  const handlePgProofUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingPgProof(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setPgTransferProofUrl(file_url);
    setUploadingPgProof(false);
  };

  const handleSubmit = async () => {
    if (!user) {
      base44.auth.redirectToLogin();
      return;
    }
    setSubmitting(true);
    // Rollout logging — fee model + listing economics
    base44.analytics.track({
      eventName: 'listing_submitted',
      properties: {
        fee_model: ACTIVE_FEE_MODEL_ID,
        asking_price: parseFloat(form.asking_price) || 0,
        quantity: parseInt(form.quantity) || 1,
        listing_mode: listingMode,
        buyer_total: feePreview?.total || 0,
        pg_fee: feePreview?.fee || 0,
        onboarding_complete: onboardingComplete,
      },
    });

    // If Stripe onboarding is not complete, save as a non-public draft
    if (!onboardingComplete) {
      await base44.entities.Listing.create({
        event_id: form.event_id,
        seller_email: user?.email,
        section: form.section,
        row: form.row,
        seats: form.seats || undefined,
        quantity: parseInt(form.quantity) || 1,
        tier: form.tier || undefined,
        asking_price: parseFloat(form.asking_price),
        original_price: form.original_price ? parseFloat(form.original_price) : undefined,
        transfer_method: form.transfer_method,
        proof_url: form.proof_url || undefined,
        listing_mode: listingMode,
        status: 'pending_payout_setup',
        proof_status: 'pending_review',
      });
      setSubmitting(false);
      setSavedAsDraft(true);
      setDone(true);
      return;
    }

    if (listingMode === 'instant_transfer_ready') {
      await base44.entities.Listing.create({
        event_id: form.event_id,
        seller_email: user?.email,
        section: form.section,
        row: form.row,
        seats: form.seats || undefined,
        quantity: parseInt(form.quantity) || 1,
        tier: form.tier || undefined,
        asking_price: parseFloat(form.asking_price),
        original_price: form.original_price ? parseFloat(form.original_price) : undefined,
        transfer_method: form.transfer_method,
        proof_url: form.proof_url || undefined,
        listing_mode: 'instant',
        listing_transfer_mode: 'instant_transfer_ready',
        seller_ownership_confirmed: true,
        limited_transfer_authorization: true,
        ticket_custody_status: 'pending',
        custody_status: 'pending_pg_verification',
        status: 'pending_verification',
        proof_status: 'pending_review',
        pg_transfer_proof_url: pgTransferProofUrl || undefined,
        pg_transfer_notes: pgTransferNotes || undefined,
        notes: isAdminUser ? '[TEST]' : undefined,
      });
      setFlagged(false);
    } else {
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
        is_test: isAdminUser,
        transfer_source: attestationData?.platform || 'seller_confirmed',
        transfer_attestation_proof_url: attestationData?.proofUrl || undefined,
      });
      setFlagged(res.data.flagged);
    }

    setSubmitting(false);
    setDone(true);
  };

  // ── Onboarding state (non-blocking) ──────────────────────────────────────
  const isAdminUser = checkIsAdmin(user);
  const onboardingComplete =
    isAdminUser ||
    user?.stripe_onboarding_complete === true ||
    user?.stripe_onboarding_complete === 'true';

  // ── Success screen ────────────────────────────────────────────────────────

  if (done) {
    // Keep saved drafts and verification states distinct from a live listing.
    const needsVerification = listingMode === 'instant_transfer_ready' || flagged;
    return (
      <div className="pg-secondary-page pg-transaction-page pg-listing-page">
        <PageIntro eyebrow="Sell tickets" title={savedAsDraft ? 'Listing saved.' : needsVerification ? 'Listing submitted.' : 'Your listing is live.'}
          description={savedAsDraft ? 'One more step before buyers can see it.' : needsVerification ? 'We’ll review your submission before it goes live.' : 'Buyers can now see your tickets.'}
          backTo="/my-sales" backLabel="My sales" />
        <section className="pg-transaction-result">
          <div className="pg-transaction-result-icon"><CheckCircle size={28} aria-hidden="true" /></div>
          {isAdminUser && <p className="pg-transaction-kicker">Test listing</p>}
          <h2>{savedAsDraft ? 'Complete your payout setup' : listingMode === 'instant_transfer_ready' ? 'Custody verification pending' : flagged ? 'Verification pending' : 'Ready for buyers'}</h2>
          <p>{savedAsDraft
            ? 'Your details are saved as a draft. Complete Stripe payout setup to make your listing live.'
            : listingMode === 'instant_transfer_ready'
            ? 'Once our team confirms custody, your listing will go live with the Instant Transfer Ready badge.'
            : flagged ? 'Your listing is being reviewed. Check My sales for its status.'
            : 'Keep an eye on your notifications so you’re ready to transfer when your tickets sell.'}</p>
          {savedAsDraft && <p className="pg-transaction-note">Your bank details are handled by Stripe.</p>}
          <div className="pg-transaction-result-actions">
            <Link to={savedAsDraft ? '/sell' : '/my-sales'} className="pg-action pg-transaction-primary">
              {savedAsDraft ? 'Complete payout setup' : 'View my listings'} <ArrowRight size={18} aria-hidden="true" />
            </Link>
            {savedAsDraft ? <Link to="/my-sales" className="pg-action pg-transaction-secondary">View my listings</Link> :
              <button
                onClick={() => {
                  setDone(false); setSavedAsDraft(false); setStep(0);
                  setForm({ event_id: '', section: '', row: '', seats: '', quantity: '1', tier: '', asking_price: '', original_price: '', transfer_method: 'email_transfer', proof_url: '' });
                  setSelectedEvent(null); selectedEventRef.current = null;
                  setAttestationDone(false); setAttestationData(null); setAttestationBlocked(false);
                  setListingMode('standard'); setItrAgreementDone(false); setPgTransferProofUrl(''); setPgTransferNotes('');
                }}
                className="pg-action pg-transaction-secondary"
              >List another</button>}
          </div>
        </section>
        {!savedAsDraft && <NotificationPermissionPrompt trigger="listing" />}
      </div>
    );
  }

  const canonicalSelected = isCanonicalEventId(form.event_id) && selectedEvent?.id === form.event_id;
  const canNext1 = canonicalSelected && !!form.section && !!form.row && attestationDone;
  const priceVal = parseFloat(form.asking_price) || 0;
  const minPrice = MIN_LISTING_PRICE_CONFIG.enabled ? MIN_LISTING_PRICE_CONFIG.threshold : 0;
  const priceTooLow = MIN_LISTING_PRICE_CONFIG.enabled && priceVal > 0 && priceVal < minPrice;
  const canSubmit = canonicalSelected && !!form.asking_price && priceVal >= (minPrice || 1)
    && (listingMode === 'standard' || (itrAgreementDone && (pgTransferProofUrl || pgTransferNotes.trim())));

  // Fee preview for step 2
  const feePreview = priceVal > 0 ? formatFeeBreakdown(priceVal, parseInt(form.quantity) || 1) : null;

  return (
    <div className="pg-secondary-page pg-transaction-page pg-listing-page selling-flow">
      <div ref={stepHeading} tabIndex={-1} className="outline-none scroll-mt-20">
        <PageIntro
          eyebrow={`Sell tickets · Step ${step + 1} of 3`}
          title={step === 0 ? 'Sell your tickets.' : step === 1 ? 'Add your seats.' : 'Price & review.'}
          description={step === 0 ? 'Choose the event for the tickets you want to sell.' : step === 1 ? 'Add your seat details, then confirm you can transfer the tickets.' : 'Choose how to deliver, set your price, and review the buyer’s total.'}
          backTo="/my-sales"
          backLabel="My sales"
        />
      </div>
      <StepBar current={step} />
      <div hidden={step !== 0}>
        <SellingEventPicker initialKeyword={preselectedQuery} initialEventId={preselectedEventId} onSelect={acceptEvent} />
      </div>
      {step > 0 && <div className="mb-6"><SellingEventSummary event={selectedEvent} onChange={() => setStep(0)} disabled={uploadingProof || uploadingPgProof || submitting} /></div>}

      {/* ── Step 1: Seat Info ── */}
      {step === 1 && (
        <section className="pg-transaction-card space-y-4" aria-label="Seat details">
          <p className="pg-transaction-kicker">Your seats</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Section *</label>
              <input type="text" value={form.section} onChange={e => set('section', e.target.value)}
                aria-label="Section" placeholder="118" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Row *</label>
              <input type="text" value={form.row} onChange={e => set('row', e.target.value)}
                aria-label="Row" placeholder="G" className={inputClass} style={inputStyle} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label htmlFor="listing-quantity" className="block text-sm text-muted-foreground mb-2">Ticket quantity</label>
              <select id="listing-quantity" value={form.quantity} onChange={e => set('quantity', e.target.value)} className={inputClass} style={inputStyle}>
                {[1,2,3,4,5,6].map(n => <option key={n} value={String(n)}>{n} {n === 1 ? 'ticket' : 'tickets'}</option>)}
              </select>
            </div>
          </div>
          <Disclosure title="More seat details" description="Optional seat numbers and level.">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Seat #s <span className="opacity-50">(optional)</span></label>
              <input type="text" value={form.seats} onChange={e => set('seats', e.target.value)}
                aria-label="Seat numbers" placeholder="4, 5" className={inputClass} style={inputStyle} />
            </div>
          <div>
            <label htmlFor="listing-level" className="block text-xs text-muted-foreground mb-2 mt-4">Level <span className="opacity-50">(optional)</span></label>
            <select id="listing-level" value={form.tier} onChange={e => set('tier', e.target.value)} className={inputClass} style={inputStyle}>
              <option value="">Choose a level</option>
              <option value="floor">Floor</option>
              <option value="lower">Lower</option>
              <option value="mid">Mid</option>
              <option value="upper">Upper</option>
            </select>
          </div>
          </Disclosure>
        </section>
      )}

      {/* ── Attestation gate (shown at bottom of step 1) ── */}
      {step === 1 && !attestationDone && !attestationBlocked && (
        <div className="mt-6 pg-listing-attestation">
          <SellerTransferAttestation key={selectedEvent?.id}
            onConfirm={(data) => { setAttestationData(data); setAttestationDone(true); }}
            onBlocked={() => setAttestationBlocked(true)}
            uploadFile={async (file) => {
              const { file_url } = await base44.integrations.Core.UploadFile({ file });
              return file_url;
            }}
          />
        </div>
      )}

      {step === 1 && attestationBlocked && (
        <div className="mt-6 rounded-2xl px-4 py-4 text-center space-y-3"
          style={{ background: 'rgba(var(--neon-pink-rgb), 0.08)', border: '1px solid rgba(var(--neon-pink-rgb), 0.3)' }}>
          <div className="text-2xl">🚫</div>
          <div className="font-bold text-sm" style={{ color: 'var(--neon-pink)' }}>Listing not allowed</div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            You indicated you cannot transfer this ticket. Only transferable tickets can be listed on Peanut Gallery.
          </p>
          <button
            onClick={() => setAttestationBlocked(false)}
            className="text-xs font-semibold px-4 py-2 rounded-lg"
            style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)', color: 'hsl(var(--foreground))' }}>
            Go back
          </button>
        </div>
      )}

      {step === 1 && attestationDone && (
        <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: 'rgba(var(--neon-green-rgb), 0.06)', border: '1px solid rgba(var(--neon-green-rgb), 0.25)' }}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-green)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--neon-green)' }}>Transfer ability confirmed · Ready to continue</span>
        </div>
      )}

      {/* ── Step 2: Price & Proof ── */}
      {step === 2 && (
        <div className="space-y-5">

          {/* Listing mode selector */}
          <div>
            <p className="pg-transaction-kicker mb-3">Choose your delivery option</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                aria-pressed={listingMode === 'standard'}
                onClick={() => { setListingMode('standard'); setItrAgreementDone(false); }}
                className="p-4 rounded-2xl text-left transition-all"
                style={{
                  background: listingMode === 'standard' ? 'rgba(var(--neon-purple-rgb), 0.08)' : 'hsl(var(--card))',
                  border: listingMode === 'standard' ? '1px solid rgba(var(--neon-purple-rgb), 0.35)' : '1px solid hsl(var(--border))',
                }}
              >
                <div className="font-bold text-sm text-foreground mb-1">{listingMode === 'standard' && '✓ '}Standard</div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">You transfer to the buyer after sale. You must be available when the ticket sells.</div>
              </button>
              <button
                type="button"
                aria-pressed={listingMode === 'instant_transfer_ready'}
                onClick={() => { setListingMode('instant_transfer_ready'); setItrAgreementDone(false); }}
                className="p-4 rounded-2xl text-left transition-all"
                style={{
                  background: listingMode === 'instant_transfer_ready' ? 'rgba(var(--neon-cyan-rgb), 0.08)' : 'hsl(var(--card))',
                  border: listingMode === 'instant_transfer_ready' ? '1px solid rgba(var(--neon-cyan-rgb), 0.35)' : '1px solid hsl(var(--border))',
                }}
              >
                <div className="font-bold text-sm flex items-center gap-1.5" style={{ color: listingMode === 'instant_transfer_ready' ? 'var(--neon-cyan)' : 'hsl(var(--foreground))' }}>
                  <Shield className="w-3.5 h-3.5" /> {listingMode === 'instant_transfer_ready' && '✓ '}Instant Transfer Ready
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed mt-1">Send your tickets to PG first. After custody is verified, PG handles delivery when they sell.</div>
              </button>
            </div>
          </div>

          {/* ITR mode: agreement gate, then proof upload */}
          {listingMode === 'instant_transfer_ready' && !itrAgreementDone && (
            <InstantTransferAgreement key={selectedEvent?.id} onConfirmed={() => setItrAgreementDone(true)} />
          )}

          {listingMode === 'instant_transfer_ready' && itrAgreementDone && (
            <div className="rounded-2xl p-4 space-y-4"
              style={{ background: 'rgba(var(--neon-cyan-rgb), 0.06)', border: '1px solid rgba(var(--neon-cyan-rgb), 0.25)' }}>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-cyan)' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--neon-cyan)' }}>Transfer Agent Agreement Signed</span>
                <button type="button" onClick={() => setItrAgreementDone(false)}
                  className="ml-auto text-[11px] text-muted-foreground underline">Review</button>
              </div>

              <div className="space-y-2 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Next: Submit your ticket for delivery custody</p>
                <div className="flex items-start gap-2"><span style={{ color: 'var(--neon-cyan)' }}>1.</span><span>Transfer your ticket to <strong className="text-foreground">experience@peanutgallery.store</strong> via Ticketmaster, SeatGeek, or email transfer.</span></div>
                <div className="flex items-start gap-2"><span style={{ color: 'var(--neon-cyan)' }}>2.</span><span>Upload proof below. Our team verifies receipt (usually within hours).</span></div>
                <div className="flex items-start gap-2"><span style={{ color: 'var(--neon-cyan)' }}>3.</span><span>Once confirmed, your listing goes live with the <strong style={{ color: 'var(--neon-cyan)' }}>⚡ Instant Transfer Ready</strong> badge. If it doesn't sell, we return the ticket to you.</span></div>
              </div>

              <p className="text-[10px] text-muted-foreground px-1 leading-relaxed"
                style={{ borderLeft: '2px solid rgba(var(--neon-cyan-rgb), 0.3)', paddingLeft: '8px' }}>
                Peanut Gallery does not own your ticket. We hold it temporarily as your authorized delivery agent only.
              </p>

              {/* PG transfer proof upload */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">
                  Transfer confirmation screenshot
                </label>
                <p className="text-xs text-muted-foreground mb-3">Provide a screenshot or transfer notes below to continue.</p>
                {pgTransferProofUrl ? (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                    style={{ background: 'rgba(var(--neon-cyan-rgb), 0.08)', border: '1px solid rgba(var(--neon-cyan-rgb), 0.25)' }}>
                    <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-cyan)' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--neon-cyan)' }}>Proof uploaded ✓</span>
                    <button onClick={() => setPgTransferProofUrl('')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Remove</button>
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-6 cursor-pointer ${uploadingPgProof ? 'opacity-70' : ''}`}
                    style={{ border: '1.5px dashed rgba(var(--neon-cyan-rgb), 0.35)', background: 'rgba(var(--neon-cyan-rgb), 0.04)' }}>
                    {uploadingPgProof
                      ? <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: 'var(--neon-cyan)' }} />
                      : <Upload className="w-5 h-5" style={{ color: 'var(--neon-cyan)' }} />}
                    <span className="text-xs text-muted-foreground">{uploadingPgProof ? 'Uploading…' : 'Tap to upload transfer screenshot'}</span>
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={handlePgProofUpload} disabled={uploadingPgProof} />
                  </label>
                )}
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">
                  Transfer notes <span className="opacity-50 font-normal">(optional if screenshot provided)</span>
                </label>
                <textarea
                  value={pgTransferNotes}
                  onChange={e => setPgTransferNotes(e.target.value)}
                  placeholder="e.g. Transferred via Ticketmaster to experience@peanutgallery.store at 3:45 PM"
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  style={{ background: 'rgba(var(--neon-cyan-rgb), 0.05)', border: '1px solid rgba(var(--neon-cyan-rgb), 0.2)' }}
                />
              </div>
            </div>
          )}

          {/* Price — visual hero */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Set your price per ticket</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-2xl" style={{ color: 'var(--neon-green)' }}>$</span>
              <input
                aria-label="Price per ticket" inputMode="decimal" type="number" min="1" step="1"
                value={form.asking_price}
                onChange={e => set('asking_price', e.target.value)}
                placeholder="0"
                className="w-full pl-10 pr-4 rounded-2xl font-black focus:outline-none focus:ring-2 focus:ring-primary/40"
                style={{
                  fontSize: 'clamp(2rem, 10vw, 2.8rem)',
                  paddingTop: '1rem', paddingBottom: '1rem',
                  background: 'rgba(var(--neon-green-rgb), 0.05)',
                  border: '1px solid rgba(var(--neon-green-rgb), 0.25)',
                  color: 'hsl(var(--foreground))',
                  letterSpacing: '-0.02em',
                }}
              />
            </div>
            {priceTooLow && (
              <div className="mt-2 flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium"
                style={{ background: 'rgba(var(--neon-pink-rgb), 0.08)', border: '1px solid rgba(var(--neon-pink-rgb), 0.25)', color: 'var(--neon-pink)' }}>
                <span className="flex-shrink-0 mt-0.5">🚫</span>
                Listings must be at least ${minPrice} to ensure secure transfers and payment processing.
              </div>
            )}
            {feePreview && !priceTooLow && (
              <div className="mt-2 px-3 py-2.5 rounded-xl text-xs space-y-1"
                style={{ background: 'rgba(var(--neon-green-rgb), 0.05)', border: '1px solid rgba(var(--neon-green-rgb), 0.15)' }}>
                <div className="flex justify-between text-muted-foreground">
                  <span>{feePreview.subtotalLabel}</span>
                  <span>${feePreview.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Service fee ({FEE_MODELS[ACTIVE_FEE_MODEL_ID]?.shortLabel})</span>
                  <span>${feePreview.fee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold pt-1 border-t" style={{ borderColor: 'rgba(var(--neon-green-rgb), 0.15)', color: 'var(--neon-green)' }}>
                  <span>Buyer pays</span>
                  <span>${feePreview.total.toFixed(2)}</span>
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-1.5">Buyers see the total at checkout.</p>
          </div>

          <Disclosure title="Optional listing details" description="Add face value or a ticket screenshot.">
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Face value <span className="opacity-50">(optional · shows savings badge)</span></label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">$</span>
              <input aria-label="Face value" inputMode="decimal" type="number" min="1" step="1" value={form.original_price}
                onChange={e => set('original_price', e.target.value)}
                placeholder="0" className={`${inputClass} pl-8`} style={inputStyle} />
            </div>
          </div>

          {/* Proof upload */}
          <div className="mt-4">
            <label className="block text-xs text-muted-foreground mb-1.5">
              Ticket screenshot or PDF <span className="opacity-50">(optional · for review)</span>
            </label>
            {form.proof_url ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                style={{ background: 'rgba(var(--neon-green-rgb), 0.08)', border: '1px solid rgba(var(--neon-green-rgb), 0.25)' }}>
                <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-green)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--neon-green)' }}>Uploaded ✓</span>
                <button onClick={() => set('proof_url', '')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Remove</button>
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-6 cursor-pointer transition-all ${uploadingProof ? 'opacity-70' : ''}`}
                style={{ border: '1.5px dashed hsl(var(--border))', background: 'hsl(var(--muted))' }}>
                {uploadingProof
                  ? <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  : <Upload className="w-5 h-5 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">{uploadingProof ? 'Uploading…' : 'Tap to upload'}</span>
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleProofUpload} disabled={uploadingProof} />
              </label>
            )}
          </div>
          </Disclosure>

          {/* Transfer method */}
          <div>
            <label className="block text-xs text-muted-foreground mb-2">How will you transfer?</label>
            <div className="space-y-2">
              {[
                { value: 'email_transfer', label: '📧 Email Transfer' },
                { value: 'platform_transfer', label: '📲 Mobile Ticket Transfer' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => set('transfer_method', opt.value)} aria-pressed={form.transfer_method === opt.value}
                  className="w-full text-left px-4 py-3.5 rounded-2xl transition-all"
                  style={{
                    background: form.transfer_method === opt.value ? 'rgba(var(--neon-purple-rgb), 0.1)' : 'hsl(var(--card))',
                    border: form.transfer_method === opt.value ? '1px solid rgba(var(--neon-purple-rgb), 0.35)' : '1px solid hsl(var(--border))',
                    color: form.transfer_method === opt.value ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                  }}
                >
                  <span className="text-sm font-semibold">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 2 && <div className="pg-listing-submit-note">
        {!onboardingComplete && <p>Your listing will be saved as a draft. Complete payout setup to make it live.</p>}
        <p>PG upgrades are separately priced add-on purchases.</p>
      </div>}
      {/* Navigation remains in flow so the keyboard cannot cover a fixed action bar. */}
      {step > 0 && <div className="pg-transaction-actions">
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={uploadingProof || uploadingPgProof || submitting}
            aria-label={step === 1 ? 'Back to events' : 'Back to seats'}
            className="pg-action pg-transaction-secondary"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
        {step === 1 && (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canNext1}
            className="pg-action pg-transaction-primary"
          >
            Price & review <ArrowRight className="w-4 h-4" />
          </button>
        )}
        {step === 2 && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting || uploadingProof}
            className="pg-action pg-transaction-primary"
          >
            {submitting
              ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Saving…</>
              : <><Zap className="w-4 h-4" /> {!onboardingComplete ? 'Save listing draft' : listingMode === 'instant_transfer_ready' ? 'Submit for verification' : 'List my tickets'}</>
            }
          </button>
        )}
      </div>}
    </div>
  );
}
