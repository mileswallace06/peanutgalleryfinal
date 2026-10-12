/** Actual Fan Gift sheet, local synthetic files/SDK only. No upload or create endpoint runs. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { installFixtureIsolation } from './helpers/fixtureIsolation.mjs';

const baseline = process.argv.includes('--baseline');
const comparisonBase = '3a56073ba06f9f25b42844d2ca67068dafd4c554';
process.env.PG_FAN_GIFT_UPLOAD_BASELINE = baseline ? comparisonBase : '';
const output = path.resolve(process.env.PG_FAN_GIFT_UPLOAD_EVIDENCE_DIR || `tests/artifacts/oct09/fan-gift-upload/${baseline ? 'before' : 'after'}`);
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: fileURLToPath(new URL('./fixtures/oct09-lifecycle/vite.config.mjs', import.meta.url)), logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: JSON.parse(process.env.PG_CHROMIUM_ARGS || '[]') });
const origin = 'http://127.0.0.1:4187';
const report = { baseline, comparisonBase, sourceMode: baseline ? 'pinned baseline component' : 'working tree', fixtureOnly: true, browser: browser.version(), checks: [], errors: [], blocked: [], screenshots: [] };
const fixtureFile = { name: 'synthetic-proof.png', mimeType: 'image/png', buffer: Buffer.from('SYNTHETIC TEST FILE - NOT A TICKET') };
const recoveryText = 'We could not upload your proof. Your seat details are saved in this form. Choose the same file or another image to retry.';
let current;
async function open(theme, scheduled) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await installFixtureIsolation(context, { origin, documentPaths: ['/tests/fixtures/oct09-lifecycle/index.html'], attempts: report.blocked });
  const page = await context.newPage(); current = page; page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${origin}/tests/fixtures/oct09-lifecycle/index.html?${new URLSearchParams({ route: '/upgrades/fixture-live', phase: 'live', role: 'user', theme, allowFixtureUpload: '1' })}`);
  await page.getByRole('button', { name: 'Fan Gifts', exact: true }).click();
  await page.getByRole('button', { name: '+ Drop Seats', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Create Flash Drop/ });
  await dialog.getByRole('button', { name: scheduled ? /Scheduled Drop/ : /Immediate Drop/ }).click();
  await dialog.getByRole('textbox', { name: 'Section *', exact: true }).fill('104');
  await dialog.getByRole('textbox', { name: 'Row', exact: true }).fill('B');
  await dialog.getByRole('textbox', { name: 'Seats', exact: true }).fill('7–8');
  await dialog.getByRole('textbox', { name: 'Message (optional)', exact: true }).fill('Synthetic draft retained');
  return { page, context, dialog };
}
async function assertClean(page, uploads) {
  assert.deepEqual(await page.evaluate(() => ({ writes: window.lifecycleFixture.writes, created: window.lifecycleFixture.created, blocked: window.ticketDesignFixture.blocked, unexpected: window.ticketDesignFixture.unexpected })), { writes: [], created: [], blocked: [], unexpected: [] });
  assert.equal(await page.evaluate(() => window.lifecycleFixture.uploads.length), uploads);
}
async function shot(page, name) { await page.screenshot({ path: path.join(output, name), fullPage: true }); report.screenshots.push(name); }
try {
  for (const theme of ['light', 'dark']) for (const scheduled of [false, true]) for (const outcome of ['reject', 'malformed']) {
    const { page, context, dialog } = await open(theme, scheduled);
    const input = dialog.locator('input[type="file"]');
    await page.evaluate(outcome => { window.lifecycleFixture.uploadOutcome = outcome; }, outcome);
    await input.setInputFiles(fixtureFile);
    await page.waitForFunction(() => window.lifecycleFixture.pendingUploads.length === 1);
    assert.equal(await input.isDisabled(), true);
    if (!scheduled) assert.equal(await dialog.getByRole('button', { name: 'Drop Now', exact: true }).isDisabled(), true);
    else {
      await dialog.getByRole('button', { name: 'Next: Schedule', exact: true }).click();
      await dialog.getByRole('button', { name: 'Halftime', exact: true }).click();
      assert.equal(await dialog.getByRole('button', { name: 'Schedule Drop', exact: true }).isDisabled(), true);
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    }
    await page.evaluate(() => window.lifecycleFixture.pendingUploads[0]());
    await dialog.getByRole('alert').filter({ hasText: recoveryText }).waitFor();
    assert.equal(await input.isEnabled(), true);
    assert.equal(await input.inputValue(), '', 'Native file selection clears, so choosing the same file fires change');
    if (!scheduled) assert.equal(await dialog.getByRole('button', { name: 'Drop Now', exact: true }).isEnabled(), true);
    else {
      await dialog.getByRole('button', { name: 'Next: Schedule', exact: true }).click();
      assert.equal(await dialog.getByRole('button', { name: 'Schedule Drop', exact: true }).isEnabled(), true);
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    }
    assert.equal(await dialog.getByRole('textbox', { name: 'Section *', exact: true }).inputValue(), '104');
    assert.equal(await dialog.getByRole('textbox', { name: 'Row', exact: true }).inputValue(), 'B');
    assert.equal(await dialog.getByRole('textbox', { name: 'Seats', exact: true }).inputValue(), '7–8');
    assert.equal(await dialog.getByRole('textbox', { name: 'Message (optional)', exact: true }).inputValue(), 'Synthetic draft retained');
    if (outcome === 'reject' && !scheduled) await shot(page, `after-rejected-${theme}.png`);
    await page.evaluate(() => { window.lifecycleFixture.uploadOutcome = 'success'; });
    await input.setInputFiles(fixtureFile);
    await page.waitForFunction(() => window.lifecycleFixture.pendingUploads.length === 2);
    assert.equal(await dialog.getByRole('alert').count(), 0);
    await page.evaluate(() => window.lifecycleFixture.pendingUploads[1]());
    await dialog.locator('.pg-gift-uploaded').waitFor();
    assert.match(await dialog.locator('.pg-gift-uploaded').innerText(), /Proof uploaded/);
    if (scheduled) {
      await dialog.getByRole('button', { name: 'Next: Schedule', exact: true }).click();
      assert.equal(await dialog.getByRole('button', { name: 'Halftime', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await dialog.getByRole('button', { name: 'Schedule Drop', exact: true }).isEnabled(), true);
    } else assert.equal(await dialog.getByRole('button', { name: 'Drop Now', exact: true }).isEnabled(), true);
    assert.deepEqual(await page.evaluate(() => window.lifecycleFixture.uploads.map(({ name, type, size }) => ({ name, type, size }))), Array(2).fill({ name: fixtureFile.name, type: fixtureFile.mimeType, size: fixtureFile.buffer.length }));
    await assertClean(page, 2); await context.close();
    report.checks.push(`${theme}/${scheduled ? 'scheduled' : 'immediate'}/${outcome}: busy blocks submission, failure clears busy, draft retained, same-file retry succeeds`);
  }
  for (const outcome of ['reject', 'success']) {
    const { page, context, dialog } = await open('light', false);
    await page.evaluate(outcome => { window.lifecycleFixture.uploadOutcome = outcome; }, outcome);
    await dialog.locator('input[type="file"]').setInputFiles(fixtureFile);
    await page.waitForFunction(() => window.lifecycleFixture.pendingUploads.length === 1);
    await dialog.getByRole('button', { name: 'Close fan gift form', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '+ Drop Seats', exact: true }).click();
    await dialog.getByRole('button', { name: /Immediate Drop/ }).click();
    await page.evaluate(() => window.lifecycleFixture.pendingUploads[0]());
    // Flush promise callbacks across a browser task; no timing-dependent sleep.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await dialog.getByRole('alert').count(), 0);
    assert.equal(await dialog.locator('.pg-gift-uploaded').count(), 0);
    assert.equal(await dialog.locator('input[type="file"]').isEnabled(), true);
    await assertClean(page, 1); await context.close();
    report.checks.push(`late ${outcome} after close/reopen cannot alter the new draft`);
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, []); report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.failure = error.message;
  if (current && !current.isClosed()) {
    report.observed = await current.evaluate(() => ({ uploadInputDisabled: document.querySelector('[role="dialog"] input[type="file"]')?.disabled, submissionDisabled: [...document.querySelectorAll('[role="dialog"] button')].find(button => /^(Drop Now|Schedule Drop)$/.test(button.textContent.trim()))?.disabled, uploadingText: document.body.innerText.includes('Uploading…'), errors: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent), uploads: window.lifecycleFixture?.uploads, forbiddenWrites: window.lifecycleFixture?.writes }));
    await shot(current, 'failure.png');
  }
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
console.log(JSON.stringify({ status: report.status, baseline, checks: report.checks.length, errors: report.errors.length, blocked: report.blocked.length, output }));
