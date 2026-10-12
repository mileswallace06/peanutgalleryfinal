/** Isolated regression for a witnessed backdrop click before Radix listener setup.
 * The deterministic cases hold only Radix's document pointerdown registration;
 * native timers and pointer/focus callbacks remain unchanged. No live SDK exists.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { installFixtureIsolation } from './helpers/fixtureIsolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = process.env.PG_PLAYWRIGHT_MODULE;
const { chromium } = runtime ? await import(pathToFileURL(runtime).href) : await import('playwright');
const evidence = process.env.PG_FAN_SORT_EVIDENCE_DIR || path.join(root, 'tests/artifacts/oct09/fan-sort-startup');
await mkdir(evidence, { recursive: true });
// Optional local before-source is for demonstrating red/green without changing
// the worktree or affecting any concurrently running fixture server.
const beforeSource = process.env.PG_FAN_SORT_BEFORE_SOURCE ? await readFile(process.env.PG_FAN_SORT_BEFORE_SOURCE, 'utf8') : null;
const report = { fixtureOnly: true, beforeSource: !!beforeSource, historicalR09CauseEstablished: false, cases: [], attempts: [], errors: [] };
const server = await createServer({
  configFile: path.join(root, 'tests/fixtures/fan-behavior/vite.config.mjs'), logLevel: 'error',
  server: { port: Number(process.env.PG_FAN_SORT_PORT || 4195) },
  plugins: beforeSource ? [{ name: 'fan-sort-before-source', enforce: 'pre', load(id) { if (id === path.join(root, 'src/components/fanzone/FanSortSheet.jsx')) return beforeSource; } }] : [],
});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [] });
  report.browser = browser.version();
  for (const theme of ['light', 'dark']) for (const action of ['mouse', 'touch', 'right and control click', 'inside', 'mouse drag', 'touch drag', 'normal mouse', 'normal touch']) {
    const hold = !action.startsWith('normal');
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, reducedMotion: 'reduce' });
    await installFixtureIsolation(context, { origin, documentPaths: ['/tests/fixtures/fan-behavior/index.html'], attempts: report.attempts });
    await context.addInitScript(hold => {
      const originalAdd = document.addEventListener;
      const originalRemove = document.removeEventListener;
      const pending = new Map(), active = new Set(), trace = [];
      let holding = hold;
      const mark = (action, extra = {}) => trace.push({ action, time: performance.now(), pending: pending.size, active: active.size, ...extra });
      const isOutsideListener = (type, callback) => type === 'pointerdown' && callback?.name === 'handlePointerDown';
      document.addEventListener = function(type, callback, options) {
        if (isOutsideListener(type, callback)) {
          if (holding) { pending.set(callback, options); mark('withheld'); return; }
          active.add(callback); mark('installed');
        }
        return Reflect.apply(originalAdd, this, [type, callback, options]);
      };
      document.removeEventListener = function(type, callback, options) {
        if (isOutsideListener(type, callback)) { pending.delete(callback); active.delete(callback); mark('removed'); }
        return Reflect.apply(originalRemove, this, [type, callback, options]);
      };
      originalAdd.call(document, 'pointerdown', event => mark('pointerdown', { target: event.target?.className, pointerType: event.pointerType, button: event.button, ctrlKey: event.ctrlKey, trusted: event.isTrusted }), true);
      originalAdd.call(document, 'click', event => mark('click', { target: event.target?.className, button: event.button, ctrlKey: event.ctrlKey, trusted: event.isTrusted }), true);
      window.__SORT_STARTUP__ = {
        trace, state: () => ({ pending: pending.size, active: active.size }),
        release() { holding = false; for (const [callback, options] of pending) { originalAdd.call(document, 'pointerdown', callback, options); active.add(callback); } pending.clear(); mark('released'); },
      };
    }, hold);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    try {
      await page.goto(`${origin}/tests/fixtures/fan-behavior/index.html?theme=${theme}`);
      await page.waitForFunction(() => window.fanBehavior?.originalTrigger);
      const trigger = page.getByRole('button', { name: /^Sort posts\. Current:/ });
      const dialog = page.getByRole('dialog', { name: 'Sort posts', exact: true });
      await trigger.click();
      await dialog.waitFor();
      await page.waitForFunction(hold => window.__SORT_STARTUP__.state()[hold ? 'pending' : 'active'] === 1, hold);
      if (action.endsWith('mouse')) await page.mouse.click(2, 2);
      if (action.endsWith('touch')) await page.touchscreen.tap(2, 2);
      if (action === 'right and control click') {
        await page.mouse.click(2, 2, { button: 'right' });
        assert.equal(await dialog.isVisible(), true);
        await page.keyboard.down('Control');
        try { await page.mouse.click(2, 2); } finally { await page.keyboard.up('Control'); }
      }
      if (action === 'inside') await dialog.getByRole('heading', { name: 'Sort posts', exact: true }).click();
      if (action === 'mouse drag') {
        await page.mouse.move(2, 2); await page.mouse.down();
        assert.equal(await dialog.isVisible(), true, 'Pointerdown alone does not invoke the click fallback');
        const box = await dialog.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 5); await page.mouse.up();
      }
      if (action === 'touch drag') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 2, y: 2 }] });
        assert.equal(await dialog.isVisible(), true, 'A touch start does not close the sheet');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 2, y: 80 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      }
      const shouldStay = ['right and control click', 'inside', 'mouse drag', 'touch drag'].includes(action);
      if (shouldStay) {
        assert.equal(await dialog.isVisible(), true, `${action} must not invoke the backdrop click fallback`);
        assert.equal(await page.evaluate(() => window.fanBehavior.closeCalls), 0);
        await page.evaluate(() => window.__SORT_STARTUP__.release());
        await page.keyboard.press('Escape');
      }
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement === window.fanBehavior.originalTrigger);
      assert.equal(await trigger.evaluate(node => node === window.fanBehavior.originalTrigger), true);
      const state = await page.evaluate(() => {
        window.__SORT_STARTUP__.release();
        return { closeCalls: window.fanBehavior.closeCalls, listeners: window.__SORT_STARTUP__.state(), unexpected: window.fanBehavior.unexpected, calls: window.fanBehavior.calls, geoCalls: window.fanBehavior.gps.length, trace: window.__SORT_STARTUP__.trace };
      });
      assert.equal(state.closeCalls, 1, 'Dismiss exactly once, including the normal Radix path');
      assert.deepEqual(state.listeners, { pending: 0, active: 0 }, 'Unmount removes or cancels every listener before release');
      assert.deepEqual(state.unexpected, []); assert.deepEqual(state.calls, []); assert.equal(state.geoCalls, 0);
      if (theme === 'light' && action === 'mouse') await page.screenshot({ path: path.join(evidence, 'after-startup-mouse.png') });
      report.cases.push({ theme, action, hold, status: 'passed', ...state });
    } catch (error) {
      await page.screenshot({ path: path.join(evidence, `failure-${report.cases.length}.png`) });
      report.cases.push({ theme, action, hold, status: 'failed', failure: error.message, state: await page.evaluate(() => ({ dialog: !!document.querySelector('.pg-fan-sort-dialog'), active: document.activeElement?.outerHTML, closeCalls: window.fanBehavior?.closeCalls, trace: window.__SORT_STARTUP__?.trace })) });
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.attempts, []);
  report.status = 'PASSED';
  console.log(`PASS ${report.cases.length} isolated Fan sort startup scenarios; exact trigger focus, once-only close, gesture exemptions and listener cleanup`);
} catch (error) { report.status = 'FAILED'; report.failure = error.message; throw error; }
finally { await writeFile(path.join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); await browser?.close(); await server.close(); }
