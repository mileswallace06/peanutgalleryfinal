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
    <div className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)' }}>

      {/* Header */}
      <div className="px-4 py-4" style={{ background: 'rgba(191,95,255,0.08)', borderBottom: '1px solid rgba(191,95,255,0.2)' }}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: '#BF5FFF' }} />
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
            Can you still transfer this ticket in your ticketing app? <span style={{ color: '#FF2D78' }}>*</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCanTransfer(true)}
              className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all"
              style={{
                background: canTransfer === true ? 'rgba(0,255,135,0.12)' : 'hsl(var(--muted))',
                border: canTransfer === true ? '1.5px solid rgba(0,255,135,0.4)' : '1px solid hsl(var(--border))',
                color: canTransfer === true ? '#00FF87' : 'hsl(var(--muted-foreground))',
              }}
            >
              <CheckCircle className="w-4 h-4" /> Yes, I can transfer
            </button>
            <button
              type="button"
              onClick={() => { setCanTransfer(false); onBlocked(); }}
              className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all"
              style={{
                background: canTransfer === false ? 'rgba(255,45,120,0.1)' : 'hsl(var(--muted))',
                border: canTransfer === false ? '1.5px solid rgba(255,45,120,0.4)' : '1px solid hsl(var(--border))',
                color: canTransfer === false ? '#FF2D78' : 'hsl(var(--muted-foreground))',
              }}
            >
              <XCircle className="w-4 h-4" /> No, I cannot transfer
            </button>
          </div>
        </div>

        {/* Blocked state */}
        {canTransfer === false && (
          <div className="rounded-xl p-4 space-y-2"
            style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.3)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#FF2D78' }} />
              <span className="text-sm font-bold" style={{ color: '#FF2D78' }}>Listing blocked</span>
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
                Which platform is your ticket on? <span style={{ color: '#FF2D78' }}>*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {PLATFORMS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPlatform(p.value)}
                    className="py-2 px-2 rounded-xl text-xs font-semibold transition-all text-center"
                    style={{
                      background: platform === p.value ? 'rgba(191,95,255,0.12)' : 'hsl(var(--muted))',
                      border: platform === p.value ? '1px solid rgba(191,95,255,0.4)' : '1px solid hsl(var(--border))',
                      color: platform === p.value ? '#BF5FFF' : 'hsl(var(--muted-foreground))',
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
                className="w-full flex items-start gap-3 text-left px-4 py-3.5 rounded-xl transition-all"
                style={{
                  background: notScanned ? 'rgba(0,255,135,0.06)' : 'hsl(var(--muted))',
                  border: notScanned ? '1.5px solid rgba(0,255,135,0.35)' : '1px solid hsl(var(--border))',
                }}
              >
                <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{
                    background: notScanned ? '#00FF87' : 'transparent',
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
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.25)' }}>
                  <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#00FF87' }} />
                  <span className="text-sm font-semibold" style={{ color: '#00FF87' }}>Screenshot uploaded ✓</span>
                  <button onClick={() => { setProofUrl(''); setProofFile(null); }}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground">Remove</button>
                </div>
              ) : (
                <label className={`flex items-center gap-2 rounded-xl px-4 py-3 cursor-pointer transition-all ${uploading ? 'opacity-60' : ''}`}
                  style={{ border: '1.5px dashed rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.02)' }}>
                  {uploading
                    ? <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    : <Upload className="w-4 h-4 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground">{uploading ? 'Uploading…' : 'Tap to upload screenshot'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
                </label>
              )}
            </div>

            {error && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ color: '#FF2D78', background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.25)' }}>
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleConfirm}
              disabled={uploading}
              className="w-full py-3.5 rounded-full font-black text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff' }}
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