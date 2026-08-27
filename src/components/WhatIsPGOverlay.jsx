import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Zap, X, ShieldCheck, Ticket, Gift } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * Versioned "What is PG?" onboarding overlay for the Upgrades page.
 *
 * Rendered via createPortal at document.body so it sits above the entire app
 * shell and bottom navigation, avoiding the framer-motion transform stacking
 * context that trapped the prior inline overlay below the nav.
 *
 * Dismissal is persisted to the authenticated account preference
 * (has_seen_upgrades_onboarding via base44.auth.updateMe) when available, with
 * a versioned localStorage fallback for logged-out visitors.
 */

const STORAGE_KEY = 'pg_what_is_pg_seen_v2';
const ACCOUNT_FIELD = 'has_seen_upgrades_onboarding';
const SWIPE_DISMISS_THRESHOLD = 100; // px

/**
 * Whether the overlay should be shown.
 * Authenticated: account preference takes priority.
 * Logged-out: versioned localStorage fallback.
 */
export function shouldShowOverlay(user) {
  if (user?.[ACCOUNT_FIELD]) return false;
  try { return !localStorage.getItem(STORAGE_KEY); } catch { return false; }
}

/**
 * Persist dismissal to both account preference (if authenticated) and localStorage.
 */
export function markOverlaySeen(user) {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
  if (user) {
    base44.auth.updateMe({ [ACCOUNT_FIELD]: true }).catch(() => {});
  }
}

export default function WhatIsPGOverlay({ onDismiss, user }) {
  const sheetRef = useRef(null);
  const closeBtnRef = useRef(null);
  const scrollRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const isDragging = useRef(false);
  const touchStartY = useRef(null);

  const handleDismiss = useCallback(() => {
    markOverlaySeen(user);
    onDismiss();
  }, [onDismiss, user]);

  // Escape key dismissal
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleDismiss]);

  // Focus the close button on mount, trap Tab, restore focus on unmount
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeBtnRef.current?.focus();

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusable = sheet.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  // Downward swipe dismissal — only from the drag handle / header (not scrollable body)
  const onTouchStart = (e) => {
    // Don't start drag if touching inside the scrollable content area
    if (scrollRef.current && scrollRef.current.contains(e.target)) return;
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const onTouchMove = (e) => {
    if (!isDragging.current || touchStartY.current === null) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) setDragY(delta);
  };

  const onTouchEnd = () => {
    if (dragY > SWIPE_DISMISS_THRESHOLD) {
      handleDismiss();
    } else {
      setDragY(0);
    }
    isDragging.current = false;
    touchStartY.current = null;
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col justify-end"
      style={{
        height: '100dvh',
        background: 'rgba(0,0,0,0.7)',
        paddingTop: 'env(safe-area-inset-top)',
      }}
      onClick={handleDismiss}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="What is Peanut Gallery?"
        className="w-full rounded-t-3xl flex flex-col relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#111',
          borderTop: '1px solid #222',
          maxHeight: '85dvh',
          transform: `translateY(${dragY}px)`,
          transition: isDragging.current ? 'none' : 'transform 0.25s ease-out',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Drag handle + header — swipe-down target */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Drag handle */}
          <div className="flex justify-center py-3">
            <div className="w-9 h-1 rounded-full" style={{ background: '#333' }} />
          </div>

          {/* Close button — 44×44px tap target */}
          <button
            ref={closeBtnRef}
            onClick={handleDismiss}
            aria-label="Close"
            className="absolute top-3 right-3 w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: '#1e1e1e' }}
          >
            <X className="w-5 h-5" style={{ color: '#666' }} />
          </button>

          {/* Header content (non-scrollable) */}
          <div className="px-6 pt-1 pb-4">
            <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#00FF87' }}>
              ⚡ Peanut Gallery
            </p>
            <h2 className="font-display text-white mb-2" style={{ fontSize: '1.75rem', lineHeight: 1.1 }}>
              Better Seats,<br />Live At The Show
            </h2>
            <p className="text-sm" style={{ color: '#888', lineHeight: 1.6 }}>
              Buy seat upgrades directly from fans already inside the venue — payment held safely until you confirm.
            </p>
          </div>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          className="px-6 overflow-y-auto flex-1"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div className="space-y-4 mb-6">
            {[
              { Icon: Ticket, label: 'Upgrade your seats during the event', color: '#FFE600' },
              { Icon: Gift, label: 'Win free upgrades through Fan Drops', color: '#BF5FFF' },
              { Icon: ShieldCheck, label: 'Money held in escrow until you confirm', color: '#00FF87' },
            ].map(({ Icon, label, color }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}15` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <p className="text-sm font-medium text-white">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky footer with CTA */}
        <div className="px-6 pt-3 pb-6 flex-shrink-0" style={{ background: '#111', borderTop: '1px solid #1a1a1a' }}>
          <button
            onClick={handleDismiss}
            className="w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, #00FF87, #00C8FF)',
              color: '#000',
            }}
          >
            <Zap className="w-4 h-4" /> Got it, let's go
          </button>
          <p className="text-center text-xs mt-3" style={{ color: '#444' }}>
            This won't show again
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}