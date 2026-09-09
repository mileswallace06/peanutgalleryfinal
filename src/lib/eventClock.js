// The minute tick only redraws local timing. Foreground refreshes reuse tmCache.
export function subscribeEventClock({ document, window, onTick, onForeground,
  now = Date.now, setInterval = globalThis.setInterval, clearInterval = globalThis.clearInterval }) {
  const tick = () => { if (document.visibilityState !== 'hidden') onTick(now()); };
  const foreground = () => {
    if (document.visibilityState === 'hidden') return;
    tick();
    onForeground();
  };
  const timer = setInterval(tick, 60000);
  document.addEventListener('visibilitychange', foreground);
  window.addEventListener('pageshow', foreground);
  window.addEventListener('focus', foreground);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', foreground);
    window.removeEventListener('pageshow', foreground);
    window.removeEventListener('focus', foreground);
  };
}
