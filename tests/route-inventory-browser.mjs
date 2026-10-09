/** Nonmutating route smoke/title inventory against the isolated full-router fixture.
 * PG_ROUTE_REVIEW_URL=http://127.0.0.1:4181 PG_ROUTE_START_FIXTURE=1 node tests/route-inventory-browser.mjs
 * Every route gets a real local render. Missing fixture reads and blocked writes
 * are reported as fixture-blocked, never counted as passing workflow coverage.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { titleForRoute } from '../src/lib/routeMetadata.js';

const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const patterns = [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(patterns).size, patterns.length, 'Route patterns must be unique');
assert.ok(patterns.includes('*'));
const paths = {
  '/listings/:listingId': '/listings/fixture-seller-active', '/events/:id': '/events/fixture-night',
  '/events/tm/:tmId': '/events/tm/tm-fixture-night', '/purchase/:id': '/purchase/fixture-received',
  '/upgrades/:id': '/upgrades/fixture-live', '/event-mode/:id': '/event-mode/fixture-live',
  '/create-listing': '/create-listing?event_id=fixture-live', '*': '/fixture-missing-route',
};
const publicPatterns = new Set(['/', '/login', '/register', '/forgot-password', '/reset-password', '/terms', '/privacy', '/cookies', '/our-story', '/listings/:listingId', '/help', '*']);
const base = new URL(process.env.PG_ROUTE_REVIEW_URL || 'http://127.0.0.1:4181');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
let playwright;
if (process.env.PG_PLAYWRIGHT_MODULE) playwright = await import(pathToFileURL(process.env.PG_PLAYWRIGHT_MODULE).href);
else { try { playwright = await import('playwright'); } catch { playwright = await import('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); } }
const browserArgs = process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [];
assert.ok(Array.isArray(browserArgs) && browserArgs.every(arg => typeof arg === 'string'));
const executablePath = process.env.PG_CHROMIUM_PATH || process.env.PG_TEST_CHROMIUM;
const browser = await playwright.chromium.launch({ headless: true, args: browserArgs, ...(executablePath ? { executablePath } : {}) });
let server;
if (process.env.PG_ROUTE_START_FIXTURE === '1') {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: 'tests/fixtures/ticket-design/vite.config.mjs', server: { host: '127.0.0.1', port: Number(base.port), strictPort: true, watch: null, hmr: false } });
  await server.listen();
}
const evidence = process.env.PG_ROUTE_EVIDENCE_DIR || '/tmp/pg-route-inventory';
await mkdir(evidence, { recursive: true });
const report = {
  fixtureOnly: true, explicitPatterns: patterns.filter(pattern => pattern !== '*').length, wildcard: patterns.includes('*'), patterns,
  cases: [], titleHistory: [], screenshots: [],
  limitations: [
    'Route smoke and document-title checks only; no financial or privileged action was clicked',
    'Synthetic SDK/Auth data, locally stubbed provider policy and images; no external provider code or live account',
    'Guest/member/admin are fixture roles, not an authorization or financial-security certification',
    'MemoryRouter Back/Forward; actual production BrowserRouter history and native device behavior remain unverified',
    'Loading/populated/empty/error coverage is supplied by focused suites; this inventory does not claim every state for every route',
  ],
};
const fixtureUrl = (path, role, theme) => `${base.origin}/tests/fixtures/ticket-design/app.html?${new URLSearchParams({ route: path, auth: role === 'guest' ? 'guest' : 'member', role, theme })}`;
const placeholder = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#5c3c89"/><text x="6" y="36" fill="white" font-size="10">Fixture</text></svg>';

async function session(role, theme, width = 390, height = 844) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const state = { errors: [], assets: [], blockedNetwork: [] };
  await context.route('**/*', route => {
    const request = route.request(), target = new URL(request.url());
    if (target.origin === base.origin || ['data:', 'blob:'].includes(target.protocol)) return route.continue();
    const record = { method: request.method(), origin: target.origin, path: target.pathname, resource: request.resourceType() };
    if (request.method() === 'GET' && request.resourceType() === 'image') {
      state.assets.push(record);
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: placeholder });
    }
    state.blockedNetwork.push(record);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => state.errors.push(error.message));
  return { context, page, state, role, theme, width, height };
}
async function settle(page) {
  await page.waitForFunction(() => window.__PG_REVIEW_LOCATION__ && !document.querySelector('[aria-label="Loading page"]'));
  // Allow delayed initial effects (including search debounce) to run, then wait
  // for three stable samples of SDK calls and route identity. No action is taken.
  await page.evaluate(() => new Promise(resolve => {
    const started = performance.now();
    let previous = '', stable = 0;
    const sample = () => {
      const value = `${window.__PG_REVIEW_LOCATION__?.pathname}:${window.ticketDesignFixture?.calls?.length || 0}`;
      stable = value === previous ? stable + 1 : 0;
      previous = value;
      if ((performance.now() - started >= 700 && stable >= 3) || performance.now() - started > 4000) return resolve();
      setTimeout(sample, 75);
    };
    sample();
  }));
}
async function observe(fixture, pattern, { representative = false } = {}) {
  const { page, state, role, theme, width, height } = fixture;
  state.errors.length = 0; state.assets.length = 0; state.blockedNetwork.length = 0;
  const path = paths[pattern] || pattern;
  const row = { pattern, requestedPath: path, role, theme, viewport: { width, height }, representative, status: 'tested' };
  try {
    await page.goto(fixtureUrl(path, role, theme));
    await settle(page);
    const snapshot = await page.evaluate(() => ({
      finalPath: window.__PG_REVIEW_LOCATION__?.pathname || '', finalSearch: window.__PG_REVIEW_LOCATION__?.search || '', title: document.title,
      headings: [...document.querySelectorAll('h1,h2')].slice(0, 8).map(node => node.textContent.trim()),
      bodyLength: document.body.innerText.trim().length,
      unexpectedReads: window.ticketDesignFixture?.unexpected || [], blockedWrites: window.ticketDesignFixture?.blocked || [],
      localFixtureMutations: (window.ticketDesignFixture?.calls || []).filter(call => /\.(create|update|delete|bulkCreate)$/.test(call.name)).map(call => call.name),
      fixtureError: !![...document.querySelectorAll('h1')].find(node => node.textContent === 'Visual review fixture error'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    Object.assign(row, snapshot, { runtimeErrors: [...state.errors], stubbedImageCount: state.assets.length, blockedNetwork: [...state.blockedNetwork] });
    row.expectedTitle = titleForRoute(snapshot.finalPath);
    row.titlePass = snapshot.title === row.expectedTitle && !/Peanut Gallery Final/i.test(snapshot.title);
    row.scope = role === 'guest' && !publicPatterns.has(pattern) ? 'Guest guard/Sign In redirect only; protected workflow not applicable' : snapshot.finalPath !== path.split('?')[0] ? 'Redirect/alias presentation only' : 'Initial route rendering only';
    if (role === 'guest' && !publicPatterns.has(pattern) && snapshot.finalPath !== '/login') row.guestGuardFailure = true;
    if (snapshot.unexpectedReads.length || snapshot.blockedWrites.length || state.blockedNetwork.length) row.status = 'fixture-blocked';
    else if (snapshot.fixtureError || state.errors.length || !snapshot.bodyLength || !row.titlePass || row.guestGuardFailure || snapshot.overflow) row.status = 'failed';
    if (representative && !snapshot.fixtureError) {
      const name = `${pattern.replace(/[^a-z0-9]+/gi, '-') || 'home'}-${role}-${theme}-${width}x${height}.png`;
      const target = join(evidence, name);
      await page.screenshot({ path: target }); report.screenshots.push(target);
    }
  } catch (error) {
    row.status = 'failed'; row.failure = error.message;
    row.runtimeErrors = [...state.errors]; row.blockedNetwork = [...state.blockedNetwork];
    const boundary = await page.evaluate(() => ({ unexpectedReads: window.ticketDesignFixture?.unexpected || [], blockedWrites: window.ticketDesignFixture?.blocked || [] })).catch(() => ({}));
    Object.assign(row, boundary);
    if (boundary.unexpectedReads?.length || boundary.blockedWrites?.length || state.blockedNetwork.length) row.status = 'fixture-blocked';
  }
  // Only the documented founder alert side effect may remain a nonfailing
  // fixture coverage gap. New SDK reads, writes or outbound requests must fail
  // CI rather than quietly weakening the boundary to accommodate a regression.
  if (row.status === 'fixture-blocked') row.knownFixtureBlocker = (
    row.pattern === '/founder' && row.role === 'admin'
    && row.blockedWrites?.length > 0 && row.blockedWrites.every(name => name === 'entities.AdminAlert.create')
    && !row.unexpectedReads?.length && !row.blockedNetwork?.length && !row.runtimeErrors?.length
    && !row.failure && !row.fixtureError && !row.overflow && !!row.bodyLength && row.titlePass === true
  );
  report.cases.push(row);
  return row;
}
async function checkTitleHistory(role, theme) {
  const fixture = await session(role, theme);
  const { page, context } = fixture;
  const results = [];
  try {
    await page.goto(fixtureUrl('/help', role, theme)); await settle(page);
    for (const [destination, expectedPath] of [['/terms#returnno', '/terms'], ['/cookies', '/cookies'], [-1, '/terms'], [1, '/cookies'], ['/events', role === 'guest' ? '/login' : '/events'], ['/event-mode/fixture-live', role === 'guest' ? '/login' : '/upgrades/fixture-live']]) {
      await page.evaluate(destination => window.__PG_REVIEW_NAVIGATE__(destination), destination);
      await page.waitForFunction(({ path, title }) => window.__PG_REVIEW_LOCATION__?.pathname === path && document.title === title, { path: expectedPath, title: titleForRoute(expectedPath) });
      results.push({ destination, finalPath: expectedPath, title: await page.title(), status: 'tested' });
    }
    report.titleHistory.push({ role, theme, status: 'tested', cases: results });
  } catch (error) { report.titleHistory.push({ role, theme, status: 'failed', cases: results, failure: error.message }); }
  finally { await context.close(); }
}

try {
  for (const theme of ['light', 'dark']) {
    await Promise.all(['guest', 'member', 'admin'].map(async role => {
      const fixture = await session(role, theme);
      try {
        for (const pattern of patterns) await observe(fixture, pattern);
        console.log(`Route inventory ${role}/${theme}: ${patterns.length} route states recorded`);
      } finally { await fixture.context.close(); }
    }));
  }
  for (const [width, height] of [[320, 844], [375, 844], [430, 844], [1280, 900], [844, 390]]) {
    for (const theme of ['light', 'dark']) {
      for (const [role, pattern] of [['guest', '/login'], ['member', '/events']]) {
        const fixture = await session(role, theme, width, height);
        try { await observe(fixture, pattern, { representative: true }); }
        finally { await fixture.context.close(); }
      }
    }
  }
  for (const role of ['guest', 'member', 'admin']) for (const theme of ['light', 'dark']) await checkTitleHistory(role, theme);
  report.summary = {
    cases: report.cases.length,
    tested: report.cases.filter(row => row.status === 'tested').length,
    fixtureBlocked: report.cases.filter(row => row.status === 'fixture-blocked').length,
    unexpectedFixtureBlockers: report.cases.filter(row => row.status === 'fixture-blocked' && !row.knownFixtureBlocker).length,
    failed: report.cases.filter(row => row.status === 'failed').length,
    titleMismatches: report.cases.filter(row => row.titlePass === false).length,
    historyFailures: report.titleHistory.filter(row => row.status === 'failed').length,
    overflowCases: report.cases.filter(row => row.overflow).map(({ pattern, role, theme, viewport }) => ({ pattern, role, theme, viewport })),
  };
  report.status = report.summary.failed || report.summary.titleMismatches || report.summary.historyFailures || report.summary.unexpectedFixtureBlockers ? 'FAILED' : report.summary.fixtureBlocked ? 'COMPLETED_WITH_FIXTURE_BLOCKERS' : 'PASSED';
  // Fixture coverage gaps are explicitly reported; real assertion/render/title
  // failures still fail CI. Workflow completeness must not be inferred here.
  if (report.status === 'FAILED') process.exitCode = 1;
} finally {
  await writeFile(join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await server?.close();
}
console.log(JSON.stringify({ status: report.status, summary: report.summary, evidence: join(evidence, 'result.json') }, null, 2));
