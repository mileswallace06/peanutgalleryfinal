/** Negative safety proof: denied attempts are expected here, never delivered. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {installFixtureIsolation} from './helpers/fixtureIsolation.mjs';
const requests=[];
const server=createServer((req,res)=>{requests.push([req.method,req.url]);res.setHeader('Content-Type',req.url.includes('.js')?'application/javascript':'text/html');res.end(req.url.includes('.js')?readFileSync(new URL('./helpers/fixtureSdkGuard.js', import.meta.url),'utf8'):'<!doctype html><title>Isolation probe</title><p>Local fixture</p>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.env.PG_CHROMIUM_PATH?{executablePath:process.env.PG_CHROMIUM_PATH}:{}),args:JSON.parse(process.env.PG_CHROMIUM_ARGS||'[]')});
try{
 const context=await browser.newContext();const guard=await installFixtureIsolation(context,{origin,documentPaths:['/fixture.html']});const page=await context.newPage();await page.goto(origin+'/fixture.html');await guard.assertClean();
 await page.evaluate(async()=>{
  await fetch('/api/should-never-leave',{method:'POST'}).catch(()=>{});
  fetch=()=>Promise.resolve('overridden');
  await fetch('https://example.invalid/blocked').catch(()=>{});
  navigator.sendBeacon('https://example.invalid/beacon','synthetic');
  try{new XMLHttpRequest().open('POST','/api/xhr');}catch{}
  try{new WebSocket('ws://127.0.0.1:1');}catch{}
  const {guardFixtureSdk}=await import('/tests/helpers/fixtureSdkGuard.js');
  const sdk=guardFixtureSdk({entities:{Event:{filter:async()=>[]}}},()=>{});
  try{await sdk.entities.Event.create({});}catch{}
  await window.__PG_FLUSH_FIXTURE_BLOCKS__();
 });
 assert.deepEqual(guard.attempts.map(x=>x.kind),['fetch','fetch','beacon','xhr','websocket','sdk']);
 await page.goto(origin+'/fixture.html');
 await assert.rejects(()=>guard.assertClean(),/No forbidden network or SDK attempts/);
 assert.ok(requests.every(([method,url])=>method==='GET'&&['/fixture.html','/favicon.ico','/tests/helpers/fixtureSdkGuard.js'].includes(url)),JSON.stringify(requests));
 console.log(JSON.stringify({status:'PASS',negativeAttempts:guard.attempts.length,persistAfterNavigation:true,fixtureOverrideCannotBypass:true,serverRequests:requests}));
 // Expected rejection is part of the negative probe; browser disposal follows.
 await assert.rejects(()=>context.close(),/No forbidden network or SDK attempts/);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
