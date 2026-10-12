/** Actual PurchaseSuccess -> readPurchaseContext -> actual endpoint response -> TransferAssistant. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { installFixtureIsolation } from './helpers/fixtureIsolation.mjs';
import { privateListingFields } from './helpers/listingParticipantFixture.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
process.env.PG_PURCHASE_PORT = '4196';
process.env.PG_PURCHASE_BASELINE = '0';
const before = !!process.env.PG_PURCHASE_LISTING_SOURCE_REF;
const evidence = process.env.PG_TRANSFER_PLATFORM_EVIDENCE_DIR || `${root}tests/artifacts/oct09/transfer-platform`;
await mkdir(evidence, { recursive: true });
const server = await createServer({ configFile: `${root}tests/fixtures/purchase-review/vite.config.mjs`, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: JSON.parse(process.env.PG_CHROMIUM_ARGS || '[]') });
const report = { sourceRef: process.env.PG_PURCHASE_LISTING_SOURCE_REF || 'working tree', checks: [], errors: [], blocked: [], screenshots: [] };
const origin = 'http://127.0.0.1:4196';
const url = extra => `${origin}/tests/fixtures/purchase-review/index.html?${new URLSearchParams({ pending: '1', ...extra })}`;
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const isolation = await installFixtureIsolation(context, { origin, documentPaths: ['/tests/fixtures/purchase-review/index.html'], attempts: report.blocked });
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    for (const [platform, label, href] of [['ticketmaster', 'Ticketmaster', 'https://www.ticketmaster.com/member/tickets'], ['axs', 'AXS', 'https://www.axs.com/myaccount/tickets']]) {
      await page.goto(url({ theme, platform, role: 'seller' }));
      await page.getByText('Transfer your tickets to the buyer', { exact: true }).waitFor();
      const link = page.getByRole('link', { name: new RegExp(`Open ${label}$`) });
      const shown = await link.count();
      await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-${platform}-${theme}.png`, fullPage: true });
      report.screenshots.push(`${before ? 'before' : 'after'}-${platform}-${theme}.png`);
      assert.equal(shown, 1, `Authorized ${platform} listing must show Open ${label} on actual PurchaseSuccess`);
      assert.equal(await link.getAttribute('href'), href);
      assert.equal(await page.getByText('Open your ticket app and transfer to the email above.', { exact: true }).count(), 0);
      const fixture = await page.evaluate(() => ({ responses: window.purchaseReview.listingResponses, calls: window.purchaseReview.calls, blocked: window.purchaseReview.blocked }));
      assert.equal(fixture.responses[0].listing.transfer_platform, platform);
      for (const key of Object.keys(privateListingFields)) assert.equal(Object.hasOwn(fixture.responses[0].listing, key), false, `No ${key} in browser response`);
      assert.doesNotMatch(JSON.stringify(fixture.responses), /PRIVATE_/);
      assert.equal(fixture.calls.some(call => call.name === 'Listing.filter'), false, 'No fallback to raw Listing');
      assert.deepEqual(fixture.blocked, []);
      report.checks.push(`${theme}/${platform}: actual authorized projection reaches seller guidance, exact provider link, no extra private fields or mutation`);
    }
    await page.goto(url({ theme, role: 'seller', platform: 'PRIVATE_UNKNOWN_PLATFORM' }));
    await page.getByText('Open your ticket app and transfer to the email above.', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.purchaseReview.listingResponses))[0].listing.transfer_platform, null);
    assert.equal(await page.getByRole('link', { name: /Open Ticketmaster|Open AXS/ }).count(), 0);
    report.checks.push(`${theme}: unknown platform stays generic without copying arbitrary field contents`);
    for (const role of ['buyer', 'admin', 'unauthorized', 'guest']) {
      await page.goto(url({ theme, role, platform: 'ticketmaster' }));
      await page.getByText(role === 'buyer' ? 'Watch for your transfer email.' : role === 'admin' ? 'Transaction reference: fixture-sale-aaaaaaaaaaaaaaaa' : role === 'guest' ? 'Sign in to view this transaction.' : 'This transaction is unavailable or you do not have access.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: /Open Ticketmaster$/ }).count(), 0);
      if (['unauthorized', 'guest'].includes(role)) assert.equal(await page.evaluate(() => window.purchaseReview.calls.some(call => ['getListingParticipantView', 'Listing.filter', 'Purchase.filter', 'Event.filter'].includes(call.name))), false);
      report.checks.push(`${theme}/${role}: no seller transfer guidance or unauthorized context hydration`);
    }
    await isolation.assertClean(); await context.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, []); report.status = 'PASSED';
} catch (error) { report.status = 'FAILED'; report.failure = error.message; throw error; }
finally { await writeFile(`${evidence}/${before ? 'before' : 'after'}-result.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, errors: report.errors.length, blocked: report.blocked.length }));
