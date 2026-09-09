// Local fixture server + actual app components. Every non-local request is blocked.
// Supply PLAYWRIGHT_MODULE when Playwright is provided by a bundled runtime.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = resolve('tests/fixtures/testflightSdk.js');
const server = await createServer({ configFile: false,
  plugins: [react(), { name: 'local-testflight-fixture', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/__testflight')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml('/__testflight', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/testflight.jsx"></script></body></html>'));
    });
  } }],
  optimizeDeps: { entries: ['tests/fixtures/testflight.jsx'] },
  server: { host: '127.0.0.1', port: 5197 },
  resolve: { alias: [{ find: '@/api/base44Client', replacement: fixture }, { find: '@/lib/AuthContext', replacement: fixture }, { find: '@', replacement: resolve('src') }] },
});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => (errors.push(error.message), console.error('Fixture page error:', error.message)));
  const open = (path, role = 'admin') => page.goto(`${origin}/__testflight?page=${encodeURIComponent(path)}&role=${role}`);
  const screenshots = await mkdtemp(join(tmpdir(), 'pg-testflight-'));
  for (const [width, height, inset] of [[390,844,47], [393,852,59], [430,932,59], [844,390,0]]) {
    await page.setViewportSize({ width, height });
    await open('/me');
    await page.locator('.profile-hero').waitFor();
    // Chromium doesn't emulate iOS env() insets. Simulate only the CSS inset;
    // these checks do not establish WKWebView/status-bar behavior on hardware.
    await page.evaluate(top => document.documentElement.style.setProperty('--safe-area-top', `${top}px`), inset);
    await page.waitForFunction(() => Math.abs(document.querySelector('.profile-hero').getBoundingClientRect().x - (innerWidth > 512 ? (innerWidth-512)/2 : 0)) < 1);
    const hero = await page.locator('.profile-hero').boundingBox();
    const edit = await page.getByRole('button', { name: 'Change profile banner' }).boundingBox();
    assert.equal(hero.y, 0); assert.equal(hero.height, 160+inset); assert.equal(edit.y, inset);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const feedbackLink = page.getByRole('link', { name: /Bugs, confusion, ideas and praise/ });
    assert.equal(await feedbackLink.count(), 1);
    if (height > width) { const box = await feedbackLink.boundingBox(); assert(box.y + box.height < height - 80, 'admin Feedback entry visible without scrolling'); }
    await page.screenshot({ path: join(screenshots, `me-${width}x${height}.png`) });
  }
  console.log('PASS: four iPhone-sized layouts; continuous hero bounds and safe edit control');
  await page.setViewportSize({ width: 393, height: 852 });
  for (const role of ['user','anonymous']) {
    await open('/beta-dashboard?view=feedback', role);
    await page.getByText('Admin only', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.feedbackReads), 0);
    assert.equal(await page.getByRole('region', { name: 'Feedback inbox' }).count(), 0);
  }
  await open('/me', 'user');
  await page.locator('.profile-hero').waitFor();
  assert.equal(await page.getByRole('link', { name: /Bugs, confusion, ideas and praise/ }).count(), 0);
  await open('/beta-dashboard?view=feedback');
  await page.getByText('Complete feedback message 0', { exact: false }).waitFor();
  assert.equal(await page.locator('article').count(), 50);
  await page.getByRole('button', { name: 'Load more' }).click();
  await page.getByText('Complete feedback message 51', { exact: false }).waitFor();
  assert.equal(await page.locator('article').count(), 52);
  for (const category of ['bug', 'confused', 'idea', 'love']) {
    await page.getByLabel('Feedback category').selectOption(category);
    await page.waitForFunction(() => document.querySelectorAll('article').length === 13);
    assert.equal(await page.locator('article time').first().getAttribute('datetime') !== null, true);
    assert.match(await page.locator('article').first().innerText(), /Second line is readable\.[\s\S]*Page: \/upgrades/);
  }
  await page.evaluate(() => { window.feedbackFailure = true; window.feedbackDelay = 300; });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('status').waitFor();
  await page.getByRole('alert').waitFor();
  await page.evaluate(() => { window.feedbackFailure = false; window.feedbackEmpty = true; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByText('No feedback in this category yet.').waitFor();
  await page.evaluate(() => { window.feedbackEmpty = false; });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Complete feedback message 3 Second line is readable.', { exact: true }).waitFor();
  await page.screenshot({ path: join(screenshots, 'feedback-inbox.png') });
  console.log('PASS: admin visibility, all categories, pagination, full text/page/time, loading/error/empty/refresh');
  await open('/upgrades');
  await page.getByRole('heading', { name: 'Local ongoing show' }).waitFor();
  await page.getByRole('heading', { name: 'Provider ongoing show' }).waitFor();
  assert.equal(await page.getByText('Estimated event window', { exact: true }).count(), 2);
  await page.reload();
  await page.getByRole('heading', { name: 'Provider ongoing show' }).waitFor();
  await page.waitForFunction(() => {
    let el = [...document.querySelectorAll('h3')].find(node => node.textContent === 'Local ongoing show');
    if (!el) return false;
    while (el) { if (Number(getComputedStyle(el).opacity) < 0.99) return false; el = el.parentElement; }
    return true;
  });
  await page.screenshot({ path: join(screenshots, 'live-now.png') });
  await page.evaluate(() => { window.fixtureNow = window.fixtureStart + 4*3600000; window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => ![...document.querySelectorAll('h3')].some(el => el.textContent === 'Local ongoing show'));
  console.log('PASS: ongoing events survive page reload and expire on foreground without a backend scheduler');
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await server.close();
}
