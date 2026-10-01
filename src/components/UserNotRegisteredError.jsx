import PublicPage from '@/components/PublicPage';
import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

// Shown when the platform returns user_not_registered (pending approval or truly not registered)
const UserNotRegisteredError = ({ onRetry }) => {
  const [checking, setChecking] = useState(false);
  const [countdown, setCountdown] = useState(15);

  // Auto-poll every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          handleRetry();
          return 15;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRetry = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setCountdown(15);
    try {
      if (onRetry) {
        await onRetry();
      } else {
        // Fallback: hard reload to re-trigger full auth check
        window.location.reload();
      }
    } finally {
      setChecking(false);
    }
  }, [checking, onRetry]);

  const handleSignOut = () => {
    base44.auth.logout('/');
  };

  return (
    <PublicPage className="fixed inset-0 flex flex-col items-center overflow-y-auto px-5 py-8">
      <div className="pg-public-state my-auto flex flex-col items-center">

      {/* Logo */}
      <img
        src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png"
        alt="Peanut Gallery"
        className="h-16 w-auto rounded-lg mb-6"
      />

      {/* Icon */}
      <div
        className="pg-public-state-icon w-16 h-16 flex items-center justify-center text-3xl mb-6"
      >
        ⏳
      </div>

      <h1
        className="font-display text-3xl mb-3 text-center"
        style={{ color: 'var(--neon-purple)' }}
      >
        Awaiting Approval
      </h1>

      <p className="pg-public-muted text-sm text-center mb-2 max-w-xs leading-relaxed">
        Your account is pending admin approval. You'll get access as soon as it's approved — no action needed.
      </p>

      <p className="pg-public-muted text-xs mb-8">
        Rechecking in {countdown}s…
      </p>

      {/* Retry button */}
      <button
        onClick={handleRetry}
        disabled={checking}
        className="pg-public-action text-sm mb-3"
      >
        {checking ? (
          <>
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Checking…
          </>
        ) : (
          '↻ Check Now'
        )}
      </button>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="pg-public-link text-sm font-medium text-center"
      >
        Sign out and use a different account
      </button>
      </div>
    </PublicPage>
  );
};

export default UserNotRegisteredError;