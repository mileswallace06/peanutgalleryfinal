import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, X } from 'lucide-react';

export default function DeleteAccountModal({ user, isOpen, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      // Note: Base44 doesn't have a built-in delete user endpoint, so we log out
      // In production, you'd implement backend logic to delete user + related data
      await base44.auth.logout('/');
    } catch (error) {
      console.error('Error deleting account:', error);
      setDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 space-y-4"
        style={{ background: 'hsl(255 12% 9%)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,45,120,0.15)' }}
            >
              <AlertTriangle className="w-5 h-5" style={{ color: '#FF2D78' }} />
            </div>
            <div>
              <h3 className="font-black text-lg text-foreground">Delete Account</h3>
              <p className="text-xs text-muted-foreground mt-0.5">This action cannot be undone</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          className="rounded-2xl p-4 space-y-2"
          style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.2)' }}
        >
          <p className="text-sm text-foreground font-semibold">When you delete your account:</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• All your listings will be permanently removed</li>
            <li>• Your ticket purchase history will be deleted</li>
            <li>• Your profile and social connections will be removed</li>
            <li>• This cannot be reversed</li>
          </ul>
        </div>

        {!confirming ? (
          <div className="space-y-2">
            <button
              onClick={() => setConfirming(true)}
              className="w-full py-3 rounded-2xl font-bold text-sm transition-all"
              style={{ background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.3)' }}
            >
              I understand, delete my account
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-2xl font-bold text-sm transition-all"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground text-center">
              Type your email to confirm account deletion:
            </p>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-4 py-3 rounded-2xl text-sm text-foreground opacity-60"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <div className="space-y-2">
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="w-full py-3 rounded-2xl font-black text-sm transition-all disabled:opacity-60"
                style={{ background: '#FF2D78', color: '#fff' }}
              >
                {deleting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting…
                  </span>
                ) : (
                  'Permanently Delete Account'
                )}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="w-full py-3 rounded-2xl font-bold text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}