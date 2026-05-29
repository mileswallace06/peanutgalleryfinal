import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldCheck, Upload, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { computeTransferConfidence } from '@/lib/transferConfidence';

/**
 * Button + mini-modal for seller to re-verify transfer availability.
 * Props:
 *   listing: Listing entity
 *   event: Event entity (for confidence computation)
 *   onVerified: () => void — called after successful save
 */
export default function VerifyTransferButton({ listing, event, onVerified }) {
  const [open, setOpen] = useState(false);
  const [canTransfer, setCanTransfer] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [proofUrl, setProofUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setProofFile(file);
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setProofUrl(file_url);
    setUploading(false);
  };

  const handleSubmit = async () => {
    setSaving(true);
    const now = new Date().toISOString();

    // Compute new confidence
    const draftListing = {
      ...listing,
      transfer_status: canTransfer ? 'transfer_confirmed' : 'transfer_disabled',
      last_transfer_verification: now,
      transfer_verification_method: proofUrl ? 'screenshot_verified' : 'seller_attestation',
      transfer_verification_proof_url: proofUrl || listing.transfer_verification_proof_url,
    };
    const { score } = computeTransferConfidence(draftListing, event);

    const update = {
      transfer_status: canTransfer ? 'transfer_confirmed' : 'transfer_disabled',
      last_transfer_verification: now,
      transfer_verification_method: proofUrl ? 'screenshot_verified' : 'seller_attestation',
      transfer_confidence_score: canTransfer ? score : 0,
      transfer_verified_by: listing.seller_email,
    };
    if (proofUrl) {
      update.transfer_verification_proof_url = proofUrl;
    }
    if (!canTransfer) {
      // Auto-hide from upgrades
      update.status = 'cancelled';
      update.transfer_verified_notes = 'Seller confirmed transfer no longer available';
    }

    await base44.entities.Listing.update(listing.id, update);
    setSaving(false);
    setDone(true);
    setTimeout(() => {
      setOpen(false);
      setDone(false);
      setCanTransfer(null);
      setProofFile(null);
      setProofUrl('');
      onVerified?.();
    }, 1200);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
        style={{ background: 'rgba(191,95,255,0.1)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}
      >
        <RefreshCw className="w-3 h-3" /> Verify Transfer Still Available
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl"
            style={{ background: 'hsl(255 12% 9%)', border: '1px solid rgba(255,255,255,0.12)' }}>
            
            {/* Header */}
            <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" style={{ color: '#BF5FFF' }} />
                <span className="font-bold text-sm text-foreground">Verify Transfer Availability</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Section {listing.section} · Row {listing.row} · {listing.quantity} ticket{listing.quantity > 1 ? 's' : ''}
              </p>
            </div>

            <div className="p-5 space-y-4">
              {done ? (
                <div className="text-center py-4">
                  <CheckCircle className="w-10 h-10 mx-auto mb-2" style={{ color: canTransfer ? '#00FF87' : '#FF2D78' }} />
                  <p className="font-bold text-sm text-foreground">
                    {canTransfer ? 'Transfer confirmed!' : 'Listing hidden from buyers.'}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-semibold text-foreground">
                    Can you currently see the Transfer button in your ticketing app?
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setCanTransfer(true)}
                      className="flex flex-col items-center gap-1.5 py-4 rounded-xl text-sm font-bold transition-all"
                      style={{
                        background: canTransfer === true ? 'rgba(0,255,135,0.12)' : 'rgba(255,255,255,0.04)',
                        border: canTransfer === true ? '1.5px solid rgba(0,255,135,0.4)' : '1px solid rgba(255,255,255,0.1)',
                        color: canTransfer === true ? '#00FF87' : 'hsl(var(--muted-foreground))',
                      }}
                    >
                      <CheckCircle className="w-6 h-6" />
                      YES
                    </button>
                    <button
                      onClick={() => setCanTransfer(false)}
                      className="flex flex-col items-center gap-1.5 py-4 rounded-xl text-sm font-bold transition-all"
                      style={{
                        background: canTransfer === false ? 'rgba(255,45,120,0.1)' : 'rgba(255,255,255,0.04)',
                        border: canTransfer === false ? '1.5px solid rgba(255,45,120,0.4)' : '1px solid rgba(255,255,255,0.1)',
                        color: canTransfer === false ? '#FF2D78' : 'hsl(var(--muted-foreground))',
                      }}
                    >
                      <XCircle className="w-6 h-6" />
                      NO
                    </button>
                  </div>

                  {canTransfer === false && (
                    <div className="rounded-xl px-4 py-3 text-xs leading-relaxed"
                      style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.25)', color: '#FF2D78' }}>
                      ⚠️ Your listing will be hidden from buyers and marked as transfer unavailable. Buyers cannot purchase untransferable tickets.
                    </div>
                  )}

                  {canTransfer === true && (
                    <div>
                      <label className="block text-xs text-muted-foreground mb-2">
                        Screenshot of transfer button <span className="opacity-60">(optional — increases confidence)</span>
                      </label>
                      {proofUrl ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                          style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.25)', color: '#00FF87' }}>
                          <CheckCircle className="w-3.5 h-3.5" /> Screenshot uploaded ✓
                          <button onClick={() => { setProofUrl(''); setProofFile(null); }}
                            className="ml-auto text-muted-foreground hover:text-foreground">Remove</button>
                        </div>
                      ) : (
                        <label className="flex items-center gap-2 px-4 py-3 rounded-xl cursor-pointer text-xs text-muted-foreground"
                          style={{ border: '1.5px dashed rgba(255,255,255,0.15)' }}>
                          {uploading
                            ? <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            : <Upload className="w-3.5 h-3.5" />}
                          {uploading ? 'Uploading…' : 'Upload screenshot'}
                          <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
                        </label>
                      )}
                    </div>
                  )}

                  {canTransfer !== null && (
                    <button
                      onClick={handleSubmit}
                      disabled={saving || uploading}
                      className="w-full py-3 rounded-full font-black text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                      style={{
                        background: canTransfer ? 'linear-gradient(135deg, #00E87A, #00B8E8)' : 'linear-gradient(135deg, #FF2D78, #FF8C00)',
                        color: '#fff',
                      }}
                    >
                      {saving
                        ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                        : canTransfer ? <><ShieldCheck className="w-4 h-4" /> Confirm — Transfer Available</>
                        : <><XCircle className="w-4 h-4" /> Confirm — Cannot Transfer</>
                      }
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}