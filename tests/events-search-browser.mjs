/**
 * Real Events page with a mocked SDK boundary; no credentials or external calls.
 * Run: node tests/events-search-browser.mjs
 * Requires an available Playwright installation + Chromium. PLAYWRIGHT_MODULE may
 * point to an existing playwright/index.mjs; no production dependencies are added.
 */
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const server = await createServer({
  configFile: false, root, logLevel: 'error', plugins: [react()],
  resolve: { alias: [
    { find: '@/api/base44Client', replacement: path.join(root, 'tests/fixtures/events-search/base44.js') },
    { find: '@', replacement: path.join(root, 'src') },
  ] },
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
let passed = 0;
const pass = label => { passed++; console.log(`PASS ${label}`); };
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/events-search/`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await context.addInitScript(() => {
    // Reproduce the exact obsolete state shown on Miles's phone.
    sessionStorage.setItem('pg_events_location', JSON.stringify({ city: 'Kahan', locationInput: 'Kahan' }));
    localStorage.setItem('pg_location_cache', JSON.stringify({ latlong: '33.45,-112.07', label: 'Near me', ts: Date.now() }));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (success, failure) => { window.geoSuccess = success; window.geoFailure = failure; } } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const search = page.getByRole('searchbox');
  await search.waitFor();
  assert.equal(await page.locator('input').count(), 1);
  assert.equal((await page.evaluate(() => window.searchFixture.calls)).length, 0);
  await page.getByRole('button', { name: 'All locations · change', exact: true }).waitFor();
  pass('one primary search; legacy city and cached GPS do not constrain or trigger searches');

  const event = (title, city, tm_id) => ({ title, city, tm_id, date: '2099-10-01T20:00:00Z', venue: 'Fixture Arena', tm_url: 'https://example.invalid/event' });
  await page.evaluate(({ tm, pg }) => Object.assign(window.searchFixture, { tm, pg }), {
    tm: [event('Noah Kahan — Boston', 'Boston', 'boston'), event('Summer Festival', 'Denver', 'festival')],
    pg: [{ id: 'pg-austin', title: 'Kahan — Austin', city: 'Austin', search_text_normalized: 'kahan austin', date: '2099-10-01T20:00:00Z' }],
  });
  await search.fill('Kahan');
  assert.equal((await page.evaluate(() => window.searchFixture.calls)).length, 0);
  await search.press('Enter');
  await page.getByRole('heading', { name: 'Noah Kahan — Boston' }).waitFor();
  await page.getByRole('heading', { name: 'Kahan — Austin' }).waitFor();
  await page.getByRole('heading', { name: 'Summer Festival' }).waitFor();
  const latestTM = () => page.evaluate(() => window.searchFixture.calls.filter(c => c.name === 'getTicketmasterEvents').at(-1)?.params);
  assert.deepEqual(await latestTM(), { size: 40, keyword: 'Kahan' });
  pass('submitted artist search finds out-of-city PG and provider events, including attraction matches');

  await page.getByRole('button', { name: 'All locations · change', exact: true }).click();
  const city = page.getByRole('combobox', { name: 'Find a city' });
  await city.fill('Kahan');
  await city.press('Enter');
  await page.getByRole('alert').waitFor();
  assert.deepEqual(await latestTM(), { size: 40, keyword: 'Kahan' });
  await search.fill('Unsubmitted city draft');
  await city.fill('Phoenix');
  await page.getByRole('option', { name: /Phoenix/ }).click();
  await page.getByText('No matches for “Kahan”', { exact: true }).waitFor();
  assert.deepEqual(await latestTM(), { size: 40, city: 'Phoenix', keyword: 'Kahan' });
  assert.equal(await search.inputValue(), 'Kahan');
  await page.getByRole('button', { name: 'Phoenix, AZ · change', exact: true }).click();
  await city.waitFor();
  await page.getByRole('button', { name: 'Close location filter' }).click();
  await page.getByRole('button', { name: 'Search all locations', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Noah Kahan — Boston' }).waitFor();
  assert.equal(await search.inputValue(), 'Kahan');
  pass('city picker reopens, rejects unselected artist text, uses canonical city, and broadens without losing query');

  await page.evaluate(() => { window.searchFixture.tmError = 429; });
  await search.fill('Retry artist');
  await search.press('Enter');
  await page.getByText('Too many requests right now. Please wait a moment.').waitFor();
  assert.equal(await page.getByText('No matches for “Retry artist”', { exact: true }).count(), 0);
  await page.evaluate(tm => { window.searchFixture.tmError = null; window.searchFixture.tm = tm; }, [event('Retry artist Boston', 'Boston', 'retry')]);
  await search.fill('Unsubmitted draft');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('heading', { name: 'Retry artist Boston' }).waitFor();
  assert.deepEqual(await latestTM(), { size: 40, keyword: 'Retry artist' });
  pass('provider failure is not a false empty result; retry preserves submitted search, not an unsent draft');

  const pull = async (distance, cancel = false) => {
    await page.evaluate(({ distance, cancel }) => {
      window.scrollTo(0, 0);
      const container = document.querySelector('#root > div');
      const send = (name, y) => container.dispatchEvent(new TouchEvent(name, {
        bubbles: true,
        touches: name === 'touchstart' || name === 'touchmove' ? [new Touch({ identifier: 1, target: container, clientY: y })] : [],
      }));
      send('touchstart', 10);
      send('touchmove', 10 + distance);
      send(cancel ? 'touchcancel' : 'touchend', 10 + distance);
    }, { distance, cancel });
  };
  const countTM = () => page.evaluate(() => window.searchFixture.calls.filter(c => c.name === 'getTicketmasterEvents').length);
  let count = await countTM();
  await pull(20);
  await pull(80, true);
  assert.equal(await countTM(), count);
  await pull(80);
  await page.waitForFunction(before => window.searchFixture.calls.filter(c => c.name === 'getTicketmasterEvents').length === before + 1, count);
  assert.deepEqual(await latestTM(), { size: 40, keyword: 'Retry artist' });
  pass('pull refresh preserves query; short and cancelled gestures do not fetch');

  await page.evaluate(tm => { window.searchFixture.tm = tm; window.searchFixture.delays.Slow = 500; }, [event('Old slow result', 'Boston', 'slow')]);
  await search.fill('Slow'); await search.press('Enter');
  await page.waitForFunction(() => window.searchFixture.calls.some(c => c.params?.keyword === 'Slow'));
  await page.evaluate(tm => { window.searchFixture.tm = tm; }, [event('New fast result', 'Denver', 'fast')]);
  await search.fill('Fast'); await search.press('Enter');
  await page.getByRole('heading', { name: 'New fast result' }).waitFor();
  await page.waitForTimeout(600);
  assert.equal(await page.getByRole('heading', { name: 'Old slow result' }).count(), 0);
  pass('late response cannot replace a newer artist search');

  await page.getByRole('button', { name: 'All locations · change', exact: true }).click();
  await page.getByRole('button', { name: 'Near me', exact: true }).click();
  await page.waitForFunction(() => typeof window.geoSuccess === 'function');
  await search.fill('National next'); await search.press('Enter');
  count = await countTM();
  await page.evaluate(() => window.geoSuccess({ coords: { latitude: 33.45, longitude: -112.07 } }));
  await page.waitForTimeout(100);
  assert.equal(await countTM(), count);
  assert.deepEqual(await latestTM(), { size: 40, keyword: 'National next' });
  pass('a late GPS response cannot replace a subsequent nationwide search');

  await page.getByRole('button', { name: 'All locations · change', exact: true }).click();
  await search.fill('Unsubmitted GPS draft');
  await page.getByRole('button', { name: 'Near me', exact: true }).click();
  await page.evaluate(() => window.geoSuccess({ coords: { latitude: 33.45, longitude: -112.07 } }));
  await page.getByRole('button', { name: 'Near me · 50 miles · change', exact: true }).waitFor();
  assert.deepEqual(await latestTM(), { size: 40, keyword: 'National next', latlong: '33.45,-112.07', radius: '50' });
  await page.getByRole('button', { name: 'Search all locations', exact: true }).first().click();
  pass('explicit Near me uses GPS and retains artist; clearing it restores nationwide results');

  await page.evaluate(() => Object.assign(window.searchFixture, { tmError: 503, pgError: true }));
  await search.fill('Unavailable'); await search.press('Enter');
  await page.getByText('Some search results are unavailable', { exact: true }).waitFor();
  assert.equal(await page.getByText('No matches for “Unavailable”', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Clear event search' }).click();
  await page.getByText('Find your next event', { exact: true }).waitFor();
  pass('both-source outage is reported honestly; clearing the query returns to the search start');

  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `horizontal overflow at ${width}px`);
  }
  if (process.env.SEARCH_SCREENSHOT) await page.screenshot({ path: process.env.SEARCH_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
  pass('three phone widths fit with no browser runtime errors');
  console.log(`${passed} browser scenarios passed`);
} finally {
  await browser?.close();
  await server.close();
}
