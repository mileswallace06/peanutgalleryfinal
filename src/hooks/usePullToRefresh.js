import { useEffect, useRef, useState } from 'react';

export function usePullToRefresh(onRefresh, threshold = 60) {
  const containerRef = useRef(null);
  const innerRef = useRef(null);
  const startYRef = useRef(0);
  const distanceRef = useRef(0);
  const trackingRef = useRef(false);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e) => {
      distanceRef.current = 0;
      trackingRef.current = container.scrollTop === 0 && window.scrollY === 0
        && !e.target.closest('input, textarea, select, [role="listbox"], [role="combobox"]');
      startYRef.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e) => {
      if (!trackingRef.current) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;
      distanceRef.current = Math.max(0, diff);

      if (diff > 0) {
        setPulling(true);
        // Apply transform to inner element only — keeps fixed children unaffected
        const inner = innerRef.current;
        if (inner) inner.style.transform = `translateY(${Math.min(diff, threshold)}px)`;
      }
    };

    const handleTouchEnd = () => {
      const inner = innerRef.current;
      // Measure the gesture, not the capped animation. Events has no innerRef.
      if (trackingRef.current && distanceRef.current >= threshold) {
        onRefresh?.();
      }
      trackingRef.current = false;
      distanceRef.current = 0;
      if (inner) inner.style.transform = '';
      setPulling(false);
    };

    const handleTouchCancel = () => {
      trackingRef.current = false;
      handleTouchEnd();
    };

    container.addEventListener('touchstart', handleTouchStart);
    container.addEventListener('touchmove', handleTouchMove);
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [onRefresh, threshold]);

  return { containerRef, innerRef, pulling };
}
