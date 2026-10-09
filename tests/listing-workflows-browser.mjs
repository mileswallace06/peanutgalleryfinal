/** R04/R05 real-browser checks against the production components + isolated SDK.
 * Starts its own fixture server. No uploads, checkout, Flash Drop creation or
 * backend writes; stale-event submission must stop at the read-only preflight.
 * PG_PLAYWRIGHT_MODULE, PG_CHROMIUM_PATH and PG_CHROMIUM_ARGS select local tooling.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const playwrightPath = process.env.PG_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES && path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs'));
const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : 'playwright');
const evidence = process.env.PG_LISTING_EVIDENCE_DIR || '/tmp/pg-listing-workflows-browser';
await mkdir(evidence, { recursive: true });
const report = { fixtureOnly: true, browser: null, checks: [], screenshots: [], externalRequests: [], errors: [], safetyChecks: [] };
const server = await createServer({ configFile: path.join(root, 'tests/fixtures/ticket-design/vite.config.mjs'), logLevel: 'error', server: { host: '127.0.0.1', port: Number(process.env.PG_LISTING_FIXTURE_PORT || 4178), strictPort: true, hmr: false, watch: null } });
let browser, origin, activePage;
const screenshot = async (page, name) => {
  // DOM presence alone can precede Framer Motion's opacity transition. Capture
  // the rendered state rather than its first transparent animation frame.
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] .space-y-4')].every(node => Number(getComputedStyle(node).opacity) >= 0.99));
  const file = path.join(evidence, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' }); report.screenshots.push(file);
};
async function openPage(params, width = 390, height = 844) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    report.externalRequests.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient');
  });
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${origin}/tests/fixtures/ticket-design/app.html?${new URLSearchParams({ theme: 'light', ...params })}`);
  await page.waitForFunction(() => !!window.ticketDesignFixture && !!window.__PG_REVIEW_NAVIGATE__);
  return { context, page };
}
async function safe(page, label) {
  const state = await page.evaluate(() => {
    const f = window.ticketDesignFixture;
    return { blocked: f.blocked, unexpected: f.unexpected, mutations: f.calls.filter(c => /^(functions\.(reserveListing|releaseReservation|createCheckout|abortCheckout|confirmCheckoutAuthorized|createDemoUpgrade|flashDrop|seatDonation|submitListing|onboardSeller)|integrations\.|entities\.(Listing|Purchase|SeatInventory)\.(create|update|delete))/.test(c.name)).map(c => c.name) };
  });
  assert.deepEqual(state, { blocked: [], unexpected: [], mutations: [] }, `${label}: no unexpected reads or financial/upload mutations`);
  assert.equal(await page.getByRole('heading', { name: 'Visual review fixture error', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, `${label}: no page-wide horizontal overflow`);
  report.safetyChecks.push({ label, ...state });
}
async function openGift(page) {
  await page.getByRole('button', { name: 'Fan Gifts', exact: true }).click();
  const trigger = page.getByRole('button', { name: '+ Drop Seats', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: /Create Flash Drop/ }); await dialog.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Close fan gift form', exact: true }).evaluate(button => button === document.activeElement), true);
  await dialog.getByRole('button', { name: /Immediate Drop/ }).click();
  await dialog.getByRole('button', { name: 'Check my listings for this event', exact: true }).waitFor();
  return { dialog, trigger };
}
try {
  await server.listen(); origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [] });
  report.browser = browser.version();

  // Exercise the real hub's return link, not the detail component mocked by the
  // discovery-only fixture. The source URL's submitted filters must survive.
  for (const theme of ['light', 'dark']) {
    const returnTo = '/events?browse=1&q=Aurora&city=Phoenix&state=AZ&sort=latest&past=1';
    const { page, context } = await openPage({ route: returnTo, theme });
    await page.getByRole('heading', { name: 'The Aurora Waves', exact: true }).waitFor();
    await page.evaluate(discoveryReturnTo => window.__PG_REVIEW_NAVIGATE__('/upgrades/fixture-live', { state: { discoveryReturnTo } }), returnTo);
    const back = page.getByRole('link', { name: /Back to events/ });
    await back.waitFor(); assert.equal(await back.getAttribute('href'), returnTo);
    await back.click();
    await page.waitForFunction(expected => `${window.__PG_REVIEW_LOCATION__?.pathname}${window.__PG_REVIEW_LOCATION__?.search}` === expected, returnTo);
    await page.getByRole('heading', { name: 'The Aurora Waves', exact: true }).waitFor();
    const filters = page.getByRole('button', { name: 'Search and filters', exact: true });
    if (await filters.getAttribute('aria-expanded') !== 'true') await filters.click();
    assert.equal(await page.getByRole('searchbox', { name: 'Search events, artists, teams, or venues', exact: true }).inputValue(), 'Aurora');
    assert.equal(await page.getByRole('combobox', { name: 'Sort events by date', exact: true }).inputValue(), 'latest');
    assert.equal(await page.getByRole('checkbox', { name: 'Include past', exact: true }).isChecked(), true);
    await safe(page, `real hub discovery return ${theme}`); await context.close();
    report.checks.push(`R02 real live-hub return link preserves submitted keyword, city, sort and include-past URL/state: ${theme}`);
  }

  for (const theme of ['light', 'dark']) for (const width of [320, 375, 390, 430, 1280]) {
    const { page, context } = await openPage({ page: 'hub', eventState: 'ended', theme }, width);
    await page.getByText('Event has ended', { exact: false }).first().waitFor();
    assert.equal(await page.getByRole('link', { name: 'List seats', exact: false }).count(), 0);
    await safe(page, `ended hub ${theme} ${width}`);
    await page.evaluate(() => window.__PG_REVIEW_NAVIGATE__('/create-listing?event_id=fixture-live'));
    await page.getByRole('heading', { name: 'Listings are closed for this event', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Seat details', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Yes, I can transfer', exact: true }).count(), 0);
    assert.equal(await page.locator('input[type="file"]').count(), 0);
    assert.equal(await page.getByRole('button', { name: /List my tickets|Save listing draft|Submit for verification/ }).count(), 0);
    assert.ok(await page.getByRole('link', { name: 'View this event’s history', exact: true }).isVisible());
    if (width === 390) await screenshot(page, `R04-ended-form-${theme}-${width}`);
    await safe(page, `ended direct form ${theme} ${width}`);
    await page.getByRole('button', { name: 'Choose a current event', exact: true }).click();
    await page.getByRole('heading', { name: 'Sell your tickets.', exact: true }).waitFor();
    await context.close();
    report.checks.push(`R04 ended hub and direct form, current-event recovery, no transfer/upload prompts: ${theme} ${width}px`);
  }

  // Browser clock advances while the user retains an open draft. No server write.
  {
    const { page, context } = await openPage({ page: 'create-listing', eventState: 'stale-live' });
    await page.getByRole('textbox', { name: 'Section', exact: true }).fill('104');
    await page.getByRole('textbox', { name: 'Row', exact: true }).fill('B');
    await page.evaluate(() => { const end = Date.parse(window.ticketDesignFixture.events[0].event_end_utc); Date.now = () => end; window.dispatchEvent(new Event('focus')); });
    await page.getByRole('heading', { name: 'Listings are closed for this event', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Section', exact: true }).count(), 0);
    await safe(page, 'draft ends at explicit boundary'); await context.close();
    report.checks.push('R04 open draft closes at exact explicit end after simulated foreground clock update');
  }
  {
    const { page, context } = await openPage({ page: 'create-listing', eventState: 'unknown' });
    await page.getByRole('textbox', { name: 'Section', exact: true }).waitFor();
    await page.getByText('The event time is unconfirmed. Check the event details before listing your seats.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Listings are closed for this event', exact: true }).count(), 0);
    await safe(page, 'unknown timing stays unknown'); await context.close();
    report.checks.push('R04 unknown timing is disclosed without fabricated end');
  }
  // Populate only fictional form fields; simulate an authoritative ended record
  // immediately before submit. The guard must prevent every SDK mutation.
  {
    const { page, context } = await openPage({ page: 'create-listing', eventState: 'stale-live' });
    await page.getByRole('textbox', { name: 'Section', exact: true }).fill('104');
    await page.getByRole('textbox', { name: 'Row', exact: true }).fill('B');
    await page.getByRole('button', { name: 'Yes, I can transfer', exact: true }).click();
    await page.getByRole('button', { name: 'Ticketmaster', exact: true }).click();
    await page.getByRole('button', { name: /I confirm this ticket has not been scanned/ }).click();
    await page.getByRole('button', { name: 'Confirm & Continue to Listing', exact: true }).click();
    await page.getByRole('button', { name: 'Price & review', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Price per ticket', exact: true }).fill('25');
    await page.evaluate(() => { window.ticketDesignFixture.events[0].status = 'ended'; });
    await page.getByRole('button', { name: 'List my tickets', exact: true }).click();
    await page.getByRole('heading', { name: 'Listings are closed for this event', exact: true }).waitFor();
    await safe(page, 'fresh ended read before submit'); await context.close();
    report.checks.push('R04 stale server timing reread stops submission before analytics or writes');
  }

  for (const theme of ['light', 'dark']) {
    const { page, context } = await openPage({ page: 'hub', theme, flashLookup: 'retry', flashLookupDelay: '200' });
    await page.evaluate(() => {
      const f = window.ticketDesignFixture;
      f.listings.push({ ...f.listings.find(l => l.id === 'fixture-seller-active'), id: 'fixture-lookup-owned', event_id: 'fixture-live', section: '104', row: 'B', seats: '7–8' });
    });
    const { dialog, trigger } = await openGift(page);
    await dialog.getByRole('button', { name: 'Check my listings for this event', exact: true }).click();
    await dialog.getByRole('button', { name: 'Checking listings…', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Checking listings…', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Retry listing check', exact: true }).waitFor();
    assert.match(await dialog.getByRole('status').innerText(), /could not check your listings/);
    assert.equal(await dialog.locator('input[type="file"]').count(), 1, 'alternate path remains present');
    if (theme === 'light') await screenshot(page, 'R05-lookup-error-light-390');
    await dialog.getByRole('button', { name: 'Retry listing check', exact: true }).click();
    const choices = dialog.getByRole('button', { name: /Sec 104 Row B.*Seats 7–8/ }); await choices.waitFor();
    assert.equal(await choices.getAttribute('aria-pressed'), 'false');
    await choices.click(); assert.equal(await choices.getAttribute('aria-pressed'), 'true');
    assert.match(await dialog.getByRole('status').innerText(), /1 active listing found in your loaded history/);
    assert.equal(await page.evaluate(() => window.ticketDesignFixture.calls.filter(c => c.name === 'functions.getListingParticipantView' && c.params.action === 'list_mine').length), 2);
    if (theme === 'dark') await screenshot(page, 'R05-lookup-retry-populated-dark-390');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    // Radix restores focus in its unmount callback, after the dialog detaches.
    await page.waitForFunction(button => button === document.activeElement, await trigger.elementHandle());
    assert.equal(await trigger.evaluate(button => button === document.activeElement), true, 'Escape returns focus to exact opener');
    await safe(page, `lookup retry ${theme}`); await context.close();
    report.checks.push(`R05 failure/retry/populated selection, accessible live status, alternate proof, Escape/trigger focus: ${theme}`);
  }
  {
    const { page, context } = await openPage({ page: 'hub', flashLookup: 'empty', flashLookupDelay: '200' }, 320);
    const { dialog } = await openGift(page);
    const lookup = dialog.getByRole('button', { name: 'Check my listings for this event', exact: true });
    await lookup.click();
    await dialog.getByRole('button', { name: 'Check listings again', exact: true }).waitFor();
    assert.match(await dialog.getByRole('status').innerText(), /No eligible active listings.*loaded history/);
    assert.match(await dialog.getByRole('status').innerText(), /does not confirm seat ownership/);
    assert.equal(await dialog.locator('button[aria-pressed="true"]').filter({ hasText: /^Sec / }).count(), 0);
    await dialog.getByRole('status').scrollIntoViewIfNeeded();
    await screenshot(page, 'R05-lookup-empty-light-320');
    await safe(page, 'lookup empty320'); await context.close();
    report.checks.push('R05 successful empty response distinct from failure; proof upload retained;320px no overflow');
  }
  assert.deepEqual(report.errors, [], 'No browser runtime errors');
  console.log(`PASS listing workflows: ${report.checks.length} rendered checks, ${report.safetyChecks.length} safety checks, ${report.screenshots.length} screenshots; Chromium ${report.browser}; fixture-only.`);
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  if (activePage && !activePage.isClosed()) { await activePage.screenshot({ path: path.join(evidence, 'failure.png') }); report.failure.renderedText = await activePage.locator('body').innerText(); }
  throw error;
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.close();
}
