/** Real Upgrades page, synthetic reads only; browser/SDK egress is denied. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { installFixtureIsolation, fixtureSourceIsolation } from './helpers/fixtureIsolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const modulePath = process.env.PG_PLAYWRIGHT_MODULE || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES && path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs'));
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const before = process.env.PG_EXPECT_BEFORE === '1';
const baselineCase = process.env.PG_UPGRADE_HISTORY_BASELINE_CASE || 'cross-city';
const baseline = '3a56073ba06f9f25b42844d2ca67068dafd4c554';
const beforeSources = new Map(before ? ['src/pages/Upgrades.jsx', 'src/hooks/useSellingDiscovery.js'].map(file => [path.join(root, file), execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' })]) : []);
const output = process.env.PG_UPGRADE_HISTORY_EVIDENCE_DIR || path.join(root, 'tests/artifacts/oct09-review/navigation');
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false, root, cacheDir: path.join(root, `node_modules/.vite-upgrades-history-${before ? 'before' : 'after'}`), logLevel: 'error',
  optimizeDeps: { entries: ['tests/fixtures/events-search/index.html'] },
  plugins: [fixtureSourceIsolation(), { name: 'review-before-source', enforce: 'pre', load(id) { return beforeSources.get(id); } }, react(), {
    name: 'isolated-navigation', configureServer(server) {
      server.middlewares.use((request, _response, next) => { if (/^\/(events|upgrades)([/?]|$)/.test(request.url)) request.url = '/tests/fixtures/events-search/index.html'; next(); });
    },
  }],
  resolve: { alias: [
    { find: '@/lib/AuthContext', replacement: path.join(root, 'tests/fixtures/events-search/auth.js') },
    { find: '@/lib/navLogger', replacement: path.join(root, 'tests/fixtures/events-search/navLogger.js') },
    { find: '@/api/base44Client', replacement: path.join(root, 'tests/fixtures/events-search/base44.js') },
    { find: '@', replacement: path.join(root, 'src') },
  ] },
  server: { watch: null, hmr: false, host: '127.0.0.1', port: Number(process.env.PG_FIXTURE_PORT || 5198) },
});
const report = { baseline, mode: before ? 'baseline' : 'repaired', ...(before ? { baselineCase } : {}), checks: [], outbound: [], errors: [] };
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const isolation = await installFixtureIsolation(context, { origin, documentPaths: ['/events', '/upgrades', '/events/fixture-continuation-0', '/tests/fixtures/events-search/index.html'], attempts: report.outbound });
  await context.addInitScript(() => {
    localStorage.setItem('pg_onboarded', '1');
    localStorage.setItem('pg_what_is_pg_seen_v2', '1');
    localStorage.setItem('pg_events_local_area_v1', JSON.stringify({ validated: true, city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' }));
    const event = (id, title, day, city = 'Phoenix', state = 'AZ') => ({ id, title, date: new Date(Date.UTC(2099, 0, day)).toISOString(), venue: 'Fixture Arena', city, state, venue_timezone: 'America/Phoenix', search_text_normalized: title.toLowerCase() });
    window.initialSearchFixture = { tm: [], pg: [...Array.from({ length: 130 }, (_, i) => event(`fixture-continuation-${i}`, `Continuation ${i}`, i + 1)), event('fixture-boston', 'Boston fixture', 1, 'Boston', 'MA')] };
  });
  const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const chooseCity = async (page, current, next, label) => {
    await page.getByRole('button', { name: current, exact: true }).click();
    await page.getByPlaceholder('Search city…').fill(next);
    await page.getByRole('option', { name: new RegExp(next) }).click();
    await page.getByRole('button', { name: label, exact: true }).waitFor();
  };
  for (const theme of ['dark', 'light']) {
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${origin}/upgrades`);
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await page.getByRole('button', { name: /^Upcoming/ }).waitFor();
    for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'Load more events', exact: true }).click(); await page.getByRole('button', { name: 'Load more events', exact: true }).waitFor(); }
    assert.equal(await page.locator('[id^="upgrade-event-"]').count(), 120);
    if (!before || baselineCase === 'early-target') {
      await page.getByRole('button', { name: /Continuation 0 / }).click();
      await page.getByRole('heading', { name: 'Isolated event detail' }).waitFor();
      // A document reload removes the retained list, so Back must reconstruct
      // the saved depth even though the focus target is already on page one.
      await page.reload(); await page.getByRole('heading', { name: 'Isolated event detail' }).waitFor();
      await page.goBack(); await page.getByRole('button', { name: /Continuation 0 / }).waitFor(); await settle(page);
      if (before) {
        const count = await page.locator('[id^="upgrade-event-"]').count();
        report.observed = { count, earlyTargetPresent: await page.locator('#upgrade-event-fixture-continuation-0').count() > 0, deepTargetPresent: await page.locator('#upgrade-event-fixture-continuation-100').count() > 0 };
        assert.equal(count, 120, 'A first-page focus target must not stop restoration before all three saved pages');
      }
      await page.waitForFunction(() => document.querySelectorAll('[id^="upgrade-event-"]').length === 120 && document.activeElement?.id === 'upgrade-event-fixture-continuation-0');
      assert.equal(await page.locator('#upgrade-event-fixture-continuation-100').count(), 1);
      report.checks.push(`${theme}: first-page target restores all 120 saved cards after detail reload and browser Back, then receives focus`);
    }
    await page.getByRole('button', { name: /Continuation 100 / }).click();
    await page.getByRole('heading', { name: 'Isolated event detail' }).waitFor();
    await page.goBack(); await page.waitForFunction(() => document.activeElement?.id === 'upgrade-event-fixture-continuation-100');
    await page.getByRole('button', { name: /^Live now/ }).click();
    await chooseCity(page, 'Phoenix, AZ', 'Boston', 'Boston, MA');
    // Wait for the different request to settle: going Back earlier hides the bug.
    await page.getByRole('heading', { name: 'Nothing live nearby right now.', exact: true }).waitFor();
    await page.goBack();
    await page.getByRole('button', { name: 'Phoenix, AZ', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Load more events', exact: true }).waitFor(); await settle(page);
    if (before) {
      const count = await page.locator('[id^="upgrade-event-"]').count();
      report.observed = { count, deepTargetPresent: await page.locator('#upgrade-event-fixture-continuation-100').count() > 0 };
      await page.screenshot({ path: path.join(output, 'before.png') });
      assert.equal(count, 120, 'Back must restore all three saved Phoenix pages after Boston has settled');
    }
    await page.waitForFunction(() => document.querySelectorAll('[id^="upgrade-event-"]').length === 120);
    assert.equal(await page.locator('#upgrade-event-fixture-continuation-100').count(), 1);
    assert.equal(await page.getByRole('button', { name: /^Upcoming/ }).getAttribute('aria-pressed'), 'true');
    assert.equal(new URL(page.url()).search, '');
    report.checks.push(`${theme}: settled Boston to Phoenix Back restores original request, Upcoming view and all 120 cards across three pages`);

    // Return to the settled Boston entry, hold the next Phoenix restoration,
    // then choose Boston again before those older reads are allowed to finish.
    await page.goForward();
    await chooseCity(page, 'Phoenix, AZ', 'Boston', 'Boston, MA');
    await page.getByRole('heading', { name: 'Nothing live nearby right now.', exact: true }).waitFor();
    await page.evaluate(() => { window.searchFixture.holdCities = ['Phoenix']; });
    await page.goBack(); await page.waitForFunction(() => window.searchFixture.pendingCities.length === 2);
    await chooseCity(page, 'Phoenix, AZ', 'Boston', 'Boston, MA');
    await page.getByRole('button', { name: /Boston fixture/ }).waitFor();
    const beforeRelease = await page.evaluate(() => ({ completed: window.searchFixture.completed, phoenixCalls: window.searchFixture.calls.filter(call => call.name === 'getTicketmasterEvents' && call.params.city === 'Phoenix').length }));
    await page.evaluate(() => window.searchFixture.releaseCity('Phoenix'));
    await page.waitForFunction(completed => window.searchFixture.completed === completed + 2, beforeRelease.completed); await settle(page);
    assert.equal(await page.getByRole('button', { name: 'Boston, MA', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: /Boston fixture/ }).count(), 1);
    assert.equal(await page.locator('[id^="upgrade-event-"]').count(), 1);
    assert.equal(await page.locator('#upgrade-event-fixture-continuation-100').count(), 0);
    assert.equal(await page.evaluate(() => window.searchFixture.calls.filter(call => call.name === 'getTicketmasterEvents' && call.params.city === 'Phoenix').length), beforeRelease.phoenixCalls, 'superseded restoration must not load more old-market pages');
    report.checks.push(`${theme}: newer Boston intent survives both late Phoenix reads without old results or restoration continuation`);
    await page.screenshot({ path: path.join(output, `after-${theme}.png`) });
    await page.close();
  }
  await isolation.assertClean(); assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(`Upgrades history request regressions passed: ${report.checks.length} cases, both themes; no SDK mutations or outbound requests.`);
  await context.close();
} catch (error) {
  report.passed = false; report.failure = error.message; throw error;
} finally {
  await writeFile(path.join(output, `${before ? baselineCase === 'early-target' ? 'before-early-target' : 'before' : 'after'}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close(); await server.close();
}
