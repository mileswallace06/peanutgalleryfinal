/** Isolated R09/R15/R16 browser regression; never run against the production app. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fanEventChoices } from '../src/components/fanzone/fanEventChoice.js';

const base = new URL(process.env.PG_REVIEW_BASE_URL || 'http://127.0.0.1:4174');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only a local isolated fixture is allowed');
const runtime = process.env.PG_PLAYWRIGHT_MODULE || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES && path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs'));
const { chromium } = await import(runtime ? pathToFileURL(runtime).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [], ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}) });
const evidence = process.env.PG_FAN_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
assert.ok(!process.env.PG_FAN_TEST_FILTER || ['sort', 'location', 'composer'].includes(process.env.PG_FAN_TEST_FILTER), 'Unknown focused browser scenario');
let passed = 0;

async function scenario(params, viewport, run) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const external = [], errors = [];
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.origin === base.origin) return route.continue();
    external.push(target.origin); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const url = new URL('/tests/fixtures/ticket-design/app.html', base);
  url.search = new URLSearchParams({ page: 'fan-zone', ...params });
  try {
    await page.goto(url.href);
    await page.getByRole('heading', { name: 'Fan Zone', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Create post', exact: true }).waitFor();
    await run(page);
    const fixture = await page.evaluate(() => ({ unexpected: window.ticketDesignFixture.unexpected, blocked: window.ticketDesignFixture.blocked }));
    assert.deepEqual(fixture.unexpected, []); assert.deepEqual(fixture.blocked, []);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    passed++;
  } finally { await context.close(); }
}
const geoCount = page => page.evaluate(() => window.fixtureGeoCalls ?? window.ticketDesignFixture.geoCalls);
const openSort = async page => {
  const filters = page.locator('.pg-feed-filter-menu');
  if ((await filters.getAttribute('open')) === null) await filters.locator('summary').click();
  const trigger = page.getByRole('button', { name: /^Sort posts\. Current:/ });
  await trigger.click();
  await page.getByRole('dialog', { name: 'Sort posts', exact: true }).waitFor();
  return trigger;
};
const assertTrigger = async trigger => {
  await trigger.page().waitForFunction(() => document.activeElement?.classList.contains('pg-sort-control'));
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
};

try {
  for (const theme of (process.env.PG_FAN_TEST_FILTER && process.env.PG_FAN_TEST_FILTER !== 'sort') ? [] : ['light', 'dark']) {
    for (const viewport of [{ width: 320, height: 844 }, { width: 375, height: 844 }, { width: 390, height: 844 }, { width: 430, height: 844 }, { width: 1280, height: 800 }, { width: 844, height: 390 }]) {
      await scenario({ theme }, viewport, async page => {
        const trigger = await openSort(page), dialog = page.getByRole('dialog', { name: 'Sort posts', exact: true });
        assert.equal(await dialog.getAttribute('aria-modal'), 'true');
        assert.equal(await page.getByRole('button', { name: 'Close sort sheet' }).evaluate(element => document.activeElement === element), true);
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('Tab');
          assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Tab stays inside modal');
        }
        await page.keyboard.press('Shift+Tab');
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1 && bounds.height <= viewport.height);
        if (evidence && [320, 390].includes(viewport.width)) await page.screenshot({ path: path.join(evidence, `sort-${theme}-${viewport.width}.png`) });
        await page.keyboard.press('Escape'); await assertTrigger(trigger);
        await openSort(page); await page.getByRole('button', { name: 'Close sort sheet' }).click(); await assertTrigger(trigger);
        await openSort(page); await page.mouse.click(2, 2); await assertTrigger(trigger);
        // All six non-distance options update selection and close without touching posts.
        for (const label of ['Upcoming Soonest', 'Newest Posted', 'Most Recent Activity', 'Most Liked', 'Most Commented', 'Oldest']) {
          await openSort(page);
          const option = page.getByRole('button', { name: label, exact: true });
          await option.scrollIntoViewIfNeeded(); await option.click(); await assertTrigger(trigger);
          assert.equal(await trigger.getAttribute('aria-label'), `Sort posts. Current: ${label}`);
        }
      });
    }
  }
  for (const mode of (process.env.PG_FAN_TEST_FILTER && process.env.PG_FAN_TEST_FILTER !== 'location') ? [] : ['denied', 'timeout', 'unavailable', 'none', 'success']) {
    await scenario({ theme: 'light', locationMode: mode }, { width: 390, height: 844 }, async page => {
      await page.getByRole('button', { name: 'Near Me', exact: true }).click();
      assert.equal(await geoCount(page), 0, 'Selecting Near Me never prompts');
      assert.equal(await page.locator('.pg-fan-post').count(), 0, 'No area means no falsely nearby posts');
      await page.getByRole('button', { name: 'Enable location', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Nearby post location' });
      if (mode === 'success') {
        await panel.getByText('Showing posts within 80 km of your location.', { exact: true }).waitFor();
        await openSort(page);
        await page.getByRole('button', { name: 'Closest Distance', exact: true }).click();
      } else {
        const expected = ['denied', 'none'].includes(mode) ? /Location access is blocked/ : mode === 'timeout' ? /timed out/ : /location is unavailable/;
        await panel.getByText(expected).waitFor();
        assert.equal(await geoCount(page), mode === 'unavailable' ? 0 : 1, 'No automatic retry');
      }
      const city = panel.getByRole('combobox', { name: 'Search city for nearby posts' });
      await city.fill('Boston');
      await page.getByRole('option', { name: /Boston/ }).waitFor();
      await city.press('ArrowDown'); await city.press('Enter');
      await panel.getByText('Showing posts for Boston, MA.', { exact: true }).waitFor();
      assert.equal(await geoCount(page), mode === 'unavailable' ? 0 : 1, 'Manual city never prompts');
      if (evidence && mode === 'denied') await page.screenshot({ path: path.join(evidence, 'nearby-manual-city-light-390.png') });
    });
  }
  for (const theme of (process.env.PG_FAN_TEST_FILTER && process.env.PG_FAN_TEST_FILTER !== 'composer') ? [] : ['light', 'dark']) {
    await scenario({ theme, catalog: 'recurring' }, { width: 320, height: 844 }, async page => {
      await page.getByRole('button', { name: 'Create post', exact: true }).click();
      await page.getByRole('button', { name: /Tag an event/ }).click();
      const rows = await page.evaluate(() => window.ticketDesignFixture.events);
      const choices = fanEventChoices(rows);
      const options = page.locator('.pg-composer-event-option');
      await options.first().waitFor();
      assert.equal(await options.count(), choices.length);
      const repeated = choices.filter(choice => choices.some(other => other.id !== choice.id && other.title === choice.title && other.venue === choice.venue));
      assert.ok(repeated.length >= 2, 'Fixture must cover recurring performances');
      const names = await options.allTextContents();
      assert.equal(new Set(names).size, names.length, 'Occurrence names are distinct');
      for (const name of names) assert.match(name, /\d{4}.*(?:MST|EST|EDT|UTC)|Date and time to be confirmed/);
      if (evidence) await page.screenshot({ path: path.join(evidence, `composer-events-${theme}-320.png`) });
      const first = await options.first().innerText();
      await options.first().click();
      assert.match(await page.locator('.pg-composer-event-tag').innerText(), /\d{4}|Date and time to be confirmed/);
      assert.ok(first.length);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Discard', exact: true }).click();
    });
  }
  console.log(`PASS ${passed} isolated Fan Zone browser scenarios (R09/R15/R16); no API mutations or outbound requests`);
} finally { await browser.close(); }
