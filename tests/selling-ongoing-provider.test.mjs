import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTMEvents,bustTMCache } from '../src/lib/tmCache.js';
import { fetchSellingEvents } from '../src/lib/sellingEventDiscovery.js';
import { createEventSearchRequest } from '../src/lib/eventSearchRequest.js';
import { sellingEventTiming,sellingEventList,withProviderTiming,applyProviderTiming } from '../src/lib/sellingEventTiming.js';
import { resolveSellingEvent } from '../src/lib/resolveSellingEvent.js';
import { normalizeTMEvent } from '../base44/shared/tmResponseHandler.js';
const now=Date.parse('2026-09-12T06:30:00Z'), iso=h=>new Date(now+h*3600000).toISOString();
const coverage={discoveryWindow:'ongoing',lookbackHours:12,limit:40,startDateTime:iso(-12),endDateTime:iso(0),truncated:false};
const e=(id,h,extra={})=>({id,tm_id:id,title:'Same Artist',date:iso(h),city:'Phoenix',state:'AZ',venue:'Sample venue',...extra});
const raw=(start,end,flags={})=>normalizeTMEvent({id:'raw',name:'Sample',dates:{start:{dateTime:start,...flags},end:{dateTime:end},timezone:'America/Phoenix'}});
test('provider end times cross midnight, override estimates and expire exactly at end',()=>{
 const event=raw('2026-09-12T05:00:00Z','2026-09-12T08:00:00Z');
 assert.equal(sellingEventTiming(event,now).status,'live');assert.equal(sellingEventTiming(event,Date.parse(event.event_end_utc)).status,'ended');
 assert.equal(sellingEventTiming(raw(iso(-10),iso(2)),now).status,'live');
 assert.equal(sellingEventTiming(raw(iso(-1),null),now).status,'estimated_live');
 assert.equal(sellingEventTiming(raw(iso(-9),null),now).status,'ended');
 for(const event of [raw(iso(-1),'invalid'),raw(iso(-1),iso(-2)),raw('2026-09-12T05:00:00',null),raw(iso(-1),iso(1),{timeTBA:true})])assert.equal(sellingEventTiming(event,now).status,'unknown');
 assert.equal(sellingEventTiming({...event,provider_status:'cancelled'},now).status,'ended');
});
test('timing merge preserves actual PG end when absent upstream, and clears it for rescheduled starts',()=>{
 const pg=e('pg',-1,{event_end_utc:iso(3),venue_timezone:'America/Phoenix'});
 assert.equal(applyProviderTiming(pg,{date:iso(-1),event_end_utc:null}).event_end_utc,iso(3));
 assert.equal(applyProviderTiming(pg,{date:iso(1),event_end_utc:null}).event_end_utc,null);
});
test('ongoing/upcoming caches are separate, stable, coalesced and retain coverage',async()=>{
 bustTMCache();let calls=0,release;const gate=new Promise(r=>release=r);
 const client={functions:{invoke:async(_name,p)=>{calls++;await gate;return {data:{events:[e(p.discoveryWindow||'future',1)],...(p.discoveryWindow?{coverage}:{})}}}}};
 const params={city:'Phoenix',size:40}, ongoing={...params,discoveryWindow:'ongoing'};
 const a=fetchTMEvents(client,ongoing),b=fetchTMEvents(client,ongoing),c=fetchTMEvents(client,params);assert.equal(calls,2);release();
 const results=await Promise.all([a,b,c]);assert.deepEqual(results[0].coverage,coverage);assert.equal(results[2].events[0].id,'future');
 assert.equal((await fetchTMEvents(client,ongoing)).fromCache,true);assert.equal(calls,2);
 for(let minute=0;minute<4;minute++)sellingEventList(results[0].events,'live',now+minute*60000);assert.equal(calls,2);
 bustTMCache(ongoing);await fetchTMEvents(client,ongoing);assert.equal(calls,3);assert.equal((await fetchTMEvents(client,params)).fromCache,true);
});
test('cache key separators cannot collide and unsupported old handler is an error',async()=>{
 bustTMCache();let calls=0;const client={functions:{invoke:async()=>{calls++;return {data:{events:[]}}}}};
 await fetchTMEvents(client,{keyword:'a&size=40'});await fetchTMEvents(client,{keyword:'a',size:40});assert.equal(calls,2);
 await assert.rejects(fetchTMEvents(client,{discoveryWindow:'ongoing',size:40}));
 await assert.rejects(fetchTMEvents(client,{discoveryWindow:'ongoing',size:40}));assert.equal(calls,4);
});
test('selling uses separate 40-result budgets, deduplicates identity and retains fresh timing on canonical resolution',async()=>{
 bustTMCache();const calls=[];
 const provider=e('identity',-1,{event_start_utc:iso(-1),event_end_utc:iso(1)});
 const pg=e('pg',-1,{tm_id:'identity',event_end_utc:null});
 const client={entities:{Event:{filter:async(_q,sort)=>sort==='-date'?[pg, {...pg,id:'duplicate'}]:[],get:async()=>pg}},functions:{invoke:async(name,p)=>{calls.push(p);return {data:{events:p.discoveryWindow?[provider]:[e('another-performance',2)],...(p.discoveryWindow?{coverage}:{})}}}}};
 const result=await fetchSellingEvents(client,createEventSearchRequest('',{city:'Phoenix',state:'AZ'}),true,now);
 assert.equal(calls.length,2);assert.ok(calls.every(p=>p.size===40&&p.city==='Phoenix'));assert.equal(calls.filter(p=>p.discoveryWindow==='ongoing').length,1);
 assert.equal(result.events.length,2);const selected=result.events.find(x=>x.id==='pg');assert.equal(selected.event_end_utc,iso(1));assert.equal(sellingEventTiming(selected,now).status,'live');
 const resolved=await resolveSellingEvent(client,selected);assert.equal(resolved.id,'pg');assert.equal(resolved.event_end_utc,iso(1));
 assert.equal(result.tmError,false);
});
test('provider failure retains valid PG and future results without an empty-live proof',async()=>{
 bustTMCache();const pg=e('pg-live',-1,{event_end_utc:iso(1)});
 const client={entities:{Event:{filter:async(_q,sort)=>sort==='-date'?[pg]:[]}},functions:{invoke:async(_name,p)=>{if(p.discoveryWindow)throw {status:429};return {data:{events:[e('future',2)]}}}}};
 const r=await fetchSellingEvents(client,createEventSearchRequest('',{city:'Phoenix',state:'AZ'}),true,now);
 assert.equal(r.tmOngoingError,true);assert.equal(r.tmError,true);assert.equal(r.rateLimited,true);assert.equal(r.pgError,false);assert.equal(r.events.length,2);assert.equal(sellingEventList(r.events,'live',now).length,1);
});
test('both provider windows respect GPS/local keyword and nationwide removes all local restrictions',async()=>{
 const calls=[];const client={entities:{Event:{filter:async()=>[]}},functions:{invoke:async(_n,p)=>{calls.push(p);return {data:{events:[],...(p.discoveryWindow?{coverage}:{})}}}}};
 for(const scope of ['local','nationwide']){
 bustTMCache();calls.length=0;await fetchSellingEvents(client,createEventSearchRequest('Artist',{ll:'33.45,-112.07'},scope),true,now);
 assert.equal(calls.length,2);for(const p of calls){assert.equal(p.keyword,'Artist');assert.equal(p.latlong,scope==='local'?'33.45,-112.07':undefined);assert.equal(p.radius,scope==='local'?'50':undefined);assert.equal(p.city,undefined);}
 }
});
test('provider TBA metadata survives resolution over a stale PG copy',async()=>{
 const candidate=withProviderTiming({...e('tm_x',-1,{tm_id:'x',source:'ticketmaster'}),time_tba:true,event_end_utc:iso(1)});
 const client={entities:{Event:{filter:async()=>[e('canonical',-1,{tm_id:'x',time_tba:false})]}}};
 assert.equal(sellingEventTiming(await resolveSellingEvent(client,candidate),now).status,'unknown');
});
