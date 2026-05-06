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
    <div className="fixed inset-0 flex flex-col items-center justify-center px-5"
      style={{ background: 'hsl(255 10% 5%)' }}>

      {/* Logo */}
      <img
        src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png"
        alt="Peanut Gallery"
        className="h-20 w-auto rounded-2xl mb-8"
      />

      {/* Icon */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-6"
        style={{
          background: 'rgba(191,95,255,0.12)',
          border: '1px solid rgba(191,95,255,0.3)',
          boxShadow: '0 0 32px rgba(191,95,255,0.2)',
        }}
      >
        ⏳
      </div>

      <h1
        className="font-display text-3xl mb-3 text-center"
        style={{
          background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        Awaiting Approval
      </h1>

      <p className="text-sm text-center mb-2 max-w-xs leading-relaxed"
        style={{ color: 'rgba(255,255,255,0.65)' }}>
        Your account is pending admin approval. You'll get access as soon as it's approved — no action needed.
      </p>

      <p className="text-xs mb-8"
        style={{ color: 'rgba(255,255,255,0.3)' }}>
        Rechecking in {countdown}s…
      </p>

      {/* Retry button */}
      <button
        onClick={handleRetry}
        disabled={checking}
        className="flex items-center justify-center gap-2 px-8 py-3.5 rounded-full font-black text-sm mb-3 transition-all disabled:opacity-60"
        style={{
          background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
          color: '#fff',
          boxShadow: '0 0 18px rgba(191,95,255,0.3)',
        }}
      >
        {checking ? (
          <>
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Checking…
          </>
        ) : (
          '↻ Check Now'
        )}
      </button>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="text-xs font-medium transition-colors"
        style={{ color: 'rgba(255,255,255,0.3)' }}
      >
        Sign out and use a different account
      </button>
    </div>
  );
};

export default UserNotRegisteredError;