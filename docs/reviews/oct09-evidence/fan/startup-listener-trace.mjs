/** Portable copy of the bounded, observed-event diagnostic used for this repair.
 * Records native registration and event timing without holding callbacks/timers.
 * This is diagnostic evidence, not a proof of the historical CI failure cause.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
const runtime = process.env.PG_PLAYWRIGHT_MODULE;
const { chromium } = runtime ? await import(pathToFileURL(runtime).href) : await import('playwright');
import { installFixtureIsolation } from '../../../../tests/helpers/fixtureIsolation.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const reportPath = process.env.PG_FAN_TRACE_REPORT || path.join(repo, 'tests/artifacts/oct09-continuation/r09/listener-trace-report.json');
await mkdir(path.dirname(reportPath), { recursive: true });
const report = { fixtureOnly: true, nativeTimersUnchanged: true, nativeListenerCallbacksUnchanged: true, documentListenerMethodsInstrumented: true, historicalCauseEstablished: false, cases: [], attempts: [], errors: [] };
const server = await createServer({ configFile: `${repo}/tests/fixtures/fan-behavior/vite.config.mjs`, logLevel: 'error', server: { port: Number(process.env.PG_FAN_TRACE_PORT || 4194) } });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, args: process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [], ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}) });
  report.browser = browser.version();
  const viewports = [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
  for (const theme of ['light', 'dark']) for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await installFixtureIsolation(context, { origin, documentPaths: ['/tests/fixtures/fan-behavior/index.html'], attempts: report.attempts });
    await context.addInitScript(() => {
      const trace = [];
      const listeners = new Set();
      const nativeAdd = document.addEventListener;
      const nativeRemove = document.removeEventListener;
      const state = () => ({ dialog: !!document.querySelector('.pg-fan-sort-dialog'), active: document.activeElement?.getAttribute('aria-label'), listenerCount: listeners.size });
      const record = data => trace.push({ time: performance.now(), ...data, ...state() });
      document.addEventListener = function(type, listener, options) {
        const value = Reflect.apply(nativeAdd, this, [type, listener, options]);
        if (type === 'pointerdown') { listeners.add(listener); record({ action: 'listener-added', listener: listener?.name }); }
        return value;
      };
      document.removeEventListener = function(type, listener, options) {
        const value = Reflect.apply(nativeRemove, this, [type, listener, options]);
        if (type === 'pointerdown') { listeners.delete(listener); record({ action: 'listener-removed', listener: listener?.name }); }
        return value;
      };
      nativeAdd.call(document, 'pointerdown', event => record({ action: 'pointerdown', target: event.target?.className, trusted: event.isTrusted, x: event.clientX, y: event.clientY }), true);
      nativeAdd.call(document, 'focusin', event => record({ action: 'focusin', target: event.target?.className }), true);
      window.__R09_TRACE__ = trace;
      window.__R09_MARK__ = action => record({ action });
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    try {
      await page.goto(`${origin}/tests/fixtures/fan-behavior/index.html?theme=${theme}`);
      await page.waitForFunction(() => window.fanBehavior?.originalTrigger);
      const trigger = page.getByRole('button', { name: /^Sort posts\. Current:/ });
      const dialog = page.getByRole('dialog', { name: 'Sort posts', exact: true });
      for (let cycle = 0; cycle < 3; cycle++) {
        await page.evaluate(cycle => window.__R09_MARK__(`cycle-${cycle}-start`), cycle);
        await trigger.click();
        await dialog.waitFor();
        await page.mouse.click(2, 2);
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement === window.fanBehavior.originalTrigger);
        assert.equal(await trigger.evaluate(node => node === window.fanBehavior.originalTrigger), true);
      }
      const state = await page.evaluate(() => ({ unexpected: window.fanBehavior.unexpected, calls: window.fanBehavior.calls, geoCalls: window.fanBehavior.gps.length, trace: window.__R09_TRACE__ }));
      assert.deepEqual(state.unexpected, []);
      assert.deepEqual(state.calls, []);
      assert.equal(state.geoCalls, 0);
      report.cases.push({ theme, viewport, status: 'passed', ...state });
    } catch (error) {
      report.cases.push({ theme, viewport, status: 'failed', failure: error.message, state: await page.evaluate(() => ({ trace: window.__R09_TRACE__, dialog: !!document.querySelector('.pg-fan-sort-dialog'), active: document.activeElement?.outerHTML, triggerConnected: window.fanBehavior?.originalTrigger?.isConnected })) });
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.attempts, []);
  report.status = 'PASSED';
  console.log(`PASS ${report.cases.length} isolated listener-trace cases / ${report.cases.length * 3} raw backdrop close cycles; historical R09 remains unresolved`);
} catch (error) { report.status = 'FAILED'; report.failure = error.message; throw error; }
finally { await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`); await browser?.close(); await server.close(); }
