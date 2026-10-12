/** R04/R05 isolated component checks. No production SDK or outbound network. */
import assert from 'node:assert/strict';
import { installFixtureIsolation } from './helpers/fixtureIsolation.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const phase = process.env.PG_LIFECYCLE_CAPTURE === 'before' ? 'before' : 'after';
const output = path.resolve(process.env.PG_LIFECYCLE_EVIDENCE_DIR || `tests/artifacts/oct09/lifecycle/${phase}`);
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: fileURLToPath(new URL('./fixtures/oct09-lifecycle/vite.config.mjs', import.meta.url)), logLevel: 'error' });
await server.listen();
const origin = 'http://127.0.0.1:4187';
const browser = await chromium.launch({ headless: true, ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}), args: JSON.parse(process.env.PG_CHROMIUM_ARGS || '[]') });
const report = { phase, fixtureOnly: true, browser: browser.version(), checks: [], screenshots: [], errors: [], external: [], base: 'c31a2e1aa9f9c7d7916908ab948201cfad3243a8' };
let current;
const url = values => `${origin}/tests/fixtures/oct09-lifecycle/index.html?${new URLSearchParams(values)}`;
async function open(values = {}, viewport = { width: 1180, height: 757 }) {
 const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
 await installFixtureIsolation(context, { origin, documentPaths: ['/tests/fixtures/oct09-lifecycle/index.html'], attempts: report.external });
 const page = await context.newPage(); current = page; page.setDefaultTimeout(12000);
 page.on('pageerror', error => report.errors.push(error.message));
 await page.goto(url({ route: '/events/fixture-live', theme: 'light', role: 'user', phase: 'after', ...values }));
 await page.waitForFunction(() => !!window.__PG_REVIEW_NAVIGATE__);
 return { page, context };
}
async function safe(page, label, created = 0) {
 const actual = await page.evaluate(() => ({ writes: window.lifecycleFixture.writes, created: window.lifecycleFixture.created.length, blocked: window.ticketDesignFixture.blocked, unexpected: window.ticketDesignFixture.unexpected }));
 assert.deepEqual(actual, { writes: [], created, blocked: [], unexpected: [] }, label);
 assert.equal(await page.locator('body').getByText('Visual review fixture error', { exact: true }).count(), 0);
}
async function shot(page, name, route, role, theme) {
 const file = path.join(output, `${name}-${role}-${theme}.png`); await page.screenshot({ path: file, animations: 'disabled' });
 report.screenshots.push({ file, route, role, theme, viewport: page.viewportSize(), isolated: true });
}
async function gift(page, scheduled = false) {
 await page.getByRole('button', { name: 'Fan Gifts', exact: true }).click();
 await page.getByRole('button', { name: '+ Drop Seats', exact: true }).click();
 const dialog = page.getByRole('dialog', { name: /Create Flash Drop/ }); await dialog.waitFor();
 await dialog.getByRole('button', { name: scheduled ? /Scheduled Drop/ : /Immediate Drop/ }).click();
 return dialog;
}
try {
 for (const theme of ['light','dark']) for (const [route, role, name] of [['/events/fixture-live','admin','native-ended'], ['/events/tm/tm-fixture-live','user','provider-ended'], ['/upgrades/fixture-live','admin','hub-ended']]) {
  const {page,context} = await open({ route, role, theme });
  await page.getByRole('heading', { name: 'Fictional Boundary Concert', exact: true }).waitFor();
  if (route.startsWith('/upgrades/')) {
   await page.getByRole('button', { name: 'Fan Gifts', exact: true }).click();
   if (phase === 'before') assert.equal(await page.getByRole('button', { name: '+ Drop Seats', exact: true }).count(), 1);
   else { await page.getByText('Fan gifts are closed for this event.', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '+ Drop Seats', exact: true }).count(), 0); }
   await page.getByRole('heading', { name: 'Fan Gifts', exact: true }).scrollIntoViewIfNeeded();
  } else {
   if (phase === 'before') await page.getByText(/Be the first to (sell|list your tickets)/).waitFor();
   else { await page.getByRole('heading', { name: 'Listings are closed for this event', exact: true }).waitFor(); assert.equal(await page.getByRole('link', { name: /List tickets for this event/ }).count(), 0); assert.equal(await page.getByRole('button', { name: /List my tickets/ }).count(), 0); }
   await page.locator('#event-tickets').scrollIntoViewIfNeeded();
  }
  await shot(page, name, route, role, theme); await safe(page, `${phase} ${name}`); await context.close(); report.checks.push(`${phase} ${name} ${role} ${theme}`);
 }
 if (phase === 'after') {
  for (const role of ['user', 'admin']) for (const boundary of ['before','exact','after']) {
   for (const route of ['/events/fixture-live','/events/tm/tm-fixture-live','/upgrades/fixture-live','/create-listing?event_id=fixture-live']) {
    const {page,context} = await open({ route, role, phase: boundary });
    if (route.startsWith('/create-listing')) {
     if (boundary === 'before') await page.getByRole('textbox', { name: 'Section', exact: true }).waitFor();
     else { await page.getByRole('heading', { name: 'Listings are closed for this event', exact: true }).waitFor(); assert.equal(await page.locator('input[type="file"]').count(),0); }
    } else if(route.startsWith('/upgrades')) {
     await page.getByRole('button', { name: 'Fan Gifts', exact: true }).click();
     if(boundary==='before') await page.getByRole('button',{name:'+ Drop Seats',exact:true}).waitFor();
     else { await page.getByText('Fan gifts are closed for this event.',{exact:true}).waitFor(); assert.equal(await page.getByRole('button',{name:'Offer your seats',exact:true}).count(),0); }
    } else if(boundary!=='before') await page.getByRole('heading',{name:'Listings are closed for this event',exact:true}).waitFor();
    else await page.getByRole('heading',{name:'Fictional Boundary Concert',exact:true}).waitFor();
    await safe(page, `${role} ${boundary} ${route}`);await context.close();report.checks.push(`boundary ${role} ${boundary} ${route}`);
   }
  }
  for (const route of ['/events/fixture-live','/events/tm/tm-fixture-live','/upgrades/fixture-live','/create-listing?event_id=fixture-live']) {
   const {page,context}=await open({route,auth:'guest'});
   await page.waitForFunction(()=>window.__PG_REVIEW_LOCATION__?.pathname==='/login');
   assert.equal(await page.getByRole('button',{name:/Drop Now|List my tickets/}).count(),0);await safe(page,`guest ${route}`);await context.close();report.checks.push(`guest route gate ${route}`);
  }
  for(const theme of ['light','dark']) {
   const {page,context}=await open({route:'/upgrades/fixture-live',phase:'live',theme});
   const dialog=await gift(page);await dialog.getByRole('textbox',{name:'Section *',exact:true}).fill('104');
   await page.evaluate(()=>window.lifecycleClock.set(window.lifecycleClock.end));
   await dialog.getByRole('heading',{name:'Fan gifts are closed for this event.',exact:true}).waitFor();
   assert.equal(await dialog.locator('input').count(),0);assert.equal(await dialog.getByRole('button',{name:'Drop Now',exact:true}).count(),0);
   await shot(page,'draft-crossing-end','/upgrades/fixture-live','user',theme);await safe(page,'draft crossing end');await context.close();report.checks.push(`local draft closes exact end ${theme}`);
  }
  for(const theme of ['light','dark']) for(const mode of ['stale','read-error']) {
   const {page,context}=await open({route:'/upgrades/fixture-live',phase:'live',theme});
   const dialog=await gift(page);await dialog.getByRole('textbox',{name:'Section *',exact:true}).fill('104');
   await page.evaluate(mode=>{if(mode==='stale')window.lifecycleFixture.fresh={status:'ended'};else window.lifecycleFixture.failRead=true;},mode);
   await dialog.getByRole('button',{name:'Drop Now',exact:true}).click();
   if(mode==='stale') await dialog.getByRole('heading',{name:'Fan gifts are closed for this event.',exact:true}).waitFor();
   else {
    await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').innerText(),/could not check/);
    assert.equal(await dialog.getByRole('button',{name:'Drop Now',exact:true}).isEnabled(),true);
    await page.evaluate(()=>{window.lifecycleFixture.failRead=false;window.lifecycleFixture.fresh={status:'ended'};});
    await dialog.getByRole('button',{name:'Drop Now',exact:true}).click();await dialog.getByRole('heading',{name:'Fan gifts are closed for this event.',exact:true}).waitFor();
   }
   await safe(page,`fresh guard ${mode}`);await context.close();report.checks.push(`fresh guard ${mode} ${theme}, no create`);
  }
  for(const theme of ['light','dark']) {
   const {page,context}=await open({route:'/upgrades/fixture-live',phase:'live',theme,flashLookup:'retry',flashLookupDelay:'100'}, {width:390,height:844});
   const dialog=await gift(page);
   await dialog.getByRole('button',{name:'Check my listings for this event',exact:true}).click();
   await dialog.getByRole('button',{name:'Retry listing check',exact:true}).waitFor();
   await dialog.getByRole('button',{name:'Retry listing check',exact:true}).click();
   const choice=dialog.getByRole('button',{name:/Sec 104 Row B.*Seats 7–8/});await choice.waitFor();assert.equal(await choice.getAttribute('aria-pressed'),'false');await choice.click();assert.equal(await choice.getAttribute('aria-pressed'),'true');
   assert.equal(await page.evaluate(()=>window.ticketDesignFixture.calls.filter(c=>c.name==='functions.getListingParticipantView'&&c.params.action==='list_mine').length),2);
   await choice.scrollIntoViewIfNeeded();await shot(page,'eligible-lookup-recovery','/upgrades/fixture-live','user',theme);
   await safe(page,'R05 retry selection');await context.close();report.checks.push(`R05 error retry populated selection ${theme}`);
  }
  {
   const {page,context}=await open({route:'/upgrades/fixture-live',phase:'live',allowFixtureDrop:'1'});
   const dialog=await gift(page,true);await dialog.getByRole('textbox',{name:'Section *',exact:true}).fill('104');
   await dialog.getByRole('button',{name:'Check my listings for this event',exact:true}).click();await dialog.getByRole('button',{name:/Sec 104 Row B.*Seats 7–8/}).click();
   await dialog.getByRole('button',{name:'Next: Schedule',exact:true}).click();await dialog.getByRole('button',{name:'Halftime',exact:true}).click();
   await page.evaluate(()=>{window.lifecycleFixture.deferRead=true;window.lifecycleFixture.deferCreate=true;window.lifecycleFixture.reads.length=0;});
   await dialog.getByRole('button',{name:'Schedule Drop',exact:true}).evaluate(button=>{button.click();button.click();});
   await dialog.getByRole('button',{name:'Creating fan gift…',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.lifecycleFixture.reads.length),1);assert.equal(await page.evaluate(()=>window.lifecycleFixture.created.length),0);
   await page.evaluate(()=>window.lifecycleFixture.resolveRead());await page.waitForFunction(()=>window.lifecycleFixture.created.length===1);
   assert.equal(await dialog.getByRole('button',{name:'Creating fan gift…',exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.lifecycleFixture.resolveCreate());await dialog.waitFor({state:'hidden'});
   await safe(page,'duplicate submit',1);await context.close();report.checks.push('R05 duplicate synchronous submit callbacks: one fresh read, one local-only scheduled create, selected listing retained');
  }
  for(const route of ['/create-listing?event_id=fixture-live','/upgrades/fixture-live']) {
   const {page,context}=await open({route,phase:'unknown'});
   if(route.startsWith('/create')) await page.getByRole('textbox',{name:'Section',exact:true}).waitFor();
   else {const dialog=await gift(page);await dialog.getByText('The event time is unconfirmed. Check the event details before offering your seats.',{exact:true}).waitFor();}
   await safe(page,'unknown timing');await context.close();report.checks.push(`unknown timing stays unknown ${route}`);
  }
 }
 assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []); report.status = 'PASSED';
} catch(error) { report.status = 'FAILED'; report.failure = error.stack; if (current && !current.isClosed()) { report.body = await current.locator('body').innerText(); await current.screenshot({path:path.join(output,'failure.png')}); } throw error; }
finally { await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)); await browser.close(); await server.close(); }
console.log(JSON.stringify({status:report.status,phase,checks:report.checks.length,screenshots:report.screenshots.length,output}));
