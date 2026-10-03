import { useEffect, useState } from 'react';
import { getUpgradeEventState } from '@/lib/upgradeEventState';

/** Keep the countdown and live badge on the same clock, including a resumed tab. */
export function useUpgradeClock(event) {
  const [nowMs, setNowMs] = useState(Date.now);

  useEffect(() => {
    if (!event) return;
    let timer;
    const update = () => {
      clearTimeout(timer);
      const now = Date.now();
      setNowMs(now);
      const timing = getUpgradeEventState(event, now);
      const nextTick = timing.beforeShowtime ? Math.min(1000, timing.start_utc_ms - now)
        : timing.isLive && timing.end_utc_ms > now ? Math.min(15000, timing.end_utc_ms - now) : 15000;
      timer = setTimeout(update, nextTick);
    };
    const onVisible = () => { if (!document.hidden) update(); };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [event]);

  return nowMs;
}
