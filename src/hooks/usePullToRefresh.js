import { useEffect, useRef, useState } from 'react';

export function usePullToRefresh(onRefresh, threshold = 60) {
  const containerRef = useRef(null);
  const startYRef = useRef(0);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e) => {
      startYRef.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e) => {
      if (container.scrollTop !== 0) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;

      if (diff > 0) {
        setPulling(true);
        container.style.transform = `translateY(${Math.min(diff, threshold)}px)`;
      }
    };

    const handleTouchEnd = () => {
      const transform = container.style.transform;
      const match = transform.match(/translateY\((\d+)px\)/);
      const distance = match ? parseInt(match[1]) : 0;

      if (distance > threshold) {
        onRefresh?.();
      }

      container.style.transform = '';
      setPulling(false);
    };

    container.addEventListener('touchstart', handleTouchStart);
    container.addEventListener('touchmove', handleTouchMove);
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onRefresh, threshold]);

  return { containerRef, pulling };
}