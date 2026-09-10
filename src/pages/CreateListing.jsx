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

const STEPS = ['Event', 'Seats', 'Price & review'];
function StepBar({ current }) {
  return <ol aria-label="Selling steps" className="grid grid-cols-3 gap-3 mb-6">
    {STEPS.map((label, index) => <li key={label} aria-current={index === current ? 'step' : undefined} className={`border-t-2 pt-3 ${index <= current ? 'border-primary' : 'border-border'}`}>
      <span className={`text-xs font-bold ${index === current ? 'text-primary' : 'text-muted-foreground'}`}>{index + 1}. {label}</span>
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
    // Draft saved — seller needs to complete Stripe onboarding first
    if (savedAsDraft) {
      return (
        <div className="max-w-md mx-auto px-4 py-16 text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: 'rgba(255,140,0,0.12)', border: '1px solid rgba(255,140,0,0.3)', boxShadow: '0 0 32px rgba(255,140,0,0.15)' }}>
            <span className="text-4xl">🏦</span>
          </div>
          <h1 className="font-display text-4xl mb-2" style={{ color: '#FF8C00' }}>Listing Saved</h1>
          <p className="text-sm text-muted-foreground leading-relaxed mt-2 mb-1 max-w-xs mx-auto">
            Your listing details are saved. To make it live and visible to buyers, you need to complete your Stripe payout setup.
          </p>
          <p className="text-xs text-muted-foreground mb-8">It takes under 2 minutes and your bank info is never stored by Peanut Gallery.</p>
          <div className="flex flex-col gap-3">
            <Link
              to="/sell"
              className="inline-flex items-center justify-center gap-2 py-4 rounded-full font-black text-sm"
              style={{ background: 'linear-gradient(135deg, #FF8C00, #FF2D78)', color: '#fff', boxShadow: '0 0 18px rgba(255,140,0,0.25)' }}
            >
              Complete Payout Setup →
            </Link>
            <Link to="/my-sales"
              className="inline-flex items-center justify-center gap-2 py-3 rounded-full font-semibold text-sm"
              style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
            >
              View My Listings
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        {isAdminUser && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black mb-4 dark:text-[#FFE600] text-[#7a6000]"
            style={{ background: 'rgba(255,200,80,0.12)', border: '1px solid rgba(255,200,80,0.3)' }}>
            🧪 Test Listing
          </div>
        )}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: 'rgba(0,255,135,0.12)', border: '1px solid rgba(0,255,135,0.3)', boxShadow: '0 0 32px rgba(0,255,135,0.2)' }}
        >
          <CheckCircle className="w-10 h-10" style={{ color: '#00FF87' }} />
        </div>
        <h1 className="font-display text-4xl mb-2 dark:[filter:none] [filter:brightness(0.45)_saturate(1.5)]" style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          {listingMode === 'instant_transfer_ready' ? 'Pending Custody Verification' : flagged ? 'Pending Verification' : 'Listing Live'}
        </h1>
        <p className="text-muted-foreground text-sm mb-1 mt-2">
          {listingMode === 'instant_transfer_ready'
            ? 'We received your transfer submission. Once our team confirms custody, your listing will go live with the Instant Transfer Ready badge.'
            : flagged ? 'Your listing is being reviewed and will go live shortly.'
            : 'Your listing is now live and visible to buyers.'}
        </p>
        <p className="text-xs mb-8 dark:opacity-70" style={{ color: listingMode === 'instant' ? '#006080' : flagged ? '#a07000' : '#007a3d' }}>
          {listingMode === 'instant_transfer_ready' ? 'Usually verified within hours.' : flagged ? 'Usually approved within minutes.' : 'Buyers can see it right now ⚡'}
        </p>
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
              setDone(false); setSavedAsDraft(false); setStep(0);
              setForm({ event_id: '', section: '', row: '', seats: '', quantity: '1', tier: '', asking_price: '', original_price: '', transfer_method: 'email_transfer', proof_url: '' });
              setSelectedEvent(null); selectedEventRef.current = null;
              setAttestationDone(false); setAttestationData(null); setAttestationBlocked(false);
              setListingMode('standard'); setItrAgreementDone(false); setPgTransferProofUrl(''); setPgTransferNotes('');
            }}
            className="inline-flex items-center justify-center gap-2 py-3 rounded-full font-semibold text-sm"
            style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
          >
            List Another
          </button>
        </div>
        {/* Prompt for push notifications after successful listing */}
        <NotificationPermissionPrompt trigger="listing" />
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
    <div className="max-w-lg mx-auto px-4 selling-flow" style={{ paddingTop: 'calc(1rem + var(--app-safe-top))', paddingBottom: 'calc(8rem + env(safe-area-inset-bottom))' }}>
      <Link to="/my-sales" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4" /> My sales
      </Link>

      <header className="mb-6 space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Peanut Gallery · Sell</p>
        <h1 ref={stepHeading} tabIndex={-1} className="font-display text-4xl leading-tight text-foreground outline-none scroll-mt-20">{step === 0 ? 'Sell your tickets.' : step === 1 ? 'Add your seats.' : 'Price & review.'}</h1>
        <p className="text-base text-muted-foreground">{step === 0 ? 'Choose your event to get started.' : step === 1 ? 'Tell buyers where they’ll be sitting.' : 'Set your price and check the details.'}</p>
      </header>
      <StepBar current={step} />
      <div hidden={step !== 0}>
        <SellingEventPicker initialKeyword={preselectedQuery} initialEventId={preselectedEventId} onSelect={acceptEvent} />
      </div>
      {step > 0 && <div className="mb-6"><SellingEventSummary event={selectedEvent} onChange={() => setStep(0)} disabled={uploadingProof || uploadingPgProof || submitting} /></div>}

      {/* ── Step 1: Seat Info ── */}
      {step === 1 && (
        <div className="space-y-4">
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
              <label className="block text-sm text-muted-foreground mb-2">Ticket quantity</label>
              <div role="group" aria-label="Ticket quantity" className="grid grid-cols-6 gap-1">
                {[1,2,3,4,5,6].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set('quantity', String(n))}
                    aria-pressed={form.quantity === String(n)} className="min-h-11 rounded-xl text-sm font-bold transition-all"
                    style={{
                      background: form.quantity === String(n) ? 'rgba(191,95,255,0.15)' : 'hsl(var(--muted))',
                      border: form.quantity === String(n) ? '1px solid rgba(191,95,255,0.4)' : '1px solid hsl(var(--border))',
                      color: form.quantity === String(n) ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Seat #s <span className="opacity-50">(optional)</span></label>
              <input type="text" value={form.seats} onChange={e => set('seats', e.target.value)}
                aria-label="Seat numbers" placeholder="4, 5" className={inputClass} style={inputStyle} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-2">Level <span className="opacity-50">(optional)</span></label>
            <div className="grid grid-cols-4 gap-2">
              {['floor','lower','mid','upper'].map(t => (
                <button key={t} type="button" onClick={() => set('tier', form.tier === t ? '' : t)}
                  className="py-2.5 rounded-xl text-xs font-bold capitalize transition-all"
                  style={{
                    background: form.tier === t ? 'rgba(191,95,255,0.15)' : 'hsl(var(--muted))',
                    border: form.tier === t ? '1px solid rgba(191,95,255,0.4)' : '1px solid hsl(var(--border))',
                    color: form.tier === t ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Attestation gate (shown at bottom of step 1) ── */}
      {step === 1 && !attestationDone && !attestationBlocked && (
        <div className="mt-6">
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
          style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.3)' }}>
          <div className="text-2xl">🚫</div>
          <div className="font-bold text-sm" style={{ color: '#FF2D78' }}>Listing not allowed</div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            You indicated you cannot transfer this ticket. Only transferable tickets can be listed on Peanut Gallery.
          </p>
          <button
            onClick={() => setAttestationBlocked(false)}
            className="text-xs font-semibold px-4 py-2 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'hsl(var(--foreground))' }}>
            Go back
          </button>
        </div>
      )}

      {step === 1 && attestationDone && (
        <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.25)' }}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#00FF87' }} />
          <span className="text-xs font-semibold" style={{ color: '#00FF87' }}>Transfer verified · Ready to continue</span>
        </div>
      )}

      {/* ── Step 2: Price & Proof ── */}
      {step === 2 && (
        <div className="space-y-5">

          {/* Listing mode selector */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wide">Listing Type</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setListingMode('standard'); setItrAgreementDone(false); }}
                className="p-4 rounded-2xl text-left transition-all"
                style={{
                  background: listingMode === 'standard' ? 'rgba(191,95,255,0.08)' : 'hsl(var(--card))',
                  border: listingMode === 'standard' ? '1px solid rgba(191,95,255,0.35)' : '1px solid hsl(var(--border))',
                }}
              >
                <div className="font-bold text-sm text-foreground mb-1">📋 Standard</div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">You transfer to the buyer after sale. You must be available when the ticket sells.</div>
              </button>
              <button
                type="button"
                onClick={() => { setListingMode('instant_transfer_ready'); setItrAgreementDone(false); }}
                className="p-4 rounded-2xl text-left transition-all"
                style={{
                  background: listingMode === 'instant_transfer_ready' ? 'rgba(0,200,255,0.08)' : 'hsl(var(--card))',
                  border: listingMode === 'instant_transfer_ready' ? '1px solid rgba(0,200,255,0.35)' : '1px solid hsl(var(--border))',
                }}
              >
                <div className="font-bold text-sm flex items-center gap-1.5" style={{ color: listingMode === 'instant_transfer_ready' ? '#00C8FF' : 'hsl(var(--foreground))' }}>
                  <Shield className="w-3.5 h-3.5" /> Instant Transfer Ready
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed mt-1">Authorize PG as your delivery agent. Buyers receive tickets immediately — you don't need to be online.</div>
              </button>
            </div>
          </div>

          {/* ITR mode: agreement gate, then proof upload */}
          {listingMode === 'instant_transfer_ready' && !itrAgreementDone && (
            <InstantTransferAgreement key={selectedEvent?.id} onConfirmed={() => setItrAgreementDone(true)} />
          )}

          {listingMode === 'instant_transfer_ready' && itrAgreementDone && (
            <div className="rounded-2xl p-4 space-y-4"
              style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.25)' }}>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#00C8FF' }} />
                <span className="text-sm font-bold" style={{ color: '#00C8FF' }}>Transfer Agent Agreement Signed</span>
                <button type="button" onClick={() => setItrAgreementDone(false)}
                  className="ml-auto text-[11px] text-muted-foreground underline">Review</button>
              </div>

              <div className="space-y-2 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Next: Submit your ticket for delivery custody</p>
                <div className="flex items-start gap-2"><span style={{ color: '#00C8FF' }}>1.</span><span>Transfer your ticket to <strong className="text-foreground">experience@peanutgallery.store</strong> via Ticketmaster, SeatGeek, or email transfer.</span></div>
                <div className="flex items-start gap-2"><span style={{ color: '#00C8FF' }}>2.</span><span>Upload proof below. Our team verifies receipt (usually within hours).</span></div>
                <div className="flex items-start gap-2"><span style={{ color: '#00C8FF' }}>3.</span><span>Once confirmed, your listing goes live with the <strong style={{ color: '#00C8FF' }}>⚡ Instant Transfer Ready</strong> badge. If it doesn't sell, we return the ticket to you.</span></div>
              </div>

              <p className="text-[10px] text-muted-foreground px-1 leading-relaxed"
                style={{ borderLeft: '2px solid rgba(0,200,255,0.3)', paddingLeft: '8px' }}>
                Peanut Gallery does not own your ticket. We hold it temporarily as your authorized delivery agent only.
              </p>

              {/* PG transfer proof upload */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5 font-semibold">
                  Upload transfer confirmation screenshot <span style={{ color: '#FF2D78' }}>*</span>
                </label>
                {pgTransferProofUrl ? (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                    style={{ background: 'rgba(0,200,255,0.08)', border: '1px solid rgba(0,200,255,0.25)' }}>
                    <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#00C8FF' }} />
                    <span className="text-sm font-semibold" style={{ color: '#00C8FF' }}>Proof uploaded ✓</span>
                    <button onClick={() => setPgTransferProofUrl('')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Remove</button>
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-6 cursor-pointer ${uploadingPgProof ? 'opacity-70' : ''}`}
                    style={{ border: '1.5px dashed rgba(0,200,255,0.35)', background: 'rgba(0,200,255,0.04)' }}>
                    {uploadingPgProof
                      ? <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: '#00C8FF' }} />
                      : <Upload className="w-5 h-5" style={{ color: '#00C8FF' }} />}
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
                  style={{ background: 'rgba(0,200,255,0.05)', border: '1px solid rgba(0,200,255,0.2)' }}
                />
              </div>
            </div>
          )}

          {/* Price — visual hero */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Set your price per ticket</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-2xl" style={{ color: '#00FF87' }}>$</span>
              <input
                aria-label="Price per ticket" inputMode="decimal" type="number" min="1" step="1"
                value={form.asking_price}
                onChange={e => set('asking_price', e.target.value)}
                placeholder="0"
                className="w-full pl-10 pr-4 rounded-2xl font-black focus:outline-none focus:ring-2 focus:ring-primary/40"
                style={{
                  fontSize: 'clamp(2rem, 10vw, 2.8rem)',
                  paddingTop: '1rem', paddingBottom: '1rem',
                  background: 'rgba(0,255,135,0.05)',
                  border: '1px solid rgba(0,255,135,0.25)',
                  color: 'hsl(var(--foreground))',
                  letterSpacing: '-0.02em',
                }}
              />
            </div>
            {priceTooLow && (
              <div className="mt-2 flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium"
                style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.25)', color: '#FF2D78' }}>
                <span className="flex-shrink-0 mt-0.5">🚫</span>
                Listings must be at least ${minPrice} to ensure secure transfers and payment processing.
              </div>
            )}
            {feePreview && !priceTooLow && (
              <div className="mt-2 px-3 py-2.5 rounded-xl text-xs space-y-1"
                style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.15)' }}>
                <div className="flex justify-between text-muted-foreground">
                  <span>{feePreview.subtotalLabel}</span>
                  <span>${feePreview.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Service fee ({FEE_MODELS[ACTIVE_FEE_MODEL_ID]?.shortLabel})</span>
                  <span>${feePreview.fee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold pt-1 border-t" style={{ borderColor: 'rgba(0,255,135,0.15)', color: '#00FF87' }}>
                  <span>Buyer pays</span>
                  <span>${feePreview.total.toFixed(2)}</span>
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-1.5">Buyers see the total at checkout.</p>
          </div>

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
                style={{ border: '1.5px dashed hsl(var(--border))', background: 'hsl(var(--muted))' }}>
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
                { value: 'email_transfer', label: '📧 Email Transfer' },
                { value: 'platform_transfer', label: '📲 Mobile Ticket Transfer' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => set('transfer_method', opt.value)}
                  className="w-full text-left px-4 py-3.5 rounded-2xl transition-all"
                  style={{
                    background: form.transfer_method === opt.value ? 'rgba(191,95,255,0.1)' : 'hsl(var(--card))',
                    border: form.transfer_method === opt.value ? '1px solid rgba(191,95,255,0.35)' : '1px solid hsl(var(--border))',
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

      {step === 2 && <p className="mt-6 text-xs leading-relaxed text-muted-foreground">PG upgrades are separately priced add-on purchases.</p>}
      {/* Navigation remains in flow so the keyboard cannot cover a fixed action bar. */}
      {step > 0 && <div className="mt-8 pt-5 border-t border-border flex gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={uploadingProof || uploadingPgProof || submitting}
            aria-label={step === 1 ? 'Back to events' : 'Back to seats'}
            className="flex items-center gap-1.5 px-5 py-3 rounded-full text-sm font-semibold transition-colors"
            style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
        {step === 1 && (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canNext1}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-30"
            style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff', boxShadow: '0 0 18px rgba(191,95,255,0.25)' }}
          >
            Price & review <ArrowRight className="w-4 h-4" />
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
      </div>}
    </div>
  );
}
