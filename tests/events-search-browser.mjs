/** Actual Events page, isolated fail-closed SDK, no production/provider network. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../', import.meta.url));
const playwrightPath = process.env.PG_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES && path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright', 'index.mjs'));
const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : 'playwright');
const server = await createServer({ configFile: false, root, cacheDir: path.join(root, 'node_modules/.vite-events-search'), logLevel: 'error', optimizeDeps: { entries: ['tests/fixtures/events-search/index.html'] }, plugins: [react(), { name: 'isolated-discovery-routes', configureServer(server) { server.middlewares.use((req, _res, next) => { if (req.url.split('?')[0] === '/events' || req.url.startsWith('/events/') || req.url.startsWith('/upgrades/')) req.url = '/tests/fixtures/events-search/index.html'; next(); }); } }], resolve: { alias: [{ find: '@/lib/navLogger', replacement: path.join(root, 'tests/fixtures/events-search/navLogger.js') }, { find: '@/api/base44Client', replacement: path.join(root, 'tests/fixtures/events-search/base44.js') }, { find: '@', replacement: path.join(root, 'src') }] }, server: { watch: null, hmr: false, host: '127.0.0.1', port: Number(process.env.PG_FIXTURE_PORT || 5179) } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await context.addInitScript(() => {
    localStorage.setItem('pg_events_local_area_v1', JSON.stringify({ validated: true, city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' }));
    const event = (title, city, state, tm_id, days = 1) => ({ title, city, state, tm_id, date: new Date(Date.UTC(2099, 9, days, 20)).toISOString(), venue: 'Fixture Arena' });
    const rock = event('Phoenix Rock Night', 'Phoenix', 'AZ', 'rock');
    window.initialSearchFixture = { tm: [rock, event('Billy in Boston', 'Boston', 'MA', 'billy'), ...Array.from({ length: 85 }, (_, i) => event(`Fixture Tour ${i}`, 'Phoenix', 'AZ', `tour-${i}`, i + 2))], pg: [{ ...rock, id: 'local-rock', search_text_normalized: 'phoenix rock night' }, { ...rock, id: 'duplicate-rock', search_text_normalized: 'phoenix rock night' }, ...Array.from({length:190}, (_,i)=>({ ...event(`Local Series ${i}`, 'Phoenix', 'AZ', undefined, i+2), id:`local-series-${i}`, search_text_normalized:`local series ${i}` }))] };
    if (new URLSearchParams(location.search).has('cityMigration')) {
      localStorage.removeItem('pg_events_local_area_v1');
      localStorage.removeItem('pg_location_cache');
      localStorage.setItem('pg_recent_cities', JSON.stringify([{ city: 'Phoenix', state: 'AZ' }]));
      window.initialSearchFixture.cityDelay = 1500;
    }
    if (new URLSearchParams(location.search).has('emptyFirstPage')) {
      window.initialSearchFixture = { tm: [], pg: [
        ...Array.from({ length: 60 }, (_, i) => ({ ...event(`Distant event ${i}`, 'Boston', 'MA', undefined, i + 1), id: `distant-${i}`, venue_lat: 42.36, venue_lng: -71.06 })),
        { ...event('Nearby later page', 'Phoenix', 'AZ', undefined, 62), id: 'nearby-later', venue_lat: 33.4484, venue_lng: -112.074 },
      ] };
    }
    if (new URLSearchParams(location.search).has('liveReturn')) {
      window.initialSearchFixture = { tm: [], pg: [{ ...event('Live return fixture', 'Phoenix', 'AZ'), id: 'live-return', date: new Date(Date.now() - 1800000).toISOString(), event_end_utc: new Date(Date.now() + 3600000).toISOString(), venue_timezone: 'America/Phoenix', status: 'live' }] };
    }
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (success, failure) => { window.geoSuccess = success; window.geoFailure = failure; } } });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/events`);
  await page.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Load more events', exact: true }).click();
  await page.getByRole('heading', { name: 'Fixture Tour 60', exact: true }).waitFor();
  for(let i=0;i<3;i++) { await page.getByRole('button', {name:'Load more events',exact:true}).click(); await page.waitForFunction(()=>!document.querySelector('button:disabled')?.textContent?.includes('Loading more')); }
  await page.getByRole('link', {name:/^View Local Series 170,/}).click();
  await page.getByRole('heading', {name:'Isolated event detail'}).waitFor();
  await page.goBack();
  await page.getByRole('link', {name:/^View Local Series 170,/}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')?.startsWith('View Local Series 170,'));
  const evidenceDir=path.join(root,'docs/reviews/oct06-evidence'); await mkdir(evidenceDir,{recursive:true});
  for (const theme of ['dark','light']) { await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme); await page.screenshot({path:path.join(evidenceDir,`events-return-390-${theme}.png`)}); }
  await page.getByRole('button', { name: 'Search and filters', exact: true }).click();
  const search = page.getByRole('searchbox'), latest = () => page.evaluate(() => window.searchFixture.calls.filter(call => call.name === 'getTicketmasterEvents').at(-1)?.params);
  await search.fill('Rock'); await search.press('Enter');
  await page.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('q'), 'Rock');
  await search.fill('unsubmitted draft');
  await page.getByRole('link', { name: /^View Phoenix Rock Night/ }).click();
  await page.getByRole('heading', { name: 'Isolated event detail' }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).waitFor();
  assert.equal(await search.inputValue(), 'Rock');
  await page.reload();
  await page.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).waitFor();
  assert.equal(await search.inputValue(), 'Rock');
  await page.getByRole('link', { name: /^View Phoenix Rock Night/ }).click();
  await page.getByRole('link', { name: 'Back to events', exact: true }).click();
  await page.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).waitFor();
  assert.equal(await search.inputValue(), 'Rock');
  await search.fill('Billy'); await search.press('Enter');
  await page.getByText('No matches for ‘Billy’ near Phoenix, AZ', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Search nationwide', exact: true }).click();
  await page.getByRole('heading', { name: 'Billy in Boston', exact: true }).waitFor();
  assert.equal((await latest()).city, undefined);
  await page.goBack(); await page.getByText('No matches for ‘Billy’ near Phoenix, AZ', { exact: true }).waitFor();
  await page.goForward(); await page.getByRole('heading', { name: 'Billy in Boston', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Near Me', exact: true }).click();
  await page.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).waitFor();
  await search.fill('Unsubmitted sort draft');
  await page.getByRole('combobox', { name: 'Sort events by date' }).selectOption('latest');
  await page.getByRole('heading', { name: 'Fixture Tour 84', exact: true }).waitFor();
  assert.equal((await latest()).sort, 'latest');
  assert.equal(await search.inputValue(), 'Unsubmitted sort draft');
  await search.fill('Unsubmitted filter draft');
  await page.getByLabel('Include past', { exact: true }).check();
  await page.waitForFunction(() => window.searchFixture.calls.some(call => call.params?.includePast));
  assert.equal(await search.inputValue(),'Unsubmitted filter draft');
  await page.reload();
  await page.getByRole('button',{name:'Search and filters',exact:true}).click();
  assert.equal(await search.inputValue(),'');
  await page.evaluate(() => { window.searchFixture.delays.Slow = 350; });
  await search.fill('Slow'); await search.press('Enter');
  await search.fill('Rock'); await search.press('Enter');
  await page.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).waitFor();
  await page.waitForTimeout(400);
  assert.equal(await search.inputValue(), 'Rock');
  assert.equal(new URL(page.url()).searchParams.get('q'), 'Rock');
  assert.equal(await page.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).count(), 1);
  await page.evaluate(() => { window.searchFixture.tmError = 429; });
  await search.fill('Unavailable'); await search.press('Enter');
  await page.getByText('Some search results are unavailable', { exact: true }).waitFor();
  await page.evaluate(() => { window.searchFixture.tmError = null; });
  await search.fill('Unsubmitted error draft');
  await page.getByRole('button', { name: 'Retry unavailable sources', exact: true }).click();
  await page.getByText('No matches for ‘Unavailable’ near Phoenix, AZ', { exact: true }).waitFor();
  assert.equal((await latest()).keyword, 'Unavailable');
  assert.equal(await search.inputValue(), 'Unsubmitted error draft');
  for (const theme of ['dark', 'light']) for (const width of [320, 375, 390, 430, 1280]) {
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} ${width} overflow`);
  }
  // Migrate a validated recent city slowly enough to type before it resolves.
  // This first browse is a submitted request, independent of the field draft.
  const migrationPage = await context.newPage();
  migrationPage.on('pageerror', error => errors.push(error.message));
  await migrationPage.goto(`http://127.0.0.1:${server.httpServer.address().port}/events?cityMigration=1`);
  await migrationPage.getByRole('button', { name: 'Search and filters', exact: true }).click();
  await migrationPage.getByRole('searchbox').fill('Draft during location recovery');
  await migrationPage.getByRole('heading', { name: 'Phoenix Rock Night', exact: true }).waitFor();
  assert.equal(await migrationPage.getByRole('searchbox').inputValue(), 'Draft during location recovery');
  assert.equal(new URL(migrationPage.url()).searchParams.get('q'), null);
  await migrationPage.close();
  const continuationPage = await context.newPage();
  continuationPage.on('pageerror', error => errors.push(error.message));
  await continuationPage.goto(`http://127.0.0.1:${server.httpServer.address().port}/events?browse=1&ll=33.4484,-112.074&emptyFirstPage=1`);
  await continuationPage.getByText('No matching events in these results.', { exact: true }).waitFor();
  assert.equal(await continuationPage.getByText(/No nearby events found/).count(), 0);
  await continuationPage.getByRole('button', { name: 'Load more events', exact: true }).click();
  await continuationPage.getByRole('heading', { name: 'Nearby later page', exact: true }).waitFor();
  await continuationPage.close();
  const livePage = await context.newPage();
  livePage.on('pageerror', error => errors.push(error.message));
  const liveSearch = '?browse=1&city=Phoenix&state=AZ&past=1&liveReturn=1';
  await livePage.goto(`http://127.0.0.1:${server.httpServer.address().port}/events${liveSearch}`);
  await livePage.getByRole('link', { name: 'Open live hub for Live return fixture', exact: true }).click();
  await livePage.getByRole('link', { name: 'Back to events', exact: true }).click();
  await livePage.getByRole('heading', { name: 'Live return fixture', exact: true }).waitFor();
  assert.equal(new URL(livePage.url()).search, liveSearch);
  await livePage.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Open live hub for Live return fixture,'));
  await livePage.close();
  assert.deepEqual(errors, []);
  console.log('PASS Events: continuation; conservative dedupe; submitted URL/history/reload/in-app Back; draft isolation; latest/past provider queries; stale response rejection; failed source retry; 320/375/390/430/1280 light/dark overflow. Isolated browser emulation only.');
} finally { await browser?.close(); await server.close(); }
