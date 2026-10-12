/** Actual purchase page; cancellation and reads are synthetic, egress denied. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { installFixtureIsolation } from './helpers/fixtureIsolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = process.argv.includes('--baseline');
const comparisonBase = '9d7aa593d8d6a8177eac7fb37d4d2cfc0fe99e84';
process.env.PG_PURCHASE_BASELINE = '0';
process.env.PG_PURCHASE_RECOVERY_SOURCE_REF = baseline ? comparisonBase : '';
process.env.PG_PURCHASE_PORT = '4197';
const output = path.resolve(process.env.PG_CANCELLATION_EVIDENCE_DIR || `tests/artifacts/oct12/purchase-cancellation/${baseline ? 'before' : 'after'}`);
await mkdir(output, { recursive: true });
const report = { baseline, comparisonBase, fixtureOnly: true, checks: [], errors: [], blocked: [], screenshots: [] };
const recovery = 'The cancellation result could not be confirmed. Refresh this page to check the latest status before trying again.';
const server = await createServer({ configFile: `${root}tests/fixtures/purchase-review/vite.config.mjs`, logLevel: 'error' });
let browser, current;
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function screenshot(page, name) { await page.screenshot({ path: path.join(output, name), fullPage: true }); report.screenshots.push(name); }
try {
  await server.listen();
  const origin = 'http://127.0.0.1:4197';
  browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: JSON.parse(process.env.PG_CHROMIUM_ARGS || '[]') });
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const isolation = await installFixtureIsolation(context, { origin, documentPaths: ['/tests/fixtures/purchase-review/index.html'], attempts: report.blocked });
    const page = await context.newPage(); current = page; page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    let accept = true, confirmations = 0;
    page.on('dialog', async dialog => {
      assert.equal(dialog.type(), 'confirm');
      assert.equal(dialog.message(), 'Cancel this purchase? The payment will be refunded.');
      confirmations++;
      if (accept) await dialog.accept(); else await dialog.dismiss();
    });
    const url = `${origin}/tests/fixtures/purchase-review/index.html?${new URLSearchParams({ theme, role: 'buyer', pending: '1', cancelRecovery: '1' })}`;
    const cancel = page.getByRole('button', { name: 'Cancel purchase & refund', exact: true });
    const dispute = page.getByRole('button', { name: 'Open a dispute', exact: true });
    for (const mode of ['reject', 'missing', 'string', 'server-error']) {
      await page.goto(url); await cancel.waitFor(); await dispute.waitFor();
      await page.evaluate(mode => { window.purchaseReview.cancelMode = mode; }, mode);
      await cancel.click();
      await page.waitForFunction(() => window.purchaseReview.pendingCancellations.length === 1);
      assert.equal(await cancel.isDisabled(), true); assert.equal(await dispute.isDisabled(), true);
      const readsBefore = await page.evaluate(() => window.purchaseReview.calls.filter(call => call.name === 'getPurchaseParticipantView').length);
      await page.evaluate(() => window.purchaseReview.pendingCancellations[0]());
      await page.getByRole('alert').filter({ hasText: mode === 'server-error' ? 'Synthetic cancellation is unavailable.' : recovery }).waitFor();
      assert.equal(await cancel.isEnabled(), true); assert.equal(await dispute.isEnabled(), true);
      assert.equal(await page.getByText('Purchase Cancelled', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('region', { name: 'Order summary', exact: true }).getByText('Transaction reference: fixture-sale-aaaaaaaaaaaaaaaa', { exact: true }).count(), 1);
      await settle(page);
      const state = await page.evaluate(() => ({ cancellations: window.purchaseReview.cancellationRequests, reads: window.purchaseReview.calls.filter(call => call.name === 'getPurchaseParticipantView').length, blocked: window.purchaseReview.blocked }));
      assert.deepEqual(state.cancellations, [{ purchase_id: 'fixture-sale-aaaaaaaaaaaaaaaa' }]);
      assert.equal(state.reads, readsBefore, 'An uncertain/error response must not enter the success read-back path');
      assert.deepEqual(state.blocked, []);
      if (mode === 'reject') {
        await screenshot(page, `recovered-${theme}.png`);
        // Follow the recovery instruction: read the current status before retry.
        await page.reload(); await cancel.waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.equal(await page.evaluate(() => window.purchaseReview.cancellationRequests.length), 0);
        await page.evaluate(() => { window.purchaseReview.cancelMode = 'success'; });
        await cancel.click(); await page.waitForFunction(() => window.purchaseReview.pendingCancellations.length === 1);
        assert.equal(await cancel.isDisabled(), true);
        await page.evaluate(() => window.purchaseReview.pendingCancellations[0]());
        await page.getByText('Purchase Cancelled', { exact: true }).waitFor();
        assert.equal(await cancel.count(), 0);
        assert.equal(await page.evaluate(() => window.purchaseReview.cancellationRequests.length), 1);
        assert.equal(await page.evaluate(() => window.purchaseReview.calls.filter(call => call.name === 'getPurchaseParticipantView').length), 2, 'Confirmed success reads back the purchase');
        assert.equal(await page.getByRole('alert').count(), 0);
        await screenshot(page, `retry-success-${theme}.png`);
      }
      report.checks.push(`${theme}/${mode}: pending controls disable, failure releases them, truthful error, original reference, no automatic repeat${mode === 'reject' ? '; refresh then explicit retry succeeds with read-back' : ''}`);
    }
    await page.goto(url); await cancel.waitFor(); accept = false; await cancel.click();
    assert.equal(await cancel.isEnabled(), true); assert.equal(await dispute.isEnabled(), true);
    assert.equal(await page.evaluate(() => window.purchaseReview.cancellationRequests.length), 0);
    report.checks.push(`${theme}: declining confirmation makes no cancellation request`);
    assert.equal(confirmations, 6);
    await isolation.assertClean(); await context.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, []); report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.failure = error.message;
  if (current && !current.isClosed()) {
    report.observed = await current.evaluate(() => ({ cancelDisabled: document.querySelector('.pg-purchase-cancel')?.disabled, alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent), cancellations: window.purchaseReview.cancellationRequests }));
    await screenshot(current, 'failure.png');
  }
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.close();
}
console.log(JSON.stringify({ status: report.status, baseline, checks: report.checks.length, errors: report.errors.length, blocked: report.blocked.length }));
