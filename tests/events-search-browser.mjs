/**
 * Nearby-first Events regression scenarios using the real page and a mock SDK.
 * Optional local runner: node tests/events-search-browser.mjs
 * Requires an existing Playwright/Chromium installation; no production dependency.
 * Equivalent scenarios may be driven in an existing Chrome session with the fixture.
 */
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const server = await createServer({configFile:false,root,logLevel:'error',plugins:[react()],resolve:{alias:[{find:'@/api/base44Client',replacement:path.join(root,'tests/fixtures/events-search/base44.js')},{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port:0}});
let browser;
try {
 await server.listen();
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await context.addInitScript(()=>{
   sessionStorage.setItem('pg_events_location',JSON.stringify({city:'Kahan'}));
   localStorage.setItem('pg_events_local_area_v1',JSON.stringify({validated:true,city:'Phoenix',state:'AZ',label:'Phoenix, AZ'}));
   const event=(title,city,state,tm_id)=>({title,city,state,tm_id,date:'2099-10-01T20:00:00Z',venue:'Fixture Arena'});
   const rock=event('Phoenix Rock Night','Phoenix','AZ','rock');
   window.initialSearchFixture={tm:[rock,event('Billy in Boston','Boston','MA','billy')],pg:[{...rock,id:'local-rock',search_text_normalized:'phoenix rock night'},{...rock,id:'duplicate',search_text_normalized:'phoenix rock night'}]};
   Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(success,failure)=>{window.geoSuccess=success;window.geoFailure=failure;}}});
 });
 const page=await context.newPage(), errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/events-search/`);
 const search=page.getByRole('searchbox'), latest=()=>page.evaluate(()=>window.searchFixture.calls.filter(c=>c.name==='getTicketmasterEvents').at(-1)?.params);
 await page.getByRole('heading',{name:'Phoenix Rock Night',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Phoenix Rock Night',exact:true}).count(),1);
 assert.equal(await search.inputValue(),'');
 assert.deepEqual(await latest(),{size:40,city:'Phoenix'});
 await search.fill('Rock'); await search.press('Enter');
 await page.getByRole('heading',{name:'Phoenix Rock Night',exact:true}).waitFor();
 await search.fill('Billy'); await search.press('Enter');
 await page.getByText('No matches for ‘Billy’ near Phoenix, AZ',{exact:true}).waitFor();
 await search.fill('Unsubmitted draft');
 await page.getByRole('button',{name:'Search nationwide',exact:true}).click();
 await page.getByRole('heading',{name:'Billy in Boston',exact:true}).waitFor();
 assert.equal(await search.inputValue(),'Billy');
 assert.deepEqual(await latest(),{size:40,keyword:'Billy'});
 await page.getByText('Nationwide results · United States',{exact:true}).waitFor();
 // A brand-new submission returns to the local area, even from nationwide.
 await search.fill('Billy'); await search.press('Enter');
 await page.getByText('No matches for ‘Billy’ near Phoenix, AZ',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Search nationwide',exact:true}).click();
 await page.getByRole('heading',{name:'Billy in Boston',exact:true}).waitFor();
 await page.getByRole('button',{name:'Near Me',exact:true}).click();
 await page.getByRole('heading',{name:'Phoenix Rock Night',exact:true}).waitFor();
 assert.equal(await search.inputValue(),'');
 await page.evaluate(()=>{window.searchFixture.tmError=429;});
 await search.fill('Unavailable');await search.press('Enter');
 await page.getByText('Some search results are unavailable',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Search nationwide',exact:true}).count(),0);
 await page.evaluate(()=>{window.searchFixture.tmError=null;});
 await search.fill('Unsubmitted error draft');
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByText('No matches for ‘Unavailable’ near Phoenix, AZ',{exact:true}).waitFor();
 assert.equal((await latest()).keyword,'Unavailable');
 await page.getByRole('button',{name:'Phoenix, AZ · change',exact:true}).click();
 await page.getByRole('combobox').fill('Kahan');await page.getByRole('combobox').press('Enter');
 await page.getByRole('alert').waitFor();
 await page.getByRole('button',{name:'Use my location',exact:true}).click();
 await page.evaluate(()=>window.geoFailure({code:1}));
 await page.getByText('Location permission was denied. Choose a city below.',{exact:true}).waitFor();
 // A newer local submit cancels a pending GPS callback.
 await page.getByRole('button',{name:'Use my location',exact:true}).click();
 await search.fill('Rock');await search.press('Enter');
 await page.getByRole('heading',{name:'Phoenix Rock Night',exact:true}).waitFor();
 await page.evaluate(()=>window.geoSuccess({coords:{latitude:42.36,longitude:-71.06}}));
 assert.equal(await page.getByText('Nearby · Phoenix, AZ',{exact:true}).count(),1);
 for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS nearby defaults, local/nationwide transitions, submitted queries, duplicates, error honesty, denied location, stale GPS, mobile widths');
} finally {await browser?.close();await server.close();}
