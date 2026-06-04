/**
 * TransferAssistant — Phase 1 Transfer UX
 * Replaces the old SellerPanel with a focused, platform-aware transfer flow.
 * Goal: seller completes transfer in under 60 seconds, ~8 taps total.
 */
import { useState } from 'react';
import { CheckCircle, Copy, ExternalLink, Upload, Send, ChevronDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const PLATFORM_CONFIG = {
  ticketmaster: {
    label: 'Ticketmaster',
    url: 'https://www.ticketmaster.com/member/tickets',
    color: '#006AFF',
    emoji: '🎟',
  },
  seatgeek: {
    label: 'SeatGeek',
    url: 'https://seatgeek.com/account/tickets',
    color: '#00A651',
    emoji: '🎫',
  },
  axs: {
    label: 'AXS',
    url: 'https://www.axs.com/myaccount/tickets',
    color: '#E4002B',
    emoji: '🎫',
  },
  stubhub: {
    label: 'StubHub',
    url: 'https://www.stubhub.com/selling',
    color: '#FF5C00',
    emoji: '🎟',
  },
  apple_wallet: {
    label: 'Apple Wallet',
    url: 'https://support.apple.com/en-us/HT204003',
    color: '#000000',
    emoji: '📱',
  },
  other: {
    label: 'Your Ticket App',
    url: null,
    color: '#888888',
    emoji: '🎫',
  },
};

const OTHER_PLATFORMS = [
  { key: 'ticketmaster', label: 'Ticketmaster', url: 'https://www.ticketmaster.com/member/tickets' },
  { key: 'seatgeek',     label: 'SeatGeek',     url: 'https://seatgeek.com/account/tickets' },
  { key: 'axs',          label: 'AXS',           url: 'https://www.axs.com/myaccount/tickets' },
  { key: 'stubhub',      label: 'StubHub',       url: 'https://www.stubhub.com/selling' },
];

export default function TransferAssistant({ purchase, listing, onConfirm, actionLoading, error, setError }) {
  const [emailCopied, setEmailCopied] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [showOtherPlatforms, setShowOtherPlatforms] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Resolve platform from listing (set during seller attestation)
  const platformKey = listing?.transfer_platform || null;
  const platform = platformKey ? (PLATFORM_CONFIG[platformKey] || PLATFORM_CONFIG.other) : null;

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(purchase.buyer_email);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2500);
    } catch {
      // Fallback for browsers that block clipboard
      const el = document.createElement('input');
      el.value = purchase.buyer_email;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2500);
    }
  };

  const handleConfirm = async () => {
    setError('');
    setUploading(true);
    let proofUrl = null;
    if (proofFile) {
      const uploadRes = await base44.integrations.Core.UploadFile({ file: proofFile });
      proofUrl = uploadRes.file_url;
    }
    setUploading(false);

    // Auto-generate transfer note — no manual typing required
    const autoNote = [
      platform ? `Transferred via ${platform.label}` : 'Transferred',
      `To: ${purchase.buyer_email}`,
      `At: ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
    ].join(' · ');

    await onConfirm({ proofUrl, proofNote: autoNote });
  };

  // Already confirmed — waiting on buyer
  if (purchase.seller_confirmed) {
    return (
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,200,255,0.3)', background: 'rgba(0,200,255,0.06)' }}>
        <div className="px-5 pt-6 pb-5 text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: 'linear-gradient(135deg, #00C8FF33, #BF5FFF33)', border: '2px solid rgba(0,200,255,0.4)' }}>
            <Send className="w-6 h-6" style={{ color: '#00C8FF' }} />
          </div>
          <h2 className="font-display text-2xl text-foreground mb-1">Tickets Sent 🚀</h2>
          <p className="text-sm text-muted-foreground">Waiting for buyer to confirm receipt.</p>
        </div>
        <div className="px-5 pb-5 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
            style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: '#00C8FF' }}>
            <CheckCircle className="w-4 h-4" /> Waiting on buyer confirmation
          </div>
          <p className="text-xs text-center text-muted-foreground">Your payout is released once the buyer confirms.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}>

      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3"
        style={{ background: 'rgba(255,140,0,0.1)', borderBottom: '1px solid rgba(255,140,0,0.2)' }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-lg"
          style={{ background: 'rgba(255,140,0,0.2)' }}>
          ⚡
        </div>
        <div>
          <div className="font-black text-sm text-foreground">ACTION REQUIRED</div>
          <div className="text-xs text-muted-foreground">Transfer your tickets to the buyer</div>
        </div>
      </div>

      <div className="p-5 space-y-5">

        {/* Step 1 — Copy buyer email */}
        <div>
          <div className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-2">
            Step 1 · Transfer To
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(191,95,255,0.3)', background: 'rgba(191,95,255,0.06)' }}>
            <div className="px-4 py-3">
              <div className="font-bold text-foreground text-base leading-snug break-all">{purchase.buyer_email}</div>
              {purchase.buyer_name && (
                <div className="text-xs text-muted-foreground mt-0.5">{purchase.buyer_name}</div>
              )}
            </div>
            <button
              onClick={copyEmail}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-black transition-all active:scale-[0.98]"
              style={{
                borderTop: '1px solid rgba(191,95,255,0.2)',
                background: emailCopied ? 'rgba(0,255,135,0.12)' : 'rgba(191,95,255,0.1)',
                color: emailCopied ? '#00FF87' : '#BF5FFF',
              }}
            >
              {emailCopied
                ? <><CheckCircle className="w-4 h-4" /> Email Copied!</>
                : <><Copy className="w-4 h-4" /> Copy Buyer Email</>
              }
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            Paste this email into your ticket app's transfer field
          </p>
        </div>

        {/* Step 2 — Open platform */}
        <div>
          <div className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-2">
            Step 2 · Open Your Ticket App
          </div>
          {platform && platform.url ? (
            <a
              href={platform.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full px-4 py-4 rounded-2xl font-black text-white text-sm transition-all active:scale-[0.98]"
              style={{ background: platform.color, boxShadow: `0 4px 20px ${platform.color}44` }}
            >
              <span className="text-xl">{platform.emoji}</span>
              <span className="flex-1">Open {platform.label}</span>
              <ExternalLink className="w-4 h-4 opacity-70" />
            </a>
          ) : (
            <div className="rounded-2xl px-4 py-3 text-sm text-muted-foreground"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
              Open your ticket app and transfer to the email above.
            </div>
          )}

          {/* Other platforms — collapsed by default */}
          <button
            onClick={() => setShowOtherPlatforms(v => !v)}
            className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground mx-auto"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showOtherPlatforms ? 'rotate-180' : ''}`} />
            Using a different platform?
          </button>
          {showOtherPlatforms && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {OTHER_PLATFORMS.filter(p => p.key !== platformKey).map(p => (
                <a key={p.key} href={p.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold text-foreground transition-all active:scale-95"
                  style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                  {p.label} <ExternalLink className="w-3 h-3 opacity-50" />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Step 3 — Confirm */}
        <div>
          <div className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-2">
            Step 3 · Confirm Transfer
          </div>

          {/* Optional proof upload — secondary, not primary */}
          <label className="flex items-center gap-2 cursor-pointer rounded-xl px-4 py-3 mb-3 transition-all text-sm"
            style={{
              border: proofFile ? '1.5px solid rgba(0,255,135,0.4)' : '1.5px dashed rgba(255,255,255,0.12)',
              background: proofFile ? 'rgba(0,255,135,0.06)' : 'rgba(255,255,255,0.02)',
              color: proofFile ? '#00FF87' : 'hsl(var(--muted-foreground))',
            }}>
            {proofFile
              ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
              : <Upload className="w-4 h-4 flex-shrink-0 opacity-60" />}
            <span className="truncate text-xs">
              {proofFile ? proofFile.name : 'Upload proof screenshot (optional — speeds up verification)'}
            </span>
            <input type="file" accept="image/*,application/pdf" className="hidden"
              onChange={e => setProofFile(e.target.files[0] || null)} />
          </label>

          {error && (
            <div className="text-xs px-3 py-2 rounded-lg mb-3"
              style={{ color: '#FF2D78', background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.25)' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={actionLoading || uploading}
            className="w-full py-4 rounded-full font-black text-base transition-all disabled:opacity-40 flex items-center justify-center gap-2 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14', boxShadow: '0 4px 24px rgba(0,232,122,0.3)' }}
          >
            {uploading ? (
              <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Uploading…</>
            ) : actionLoading ? (
              <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Confirming…</>
            ) : (
              <><CheckCircle className="w-5 h-5" /> I've Sent The Tickets</>
            )}
          </button>

          <p className="text-[10px] text-center text-muted-foreground mt-2">
            Transfer note generated automatically. Your payout releases when the buyer confirms.
          </p>
        </div>
      </div>
    </div>
  );
}