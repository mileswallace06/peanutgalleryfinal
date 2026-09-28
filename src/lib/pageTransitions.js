import { useRef, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';

const reducedMotionQuery = () => typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;
const reducedMotionSnapshot = () => reducedMotionQuery()?.matches ?? false;
const reducedMotionServerSnapshot = () => false;

function subscribeToReducedMotion(onChange) {
  const query = reducedMotionQuery();
  if (!query) return () => {};
  if (query.addEventListener) {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  // Older iOS WebViews expose the legacy MediaQueryList listener API.
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

/** Keep mounted tabs in sync when the device's motion preference changes. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeToReducedMotion, reducedMotionSnapshot, reducedMotionServerSnapshot);
}

/**
 * iOS-native page transition variants.
 * - forward (push): new page slides in from right, old page nudges left
 * - backward (pop): new page slides in from left, old page slides out right
 * - tab (switch): cross-fade
 */
export const pageVariants = {
  initial: (direction) => ({
    x: direction === 'forward' ? '100%' : direction === 'backward' ? '-25%' : 0,
    opacity: 0,
  }),
  animate: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
  },
  exit: (direction) => ({
    x: direction === 'forward' ? '-25%' : direction === 'backward' ? '100%' : 0,
    opacity: 0,
    transition: { duration: 0.15, ease: [0.32, 0.72, 0, 1] },
  }),
};

export const reducedPageVariants = {
  initial: { x: 0, opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { duration: 0 } },
  exit: { x: 0, opacity: 0, transition: { duration: 0 } },
};

/**
 * Determine navigation direction based on path depth and tab segment.
 */
export function getNavigationDirection(prevPath, currPath) {
  const getTab = (p) => p.split('/').filter(Boolean)[0] || '';
  const getDepth = (p) => p.split('/').filter(Boolean).length;

  if (getTab(prevPath) !== getTab(currPath)) return 'tab';
  if (getDepth(currPath) > getDepth(prevPath)) return 'forward';
  if (getDepth(currPath) < getDepth(prevPath)) return 'backward';
  return 'forward';
}

/**
 * Track navigation direction across renders.
 * Uses a ref so the direction stays stable between pathname changes
 * (AnimatePresence reads `custom` for exit animations).
 */
export function useNavigationDirection() {
  const location = useLocation();
  const stateRef = useRef({ prevPath: location.pathname, direction: 'forward' });

  if (stateRef.current.prevPath !== location.pathname) {
    stateRef.current = {
      prevPath: location.pathname,
      direction: getNavigationDirection(stateRef.current.prevPath, location.pathname),
    };
  }

  return stateRef.current.direction;
}
