import { useEffect, useState } from 'react';
export function useEventClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const visible = () => { if (document.visibilityState === 'visible') update(); };
    const timer = setInterval(update, 60000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', update); };
  }, []);
  return now;
}
