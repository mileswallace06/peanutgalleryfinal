/** Narrow local-only browser checks for the listing sharing kit.
 * Run the isolated fixture first, then PG_SHARE_REVIEW_URL=http://127.0.0.1:4174 node tests/listing-share-browser.mjs.
 * Optional: PG_PLAYWRIGHT_MODULE, PG_CHROMIUM_PATH (or PG_TEST_CHROMIUM), PG_CHROMIUM_ARGS JSON array, PG_SHARE_EVIDENCE_DIR.
 * No production API, authenticated browser session, reservation, or purchase is used.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = new URL(process.env.PG_SHARE_REVIEW_URL || 'http://127.0.0.1:4174');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Browser review must use a local fixture origin');
const modulePath = process.env.PG_PLAYWRIGHT_MODULE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(modulePath).href);
const executablePath = process.env.PG_CHROMIUM_PATH || process.env.PG_TEST_CHROMIUM;
const browserArgs = process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [];
assert.ok(Array.isArray(browserArgs) && browserArgs.every(value => typeof value === 'string'), 'Chromium args must be a JSON array of strings');
const browser = await chromium.launch({ headless: true, args: browserArgs, ...(executablePath ? { executablePath } : {}) });
const evidence = process.env.PG_SHARE_EVIDENCE_DIR || '/tmp/pg-listing-share-browser';
await mkdir(evidence, { recursive: true });
const report = { fixtureOnly: true, externalRequests: [], checks: [], screenshots: [], png: [], errors: [] };
const expectedLink = 'https://peanutgallery.store/listings/fixture-seller-active';
const privateCanaries = ['reviewer@example.invalid', 'FICTIONAL_PRIVATE_PROOF_MUST_NOT_APPEAR', 'FICTIONAL_PRIVATE_TRANSFER_MUST_NOT_APPEAR', 'FICTIONAL_PRIVATE_BARCODE_MUST_NOT_APPEAR'];
const fixtureUrl = (page, theme = 'dark', scenario = 'populated', auth = 'member') => `${base.origin}/tests/fixtures/ticket-design/app.html?${new URLSearchParams({ page, theme, scenario, auth })}`;

async function setupPage(width, theme, extra = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, acceptDownloads: true });
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.origin === base.origin || ['data:', 'blob:'].includes(target.protocol)) return route.continue();
    report.externalRequests.push({ method: route.request().method(), origin: target.origin, path: target.pathname });
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(({ shareMode }) => {
    window.__shareReview = { copied: [], shared: [] };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__shareReview.copied.push(text); } } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: ({ files } = {}) => shareMode === 'cancel' && !!files?.length });
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareMode === 'cancel' ? async data => {
      window.__shareReview.shared.push({ title: data.title, text: data.text, url: data.url, files: (data.files || []).map(file => ({ name: file.name, type: file.type, size: file.size })) });
      throw new DOMException('User cancelled the local share stub', 'AbortError');
    } : undefined });
  }, { shareMode: extra.shareMode || 'unsupported' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  return { context, page, width, theme };
}
async function checkFixture(page) {
  const state = await page.evaluate(() => ({ unexpected: window.ticketDesignFixture.unexpected, blocked: window.ticketDesignFixture.blocked }));
  assert.deepEqual(state.unexpected, [], 'No unimplemented SDK reads');
  assert.deepEqual(state.blocked, [], 'No mutating API calls');
  assert.equal(await page.getByText('Visual review fixture error', { exact: true }).count(), 0, 'No render failure');
}
async function openShare(page, theme, scenario = 'populated') {
  await page.goto(fixtureUrl('my-sales', theme, scenario));
  const trigger = page.getByRole('button', { name: 'Share listing', exact: true }).first();
  await trigger.waitFor({ state: 'visible' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Share your listing', exact: true });
  await dialog.waitFor({ state: 'visible' });
  return { trigger, dialog };
}
async function checkFit(page, dialog, width) {
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(dimensions.scroll <= dimensions.client + 1, `No horizontal viewport overflow at ${width}`);
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, 'Dialog fits width');
  assert.ok(box.y >= -1 && box.y + box.height <= 845, 'Dialog fits height and can scroll internally');
}
async function downloadImage(page, dialog, kind) {
  await dialog.getByText(kind === 'Square' ? 'Square post' : kind, { exact: true }).click();
  const save = dialog.getByRole('link', { name: 'Save image', exact: true });
  await save.waitFor({ state: 'visible' });
  await page.waitForFunction(expectedFormat => [...document.querySelectorAll('[role="dialog"] a[download]')].some(link => link.download.endsWith(`-${expectedFormat}.png`)), kind.toLowerCase());
  const pending = page.waitForEvent('download');
  await save.click();
  const download = await pending;
  const path = join(evidence, `${kind.toLowerCase()}.png`);
  await download.saveAs(path);
  const bytes = await readFile(path);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Export is PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.deepEqual([width, height], kind === 'Story' ? [1080, 1920] : [1080, 1080]);
  report.png.push({ kind, width, height, bytes: bytes.length, path });
}

try {
  for (const width of [320, 390]) {
    for (const theme of ['dark', 'light']) {
      const { context, page } = await setupPage(width, theme);
      const { trigger, dialog } = await openShare(page, theme);
      await dialog.getByRole('button', { name: 'Copy link', exact: true }).waitFor({ state: 'visible' });
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some(button => button.textContent.trim() === 'Copy link' && !button.disabled));
      await checkFit(page, dialog, width);
      const text = await dialog.innerText();
      privateCanaries.forEach(value => assert.ok(!text.includes(value), `Private listing field excluded: ${value}`));
      await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__shareReview.copied.at(-1)), expectedLink);
      if (width === 390 && theme === 'dark') {
        await downloadImage(page, dialog, 'Story');
        await downloadImage(page, dialog, 'Square');
      }
      const screenshot = join(evidence, `share-${width}-${theme}.png`);
      await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate(node => document.activeElement === node), true, 'Escape returns focus to seller trigger');
      await checkFixture(page);
      report.checks.push(`Share dialog ${width}px ${theme}: fit, privacy, canonical copied link, Escape/focus${width === 390 && theme === 'dark' ? ', both PNG dimensions' : ''}`);
      await context.close();
    }
  }
  // A native share cancellation is not an error and must not trigger a download.
  {
    const { context, page } = await setupPage(390, 'dark', { shareMode: 'cancel' });
    const downloads = []; page.on('download', download => downloads.push(download.suggestedFilename()));
    const { dialog } = await openShare(page, 'dark');
    const share = dialog.getByRole('button', { name: 'Share image', exact: true });
    await share.waitFor({ state: 'visible' });
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some(button => button.textContent.trim() === 'Share image' && !button.disabled));
    await share.click();
    await page.waitForFunction(() => window.__shareReview.shared.length === 1);
    assert.equal(downloads.length, 0, 'Native share cancellation does not force-save');
    assert.equal(await dialog.getByRole('alert').count(), 0, 'Cancellation is not a failure alert');
    await checkFixture(page); report.checks.push('Stubbed native share cancellation: no fallback download or failure alert');
    await context.close();
  }
  // Fresh read invalidates an otherwise shareable row without publishing stale artwork.
  {
    const { context, page } = await setupPage(390, 'dark');
    const { dialog } = await openShare(page, 'dark', 'share-unavailable');
    await dialog.getByText(/not currently available to share/).waitFor({ state: 'visible' });
    assert.equal(await dialog.getByRole('button', { name: 'Copy link', exact: true }).count(), 0);
    assert.equal(await dialog.getByRole('link', { name: 'Save image', exact: true }).count(), 0);
    await checkFixture(page); report.checks.push('Seller inventory stale: fresh unavailable read prevents sharing');
    await context.close();
  }
  // Shared destinations and failure paths are deliberately read-only.
  for (const scenario of ['populated', 'empty', 'provider-error']) {
    const { context, page } = await setupPage(390, 'dark');
    await page.goto(fixtureUrl('shared-listing', 'dark', scenario, 'guest'));
    const heading = scenario === 'populated' ? 'Neon Orchard: After Hours'
      : scenario === 'empty' ? 'This listing isn’t available' : 'We couldn’t load this listing';
    await page.getByRole('heading', { name: heading, exact: true }).waitFor({ state: 'visible' });
    const body = await page.locator('body').innerText();
    privateCanaries.forEach(value => assert.ok(!body.includes(value), `Public destination omits private field: ${value}`));
    assert.ok(!body.includes('Sample provider failure'), 'Provider exception is not exposed');
    const handoff = page.getByRole('link', { name: 'View this ticket in PG', exact: true });
    if (scenario === 'populated') {
      assert.equal(await handoff.getAttribute('href'), '/events/fixture-night?listing=fixture-seller-active');
    } else {
      assert.equal(await handoff.count(), 0, 'Unavailable listing offers no specific-ticket CTA');
    }
    const screenshot = join(evidence, `shared-listing-${scenario}.png`);
    await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
    await checkFixture(page);
    report.checks.push(`Shared listing guest ${scenario}: exact state, privacy, local reads only`);
    await context.close();
  }
  {
    const { context, page } = await setupPage(390, 'dark');
    await page.goto(fixtureUrl('shared-event'));
    await page.getByRole('heading', { name: 'The ticket shared with you', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.pg-listing-card').count(), 1, 'Exact shared listing only');
    assert.ok((await page.locator('.pg-listing-card').innerText()).includes('Section 210'));
    assert.equal(await page.getByRole('dialog').count(), 0, 'Purchase does not auto-open');
    await checkFixture(page); report.checks.push('Signed-in event handoff: exact listing only, no purchase auto-open');
    await context.close();
  }
  assert.equal(report.errors.length, 0, `No browser runtime errors: ${report.errors.join('; ')}`);
  assert.equal(report.externalRequests.length, 0, 'No attempted external requests');
  report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.failure = error.message;
  throw error;
} finally {
  await writeFile(join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
