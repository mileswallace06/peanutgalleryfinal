document.documentElement.classList.toggle('dark', new URLSearchParams(location.search).get('theme') === 'dark');
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const method = (init?.method || input?.method || 'GET').toUpperCase();
  if (url.origin === location.origin && ['GET', 'HEAD'].includes(method) && /^\/(src\/|tests\/fixtures\/|node_modules\/|@vite\/|@fs\/|@id\/|@react-refresh)/.test(url.pathname)) return originalFetch(input, init);
  return Promise.reject(new Error('Fixture blocks all application network requests'));
};
XMLHttpRequest.prototype.open = function () { throw new Error('Fixture blocks XMLHttpRequest'); };
if (navigator.sendBeacon) navigator.sendBeacon = () => false;
