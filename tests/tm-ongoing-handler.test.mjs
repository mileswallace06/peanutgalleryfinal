import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildTMDiscoveryRequest, ongoingCoverage } from '../base44/shared/tmDiscoveryRequest.js';
import { classifyTMResponse, normalizeTMEvent, reliableTMTimestamp } from '../base44/shared/tmResponseHandler.js';
const now = Date.parse('2026-09-11T07:30:00Z');
const sample = (start='2026-09-11T05:00:00Z',end='2026-09-11T09:00:00Z') => ({id:'sample',name:'Sample show',dates:{start:{dateTime:start},end:{dateTime:end},timezone:'America/Phoenix'},_embedded:{venues:[{name:'Sample venue',city:{name:'Phoenix'},state:{stateCode:'AZ'}}]}});
test('default future request retains original parameters and future budget',()=>{
 const implicit=buildTMDiscoveryRequest({keyword:'Wailers',city:'Phoenix',size:40},now);
 const explicit=buildTMDiscoveryRequest({keyword:'Wailers',city:'Phoenix',size:40,discoveryWindow:'future'},now);
 assert.deepEqual(Object.fromEntries(implicit.params),{size:'40',sort:'date,asc',startDateTime:'2026-09-11T07:30:00Z',countryCode:'US',keyword:'Wailers',city:'Phoenix'});
 assert.equal(implicit.params.toString(),explicit.params.toString());
 assert.equal(buildTMDiscoveryRequest({size:200},now).limit,200);
 assert.equal(ongoingCoverage(implicit,{},0),undefined);
});
test('ongoing windows are server-owned, bounded, separate and descending',()=>{
 const q=buildTMDiscoveryRequest({discoveryWindow:'ongoing',size:200,keyword:'Night',latlong:'33.45,-112.07',radius:'50',city:'Ignored'},now);
 assert.deepEqual(Object.fromEntries(q.params),{size:'40',sort:'date,desc',startDateTime:'2026-09-10T19:30:00Z',countryCode:'US',endDateTime:'2026-09-11T07:30:00Z',keyword:'Night',latlong:'33.45,-112.07',radius:'50',unit:'miles'});
 assert.equal(ongoingCoverage(q,{page:{totalElements:83}},40).truncated,true);
 assert.equal(ongoingCoverage(q,{page:{totalElements:2}},2).truncated,false);
 assert.equal(ongoingCoverage(q,{},40).truncated,true);
});
test('server rejects invalid modes, numeric coercions and caller-controlled history',()=>{
 for(const body of [null,[],{discoveryWindow:null},{discoveryWindow:'all'},{keyword:{}},{city:'a'.repeat(101)},{latlong:',2'},{latlong:'91,0'},{latlong:'1,Infinity'},{radius:[]},{radius:501},{size:true},{size:1.2},{size:201}]) assert.ok(buildTMDiscoveryRequest(body,now).error,JSON.stringify(body));
 for(const key of ['startDateTime','endDateTime','lookbackHours','page','startEndDateTime']) assert.equal(buildTMDiscoveryRequest({[key]:'anything'},now).error,'unsupported_time_window');
});
test('normalization retains explicit start/end/timezone and does not manufacture midnight',()=>{
 const raw=sample(), e=normalizeTMEvent(raw);
 assert.equal(e.date,raw.dates.start.dateTime);assert.equal(e.event_start_utc,'2026-09-11T05:00:00.000Z');assert.equal(e.event_end_utc,'2026-09-11T09:00:00.000Z');assert.equal(e.venue_timezone,'America/Phoenix');
 assert.equal(normalizeTMEvent({dates:{start:{localDate:'2026-09-11'}}}).date,null);
 assert.equal(normalizeTMEvent({dates:{start:{localDate:'2026-09-11',localTime:'19:30:00'}}}).event_start_utc,null);
 for(const value of ['2026-02-30T12:00:00Z','2026-09-11T24:00:00Z','2026-09-11T19:30:00','2026-09-11'])assert.equal(reliableTMTimestamp(value),null);
 assert.equal(normalizeTMEvent(sample(undefined,'invalid')).end_time_invalid,true);
 assert.equal(normalizeTMEvent(sample(undefined,'2026-09-10T12:00:00Z')).end_time_invalid,true);
 const tba=sample();Object.assign(tba.dates.start,{dateTBA:true,timeTBA:true,noSpecificTime:true});
 assert.equal(normalizeTMEvent(tba).time_tba,true);assert.equal(normalizeTMEvent(tba).no_specific_time,true);
});
const source=readFileSync(new URL('../base44/functions/getTicketmasterEvents/entry.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function handler(fetch){let run;vm.runInNewContext(source,{Deno:{serve:fn=>{run=fn},env:{get:()=> 'isolated-fixture-key'}},createClientFromRequest:()=>({}),buildTMDiscoveryRequest,ongoingCoverage,classifyTMResponse,normalizeTMEvent,Response,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch});return run;}
const request=body=>new Request('https://example.invalid',{method:'POST',body:JSON.stringify(body)});
test('actual handler calls provider once with bounded ongoing query and returns coverage',async()=>{
 const urls=[];const run=handler(async url=>{urls.push(new URL(url));return Response.json({_embedded:{events:[sample()]},page:{totalElements:1}})});
 const res=await run(request({discoveryWindow:'ongoing',size:200,city:'Phoenix'})),data=await res.json();
 assert.equal(res.status,200);assert.equal(urls.length,1);assert.equal(urls[0].searchParams.get('size'),'40');assert.equal(Date.parse(urls[0].searchParams.get('endDateTime'))-Date.parse(urls[0].searchParams.get('startDateTime')),12*3600000);
 assert.equal(data.coverage.limit,40);assert.equal(data.coverage.truncated,false);assert.equal(data.events[0].event_end_utc,'2026-09-11T09:00:00.000Z');
});
test('actual handler keeps default success shape and rejects invalid requests before provider',async()=>{
 let calls=0;const run=handler(async()=>{calls++;return Response.json({_embedded:{events:[sample()]}})});
 const data=await (await run(request({}))).json();assert.deepEqual(Object.keys(data),['events']);assert.equal(calls,1);
 for(const body of [{discoveryWindow:'bad'},{size:'Infinity'},{lookbackHours:1000},null])assert.equal((await run(request(body))).status,400);
 assert.equal(calls,1);
});
test('actual handler preserves 404, rate limits, malformed data and timeout failures',async()=>{
 for(const [fetch,status,error] of [
 [async()=>Response.json({}, {status:404}),200,undefined],
 [async()=>Response.json({}, {status:429}),429,'rate_limited'],
 [async()=>Response.json({_embedded:{events:{}}}),502,'malformed_response'],
 [async()=>new Response('invalid'),502,'malformed_response'],
 [async()=>{throw Object.assign(Error(),{name:'AbortError'})},504,'tm_timeout'],
 [async()=>{throw Error('secret-like upstream detail')},502,'tm_fetch_failed']]){
 const res=await handler(fetch)(request({discoveryWindow:'ongoing'})),data=await res.json();assert.equal(res.status,status);assert.equal(data.error,error);if(status===200){assert.equal(data.events.length,0);assert.equal(data.coverage.returned,0);}
 }
});
