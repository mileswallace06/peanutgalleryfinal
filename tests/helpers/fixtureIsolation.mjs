import assert from 'node:assert/strict';

// Install before opening a page. The recorder lives in Node, so reload/navigation
// cannot erase a denied attempt and caught errors cannot silently pass the gate.
export async function installFixtureIsolation(context, { origin, documentPaths, attempts = [] }) {
  const base = new URL(origin);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && base.protocol === 'http:' && !base.username && !base.password, 'Fixtures require a local HTTP origin');
  assert.equal(base.origin, origin, 'Use the exact fixture origin');
  const record = entry => attempts.push(entry);
  const asset = pathname => /^\/(?:src\/|tests\/(?:fixtures|helpers)\/|node_modules\/|@vite\/|@fs\/|@id\/|@react-refresh$|assets\/|base44\/shared\/[^?]+\.(?:js|mjs|ts)$)/.test(pathname) || pathname === '/favicon.ico';
  await context.exposeBinding('__PG_ISOLATION_REPORT__', (_source, entry) => record(entry));
  await context.route('**/*', route => {
    const request = route.request(), target = new URL(request.url());
    const document = request.resourceType() === 'document';
    if (target.origin === origin && ['GET', 'HEAD'].includes(request.method()) && (document ? documentPaths.includes(target.pathname) : asset(target.pathname))) return route.continue();
    record({ kind: 'request', method: request.method(), url: target.href, resourceType: request.resourceType() });
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    record({ kind: 'websocket', url: socket.url() });
    socket.close();
  });
  await context.addInitScript(({ origin }) => {
    const pending = new Set();
    const report = entry => {
      const promise = window.__PG_ISOLATION_REPORT__(entry);
      pending.add(promise);
      promise.catch(() => {}).finally(() => pending.delete(promise));
    };
    window.__PG_RECORD_FIXTURE_BLOCK__ = report;
    window.__PG_FLUSH_FIXTURE_BLOCKS__ = () => Promise.allSettled([...pending]);
    const protect = (target, key, value) => Object.defineProperty(target, key, { configurable: false, get: () => value, set() {} });
    const forbidden = (kind, url = '') => {
      report({ kind, url: String(url) });
      throw new Error(`Isolated fixture forbids ${kind}: ${url}`);
    };
    const nativeFetch = window.fetch.bind(window);
    protect(window, 'fetch', (input, init) => {
      const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = (init?.method || input?.method || 'GET').toUpperCase();
      const asset = /^\/(?:src\/|tests\/(?:fixtures|helpers)\/|node_modules\/|@vite\/|@fs\/|@id\/|@react-refresh$|assets\/|base44\/shared\/[^?]+\.(?:js|mjs|ts)$)/.test(target.pathname);
      if (target.origin === origin && ['GET', 'HEAD'].includes(method) && asset) return nativeFetch(input, init);
      report({ kind: 'fetch', method, url: target.href });
      return Promise.reject(new Error('Isolated fixture blocks application fetch'));
    });
    protect(XMLHttpRequest.prototype, 'open', function (_method, url) { forbidden('xhr', url); });
    protect(navigator, 'sendBeacon', url => { report({ kind: 'beacon', url: String(url) }); return false; });
    protect(window, 'WebSocket', function (url) { forbidden('websocket', url); });
    protect(window, 'EventSource', function (url) { forbidden('eventsource', url); });
    protect(window, 'Worker', function (url) { forbidden('worker', url); });
    protect(window, 'SharedWorker', function (url) { forbidden('sharedworker', url); });
    if (navigator.serviceWorker) protect(navigator.serviceWorker, 'register', url => { forbidden('serviceworker', url); });
    document.addEventListener('securitypolicyviolation', event => report({ kind: 'csp', url: event.blockedURI, directive: event.violatedDirective }));
  }, { origin });
  const assertClean = async () => {
    for (const page of context.pages()) if (!page.isClosed()) await page.evaluate(() => window.__PG_FLUSH_FIXTURE_BLOCKS__?.());
    assert.deepEqual(attempts, [], 'No forbidden network or SDK attempts, including caught failures and earlier documents');
  };
  // Every existing close boundary becomes a mandatory check before disposal.
  const close = context.close.bind(context);
  context.close = async (...args) => { try { await assertClean(); } finally { await close(...args); } };
  return { attempts, assertClean };
}

// Test rendering has always used fallback fonts because fixture CSP disallows
// Google Fonts. Remove only that known import before browser execution so an
// intentional fixture omission is not an unobserved CSP/network attempt.
export function fixtureSourceIsolation() {
  const stripeId = '\0isolated-fixture-stripe';
  const logo = 'https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png';
  const fixtureLogo = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%23192238%22/%3E%3Ctext x=%2250%22 y=%2263%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2238%22%3EPG%3C/text%3E%3C/svg%3E';
  const knownHeroImages = [
    'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=900&q=80',
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&q=90',
    'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1200&q=90',
  ];
  const fixtureHero = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#192238"/><text x="800" y="450" text-anchor="middle" fill="#a8b6d4" font-size="50">Fictional event image</text></svg>');
  return {
    name: 'fixture-source-isolation', enforce: 'pre',
    configureServer(server) {
      // Vite still injects its client when hmr:false. Its CSS helpers are useful,
      // but its reconnect loop must not initiate sockets in a frozen fixture.
      server.middlewares.use((request, response, next) => {
        if (new URL(request.url, 'http://fixture.invalid').pathname !== '/@vite/client') return next();
        response.setHeader('Content-Type', 'application/javascript');
        response.end(`
          const styles = new Map();
          export function updateStyle(id, css) { let node=styles.get(id); if(!node){node=document.createElement('style');node.dataset.viteDevId=id;document.head.appendChild(node);styles.set(id,node);} node.textContent=css; }
          export function removeStyle(id) { styles.get(id)?.remove(); styles.delete(id); }
          export function createHotContext() { return {data:{},accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){}}; }
          export function injectQuery(url, query) { return url+(url.includes('?')?'&':'?')+query; }
        `);
      });
    },
    resolveId(id) {
      if (id === '@base44/sdk' || id.startsWith('@base44/sdk/')) throw new Error('Production Base44 SDK cannot enter an isolated fixture');
      if (id === '@stripe/stripe-js' || id === '@stripe/stripe-js/pure') return stripeId;
    },
    load(id) {
      if (id === stripeId) return `export async function loadStripe() { window.__PG_RECORD_FIXTURE_BLOCK__?.({kind:'provider',name:'Stripe.loadStripe'}); throw new Error('Stripe execution is forbidden in isolated fixtures'); }`;
    },
    transform(code, id) {
      if (id.split('?')[0].endsWith('/src/index.css')) return code.replace(/^@import url\('https:\/\/fonts\.googleapis\.com\/css2\?[^']+'\);\r?\n/, '/* Fixture uses local fallback fonts. */\n');
      if (id.includes('/src/')) {
        let fixtureCode = code.replaceAll(logo, fixtureLogo);
        for (const image of knownHeroImages) fixtureCode = fixtureCode.replaceAll(image, fixtureHero);
        if (fixtureCode !== code) return fixtureCode;
      }
    },
  };
}
