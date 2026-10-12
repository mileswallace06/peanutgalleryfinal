/** Local-only legal UI regression checks. Start the ticket-design Vite fixture.
 * PG_LEGAL_REVIEW_URL=http://127.0.0.1:4174 node tests/legal-document-browser.mjs
 * The root fixture replaces Usercentrics with synthetic five-column content.
 * MemoryRouter Back/Forward is exercised via its test harness, not a production session.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = new URL(process.env.PG_LEGAL_REVIEW_URL || 'http://127.0.0.1:4174');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Legal UI checks require an isolated local fixture');
let playwright;
if (process.env.PG_PLAYWRIGHT_MODULE) playwright = await import(pathToFileURL(process.env.PG_PLAYWRIGHT_MODULE).href);
else {
  try { playwright = await import('playwright'); }
  catch { playwright = await import('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
}
const { chromium } = playwright;
const executablePath = process.env.PG_CHROMIUM_PATH || process.env.PG_TEST_CHROMIUM;
const browserArgs = process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [];
assert.ok(Array.isArray(browserArgs) && browserArgs.every(value => typeof value === 'string'));
const browser = await chromium.launch({ headless: true, args: browserArgs, ...(executablePath ? { executablePath } : {}) });
let server;
if (process.env.PG_LEGAL_START_FIXTURE === '1') {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: 'tests/fixtures/ticket-design/vite.config.mjs', server: { host: '127.0.0.1', port: Number(base.port), strictPort: true, watch: null, hmr: false } });
  await server.listen();
}
const evidence = process.env.PG_LEGAL_EVIDENCE_DIR || '/tmp/pg-legal-browser';
await mkdir(evidence, { recursive: true });
const report = { fixtureOnly: true, checks: [], screenshots: [], errors: [], externalRequests: [], limits: ['Synthetic policy-provider content', 'MemoryRouter navigation history; no production browser session', 'Zoom uses CSS zoom emulation; no physical device or assistive-technology test'] };
const fixtureUrl = (route, theme, extra = {}) => `${base.origin}/tests/fixtures/ticket-design/app.html?${new URLSearchParams({ route, theme, auth: 'guest', ...extra })}`;

async function setup(width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.origin === base.origin || ['data:', 'blob:'].includes(target.protocol)) return route.continue();
    report.externalRequests.push({ origin: target.origin, path: target.pathname, method: route.request().method() });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  return { context, page, width, height, theme };
}
async function semanticPage(page, title) {
  await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor();
  assert.equal(await page.getByRole('main', { name: title, exact: true }).count(), 1);
  assert.equal(await page.locator('h1').count(), 1, `${title} has one document h1`);
  const levels = await page.locator('h1,h2,h3,h4,h5,h6').evaluateAll(nodes => nodes.map(node => Number(node.tagName.slice(1))));
  assert.ok(levels.every((level, index) => index === 0 || level <= levels[index - 1] + 1), `${title} has no skipped heading levels`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'No page-wide horizontal overflow');
}
async function checkFixture(page) {
  const state = await page.evaluate(() => ({ unexpected: window.ticketDesignFixture?.unexpected || [], blocked: window.ticketDesignFixture?.blocked || [] }));
  assert.deepEqual(state, { unexpected: [], blocked: [] });
}
async function fragmentVisible(page, id) {
  await page.waitForFunction(id => {
    const target = document.getElementById(id);
    const header = document.querySelector('.pg-public-header');
    if (!target || !header) return false;
    const title = target.matches('h1,h2,h3,h4,h5,h6') ? target : target.querySelector('h1,h2,h3,h4,h5,h6') || target;
    const box = title.getBoundingClientRect();
    return box.top >= header.getBoundingClientRect().bottom + 8 && box.bottom <= innerHeight && (document.activeElement === target || target.contains(document.activeElement));
  }, id);
  assert.equal(await page.evaluate(id => {
    const target = document.getElementById(id);
    return document.activeElement === target || target.contains(document.activeElement);
  }, id), true, `Fragment ${id} moves focus into its target`);
}

try {
  for (const [width, height] of [[320, 844], [375, 844], [390, 844], [430, 844], [1280, 900], [844, 390]]) {
    for (const theme of ['light', 'dark']) {
      const { context, page } = await setup(width, height, theme);
      assert.deepEqual(page.viewportSize(), { width, height }, 'Reported viewport is the actual browser viewport');
      await page.goto(fixtureUrl('/privacy', theme));
      const region = page.getByRole('region', { name: /scroll horizontally to view all columns/ }).first();
      await region.waitFor();
      await semanticPage(page, 'Privacy Policy');
      const layout = await region.evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth, columns: [...node.querySelector('tr').cells].map(cell => cell.getBoundingClientRect().width) }));
      assert.equal(layout.columns.length, 5);
      assert.ok(layout.columns.every(width => width >= 80), 'Every policy column has a readable nonzero width');
      assert.ok(layout.scroll > layout.client, 'Wide privacy table is contained in a horizontal scroll region');
      await region.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.pg-legal-table-scroll').scrollLeft > 0);
      await region.evaluate(node => { node.scrollLeft = 0; });
      await region.hover();
      await page.mouse.wheel(800, 0);
      await page.waitForFunction(() => document.querySelector('.pg-legal-table-scroll').scrollLeft > 0);
      const lastLink = region.getByRole('link').last();
      await region.focus();
      for (let index = 0; index < await region.getByRole('link').count(); index++) await page.keyboard.press('Tab');
      assert.equal(await lastLink.evaluate(node => node === document.activeElement), true);
      assert.ok((await lastLink.innerText()).trim().length > 4, 'Last-column link remains labeled and reachable');
      assert.equal(await region.locator('th:not([scope])').count(), 0, 'Headers preserve explicit table column relationships');
      if ([375, 1280].includes(width)) {
        await page.evaluate(() => window.__PG_REVIEW_NAVIGATE__('/privacy#providers'));
        await fragmentVisible(page, 'providers');
        await region.evaluate(node => { node.scrollLeft = 0; });
        const path = join(evidence, `privacy-${width}-${theme}.png`);
        await page.screenshot({ path }); report.screenshots.push(path);
        await region.evaluate(node => { node.scrollLeft = node.scrollWidth; });
        const finalColumnPath = join(evidence, `privacy-${width}-${theme}-last-column.png`);
        await page.screenshot({ path: finalColumnPath }); report.screenshots.push(finalColumnPath);
      }
      await checkFixture(page);
      report.checks.push(`Privacy ${width}×${height} ${theme}: five visible-width columns, no page overflow, keyboard/pointer scroll, final link focus, main/h1/table semantics`);

      // The provider first appends its table, then adds a later section. The
      // fragment must resolve after that second update at every real viewport.
      await page.goto(fixtureUrl('/privacy#privacy-rights', theme, { policyDelay: '80', policyStages: '1' }));
      await fragmentVisible(page, 'privacy-rights');
      await semanticPage(page, 'Privacy Policy');
      await page.reload();
      await fragmentVisible(page, 'privacy-rights');
      await page.evaluate(() => window.__PG_REVIEW_NAVIGATE__('/privacy#providers'));
      await fragmentVisible(page, 'providers');
      await page.evaluate(() => window.__PG_REVIEW_NAVIGATE__(-1));
      await fragmentVisible(page, 'privacy-rights');
      await page.evaluate(() => window.__PG_REVIEW_NAVIGATE__(1));
      await fragmentVisible(page, 'providers');
      await checkFixture(page);
      report.checks.push(`Privacy ${width}×${height} ${theme}: delayed two-stage content, direct/reload fragment, Back/Forward, reduced motion and exact target focus`);

      await page.goto(fixtureUrl('/terms#returnno', theme));
      await semanticPage(page, 'Terms of Service');
      await fragmentVisible(page, 'returnno');
      const refundCopy = page.getByText('All sales are final and no refund will be issued.', { exact: true });
      assert.ok(await refundCopy.isVisible());
      assert.ok((await refundCopy.boundingBox()).y >= (await page.locator('.pg-public-header').boundingBox()).height, 'First refund sentence is below sticky header');
      await page.reload();
      await fragmentVisible(page, 'returnno');
      if (width === 375) {
        const path = join(evidence, `terms-refund-${width}-${theme}.png`);
        await page.screenshot({ path }); report.screenshots.push(path);
      }
      await checkFixture(page);
      report.checks.push(`Terms ${width}×${height} ${theme}: direct/reloaded refund fragment, heading/body below header, focus, reduced motion`);
      await context.close();
    }
  }

  for (const theme of ['light', 'dark']) {
    const { context, page } = await setup(1280, 900, theme);
    await page.goto(fixtureUrl('/terms', theme));
    await semanticPage(page, 'Terms of Service');
    const ids = await page.locator('main a[href^="#"]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('href').slice(1)))]);
    assert.ok(ids.length >= 31);
    for (const id of ids) {
      await page.locator(`main a[href="#${id}"]`).first().click();
      await fragmentVisible(page, id);
    }
    await page.evaluate(() => window.__PG_REVIEW_NAVIGATE__('/terms#returnno'));
    await fragmentVisible(page, 'returnno');
    await page.evaluate(() => window.__PG_REVIEW_NAVIGATE__('/terms#purchases'));
    await fragmentVisible(page, 'purchases');
    await page.evaluate(() => window.__PG_REVIEW_NAVIGATE__(-1));
    await fragmentVisible(page, 'returnno');
    await page.evaluate(() => window.__PG_REVIEW_NAVIGATE__(1));
    await fragmentVisible(page, 'purchases');
    report.checks.push(`Terms ${theme}: every ${ids.length} ToC target and MemoryRouter Back/Forward keeps heading visible and focused`);

    await page.goto(fixtureUrl('/privacy#privacy-rights', theme));
    await fragmentVisible(page, 'privacy-rights');
    await semanticPage(page, 'Privacy Policy');
    await page.reload();
    await fragmentVisible(page, 'privacy-rights');
    report.checks.push(`Privacy ${theme}: direct/reloaded fragment restored after asynchronous policy mount`);

    await page.goto(fixtureUrl('/cookies', theme));
    await semanticPage(page, 'Cookie Policy');
    assert.equal(await page.locator('main h2').count(), 7);
    report.checks.push(`Cookies ${theme}: named main, one h1 and seven h2 sections`);

    await page.goto(fixtureUrl('/privacy', theme));
    await page.getByRole('region', { name: /scroll horizontally to view all columns/ }).first().waitFor();
    for (const factor of [2, 4]) {
      await page.evaluate(factor => { document.documentElement.style.zoom = String(factor); }, factor);
      await semanticPage(page, 'Privacy Policy');
      const widths = await page.locator('.pg-legal-table-scroll').first().locator('tr').first().locator('th,td').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
      assert.ok(widths.every(width => width > 0));
      report.checks.push(`Privacy ${theme}: ${factor * 100}% CSS zoom emulation, all columns retained with no page overflow`);
    }
    await checkFixture(page);
    await context.close();
  }
  assert.deepEqual(report.errors, [], 'No browser runtime errors');
  assert.deepEqual(report.externalRequests, [], 'No external requests attempted (policy provider must be stubbed by fixture)');
  report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED';
  report.failure = error.message;
  throw error;
} finally {
  await writeFile(join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  await server?.close();
}
console.log(JSON.stringify(report, null, 2));
