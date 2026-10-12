/** R09 diagnostic repetition + R15 controlled browser coverage. Local SDK only.
 * Does not resolve the historical R09 failure merely because this suite passes.
 */
import assert from 'node:assert/strict';
import { installFixtureIsolation } from './helpers/fixtureIsolation.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = process.env.PG_PLAYWRIGHT_MODULE;
const { chromium } = runtime ? await import(pathToFileURL(runtime).href) : await import('playwright');
const evidence = process.env.PG_FAN_BEHAVIOR_EVIDENCE_DIR || path.join(root, 'tests/artifacts/oct09/fan-behavior');
await mkdir(evidence, { recursive: true });
const report = { fixtureOnly: true, productionChanges: false, historicalR09: 'Unresolved: original gate has not reproduced the historical failure', cases: [], screenshots: [], errors: [], external: [] };
const server = await createServer({ configFile: path.join(root, 'tests/fixtures/fan-behavior/vite.config.mjs'), logLevel: 'error', server: { port: Number(process.env.PG_FAN_BEHAVIOR_PORT || 4191) } });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [] });
  report.browser = browser.version();
  async function scenario(label, theme, config, run, viewport = { width: 390, height: 844 }) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await installFixtureIsolation(context, { origin, documentPaths: ['/tests/fixtures/fan-behavior/index.html'], attempts: report.external });
    await context.addInitScript(config => {
      window.__FAN_BEHAVIOR_CONFIG__ = config;
      const now = Date.now();
      const gps = (ll, age = 0) => ({ validated: true, ll, savedAt: now - age });
      const caches = {
        valid: gps('0,0'), expired: gps('0,0', 3600001), future: gps('0,0', -60000),
        invalid: gps('200,0'), malformed: '{', city: { validated: true, city: 'Boston', state: 'MA', label: 'Boston, MA' },
        'invalid-city': { validated: true, city: 'Boston', state: 'M' },
      };
      if (config.cache in caches) localStorage.setItem('pg_events_local_area_v1', typeof caches[config.cache] === 'string' ? caches[config.cache] : JSON.stringify(caches[config.cache]));
      if (config.cache === 'legacy-gps') localStorage.setItem('pg_location_cache', JSON.stringify({ latlong: '0,0', ts: now }));
      if (config.deferPhoenix) localStorage.setItem('pg_recent_cities', JSON.stringify([{ city: 'Phoenix', state: 'AZ', country: 'US' }]));
    }, config);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    try {
      await page.goto(`${origin}/tests/fixtures/fan-behavior/index.html?theme=${theme}`);
      await page.waitForFunction(() => window.fanBehavior?.location && window.fanBehavior?.originalTrigger);
      await run(page);
      const boundary = await page.evaluate(() => ({ unexpected: window.fanBehavior.unexpected, calls: window.fanBehavior.calls.map(row => row.name), geoCalls: window.fanBehavior.gps.length }));
      assert.deepEqual(boundary.unexpected, []);
      assert.ok(boundary.calls.every(name => name === 'suggestCities'));
      report.cases.push({ label, theme, viewport, status: 'passed', ...boundary });
    } catch (error) {
      const screenshot = path.join(evidence, `failure-${report.cases.length}.png`);
      await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
      report.cases.push({ label, theme, viewport, status: 'failed', failure: error.message, state: await page.evaluate(() => ({ location: window.fanBehavior?.location, dialog: !!document.querySelector('[role="dialog"]'), active: document.activeElement?.outerHTML, originalTriggerConnected: window.fanBehavior?.originalTrigger?.isConnected })) });
      throw error;
    } finally { await context.close(); }
  }
  const flushRender = async page => {
    const revision = await page.evaluate(() => { const next = window.fanBehavior.revision + 1; window.fanBehavior.rerender(); return next; });
    await page.waitForFunction(revision => window.fanBehavior.revision === revision, revision);
  };
  const state = page => page.evaluate(() => window.fanBehavior.location);
  const countGPS = page => page.evaluate(() => window.fanBehavior.gps.length);
  const chooseBoston = async page => {
    const input = page.getByRole('combobox', { name: 'Search city for nearby posts' });
    await input.fill('Boston'); await page.getByRole('option', { name: /Boston/ }).waitFor();
    await input.press('ArrowDown'); await input.press('Enter');
    await page.getByText('Showing posts for Boston, MA.', { exact: true }).waitFor();
  };
  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await scenario('R09 repeated modal close after asynchronous parent render', theme, {}, async page => {
        const trigger = page.getByRole('button', { name: /^Sort posts\. Current:/ });
        for (let cycle = 0; cycle < 3; cycle++) for (const close of ['Escape', 'button', 'backdrop', 'selection']) {
          await trigger.click();
          const dialog = page.getByRole('dialog', { name: 'Sort posts', exact: true });
          await dialog.waitFor();
          await flushRender(page);
          assert.equal(await dialog.getByRole('button', { pressed: true }).count(), 1);
          assert.equal(await dialog.locator('button[aria-pressed]').count(), 6);
          for (const key of ['Tab', 'Shift+Tab']) { await page.keyboard.press(key); assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true); }
          assert.equal(await page.evaluate(() => window.fanBehavior.originalTrigger.isConnected), true);
          if (close === 'Escape') await page.keyboard.press('Escape');
          if (close === 'button') await page.getByRole('button', { name: 'Close sort sheet' }).click();
          if (close === 'backdrop') await page.locator('.pg-fan-sort-backdrop').click({ position: { x: 2, y: 2 } });
          if (close === 'selection') await dialog.getByRole('button', { name: cycle % 2 ? 'Oldest' : 'Most Liked', exact: true }).click();
          await dialog.waitFor({ state: 'hidden' });
          await page.waitForFunction(() => document.activeElement === window.fanBehavior.originalTrigger);
          assert.equal(await trigger.evaluate(node => node === window.fanBehavior.originalTrigger), true, 'The original DOM trigger stays mounted and receives focus');
        }
      }, viewport);
    }
    for (const outcome of ['success', 'denied', 'timeout', 'unavailable', 'invalid']) {
      await scenario(`R15 deliberate location ${outcome} and recovery`, theme, { unavailable: outcome === 'unavailable' }, async page => {
        assert.equal(await countGPS(page), 0);
        await page.getByRole('button', { name: 'Enable location', exact: true }).click();
        if (outcome === 'unavailable') {
          await page.getByText(/Your location is unavailable/).waitFor(); assert.equal(await countGPS(page), 0);
        } else {
          await page.getByRole('button', { name: 'Locating…', exact: true }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Locating…', exact: true }).isDisabled(), true);
          await page.getByRole('button', { name: 'Locating…', exact: true }).evaluate(node => node.click());
          assert.equal(await countGPS(page), 1, 'Pending request prevents duplicate GPS request');
          if (outcome === 'success') await page.evaluate(() => window.fanBehavior.resolveGPS(0));
          else if (outcome === 'invalid') await page.evaluate(() => window.fanBehavior.resolveGPS(0, 200, 0));
          else await page.evaluate(code => window.fanBehavior.rejectGPS(0, code), outcome === 'denied' ? 1 : 3);
          await flushRender(page);
          assert.equal((await state(page)).status, outcome === 'success' ? 'granted' : outcome === 'invalid' ? 'unavailable' : outcome);
          assert.equal(await countGPS(page), 1, 'Failure never requests location again automatically');
          if (outcome !== 'success') {
            await page.getByRole('button', { name: 'Try location again', exact: true }).click();
            assert.equal(await countGPS(page), 2);
            await page.evaluate(() => window.fanBehavior.rejectGPS(0, 1)); await flushRender(page);
            assert.equal((await state(page)).status, 'requesting', 'Stale failure cannot replace the current request');
            await page.evaluate(() => window.fanBehavior.resolveGPS(1)); await flushRender(page);
            assert.equal((await state(page)).status, 'granted');
          }
        }
        const before = await countGPS(page); await chooseBoston(page); assert.equal(await countGPS(page), before);
        assert.equal((await state(page)).area.city, 'Boston');
      });
    }
    for (const action of ['manual city', 'other tab', 'unmount']) {
      await scenario(`R15 pending GPS cancelled by ${action}`, theme, {}, async page => {
        await page.getByRole('button', { name: 'Enable location', exact: true }).click();
        if (action === 'manual city') await chooseBoston(page);
        if (action === 'other tab') await page.evaluate(() => window.fanBehavior.otherMarket({ city: 'Boston', state: 'MA', label: 'Boston, MA' }));
        if (action === 'unmount') {
          await page.evaluate(() => window.fanBehavior.mountLocation(false));
          await page.getByRole('region', { name: 'Nearby post location' }).waitFor({ state: 'hidden' });
        }
        await flushRender(page);
        await page.evaluate(() => { window.fanBehavior.resolveGPS(0, 42.36, -71.06); window.fanBehavior.rejectGPS(0, 1); });
        if (action === 'unmount') {
          await page.evaluate(() => window.fanBehavior.mountLocation(true));
          await page.getByRole('region', { name: 'Nearby post location' }).waitFor();
        }
        await flushRender(page);
        assert.equal((await state(page)).area?.city || null, action === 'unmount' ? null : 'Boston');
        assert.equal(await page.evaluate(() => localStorage.getItem('pg_location_cache')), null, 'Cancelled success cannot persist a GPS fix');
      });
    }
    for (const cache of ['valid', 'legacy-gps', 'city', 'expired', 'future', 'invalid', 'malformed', 'invalid-city']) {
      await scenario(`R15 cache ${cache}`, theme, { cache }, async page => {
        await flushRender(page);
        const saved = (await state(page)).area;
        if (['valid', 'legacy-gps'].includes(cache)) assert.equal(saved?.ll, '0,0');
        else if (cache === 'city') assert.equal(saved?.city, 'Boston');
        else assert.equal(saved, null);
        assert.equal(await countGPS(page), 0, 'Cache restoration never prompts for location');
      });
    }
    for (const selection of ['manual', 'GPS']) {
      await scenario(`R15 late city migration cannot overwrite ${selection}`, theme, { deferPhoenix: true }, async page => {
        await page.waitForFunction(() => window.fanBehavior.cityReads.length === 1);
        if (selection === 'manual') await chooseBoston(page);
        else { await page.getByRole('button', { name: 'Enable location', exact: true }).click(); await page.evaluate(() => window.fanBehavior.resolveGPS(0)); }
        await flushRender(page);
        await page.evaluate(() => window.fanBehavior.resolveCityReads()); await flushRender(page);
        const saved = (await state(page)).area;
        if (selection === 'manual') assert.equal(saved.city, 'Boston'); else assert.equal(saved.ll, '0,0');
      });
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []);
  report.status = 'PASSED';
  console.log(`PASS ${report.cases.length} controlled Fan behavior scenarios; historical R09 remains unresolved; no service mutations or external requests`);
} catch (error) { report.status = 'FAILED'; report.failure = error.message; throw error; }
finally { await writeFile(path.join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); await browser?.close(); await server.close(); }
