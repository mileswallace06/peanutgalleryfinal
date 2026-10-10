import assert from 'node:assert/strict';
import { installFixtureIsolation } from './helpers/fixtureIsolation.mjs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const before = process.env.PG_IDENTITY_CAPTURE_BEFORE === '1';
const output = process.env.PG_IDENTITY_EVIDENCE_DIR || '.artifacts/event-identity';
await mkdir(output, { recursive: true });
const server = process.env.PG_IDENTITY_REVIEW_URL ? null : await createServer({ configFile: 'tests/fixtures/event-identity/vite.config.mjs' });
await server?.listen();
const origin = process.env.PG_IDENTITY_REVIEW_URL || 'http://127.0.0.1:4179';
const browser = await chromium.launch({ executablePath: process.env.PG_CHROMIUM_PATH || undefined, args: JSON.parse(process.env.PG_CHROMIUM_ARGS || '[]') });
const errors = [], outbound = [];
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 757 } });
  page.on('pageerror', error => errors.push(error.message));
  const isolation = await installFixtureIsolation(page.context(), { origin, documentPaths: ['/tests/fixtures/event-identity/index.html'], attempts: outbound });
  const open = async (route, theme) => page.goto(`${origin}/tests/fixtures/event-identity/index.html?route=${encodeURIComponent(route)}&theme=${theme}`);
  const capture = (surface, theme) => page.screenshot({ path: `${output}/${before ? 'before' : 'after'}-${surface}-${theme}.png`, fullPage: true });
  const safe = async () => {
    const state = await page.evaluate(() => window.ticketDesignFixture);
    assert.deepEqual(state.blocked, []); assert.deepEqual(state.unexpected, []);
    assert.equal(state.calls.some(call => /\.create$|\.update$|\.delete$|UploadFile|releaseDemoUpgrades/.test(call.name)), false);
  };
  for (const theme of ['light', 'dark']) {
    await open('/composer', theme);
    await page.getByRole('button', { name: 'Open fixture composer' }).click();
    await page.getByRole('button', { name: /Tag an event/ }).click();
    await page.getByRole('textbox', { name: 'Search events' }).fill('Fixture Hail');
    await page.locator('.pg-composer-event-option').first().waitFor();
    const labels = await page.locator('.pg-composer-event-option').allTextContents();
    assert.equal(labels.length, 2);
    assert.equal(new Set(labels).size, before ? 1 : 2);
    if (!before) {
      assert.ok(labels.every(label => /Identity unconfirmed/.test(label) && /venue time unconfirmed/.test(label) && /2026/.test(label)));
      await page.getByRole('button', { name: /fixture-hail-b/ }).click();
      assert.match(await page.locator('.pg-composer-event-tag').textContent(), /fixture-hail-b/);
      await page.getByRole('button', { name: 'Remove tagged event' }).click();
      await page.getByRole('button', { name: /Tag an event/ }).click();
      await page.getByRole('textbox', { name: 'Search events' }).fill('Fixture Provider Alias');
      assert.equal(await page.locator('.pg-composer-event-option').count(), 1);
      await page.getByRole('textbox', { name: 'Search events' }).fill('no such fixture event');
      assert.equal(await page.getByText('No matching events. Try an artist, venue or city.').isVisible(), true);
      await page.getByRole('textbox', { name: 'Search events' }).fill('Fixture Hail');
    }
    await capture('composer', theme); checks++;
    await page.getByRole('button', { name: 'Back to post' }).click();
    await page.getByRole('button', { name: 'Close post composer' }).click();
    await safe();

    await open('/admin', theme);
    await page.locator('option[value="fixture-hail-a"]').waitFor({ state: 'attached' });
    const options = await page.locator('option[value^="fixture-hail-"]').allTextContents();
    assert.equal(new Set(options).size, before ? 1 : 2);
    if (!before) {
      const select = page.getByRole('combobox', { name: 'Select Event', exact: true });
      await select.selectOption('fixture-hail-b');
      assert.match(await page.locator('#live-upgrade-event-context').textContent(), /fixture-hail-b/);
      assert.ok(options.every(label => /2026/.test(label) && /UTC/.test(label) && /Past/.test(label)));
      assert.equal(await page.locator('option[value^="fixture-alias-"]').count(), 2, 'operator choices preserve separate target records');
      const refresh = page.getByRole('button', { name: 'Refresh live upgrades' });
      await refresh.focus(); assert.equal(await refresh.evaluate(node => node === document.activeElement), true);
      await page.evaluate(() => { window.identityFailNextEventList = true; });
      await refresh.click(); await page.getByRole('alert').waitFor();
      assert.equal(await select.isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Release Demo Upgrades' }).isDisabled(), true);
      assert.equal(await refresh.isEnabled(), true);
      await refresh.click(); await page.getByRole('alert').waitFor({ state: 'hidden' });
      await select.selectOption('fixture-hail-b');
      assert.equal(await page.getByRole('button', { name: 'Release Demo Upgrades' }).isEnabled(), true);
    }
    await capture('admin', theme); await safe(); checks++;

    await open('/events?browse=1&q=Fixture%20Knocked&past=1&scope=nationwide', theme);
    await page.locator('.pg-event-row').first().waitFor();
    const cards = await page.locator('.pg-event-row').allTextContents();
    assert.equal(cards.length, 2); assert.equal(new Set(cards).size, before ? 1 : 2);
    if (!before) assert.ok(cards.every(label => /Identity unconfirmed/.test(label)));
    if (!before) for (const identity of await page.locator('.pg-event-identity').all()) {
      assert.equal(await identity.evaluate(node => getComputedStyle(node).whiteSpace), 'normal');
      assert.equal(await identity.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'identity references must not clip');
    }
    await capture('cards', theme); await safe(); checks++;

    if (!before) {
      for (const id of ['fixture-knocked-a', 'fixture-knocked-b', 'fixture-alias-a', 'fixture-alias-b']) {
        await open(`/events/${id}`, theme);
        await page.getByRole('heading', { level: 1 }).waitFor();
        assert.match(await page.locator('body').textContent(), new RegExp(`Event reference ${id}`));
        await safe(); checks++;
      }
      await capture('detail', theme);
    }
  }
  await isolation.assertClean();
  assert.deepEqual(errors, []); assert.deepEqual(outbound, []);
  console.log(`Event identity ${before ? 'baseline reproduced' : 'regressions passed'}: ${checks} surface cases, both themes; no mutation calls or outbound requests.`);
} finally { await browser.close(); await server?.close(); }
