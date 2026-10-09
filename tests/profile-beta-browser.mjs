/** Fixture-only rendered R10/R11/L4 checks. No submitted feedback or account writes.
 * PG_PROFILE_REVIEW_URL points to the isolated ticket-design Vite server.
 * PG_PLAYWRIGHT_MODULE / PG_CHROMIUM_PATH / PG_CHROMIUM_ARGS select test tooling.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = new URL(process.env.PG_PROFILE_REVIEW_URL || 'http://127.0.0.1:4174');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Only isolated local fixture origins are allowed');
const { chromium } = process.env.PG_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PG_PLAYWRIGHT_MODULE).href)
  : await import('playwright').catch(() => import('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const executablePath = process.env.PG_CHROMIUM_PATH || process.env.PG_TEST_CHROMIUM;
const args = process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [];
const browser = await chromium.launch({ headless: true, args, ...(executablePath ? { executablePath } : {}) });
const evidence = process.env.PG_PROFILE_EVIDENCE_DIR || '/tmp/pg-profile-beta-browser';
await mkdir(evidence, { recursive: true });
const report = { fixtureOnly: true, checks: [], screenshots: [], externalRequests: [], errors: [], computedContrast: [] };
const fixtureUrl = (page, theme, extra = {}) => `${base.origin}/tests/fixtures/ticket-design/app.html?${new URLSearchParams({ page, theme, role: 'admin', ...extra })}`;

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
  assert.deepEqual(fixture.unexpected, [], 'All SDK reads are explicit local fixtures');
  assert.deepEqual(fixture.blocked, [], 'No mutation was attempted');
  assert.equal(await page.getByText('Visual review fixture error', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'No page horizontal overflow');
}

async function screenshot(page, name) {
  const path = join(evidence, `${name}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

// Read computed inks and the actual rendered card's composited gradient.
async function pointsContrast(page) {
  return page.locator('.pg-points-card').evaluate(card => {
    const rgb = value => value.match(/[\d.]+/g).map(Number);
    const blend = (top, bottom, alpha) => top.slice(0, 3).map((v, i) => alpha * v + (1 - alpha) * bottom[i]);
    const luminance = value => value.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    let surface = card.parentElement, background = [255, 255, 255];
    while (surface) {
      const candidate = rgb(getComputedStyle(surface).backgroundColor);
      if (candidate.length === 3 || candidate[3] === 1) { background = candidate.slice(0, 3); break; }
      surface = surface.parentElement;
    }
    const gradient = getComputedStyle(card).backgroundImage;
    const stops = [...gradient.matchAll(/rgba?\([^)]+\)/g)].map(match => rgb(match[0]));
    const endpoints = stops.map(stop => blend(stop, background, stop[3] ?? 1));
    return [...card.querySelectorAll('[style*="--pg-points-"]')].filter(node => node.getClientRects().length && node.textContent.trim()).map(node => {
      const ink = getComputedStyle(node).color;
      let ratio = Infinity;
      for (let sample = 0; sample <= 100; sample++) {
        let composite = blend(endpoints[1], endpoints[0], sample / 100);
        const parent = node.closest('.pg-points-unlocks');
        if (parent) { const tint = rgb(getComputedStyle(parent).backgroundColor); composite = blend(tint, composite, tint[3] ?? 1); }
        ratio = Math.min(ratio, contrast(rgb(ink).slice(0, 3), composite));
      }
      return { text: node.textContent.trim(), ink, minimumRatio: Number(ratio.toFixed(3)), gradient, background };
    });
  });
}

try {
  for (const width of [320, 375, 390, 430, 1280]) for (const theme of ['light', 'dark']) {
    const { context, page } = await isolatedPage(width, theme);
    await page.goto(fixtureUrl('me', theme));
    await page.getByText('Fan activity', { exact: true }).click();
    const info = page.getByRole('button', { name: /About .* rank unlocks/ });
    await info.waitFor({ state: 'visible' });
    assert.equal(await info.getAttribute('aria-expanded'), 'false');
    await info.focus(); await page.keyboard.press('Enter');
    assert.equal(await info.getAttribute('aria-expanded'), 'true');
    const detailsId = await info.getAttribute('aria-controls');
    assert.equal(await page.locator('.pg-points-unlocks').getAttribute('id'), detailsId);
    assert.equal(await page.locator('.pg-points-unlocks').isVisible(), true);
    const measures = await pointsContrast(page);
    assert.ok(measures.some(value => value.text.includes('/100')));
    assert.ok(measures.some(value => value.text.includes('Crowd Member')));
    for (const value of measures) assert.ok(value.minimumRatio >= 4.5, `${width}/${theme}/${value.text}: ${value.minimumRatio}`);
    report.computedContrast.push({ width, theme, measures });
    await page.locator('.pg-points-card').scrollIntoViewIfNeeded();
    await screenshot(page, `profile-${width}-${theme}`);
    await page.keyboard.press('Space');
    assert.equal(await info.getAttribute('aria-expanded'), 'false');
    await assertSafe(page);
    report.checks.push(`Me ${width}px ${theme}: rank disclosure Enter/Space state/target, computed gradient inks >=4.5:1`);

    await page.goto(fixtureUrl('beta-qa', theme));
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Feedback', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Back from Beta QA' }).count(), 1);
    const group = page.getByRole('radiogroup', { name: 'Overall rating' });
    await group.waitFor({ state: 'visible' });
    assert.equal(await group.getByRole('radio').count(), 5);
    await page.getByLabel('Device', { exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await group.getByRole('radio', { name: '1 star out of 5', exact: true }).evaluate(node => document.activeElement === node), true, 'Tab enters native group once');
    await page.keyboard.press('Space');
    for (let value = 1; value <= 5; value++) {
      const selected = group.getByRole('radio', { name: `${value} ${value === 1 ? 'star' : 'stars'} out of 5`, exact: true });
      assert.equal(await selected.isChecked(), true);
      assert.equal(await selected.evaluate(node => document.activeElement === node), true);
      if (value < 5) await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('ArrowDown');
    assert.equal(await group.getByRole('radio', { name: '1 star out of 5', exact: true }).isChecked(), true, 'ArrowDown wraps');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await group.getByRole('radio', { name: '5 stars out of 5', exact: true }).isChecked(), true, 'ArrowLeft wraps');
    await page.keyboard.press('ArrowUp');
    assert.equal(await group.getByRole('radio', { name: '4 stars out of 5', exact: true }).isChecked(), true);
    await page.keyboard.press('Tab');
    const question = page.getByLabel('What felt confusing or unclear?', { exact: true });
    assert.equal(await question.evaluate(node => document.activeElement === node), true, 'Tab exits group to next question');
    await page.keyboard.press('Shift+Tab');
    const selected = group.getByRole('radio', { name: '4 stars out of 5', exact: true });
    assert.equal(await selected.evaluate(node => document.activeElement === node), true, 'Shift+Tab returns to selected radio');
    const focus = await selected.evaluate(node => { const style = getComputedStyle(node.nextElementSibling); return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor }; });
    assert.ok(parseFloat(focus.width) >= 2 && focus.style === 'solid', 'Visible rating focus');
    for (const label of ['Your Name *', 'Device', 'What felt confusing or unclear?', 'Would you trust this app with real tickets? Why?', 'What almost stopped you from completing a purchase?', 'What feature felt the coolest or most exciting?', 'Anything else?']) assert.equal(await page.getByLabel(label, { exact: true }).count(), 1);
    await group.scrollIntoViewIfNeeded();
    await screenshot(page, `beta-rating-${width}-${theme}`);
    await assertSafe(page);
    report.checks.push(`Beta feedback ${width}px ${theme}: native Tab/Shift+Tab/Space/all Arrow keys, all five values, selected state, field labels, visible focus; no submission`);
    await context.close();
  }
  {
    const { context, page } = await isolatedPage(320, 'light');
    await page.goto(fixtureUrl('help', 'light'));
    const input = page.getByRole('searchbox', { name: 'Search help' });
    await input.fill('q'.repeat(1000));
    assert.equal((await input.inputValue()).length, 1000);
    const summary = await page.locator('.pg-help-count').innerText();
    assert.ok(summary.length < 120 && summary.includes('…'));
    await page.getByRole('button', { name: 'Show all topics', exact: true }).click();
    assert.equal(await input.inputValue(), '');
    await assertSafe(page);
    report.checks.push('Help 320px light: 1000-character input intact, bounded summary, recovery reachable');
    await context.close();
  }
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.errors, []);
  report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.failure = error.message; throw error;
} finally {
  await writeFile(join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, screenshots: report.screenshots.length, evidence }, null, 2));
