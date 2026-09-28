import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Zap, X, ShieldCheck, Ticket, Gift } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import './upgrades-explainer.css';

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
      className="pg-upgrade-explainer-backdrop"
      onClick={handleDismiss}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="What is Peanut Gallery?"
        className="pg-upgrade-explainer"
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: `translateY(${dragY}px)`,
          transition: isDragging.current ? 'none' : 'transform 0.25s ease-out',
        }}
      >
        {/* Drag handle + header — swipe-down target */}
        <div
          className="pg-upgrade-explainer-header"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Drag handle */}
          <div className="pg-upgrade-explainer-handle">
            <div />
          </div>

          {/* Close button — 44×44px tap target */}
          <button
            ref={closeBtnRef}
            onClick={handleDismiss}
            aria-label="Close"
            className="pg-upgrade-explainer-close"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header content (non-scrollable) */}
          <div className="pg-upgrade-explainer-heading">
            <p className="pg-upgrade-explainer-eyebrow">
              ⚡ Peanut Gallery
            </p>
            <h2 className="font-display">
              Better Seats,<br />Live At The Show
            </h2>
            <p className="pg-upgrade-explainer-description">
              Buy seat upgrades directly from fans already inside the venue — payment held safely until you confirm.
            </p>
          </div>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          className="pg-upgrade-explainer-body"
        >
          <div className="pg-upgrade-explainer-features">
            {[
              { Icon: Ticket, label: 'Upgrade your seats during the event' },
              { Icon: Gift, label: 'Win free upgrades through Fan Drops' },
              { Icon: ShieldCheck, label: 'Money held in escrow until you confirm' },
            ].map(({ Icon, label }) => (
              <div key={label} className="pg-upgrade-explainer-feature">
                <div className="pg-upgrade-explainer-icon">
                  <Icon className="w-4 h-4" />
                </div>
                <p>{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky footer with CTA */}
        <div className="pg-upgrade-explainer-footer">
          <button
            onClick={handleDismiss}
            className="pg-upgrade-explainer-action"
          >
            <Zap className="w-4 h-4" /> Got it, let's go
          </button>
          <p>
            This won't show again
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
