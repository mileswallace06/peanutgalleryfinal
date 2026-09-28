import '@/components/events/detail-ticket.css';
import { useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Upload, ShieldCheck } from 'lucide-react';

const PLATFORMS = [
  { value: 'ticketmaster', label: 'Ticketmaster' },
  { value: 'seatgeek', label: 'SeatGeek' },
  { value: 'axs', label: 'AXS' },
  { value: 'stubhub', label: 'StubHub' },
  { value: 'apple_wallet', label: 'Apple Wallet' },
  { value: 'other', label: 'Other' },
];

/**
 * Seller attestation gate shown before listing submission.
 * Props:
 *   onConfirm({ canTransfer, platform, proofUrl, notScanned }) - called when seller confirms
 *   onBlocked() - called when seller says they can't transfer
 *   uploadFile(file) => Promise<string> - returns url
 */
export default function SellerTransferAttestation({ onConfirm, onBlocked, uploadFile }) {
  const [canTransfer, setCanTransfer] = useState(null); // null | true | false
  const [notScanned, setNotScanned] = useState(false);
  const [platform, setPlatform] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [proofUrl, setProofUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setProofFile(file);
    setUploading(true);
    const url = await uploadFile(file);
    setProofUrl(url);
    setUploading(false);
  };

  const handleConfirm = () => {
    if (!platform) {
      setError('Please select your ticket platform.');
      return;
    }
    if (!notScanned) {
      setError('Please confirm your ticket has not been scanned.');
      return;
    }
    setError('');
    onConfirm({ canTransfer: true, platform, proofUrl: proofUrl || null });
  };

  return (
    <div className="pg-seller-attestation pg-detail-surface rounded-lg overflow-hidden"
      style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)' }}>

      {/* Header */}
      <div className="px-4 py-4" style={{ background: 'color-mix(in srgb, var(--pg-violet) 8%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--pg-violet) 20%, transparent)' }}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-purple)' }} />
          <span className="font-bold text-sm text-foreground">Transfer Verification Required</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Before listing, we need to verify you can still transfer this ticket. This protects buyers from purchasing untransferable tickets.
        </p>
      </div>

      <div className="p-4 space-y-5">

        {/* Q1: Can you still transfer? */}
        <div>
          <p className="text-sm font-semibold text-foreground mb-3">
            Can you still transfer this ticket in your ticketing app? <span style={{ color: 'var(--neon-pink)' }}>*</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCanTransfer(true)}
              className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all"
              style={{
                background: canTransfer === true ? 'color-mix(in srgb, var(--pg-mint) 12%, transparent)' : 'var(--pg-surface-raised)',
                border: canTransfer === true ? '1.5px solid color-mix(in srgb, var(--pg-mint) 40%, transparent)' : '1px solid var(--pg-line)',
                color: canTransfer === true ? 'var(--neon-green)' : 'var(--pg-muted)',
              }}
            >
              <CheckCircle className="w-4 h-4" /> Yes, I can transfer
            </button>
            <button
              type="button"
              onClick={() => { setCanTransfer(false); onBlocked(); }}
              className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all"
              style={{
                background: canTransfer === false ? 'color-mix(in srgb, var(--pg-pink) 10%, transparent)' : 'var(--pg-surface-raised)',
                border: canTransfer === false ? '1.5px solid color-mix(in srgb, var(--pg-pink) 40%, transparent)' : '1px solid var(--pg-line)',
                color: canTransfer === false ? 'var(--neon-pink)' : 'var(--pg-muted)',
              }}
            >
              <XCircle className="w-4 h-4" /> No, I cannot transfer
            </button>
          </div>
        </div>

        {/* Blocked state */}
        {canTransfer === false && (
          <div className="rounded-lg p-4 space-y-2"
            style={{ background: 'color-mix(in srgb, var(--pg-pink) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--pg-pink) 30%, transparent)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-pink)' }} />
              <span className="text-sm font-bold" style={{ color: 'var(--neon-pink)' }}>Listing blocked</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You cannot list a ticket you cannot transfer. If your ticket has already been used for entry, it cannot be sold.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              If you have physical tickets or your app is malfunctioning, contact support.
            </p>
          </div>
        )}

        {/* If yes — show platform + attestation */}
        {canTransfer === true && (
          <>
            {/* Platform */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-2">
                Which platform is your ticket on? <span style={{ color: 'var(--neon-pink)' }}>*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {PLATFORMS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPlatform(p.value)}
                    className="py-2 px-2 rounded-lg text-xs font-semibold transition-all text-center"
                    style={{
                      background: platform === p.value ? 'color-mix(in srgb, var(--pg-violet) 12%, transparent)' : 'var(--pg-surface-raised)',
                      border: platform === p.value ? '1px solid color-mix(in srgb, var(--pg-violet) 40%, transparent)' : '1px solid var(--pg-line)',
                      color: platform === p.value ? 'var(--neon-purple)' : 'var(--pg-muted)',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scanned attestation */}
            <div>
              <button
                type="button"
                onClick={() => setNotScanned(v => !v)}
                className="w-full flex items-start gap-3 text-left px-4 py-3.5 rounded-lg transition-all"
                style={{
                  background: notScanned ? 'color-mix(in srgb, var(--pg-mint) 6%, transparent)' : 'var(--pg-surface-raised)',
                  border: notScanned ? '1.5px solid color-mix(in srgb, var(--pg-mint) 35%, transparent)' : '1px solid var(--pg-line)',
                }}
              >
                <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{
                    background: notScanned ? 'var(--pg-mint)' : 'transparent',
                    border: notScanned ? 'none' : '2px solid hsl(var(--muted-foreground))',
                  }}>
                  {notScanned && <span className="text-black text-xs font-black">✓</span>}
                </div>
                <span className="text-xs text-foreground leading-relaxed">
                  <strong>I confirm this ticket has not been scanned or used for entry</strong> and the transfer button is currently visible in my ticketing app.
                </span>
              </button>
            </div>

            {/* Optional screenshot */}
            <div>
              <label className="block text-xs text-muted-foreground mb-2">
                Screenshot of transfer button <span className="opacity-60 font-normal">(optional but increases buyer trust)</span>
              </label>
              {proofUrl ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg"
                  style={{ background: 'color-mix(in srgb, var(--pg-mint) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--pg-mint) 25%, transparent)' }}>
                  <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-green)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--neon-green)' }}>Screenshot uploaded ✓</span>
                  <button onClick={() => { setProofUrl(''); setProofFile(null); }}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground">Remove</button>
                </div>
              ) : (
                <label className={`flex items-center gap-2 rounded-lg px-4 py-3 cursor-pointer transition-all ${uploading ? 'opacity-60' : ''}`}
                  style={{ border: '1.5px dashed var(--pg-line)', background: 'var(--pg-surface-raised)' }}>
                  {uploading
                    ? <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    : <Upload className="w-4 h-4 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground">{uploading ? 'Uploading…' : 'Tap to upload screenshot'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
                </label>
              )}
            </div>

            {error && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--neon-pink)', background: 'color-mix(in srgb, var(--neon-pink) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--neon-pink) 25%, transparent)' }}>
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleConfirm}
              disabled={uploading}
              className="w-full py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'var(--pg-violet)', color: 'var(--pg-ink)' }}
            >
              <ShieldCheck className="w-4 h-4" /> Confirm & Continue to Listing
            </button>

            <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
              False attestations may result in account suspension. Transfer source will be recorded as seller-confirmed.
            </p>
          </>
        )}
      </div>
    </div>
  );
}