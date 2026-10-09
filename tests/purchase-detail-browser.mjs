import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { installFixtureIsolation } from './helpers/fixtureIsolation.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = process.argv.includes('--baseline');
process.env.PG_PURCHASE_BASELINE = baseline ? '1' : '0';
const evidence = process.env.PG_PURCHASE_EVIDENCE_DIR || `${root}tests/artifacts/oct09/purchase`;
await mkdir(evidence, { recursive: true });
const server = await createServer({ configFile: `${root}tests/fixtures/purchase-review/vite.config.mjs`, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: JSON.parse(process.env.PG_CHROMIUM_ARGS || '[]') });
const report = { baseline, comparisonBase: 'c31a2e1aa9f9c7d7916908ab948201cfad3243a8', sourceMode: baseline ? 'pinned baseline component' : 'working tree', checks: [], errors: [], blocked: [], screenshots: [] };
const origin = 'http://127.0.0.1:4188';
const url = (extra = {}) => `${origin}/tests/fixtures/purchase-review/index.html?${new URLSearchParams(extra)}`;
async function shot(page, name) { await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true }); report.screenshots.push(`${name}.png`); }
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1180, height: 757 }, reducedMotion: 'reduce' });
    const isolation = await installFixtureIsolation(context, { origin, documentPaths: ['/tests/fixtures/purchase-review/index.html'], attempts: report.blocked });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(url({ theme, metadata: 'sparse' }));
    await page.getByRole('heading', { name: 'Sale details.', exact: true }).waitFor();
    if (baseline) {
      await page.getByRole('heading', { name: 'Your purchase', exact: true }).waitFor();
      assert.equal(await page.getByText('Sale reference: fixture-sale-aaaaaaaaaaaaaaaa', { exact: true }).count(), 0);
      await shot(page, `before-seller-sparse-1180-${theme}`);
      report.checks.push(`${theme}: reproduced seller detail buyer heading/advice and missing body reference`);
    } else {
      for (const [width, height] of [[1180,757], [320,844], [375,844], [390,844], [430,844], [1280,844], [844,390]]) {
        await page.setViewportSize({ width, height });
        for (const role of ['seller', 'buyer']) for (const metadata of ['sparse', 'populated']) {
          await page.goto(url({ theme, role, metadata }));
          const summary = page.getByRole('region', { name: role === 'seller' ? 'Sale summary' : 'Order summary', exact: true });
          await summary.getByText(`${role === 'seller' ? 'Sale' : 'Transaction'} reference: fixture-sale-aaaaaaaaaaaaaaaa`, { exact: true }).waitFor();
          await summary.getByText(metadata === 'sparse' ? 'Event metadata is missing or no longer accessible.' : 'Fixture Hall', { exact: true }).waitFor();
          assert.match(await summary.innerText(), /Order total\s+\$15\.00/);
          if (role === 'seller') {
            assert.match(await summary.innerText(), /Recorded seller amount\s+\$12\.00/);
            assert.doesNotMatch(await summary.innerText(), /Your purchase|Use your ticket provider/);
            assert.match(await summary.innerText(), /Bank payout unconfirmed/);
          } else {
            assert.match(await summary.innerText(), /Use your ticket provider/);
            assert.doesNotMatch(await summary.innerText(), /Recorded seller amount/);
          }
          if (metadata === 'populated') assert.match(await summary.innerText(), /Seats\s+7–8/);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${role} ${metadata} ${theme} ${width} overflow`);
          assert.deepEqual(await page.evaluate(() => window.purchaseReview.blocked), []);
          assert.equal(await page.evaluate(() => window.purchaseReview.calls.some(call => call.name === 'Purchase.filter')), false, 'Completed context must not query legacy Purchase');
          if (width === 1180 || width === 390) await shot(page, `after-${role}-${metadata}-${width}-${theme}`);
          report.checks.push(`${role}/${metadata}/${theme}/${width}x${height}: reference, role, amounts, authorized context, no overflow or mutation`);
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url({ theme, recordLoading: '1' }));
      await page.getByText('Loading transfer details…', { exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: 'Sale summary' }).count(), 0);
      await page.evaluate(() => { window.purchaseReview.recordLoading = false; window.purchaseReview.releaseRecord(); });
      await page.getByRole('region', { name: 'Sale summary' }).waitFor();
      await page.goto(url({ theme, metadata: 'loading' }));
      await page.getByText('Loading event and seat details…', { exact: true }).waitFor();
      assert.equal(await page.getByText(/metadata is missing/).count(), 0);
      await page.evaluate(() => { window.purchaseReview.metadata = 'populated'; window.purchaseReview.releaseMetadata.forEach(resolve => resolve()); });
      await page.getByText('Fixture Hall', { exact: true }).waitFor();
      for (const metadata of ['event-error', 'listing-error', 'error']) {
        await page.goto(url({ theme, metadata }));
        const retry = page.getByRole('button', { name: 'Retry event and seat details', exact: true });
        await retry.waitFor();
        assert.equal(await page.getByText(/metadata is missing/).count(), 0);
        await page.evaluate(() => { window.purchaseReview.metadata = 'populated'; });
        await retry.focus(); await page.keyboard.press('Enter');
        await page.getByText('Fixture Hall', { exact: true }).waitFor();
        await page.getByRole('definition').filter({ hasText: '7–8' }).waitFor();
        assert.equal(await retry.count(), 0);
      }
      await page.goto(url({ theme, readFailure: '1' }));
      await page.getByText('Transaction details could not be loaded.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: 'Sale summary' }).count(), 0);
      await page.evaluate(() => { window.purchaseReview.readFailure = false; });
      await page.getByRole('button', { name: 'Retry transaction details', exact: true }).click();
      await page.getByText('Sale reference: fixture-sale-aaaaaaaaaaaaaaaa', { exact: true }).waitFor();
      await page.goto(url({ theme, route: '/purchase/fixture-sale-bbbbbbbbbbbbbbbb', metadata: 'sparse' }));
      await page.getByText('Sale reference: fixture-sale-bbbbbbbbbbbbbbbb', { exact: true }).waitFor();
      assert.equal(await page.getByText(/fixture-sale-aaaaaaaaaaaaaaaa/).count(), 0);
      for (const role of ['unauthorized', 'guest']) {
        await page.goto(url({ theme, role }));
        await page.getByText(role === 'guest' ? 'Sign in to view this transaction.' : 'This transaction is unavailable or you do not have access.', { exact: true }).waitFor();
        assert.equal(await page.getByText(/reference:|\$15\.00|Fixture Hall/).count(), 0);
        assert.equal(await page.evaluate(() => window.purchaseReview.calls.some(call => ['Purchase.filter', 'Event.filter', 'Listing.filter', 'getListingParticipantView'].includes(call.name))), false);
      }
      await page.goto(url({ theme, role: 'admin' }));
      await page.getByRole('heading', { name: 'Transaction details.', exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Your sale is complete.', exact: true }).count(), 0);
      for (const role of ['seller', 'buyer']) {
        await page.goto(url({ theme, role, pending: '1', metadata: 'listing-error' }));
        await page.getByText('Transfer context is unavailable. Your transaction reference remains available below.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: /I've Sent The Tickets|Cancel purchase|I received my tickets/ }).count(), 0);
        await page.evaluate(() => { window.purchaseReview.metadata = 'populated'; });
        await page.getByRole('button', { name: 'Retry transfer context', exact: true }).click();
        await page.getByText(role === 'seller' ? 'Transfer your tickets to the buyer' : 'Watch for your transfer email.', { exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.purchaseReview.blocked), []);
        if (role === 'seller') assert.equal(await page.getByText('You receive', { exact: true }).count(), 0, 'Missing seller amount must not fall back to order total');
      }
      report.checks.push(`${theme}: record/context loading, independent metadata failure/recovery, record failure/recovery, same-amount reference identity, guest/unauthorized denied without hydration, admin neutral`);

      await page.goto(url({ theme, route: '/my-sales', metadata: 'event-error' }));
      await page.locator('.pg-sales-history > summary').click();
      await page.getByRole('button', { name: 'Retry event details', exact: true }).first().waitFor();
      assert.equal(await page.getByText('Event details could not be loaded.', { exact: true }).count(), 2);
      await page.evaluate(() => { window.purchaseReview.metadata = 'populated'; });
      await page.getByRole('button', { name: 'Retry event details', exact: true }).first().focus();
      await page.keyboard.press('Enter');
      await page.locator('.pg-sales-history > summary').click();
      await page.getByRole('heading', { name: 'Fictional Friday concert', exact: true }).first().waitFor();
      assert.equal(await page.getByRole('button', { name: 'Retry event details', exact: true }).count(), 0);
      for (const suffix of ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']) assert.equal(await page.getByText(`Sale reference: fixture-sale-${suffix}`, { exact: true }).count(), 1);
      report.checks.push(`${theme}: R12 sparse hydration failure and successful retry preserve two full same-date/amount references`);
      const settings = stripe => url({ theme, route: '/account-settings#payouts', stripe, history: 'mixed' });
      const payout = page.getByRole('region', { name: 'Payout account setup', exact: true });
      await page.goto(settings('loading'));
      await payout.getByText('Checking Stripe status…', { exact: true }).waitFor();
      assert.equal(await payout.getByRole('button', { name: /Stripe Setup/ }).count(), 0);
      await page.evaluate(() => { window.purchaseReview.stripe = 'missing-readiness'; window.purchaseReview.releaseStripe(); });
      await payout.getByText('Payout status not confirmed', { exact: true }).waitFor();
      await page.goto(settings('error'));
      await payout.getByText('Stripe status unavailable', { exact: true }).waitFor();
      assert.equal(await payout.getByRole('button', { name: /Stripe Setup/ }).count(), 0);
      await page.evaluate(() => { window.purchaseReview.stripe = 'missing-readiness'; });
      await payout.getByRole('button', { name: 'Retry Stripe status', exact: true }).click();
      await payout.getByText('Payout status not confirmed', { exact: true }).waitFor();
      await page.goto(settings('disconnected'));
      await payout.getByText('Stripe setup incomplete', { exact: true }).waitFor();
      await payout.getByRole('button', { name: 'Continue Stripe Setup', exact: true }).waitFor();
      assert.equal(await payout.getByText('Payouts enabled', { exact: true }).count(), 0);
      await page.getByText('Amount incomplete', { exact: true }).waitFor();
      await shot(page, `after-payout-disconnected-390-${theme}`);
      assert.deepEqual(await page.evaluate(() => window.purchaseReview.blocked), []);
      report.checks.push(`${theme}: R17 loading/error/retry/disconnected/missing-readiness, no setup actions; mixed finite/missing seller amount incomplete`);
    }
    await isolation.assertClean();
    await context.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, []);
  report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.failure = error.message; throw error;
} finally {
  await writeFile(`${evidence}/${baseline ? 'before' : 'after'}-result.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
console.log(JSON.stringify({ status: report.status, baseline, checks: report.checks.length, errors: report.errors.length, blocked: report.blocked.length, screenshots: report.screenshots.length }));
