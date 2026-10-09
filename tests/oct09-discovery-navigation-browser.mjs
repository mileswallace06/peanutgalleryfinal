/** October 9 navigation regression: real pages, fixture-only data, no SDK writes. */
import assert from 'node:assert/strict';
import { installFixtureIsolation, fixtureSourceIsolation } from './helpers/fixtureIsolation.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../', import.meta.url));
const modulePath = process.env.PG_PLAYWRIGHT_MODULE || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES && path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs'));
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const before = process.env.PG_EXPECT_BEFORE === '1';
// Read the audited source at the recorded base without changing the worktree.
const beforeFiles = ['src/pages/Events.jsx','src/pages/Upgrades.jsx','src/hooks/useSellingDiscovery.js','src/lib/eventDiscoveryState.js'];
const beforeSources = new Map(before ? beforeFiles.map(file => [path.join(root,file),execFileSync('git',['show',`c31a2e1:${file}`],{cwd:root,encoding:'utf8'})]) : []);
const evidence = path.join(root, 'tests/artifacts/oct09'); await mkdir(evidence, {recursive:true});
const server = await createServer({ configFile:false, root, cacheDir:path.join(root,`node_modules/.vite-oct09-navigation-${before?'before':'after'}`), logLevel:'error', optimizeDeps:{entries:['tests/fixtures/events-search/index.html']}, plugins:[fixtureSourceIsolation(),{name:'audited-before-source',enforce:'pre',load(id){return beforeSources.get(id);}},react(),{name:'isolated-navigation',configureServer(server){server.middlewares.use((req,_res,next)=>{if(/^\/(events|upgrades)([/?]|$)/.test(req.url))req.url='/tests/fixtures/events-search/index.html';next();});}}], resolve:{alias:[{find:'@/lib/AuthContext',replacement:path.join(root,'tests/fixtures/events-search/auth.js')},{find:'@/lib/navLogger',replacement:path.join(root,'tests/fixtures/events-search/navLogger.js')},{find:'@/api/base44Client',replacement:path.join(root,'tests/fixtures/events-search/base44.js')},{find:'@',replacement:path.join(root,'src')}]},server:{watch:null,hmr:false,host:'127.0.0.1',port:Number(process.env.PG_FIXTURE_PORT || 5194)}});
let browser;
const observations=[];
try {
 await server.listen(); browser=await chromium.launch({headless:true,...(process.env.PG_CHROMIUM_PATH?{executablePath:process.env.PG_CHROMIUM_PATH}:{}),args:process.env.PG_CHROMIUM_ARGS?JSON.parse(process.env.PG_CHROMIUM_ARGS):[]});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const isolation = await installFixtureIsolation(context, { origin, documentPaths: ['/events', '/upgrades', '/tests/fixtures/events-search/index.html'] });
 await context.addInitScript(()=>{
   localStorage.setItem('pg_onboarded','1');
   localStorage.setItem('pg_events_local_area_v1',JSON.stringify({validated:true,city:'Phoenix',state:'AZ',label:'Phoenix, AZ'}));
   localStorage.setItem('pg_what_is_pg_seen_v2','1');
   const event=(id,title,date,extra={})=>({id,title,date,venue:'Fixture Arena',city:'Phoenix',state:'AZ',venue_timezone:'America/Phoenix',search_text_normalized:title.toLowerCase(),...extra});
   window.initialSearchFixture={tm:[],pg:[event('fixture-repeat-1','Knocked Loose','2099-10-01T22:00:00Z'),event('fixture-repeat-2','Knocked Loose','2099-10-02T22:00:00Z'),event('fixture-another','Another query','2099-10-03T22:00:00Z'),event('fixture-live','Live fixture',new Date(Date.now()-1800000).toISOString(),{event_end_utc:new Date(Date.now()+10800000).toISOString(),status:'live'}),...Array.from({length:130},(_,i)=>event(`fixture-continuation-${i}`,`Continuation ${i}`,new Date(Date.UTC(2099,10,i+1)).toISOString()))]};
 });
 for (const theme of ['dark','light']) {
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(`${origin}/events?browse=1&q=Knocked+Loose&city=Phoenix&state=AZ&past=1`);
  await page.evaluate(theme=>{localStorage.setItem('pg_theme',theme);document.documentElement.classList.toggle('dark',theme==='dark');},theme);
  await page.getByRole('link',{name:/^View Knocked Loose/}).nth(1).click();
  await page.getByRole('heading',{name:'Isolated event detail'}).waitFor();
  await page.goBack(); await page.waitForFunction(()=>document.activeElement?.closest('#event-row-fixture-repeat-2'));
  const input=page.getByRole('searchbox');
  await input.fill('Another');await input.press('Enter');await page.getByRole('heading',{name:'Another query',exact:true}).waitFor();
  await input.fill('Knocked Loose');await input.press('Enter');await page.getByRole('heading',{name:'Knocked Loose',exact:true}).nth(1).waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,label:document.activeElement?.getAttribute('aria-label'),scrollY,ancestorScroll:[...document.querySelectorAll('*')].filter(node=>node.scrollTop>0).map(node=>({tag:node.tagName,scrollTop:node.scrollTop}))}));
  observations.push({finding:'R02',theme,phase:before?'before':'after',focus});
  await page.screenshot({path:path.join(evidence,`r02-${before?'before':'after'}-${theme}.png`)});
  assert.equal(focus.tag,before?'A':'INPUT',`fresh repeated search focus ${theme}`);
  if (!before) {
    // The old entry still has its real return target; only a new submission is fresh.
    await page.goBack(); await page.getByRole('heading',{name:'Another query',exact:true}).waitFor();
    await page.goBack(); await page.waitForFunction(()=>document.activeElement?.closest('#event-row-fixture-repeat-2'));
    await page.goForward(); await page.getByRole('heading',{name:'Another query',exact:true}).waitFor();
    await page.goForward(); await page.getByRole('heading',{name:'Knocked Loose',exact:true}).nth(1).waitFor();
    await page.getByRole('link',{name:/^View Knocked Loose/}).nth(1).click();
    await page.getByRole('link',{name:'Back to events',exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.closest('#event-row-fixture-repeat-2'));
    await page.reload(); await page.waitForFunction(()=>document.activeElement?.closest('#event-row-fixture-repeat-2'));
    await input.fill('Knocked Loose'); await input.press('Enter');
    await page.getByRole('heading',{name:'Knocked Loose',exact:true}).nth(1).waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await input.evaluate(node=>node===document.activeElement),true,'explicit same-query refresh stays fresh');
    await page.getByRole('combobox',{name:'Sort events by date'}).focus();
    await page.getByRole('combobox',{name:'Sort events by date'}).selectOption('latest');
    await page.getByRole('heading',{name:'Knocked Loose',exact:true}).nth(1).waitFor();
    assert.equal(await page.getByRole('combobox',{name:'Sort events by date'}).evaluate(node=>node===document.activeElement),true);
    await page.getByLabel('Include past',{exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('input[type=checkbox]')?.checked);
    await page.getByRole('heading',{name:'Knocked Loose',exact:true}).nth(1).waitFor();
    await page.getByRole('button',{name:'Clear event search',exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.get('q'),null);
    await page.goto(`${origin}/events?browse=1&q=Another&city=Phoenix&state=AZ`);
    await page.getByRole('heading',{name:'Another query',exact:true}).waitFor();
    await page.goto(`${origin}/events?browse=1&q=Knocked+Loose&city=Phoenix&state=AZ&past=1`);
    await page.getByRole('heading',{name:'Knocked Loose',exact:true}).nth(1).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement?.tagName==='A'),false,'new direct visit does not inherit old entry');
  }

  await page.goto(`${origin}/upgrades`);
  await page.evaluate(theme=>{localStorage.setItem('pg_theme',theme);document.documentElement.classList.toggle('dark',theme==='dark');},theme);
  const live=page.getByRole('button',{name:/^Live now/}); await live.waitFor();
  if(theme==='dark')await live.click();else{await live.focus();await live.press('Enter');}
  assert.equal(await live.getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:/Live fixture/}).click();await page.getByRole('heading',{name:'Isolated event detail'}).waitFor();
  await page.goBack();await live.waitFor();
  const restored=await live.getAttribute('aria-pressed');
  observations.push({finding:'N01',theme,phase:before?'before':'after',restored});
  await page.waitForFunction(()=>[...document.querySelectorAll('.pg-upgrades-page')].some(node=>getComputedStyle(node).visibility==='visible' && Math.abs(node.getBoundingClientRect().x)<1 && Number(getComputedStyle(node.parentElement).opacity)>0.99));
  await page.screenshot({path:path.join(evidence,`n01-${before?'before':'after'}-${theme}.png`)});
  assert.equal(restored,before?'false':'true',`Live filter after Back ${theme}`);
  await live.click();await page.reload();await live.waitFor();assert.equal(await live.getAttribute('aria-pressed'),before?'false':'true');
  if (!before) {
    await page.getByRole('button',{name:/Live fixture/}).click();
    await page.getByRole('link',{name:'Back to upgrades',exact:true}).click();
    await live.waitFor(); assert.equal(await live.getAttribute('aria-pressed'),'true','explicit hub Back retains Live');
    await page.waitForFunction(()=>document.activeElement?.id==='upgrade-event-fixture-live');
    const upcoming=page.getByRole('button',{name:/^Upcoming/});
    await upcoming.click(); assert.equal(new URL(page.url()).searchParams.get('view'),null);
    await page.goBack();assert.equal(await live.getAttribute('aria-pressed'),'true');
    await page.goForward();assert.equal(await upcoming.getAttribute('aria-pressed'),'true');
    for(let i=0;i<2;i++) {await page.getByRole('button',{name:'Load more events',exact:true}).click(); await page.getByRole('button',{name:'Load more events',exact:true}).waitFor();}
    await page.getByRole('button',{name:/Continuation 100 /}).click();
    await page.getByRole('heading',{name:'Isolated event detail'}).waitFor();
    await page.goBack();await page.waitForFunction(()=>document.activeElement?.id==='upgrade-event-fixture-continuation-100');
    assert.equal(await upcoming.getAttribute('aria-pressed'),'true');
    await page.waitForFunction(()=>[...document.querySelectorAll('.pg-upgrades-page')].some(node=>getComputedStyle(node).visibility==='visible' && Math.abs(node.getBoundingClientRect().x)<1 && Number(getComputedStyle(node.parentElement).opacity)>0.99));
    await page.screenshot({path:path.join(evidence,`n01-depth-after-${theme}.png`)});
    const providerCalls=await page.evaluate(()=>window.searchFixture.calls.filter(call=>call.name==='getTicketmasterEvents'));
    assert.ok(providerCalls.every(call=>call.params.page===0),'exhausted provider never advances during local depth restore');
    await page.reload();await page.waitForFunction(()=>document.activeElement?.id==='upgrade-event-fixture-continuation-100');
    await page.goto(`${origin}/upgrades?view=unrecognized`);await upcoming.waitFor();
    assert.equal(await upcoming.getAttribute('aria-pressed'),'true');assert.equal(new URL(page.url()).searchParams.get('view'),'unrecognized','invalid URL defaults without replacing history');
    await page.goto(`${origin}/upgrades`);await upcoming.waitFor();assert.equal(await upcoming.getAttribute('aria-pressed'),'true');
  }

  assert.deepEqual(errors,[]);await page.close();
 }
 await isolation.assertClean();
 await writeFile(path.join(evidence,`discovery-${before?'before':'after'}.json`),JSON.stringify(observations,null,2)+'\n');
 console.log(`${before?'REPRODUCED':'PASS'} R02 repeated fresh query focus and N01 Live Back/reload, dark/light, pointer/keyboard; ${before?'baseline':'explicit Back, Forward, same-query refresh, direct visits, invalid defaults, local continuation depth'}; isolated 390x844`);
} finally {await browser?.close();await server.close();}
