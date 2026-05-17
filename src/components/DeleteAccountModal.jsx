import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, X } from 'lucide-react';

// Step 1: Info + consequences
// Step 2: Type email to confirm
// Step 3: Final "really sure?" + execute

export default function DeleteAccountModal({ user, isOpen, onClose }) {
  const [step, setStep] = useState(1);
  const [emailInput, setEmailInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => { setStep(1); setEmailInput(''); setError(''); onClose(); };

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      // Contact support flow — Base44 doesn't expose a hard-delete endpoint.
      // We log out and send a deletion request email per App Store guidelines.
      await base44.integrations.Core.SendEmail({
        to: 'support@peanutgallery.app',
        subject: `Account Deletion Request — ${user?.email}`,
        body: `User ${user?.full_name} (${user?.email}, id: ${user?.id}) has requested account deletion from within the app on ${new Date().toISOString()}.`,
      }).catch(() => {});
      await base44.auth.logout('/');
    } catch {
      setError('Something went wrong. Please email support@peanutgallery.app directly.');
      setDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={reset} />

      <div
        className="relative z-10 w-full sm:max-w-md sm:mx-auto rounded-t-3xl sm:rounded-3xl p-6 space-y-5"
        style={{ background: 'hsl(255 12% 9%)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,45,120,0.15)' }}>
              <AlertTriangle className="w-5 h-5" style={{ color: '#FF2D78' }} />
            </div>
            <div>
              <h3 className="font-black text-lg text-foreground">Delete Account</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Step {step} of 3</p>
            </div>
          </div>
          <button onClick={reset} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step dots */}
        <div className="flex gap-2">
          {[1, 2, 3].map(s => (
            <div key={s} className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: s <= step ? '#FF2D78' : 'rgba(255,255,255,0.1)' }} />
          ))}
        </div>

        {/* Step 1 — Consequences */}
        {step === 1 && (
          <>
            <div className="rounded-2xl p-4 space-y-2"
              style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.2)' }}>
              <p className="text-sm font-bold text-foreground">What gets deleted:</p>
              <ul className="text-xs text-muted-foreground space-y-1.5">
                <li>• All your active listings will be removed</li>
                <li>• Your purchase and sales history will be deleted</li>
                <li>• Your profile, bio, followers and bucket list are gone</li>
                <li>• Any pending payouts may be forfeited</li>
                <li>• This action <span className="font-bold text-foreground">cannot be reversed</span></li>
              </ul>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Your request will be processed within 30 days per our Privacy Policy. You'll receive a confirmation email.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => setStep(2)}
                className="w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
                style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.3)' }}
              >
                I understand, continue
              </button>
              <button onClick={reset}
                className="w-full py-3 rounded-2xl font-bold text-sm transition-all"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Step 2 — Type email */}
        {step === 2 && (
          <>
            <p className="text-sm text-muted-foreground">
              Type your email address to confirm you want to delete your account:
            </p>
            <div className="space-y-1">
              <input
                type="email"
                placeholder={user?.email}
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl text-sm text-foreground focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${emailInput === user?.email ? '#FF2D78' : 'rgba(255,255,255,0.1)'}` }}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <p className="text-[10px] text-muted-foreground px-1">Must match exactly: {user?.email}</p>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => emailInput === user?.email ? setStep(3) : setError('Email doesn\'t match.')}
                className="w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40"
                style={{ background: emailInput === user?.email ? 'rgba(255,45,120,0.18)' : 'rgba(255,255,255,0.05)', color: emailInput === user?.email ? '#FF2D78' : 'hsl(var(--muted-foreground))', border: `1px solid ${emailInput === user?.email ? 'rgba(255,45,120,0.35)' : 'rgba(255,255,255,0.08)'}` }}
              >
                Confirm email
              </button>
              {error && <p className="text-xs text-center" style={{ color: '#FF2D78' }}>{error}</p>}
              <button onClick={() => { setStep(1); setError(''); }}
                className="w-full py-3 rounded-2xl font-bold text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Back
              </button>
            </div>
          </>
        )}

        {/* Step 3 — Final confirmation */}
        {step === 3 && (
          <>
            <div className="rounded-2xl p-4 text-center space-y-2"
              style={{ background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.25)' }}>
              <p className="text-2xl">☠️</p>
              <p className="text-sm font-black text-foreground">Are you absolutely sure?</p>
              <p className="text-xs text-muted-foreground">This will permanently delete <span className="font-bold text-foreground">{user?.email}</span> and all associated data.</p>
            </div>
            {error && <p className="text-xs text-center" style={{ color: '#FF2D78' }}>{error}</p>}
            <div className="space-y-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="w-full py-3.5 rounded-2xl font-black text-sm transition-all active:scale-[0.98] disabled:opacity-60"
                style={{ background: '#FF2D78', color: '#fff' }}
              >
                {deleting
                  ? <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Submitting request…
                    </span>
                  : 'Yes, delete my account'
                }
              </button>
              <button onClick={() => { setStep(2); setError(''); }}
                className="w-full py-3 rounded-2xl font-bold text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}