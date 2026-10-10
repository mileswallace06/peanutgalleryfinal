/** Isolated N02/N05/N06 checks. No production credentials, requests or writes.
 * Uses its own fixture/server; PG_CHROMIUM_PATH and PG_CHROMIUM_ARGS are optional.
 */
import assert from 'node:assert/strict';
import { installFixtureIsolation } from './helpers/fixtureIsolation.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const base = new URL(process.env.PG_FOUNDER_REVIEW_URL || 'http://127.0.0.1:4183');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(base.hostname), 'Local fixtures only');
const server = process.env.PG_FOUNDER_REVIEW_URL ? null : await createServer({ configFile: fileURLToPath(new URL('./fixtures/founder-recovery/vite.config.mjs', import.meta.url)), logLevel: 'error', server: { port: Number(base.port), hmr: false, strictPort: true } });
if (server) await server.listen();
const { chromium } = process.env.PG_PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PG_PLAYWRIGHT_MODULE).href) : await import('playwright').catch(() => import('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const executablePath = process.env.PG_CHROMIUM_PATH || process.env.PG_TEST_CHROMIUM;
const browser = await chromium.launch({ headless: true, args: process.env.PG_CHROMIUM_ARGS ? JSON.parse(process.env.PG_CHROMIUM_ARGS) : [], ...(executablePath ? { executablePath } : {}) });
const evidence = process.env.PG_FOUNDER_EVIDENCE_DIR || '/tmp/pg-founder-recovery'; await mkdir(evidence,{recursive:true});
const report = { fixtureOnly: true, checks: [], screenshots: [], externalRequests: [], errors: [], syntheticAlertWrites: [], accessibilitySnapshots: [] };
const sources = { Purchase: ['purchases','Purchases'], Listing: ['listings','Listings'], AdminAlert: ['alerts','Alerts'], SeatDonation: ['donations','Donations'], TransferOutcome: ['outcomes','Transfer outcomes'] };
const url = (theme, extra = {}) => `${base.origin}/tests/fixtures/founder-recovery/index.html?${new URLSearchParams({theme,...extra})}`;
async function screenshot(page, name) { const path = join(evidence,`${name}.png`); await page.screenshot({path}); report.screenshots.push(path); }
async function safe(page, expectedWrites = 0) {
 const state = await page.evaluate(() => ({ writes:window.founderFixture.writes, unexpected:window.founderFixture.unexpected }));
 assert.deepEqual(state.unexpected,[]); assert.equal(state.writes.length,expectedWrites);
 for(const write of state.writes) { assert.equal(write.key,'AdminAlert'); assert.equal(write.method,'create'); assert.equal(write.value.title,'⚠ Event Navigation Failure Spike'); }
 const dimensions = await page.evaluate(() => [document.documentElement.scrollWidth,document.documentElement.clientWidth]);
 assert.ok(dimensions[0] <= dimensions[1]+1,`No page overflow ${dimensions}`);
}
async function keyboardFocus(page, button) {
 await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); });
 for (let step = 0; step < 80; step++) { await page.keyboard.press('Tab'); if (await button.evaluate(el => el === document.activeElement)) break; }
 const focus = await button.evaluate(el=>({active:el===document.activeElement,visible:el.matches(':focus-visible'),outline:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth}));
 assert.equal(focus.active,true); assert.equal(focus.visible,true); assert.notEqual(focus.outline,'none'); assert.ok(parseFloat(focus.width)>=2);
}
try {
 for (const theme of ['light','dark']) {
  const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await installFixtureIsolation(context, { origin: base.origin, documentPaths: ['/tests/fixtures/founder-recovery/index.html'], attempts: report.externalRequests });
  const page = await context.newPage(); page.on('pageerror', error=>report.errors.push(error.message));
  for (const [entity,[key,label]] of Object.entries(sources)) {
   await page.goto(url(theme,{fail:entity}));
   await page.locator(`[data-source=${key}]`).getByText('Read failed',{exact:true}).waitFor();
   const refresh = page.getByRole('button',{name:'Refresh founder dashboard',exact:true});
   await page.waitForFunction(()=>!document.querySelector('[aria-label="Refresh founder dashboard"]').disabled);
   assert.equal(await refresh.getAttribute('aria-busy'),'false');
   await page.getByText('Not assessed',{exact:true}).waitFor();
   assert.equal(await page.getByText('No critical alerts, open disputes or elevated buyer waits in the loaded windows.',{exact:true}).count(),0);
   const independent = entity==='Listing' ? 'Completed Sales' : 'Active Listings';
   assert.ok((await page.getByText(independent,{exact:true}).locator('..').innerText()).includes('1'),'Successful independent metric preserved');
   const retry=page.getByRole('button',{name:`Retry ${label.toLowerCase()}`,exact:true}); await keyboardFocus(page,retry);
   if(entity==='Purchase') await screenshot(page,`after-founder-failure-${theme}`);
   await page.evaluate(entity=>{window.founderFixture.modes[entity]='ready';},entity); await page.keyboard.press('Enter');
   await page.locator(`[data-source=${key}]`).getByText('Loaded',{exact:true}).waitFor();
   await page.getByText('/ 100',{exact:true}).waitFor();
   await safe(page); report.checks.push(`${theme}: ${entity} read rejection withholds health, preserves independent metrics and recovers with keyboard retry`);
  }
  await page.goto(url(theme,{fail:'EventNavigationLog'}));
  await page.getByText('Navigation health unavailable. Refresh to retry.',{exact:true}).waitFor();
  await page.getByText('Not assessed',{exact:true}).waitFor();
  const navRefresh=page.getByRole('button',{name:'Refresh event navigation health',exact:true});assert.equal(await navRefresh.isDisabled(),false);
  assert.equal(await page.getByText('No navigation logs yet. Logs appear as users click event cards.',{exact:true}).count(),0);
  await page.evaluate(()=>{window.founderFixture.modes.EventNavigationLog='ready';});await navRefresh.click();
  await page.getByText('All 1 loaded navigation clicks resolved successfully.',{exact:true}).waitFor();await safe(page);
  report.checks.push(`${theme}: navigation read rejection is unavailable, not empty/healthy, and recovers`);

  await page.goto(url(theme,{delay:'Purchase,Listing,AdminAlert,SeatDonation,TransferOutcome,EventNavigationLog'}));
  await page.locator('[data-source=purchases]').getByText('Loading…',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Refresh founder dashboard',exact:true}).isDisabled(),true);
  await page.getByText('Not assessed',{exact:true}).waitFor();await screenshot(page,`after-founder-loading-${theme}`);
  await page.evaluate(()=>{window.founderFixture.release('Listing');window.founderFixture.release('Purchase','error');});
  await page.locator('[data-source=listings]').getByText('Loaded',{exact:true}).waitFor();
  await page.locator('[data-source=purchases]').getByText('Read failed',{exact:true}).waitFor();
  assert.ok((await page.getByText('Active Listings',{exact:true}).locator('..').innerText()).includes('1'));
  await page.evaluate(()=>{for(const key of ['AdminAlert','SeatDonation','TransferOutcome','EventNavigationLog'])window.founderFixture.release(key);});
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Refresh founder dashboard"]').disabled);
  await page.getByText('Not assessed',{exact:true}).waitFor();
  await page.evaluate(()=>{window.founderFixture.modes.Purchase='ready';});await page.getByRole('button',{name:'Refresh founder dashboard',exact:true}).click();await page.getByText('/ 100',{exact:true}).waitFor();await safe(page);
  report.checks.push(`${theme}: delayed mixed sources settle independently; failed source remains unknown until full refresh recovery`);

  for (const [entity,[key]] of Object.entries(sources)) {
   await page.goto(url(theme,{unavailable:entity}));await page.locator(`[data-source=${key}]`).getByText('Unavailable',{exact:true}).waitFor();await page.getByText('Not assessed',{exact:true}).waitFor();await safe(page);
  }
  await page.goto(url(theme,{unavailable:'EventNavigationLog'}));await page.getByText('Navigation health unavailable. Refresh to retry.',{exact:true}).waitFor();await page.getByText('Not assessed',{exact:true}).waitFor();await safe(page);
  report.checks.push(`${theme}: each of 6 malformed/unavailable sources withholds unsupported health and cannot become an empty success`);

  await page.goto(url(theme,{empty:'1'}));await page.locator('[data-source=outcomes]').getByText('Loaded',{exact:true}).waitFor();await page.getByText('Not assessed',{exact:true}).waitFor();assert.equal(await page.getByText('100%',{exact:true}).count(),0);await safe(page);
  report.checks.push(`${theme}: successfully empty sample never becomes 100% health`);

  await page.goto(url(theme,{delay:'Purchase'}));await page.locator('[data-source=purchases]').getByText('Loading…',{exact:true}).waitFor();
  await page.evaluate(()=>window.founderFixture.mount(false));await page.waitForFunction(()=>!document.body.innerText.includes('FOUNDER DASHBOARD'));
  await page.evaluate(()=>{window.founderFixture.modes.Purchase='ready';window.founderFixture.mount(true);});await page.locator('[data-source=purchases]').getByText('Loaded',{exact:true}).waitFor();
  await page.evaluate(()=>window.founderFixture.release('Purchase','error'));await page.waitForTimeout(50);
  await page.locator('[data-source=purchases]').getByText('Loaded',{exact:true}).waitFor();await safe(page);report.checks.push(`${theme}: late failed read after unmount cannot overwrite remounted success`);

  await page.goto(url(theme,{spike:'1'}));await page.waitForFunction(()=>window.founderFixture.writes.length===1);await page.getByText('Not assessed',{exact:true}).waitFor();assert.equal(await page.getByText('No critical alerts, open disputes or elevated buyer waits in the loaded windows.',{exact:true}).count(),0);
  for(let i=0;i<2;i++){await page.getByRole('button',{name:'Refresh event navigation health',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[aria-label="Refresh event navigation health"]').disabled);}
  await page.evaluate(()=>window.founderFixture.mount(false));await page.waitForFunction(()=>!document.body.innerText.includes('FOUNDER DASHBOARD'));await page.evaluate(()=>window.founderFixture.mount(true));await page.getByText('Navigation Failure Spike — 100% failure rate',{exact:false}).waitFor();await page.waitForTimeout(50);await safe(page,1);
  await page.getByRole('button',{name:'Refresh event navigation health',exact:true}).scrollIntoViewIfNeeded();await screenshot(page,`after-founder-spike-${theme}`);
  report.syntheticAlertWrites.push({theme,createsAfterRetriesAndRemount:1});report.checks.push(`${theme}: nav spike refresh twice plus remount creates exactly one synthetic alert`);
  await page.reload();await page.waitForFunction(()=>window.founderFixture.calls.some(call=>call.key==='EventNavigationLog'));await page.getByText('Navigation Failure Spike — 100% failure rate',{exact:false}).waitFor();await safe(page,0);
  report.checks.push(`${theme}: session fingerprint also prevents duplicate alert after reload`);
  await context.clearCookies(); await page.evaluate(()=>sessionStorage.clear());
  await page.goto(url(theme,{spike:'1',fail:'AdminAlert'}));await page.getByText('Navigation spike alert status unavailable. Refresh to retry verification.',{exact:true}).waitFor();await safe(page);
  await page.evaluate(()=>{window.founderFixture.modes.AdminAlert='ready';});await page.getByRole('button',{name:'Refresh event navigation health',exact:true}).click();await page.waitForFunction(()=>window.founderFixture.writes.length===1);await safe(page,1);
  report.checks.push(`${theme}: unavailable dedup lookup blocks alert creation; retry verifies then creates once`);

  for(const [screen,entity,name,message] of [
   ['windows','Event','Refresh transfer windows','Transfer windows unavailable. Refresh to retry.'],
   ['drops','FlashDrop','Refresh flash drop metrics','Flash drop metrics unavailable: drops. Refresh to retry.'],
   ['instant','Listing','Refresh instant transfer ready listings','Instant transfer ready listings unavailable. Refresh to retry.'],
  ]) {
   await page.goto(url(theme,{screen,delay:entity}));const button=page.getByRole('button',{name,exact:true});await button.waitFor();assert.equal(await button.isDisabled(),true);assert.equal(await button.getAttribute('aria-busy'),'true');
   await page.evaluate(entity=>window.founderFixture.release(entity,'error'),entity);await page.getByText(message,{exact:true}).waitFor();assert.equal(await button.isDisabled(),false);
   await page.evaluate(entity=>{window.founderFixture.modes[entity]='ready';},entity);await keyboardFocus(page,button);await page.keyboard.press('Enter');await page.waitForFunction(name=>!document.querySelector(`[aria-label="${name}"]`).disabled,name);await keyboardFocus(page,button);assert.equal(await button.getAttribute('aria-busy'),'false');
   report.accessibilitySnapshots.push({theme,screen,snapshot:await button.ariaSnapshot()});
   await screenshot(page,`after-${screen}-refresh-focus-${theme}`);await safe(page);report.checks.push(`${theme}: ${screen} refresh has stable accessible name, loading/disabled/error/retry state and visible keyboard focus`);
  }
  await page.goto(url(theme,{screen:'beta'}));const input=page.getByRole('textbox',{name:'Event name',exact:true});await input.waitFor();const association=await input.evaluate(el=>({labels:[...el.labels].map(label=>label.textContent),hint:document.getElementById(el.getAttribute('aria-describedby'))?.textContent}));assert.deepEqual(association.labels,['Event name']);assert.equal(association.hint,'For example, Taylor Swift @ MSG.');report.accessibilitySnapshots.push({theme,screen:'beta',association});await keyboardFocus(page,input);await input.fill('Fictional Test Show');await screenshot(page,`after-beta-event-label-${theme}`);await safe(page);report.checks.push(`${theme}: persistent Beta event-name label and supplemental hint association survive typed input; focus visible`);
  await page.goto(url(theme));await page.getByText('/ 100',{exact:true}).waitFor();
  await page.clock.install();await page.evaluate(()=>{window.founderFixture.modes.Purchase='delay';});await page.getByRole('button',{name:'Refresh founder dashboard',exact:true}).click();
  await page.waitForFunction(()=>window.founderFixture.pending.Purchase?.length===1);await page.clock.fastForward(15001);
  await page.locator('[data-source=purchases]').getByText('Read failed',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Refresh founder dashboard',exact:true}).isDisabled(),false);
  await page.evaluate(()=>{window.founderFixture.modes.Purchase='ready';});await page.getByRole('button',{name:'Retry purchases',exact:true}).click();await page.locator('[data-source=purchases]').getByText('Loaded',{exact:true}).waitFor();
  await page.evaluate(()=>window.founderFixture.release('Purchase','error'));await page.locator('[data-source=purchases]').getByText('Loaded',{exact:true}).waitFor();await safe(page);
  report.checks.push(`${theme}: hanging read times out at 15 seconds; retry usable and late failed response cannot override recovery`);
  await context.close();
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
 console.log(`${report.checks.length} isolated Founder/admin/Beta checks passed; ${report.screenshots.length} screenshots; no external requests. Synthetic expected alert writes only.`);
} finally { await writeFile(join(evidence,'founder-recovery-report.json'),JSON.stringify(report,null,2));await browser.close();if(server)await server.close(); }
