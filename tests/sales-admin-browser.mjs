/** Local fixture-only sales/admin presentation checks. No financial/admin actions.
 * Starts an isolated Vite server unless PG_SALES_REVIEW_URL is supplied.
 * Tooling: PG_PLAYWRIGHT_MODULE, PG_CHROMIUM_PATH, PG_CHROMIUM_ARGS (JSON).
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const base = new URL(process.env.PG_SALES_REVIEW_URL || 'http://127.0.0.1:4180');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only isolated local fixtures are allowed');
const server = process.env.PG_SALES_REVIEW_URL ? null : await createServer({
  configFile: fileURLToPath(new URL('./fixtures/ticket-design/vite.config.mjs', import.meta.url)),
  server: { host: '127.0.0.1', port: Number(base.port), strictPort: true, hmr: false },
});
if (server) await server.listen();
const { chromium } = process.env.PG_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PG_PLAYWRIGHT_MODULE).href)
  : await import('playwright').catch(() => import('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const executablePath = process.env.PG_CHROMIUM_PATH || process.env.PG_TEST_CHROMIUM;
const browser = await chromium.launch({ headless: true, args: process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [], ...(executablePath ? { executablePath } : {}) });
const evidence = process.env.PG_SALES_EVIDENCE_DIR || '/tmp/pg-sales-admin-browser';
await mkdir(evidence, { recursive: true });
const report = { fixtureOnly: true, checks: [], screenshots: [], externalRequests: [], errors: [], widths: [320,375,390,430,1280], themes: ['light','dark'], physicalDevice: false };
const fixtureUrl = (page, theme, extra = {}) => `${base.origin}/tests/fixtures/ticket-design/app.html?${new URLSearchParams({ page, theme, ...extra })}`;

async function isolatedPage(width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === base.origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    report.externalRequests.push({ origin: url.origin, path: url.pathname });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  return { context, page, width, theme };
}
async function assertSafe(page) {
  const fixture = await page.evaluate(() => ({ blocked: window.ticketDesignFixture?.blocked, unexpected: window.ticketDesignFixture?.unexpected }));
  assert.deepEqual(fixture.unexpected, [], 'Only explicitly mocked SDK operations');
  assert.deepEqual(fixture.blocked, [], 'No mutating SDK action attempted');
  assert.equal(await page.getByText('Visual review fixture error', { exact: true }).count(), 0);
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(dimensions.scroll <= dimensions.client + 1, `No page horizontal overflow: ${dimensions.scroll}/${dimensions.client}`);
}
async function capture(page, name) {
  const path = join(evidence, `${name}.png`);
  await page.screenshot({ path }); report.screenshots.push(path);
}
try {
  for (const theme of report.themes) {
    const { context, page } = await isolatedPage(390, theme);
    const settings = extra => fixtureUrl('account-settings', theme, { route: '/account-settings#payouts', ...extra });
    const payout = page.getByRole('region', { name: 'Payout account setup', exact: true });
    await page.goto(settings({ stripeState: 'checking' }));
    await payout.getByText('Checking Stripe status…', { exact: true }).waitFor();
    assert.equal(await payout.getByText('Not connected', { exact: true }).count(), 0);
    assert.equal(await payout.getByRole('button', { name: /(?:Continue|Review) Stripe Setup/ }).count(), 0);
    await page.waitForFunction(() => typeof window.ticketDesignFixture.resolveStripeCheck === 'function');
    await capture(page, `settings-payout-checking-${theme}`);
    await page.evaluate(() => window.ticketDesignFixture.resolveStripeCheck());
    await payout.getByText('Payout status not confirmed', { exact: true }).waitFor();
    assert.equal(await payout.getByText('Payouts enabled', { exact: true }).count(), 0);
    await payout.getByRole('button', { name: 'Review Stripe Setup', exact: true }).waitFor();
    await capture(page, `settings-payout-unconfirmed-${theme}`);
    await assertSafe(page);
    report.checks.push(`Settings ${theme}: initial checking has no false disconnected/setup prompt; legacy charge-only response leaves payout readiness unconfirmed`);

    await page.goto(settings({ stripeState: 'retry' }));
    await payout.getByText('Stripe status unavailable', { exact: true }).waitFor();
    assert.equal(await payout.getByRole('button', { name: /(?:Continue|Review) Stripe Setup/ }).count(), 0);
    await capture(page, `settings-payout-error-${theme}`);
    const retry = payout.getByRole('button', { name: 'Retry Stripe status', exact: true });
    await retry.focus(); await page.keyboard.press('Enter');
    await payout.getByText('Payout status not confirmed', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.ticketDesignFixture.calls.filter(c => c.name === 'functions.checkSellerOnboarding').length), 2);
    await assertSafe(page);
    report.checks.push(`Settings ${theme}: failed check exposes keyboard retry, recovers without onboarding and without false account state`);

    for (const stripeState of ['payouts-disabled', 'payouts-enabled', 'malformed', 'incomplete']) {
      await page.goto(settings({ stripeState }));
      const expected = { 'payouts-disabled': 'Payouts disabled', 'payouts-enabled': 'Payouts enabled', malformed: 'Stripe status unavailable', incomplete: 'Payout status not confirmed' }[stripeState];
      await payout.getByText(expected, { exact: true }).waitFor();
      if (stripeState !== 'payouts-enabled') assert.equal(await payout.getByText('Payouts enabled', { exact: true }).count(), 0);
      if (stripeState === 'incomplete') await payout.getByRole('button', { name: 'Continue Stripe Setup', exact: true }).waitFor();
      if (stripeState === 'payouts-disabled') await capture(page, `settings-payout-disabled-${theme}`);
      await assertSafe(page);
      report.checks.push(`Settings ${theme}: ${stripeState} status is explicit; no automatic Stripe onboarding`);
    }
    await context.close();
  }
  for (const width of report.widths) for (const theme of report.themes) {
    const { context, page } = await isolatedPage(width, theme);
    await page.goto(fixtureUrl('my-sales', theme, { salesState: 'sparse' }));
    const history = page.locator('.pg-sales-history');
    await history.getByText('Sale reference: fixture-missing-sale-a', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await history.getByText('Sale reference: fixture-missing-sale-b', { exact: true }).count(), 1);
    assert.equal(await history.getByText('Event details unavailable', { exact: true }).count(), 2);
    assert.equal(await history.getByText('Payment capture not confirmed', { exact: true }).count(), 3);
    assert.equal(await history.getByText('Recorded seller amount: Amount unavailable', { exact: true }).count(), 2);
    assert.equal(await history.getByText('Payment captured', { exact: true }).count(), 1);
    assert.doesNotMatch(await history.innerText(), /paid out|pending payout|Stripe deposits|not yet captured/i);
    assert.match(await history.innerText(), /Bank payout status is unavailable/);
    await history.scrollIntoViewIfNeeded();
    await capture(page, `sales-sparse-${width}-${theme}`);
    await assertSafe(page);
    report.checks.push(`MySales ${width}px ${theme}: sparse distinct sale references, unavailable amounts, capture/unknown states, no bank-payout claim, no horizontal overflow`);

    await page.goto(fixtureUrl('admin', theme, { queueState: 'open-only' }));
    const queues = page.getByRole('region', { name: 'Separate operational queues' });
    await queues.getByText('1 in loaded records', { exact: true }).first().waitFor();
    assert.equal(await queues.getByText('1 in loaded records', { exact: true }).count(), 3);
    await page.getByText('No matching issues in the loaded transaction feed.', { exact: true }).waitFor();
    assert.match(await page.locator('.pg-command-center').innerText(), /does not clear the separate alert, review or transfer intelligence queues/);
    assert.equal(await page.getByRole('button', { name: 'Refresh admin dashboard and queues', exact: true }).count(), 1);
    await capture(page, `admin-scoped-queues-${width}-${theme}`);
    await assertSafe(page);
    report.checks.push(`Admin ${width}px ${theme}: clear loaded transaction feed plus alert1/review1/reverify1, explicit bounded scopes and named refresh`);
    await context.close();
  }
  {
    const { context, page } = await isolatedPage(390, 'light');
    await page.goto(fixtureUrl('my-sales', 'light', { salesState: 'sparse', hydrationState: 'error' }));
    const retry = page.getByRole('button', { name: 'Retry event details', exact: true }).first();
    await retry.waitFor();
    assert.ok(await page.getByText('Event details could not be loaded.', { exact: true }).count() > 0);
    const before = await page.evaluate(() => window.ticketDesignFixture.calls.filter(c => c.name === 'entities.Event.filter').length);
    await retry.focus(); await page.keyboard.press('Enter');
    await retry.waitFor();
    const after = await page.evaluate(() => window.ticketDesignFixture.calls.filter(c => c.name === 'entities.Event.filter').length);
    assert.ok(after > before, 'Keyboard retry re-reads authorized event metadata');
    assert.equal(await page.getByText('Sale reference: fixture-missing-sale-a', { exact: true }).count(), 1);
    await assertSafe(page);
    report.checks.push('MySales hydration failure remains separate from missing metadata; Enter retry re-reads while preserving sale reference');

    await page.goto(fixtureUrl('my-sales', 'light', { scenario: 'provider-error' }));
    await page.getByRole('heading', { name: 'Failed to load sales' }).waitFor();
    await page.getByRole('button', { name: 'Try Again', exact: true }).click();
    await page.getByRole('heading', { name: 'Failed to load sales' }).waitFor();
    await assertSafe(page);
    report.checks.push('MySales participant failure shows error and working retry without false zero/empty success');

    await page.goto(fixtureUrl('sell', 'light', { salesState: 'sparse' }));
    const stat = page.locator('.pg-sell-stats > div').filter({ hasText: 'Completed sales' });
    await stat.getByText('4', { exact: true }).waitFor();
    await assertSafe(page);
    await page.goto(fixtureUrl('me', 'light', { salesState: 'sparse' }));
    await page.getByText('Fan activity', { exact: true }).click();
    const profileStat = page.locator('.pg-points-card').getByText('Completed sales', { exact: true }).locator('..');
    await profileStat.getByText('4', { exact: true }).waitFor();
    await assertSafe(page);
    report.checks.push('Sell and Me show the same 4 completed authorized sales, including sparse archived history');

    await page.goto(fixtureUrl('account-settings', 'light', { salesState: 'sparse', route: '/account-settings#payouts' }));
    await page.getByRole('region', { name: 'Payout account setup', exact: true }).waitFor();
    await page.getByText('Amount incomplete', { exact: true }).waitFor();
    assert.equal(await page.getByText('Completed seller amounts', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Earned', { exact: true }).count(), 0);
    await capture(page, 'settings-incomplete-recorded-amounts');
    await assertSafe(page);
    report.checks.push('Settings sparse seller amounts are incomplete, never verified zero or bank deposits');

    await page.goto(fixtureUrl('account-settings', 'light', { scenario: 'provider-error', route: '/account-settings#payouts' }));
    await page.getByRole('button', { name: 'Retry transaction history' }).waitFor();
    assert.ok(await page.getByText('Unavailable', { exact: true }).count() >= 2);
    await page.getByRole('button', { name: 'Retry transaction history' }).click();
    await page.getByRole('button', { name: 'Retry transaction history' }).waitFor();
    await assertSafe(page);
    report.checks.push('Settings history failure is unavailable with retry, not a verified $0.00');

    await page.goto(fixtureUrl('admin', 'light', { queueState: 'error' }));
    const queues = page.getByRole('region', { name: 'Separate operational queues' });
    await queues.getByText('Unavailable — retry', { exact: true }).first().waitFor();
    assert.equal(await queues.getByText('Unavailable — retry', { exact: true }).count(), 3);
    await page.getByText('Transaction issues could not be loaded.', { exact: false }).waitFor();
    assert.equal(await page.getByText('No matching issues in the loaded transaction feed.', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Alert Center', exact: true }).click();
    await page.getByRole('button', { name: 'Retry alerts', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh Alert Center', exact: true }).click();
    await page.getByRole('button', { name: 'Retry alerts', exact: true }).waitFor();
    await assertSafe(page);
    report.checks.push('Admin queue/feed failures show unavailable; Alert Center refresh and retry remain named and operable');

    await page.goto(fixtureUrl('admin', 'light', { queueState: 'open-only' }));
    await page.getByText('No matching issues in the loaded transaction feed.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Review Queue', exact: true }).click();
    await page.getByRole('heading', { name: 'Pending Review Queue', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh pending review queue', exact: true }).waitFor();
    assert.match(await page.locator('.pg-command-center').innerText(), /1 loaded listings awaiting approval/);
    await page.getByRole('button', { name: 'Transfer Intelligence', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh transfer intelligence', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Needs Attention (1 loaded)', exact: true }).waitFor();
    await assertSafe(page);
    report.checks.push('Review and transfer intelligence windows expose 1 loaded item, named refresh controls, authorized event identity');

    await page.goto(fixtureUrl('seller-payout-guide', 'light'));
    const payoutLink = page.locator('a[href="/account-settings#payouts"]').first();
    await payoutLink.waitFor(); await payoutLink.click();
    const payout = page.getByRole('region', { name: 'Payout account setup', exact: true });
    await payout.waitFor();
    assert.equal(await payout.locator('button[aria-controls="payout-account-details"]').getAttribute('aria-expanded'), 'true');
    assert.equal(await payout.locator('#payout-account-details').isVisible(), true);
    await assertSafe(page);
    report.checks.push('Guide payout link reaches and expands Settings payout section; no Stripe onboarding invoked; timing policy remains owner-blocked');
    await context.close();
  }
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.errors, []);
  report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.failure = error.stack || error.message; throw error;
} finally {
  await writeFile(join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  if (server) await server.close();
}
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, screenshots: report.screenshots.length, evidence }, null, 2));
