import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { sellingEventTiming, sellingEventList, reliableTime } from '../src/lib/sellingEventTiming.js';
import { createEventSearchRequest } from '../src/lib/eventSearchRequest.js';
import { mergeEventSources } from '../src/lib/eventSourceMerger.js';
import { fetchSellingEvents, sellingPGQueries } from '../src/lib/sellingEventDiscovery.js';
import { resolveSellingEvent, isCanonicalEventId } from '../src/lib/resolveSellingEvent.js';
const now=Date.parse('2026-09-10T20:00:00Z');
const iso=hours=>new Date(now+hours*3600000).toISOString();
const event=(id,hours,extra={})=>({id,title:`Sample ${id}`,date:iso(hours),city:'Phoenix',state:'AZ',venue:'Sample Arena',...extra});
const area={city:'Phoenix',state:'AZ',label:'Phoenix, AZ'};
const ok=value=>({status:'fulfilled',value});
test('actual end times retain ongoing PG events and end exactly at the boundary',()=>{
 const live=event('live',-10,{event_end_utc:iso(1)});
 assert.equal(sellingEventTiming(live,now).status,'live');
 assert.equal(sellingEventTiming(live,now+3600000).status,'ended');
 assert.equal(sellingEventTiming({...live,event_start_utc:iso(2)},now).status,'unknown');
});
test('estimated windows are bounded, labeled and never applied to unknown timestamps',()=>{
 assert.equal(sellingEventTiming(event('estimate',-1),now).status,'estimated_live');
 assert.equal(sellingEventTiming(event('estimate',-9,{duration_hours:1000}),now).status,'ended');
 for(const date of [null,'2026-09-10','2026-09-10T10:00:00','2026-02-30T10:00:00Z','2026-09-10T24:00:00Z','nonsense']){
  assert.equal(sellingEventTiming(event('unknown',0,{date,status:'live'}),now).status,'unknown');
  assert.equal(reliableTime(date),null);
 }
 assert.equal(sellingEventTiming(event('tba',-1,{time_tba:true}),now).status,'unknown');
});
test('All puts live first, sorts upcoming start times, and excludes synthetic/ended events',()=>{
 const rows=[event('late',3),event('soon',1),event('live',-1,{event_end_utc:iso(1)}),event('ended',-8),event('beta',1,{is_beta_live:true})];
 assert.deepEqual(sellingEventList(rows,'all',now).map(x=>x.event.id),['live','soon','late']);
 assert.deepEqual(sellingEventList(rows,'upcoming',now).map(x=>x.event.id),['soon','late']);
 assert.deepEqual(sellingEventList(rows,'live',now).map(x=>x.event.id),['live']);
});
test('minute/foreground reclassification can move upcoming to live and then ended without fetching',()=>{
 const rows=[event('time',1/60,{duration_hours:1})];
 assert.equal(sellingEventList(rows,'live',now).length,0);
 assert.equal(sellingEventList(rows,'live',now+60000)[0].timing.status,'estimated_live');
 assert.equal(sellingEventList(rows,'all',now+3660000).length,0);
});
test('started PG support is opt-in and preserves the shared merger identity correction',()=>{
 const local=[event('live',-1,{tm_id:'same'}),event('copy',-1,{tm_id:'same'})];
 const args={localResult:ok(local),tmResult:ok({events:[]}),filters:{now,isAdmin:false}};
 assert.equal(mergeEventSources(args).events.length,0);
 assert.deepEqual(mergeEventSources({...args,filters:{...args.filters,includeStarted:true}}).events.map(e=>e.id),['live']);
});
test('PG partitions preserve future capacity and explicitly query ongoing/canonical timestamps',()=>{
 const q=sellingPGQueries(createEventSearchRequest('',area),now);
 assert.equal(q.limit,200);assert.equal(q.future.state.$regex,'^AZ$');
 assert.deepEqual(q.future.$or[0],{event_start_utc:{$gte:iso(0)}});
 assert.deepEqual(q.ongoing.$or[0],{event_start_utc:{$gte:iso(-12),$lt:iso(0)}});
 assert.ok(q.ongoing.$or.some(x=>x.event_end_utc));
 assert.ok(q.ongoing.$or.some(x=>x.status==='live'));
});
test('discovery is read-only, keeps future provider request limits and deduplicates PG/provider copies',async()=>{
 const calls=[];const client={entities:{Event:{filter:async(q,sort,limit)=>{calls.push({q,sort,limit});return sort==='date'?[event('pg',1,{tm_id:'same'})]:[event('live',-1,{event_end_utc:iso(1)})]}}},functions:{invoke:async(name,params)=>{assert.equal(name,'getTicketmasterEvents');calls.push({name,params});return {data:{events:[event('tm',1,{tm_id:'same'})]}}}}};
 const result=await fetchSellingEvents(client,createEventSearchRequest('',area),true,now);
 assert.equal(result.events.length,2);assert.equal(result.pgError,false);assert.equal(result.tmError,false);
 assert.deepEqual(calls[2].params,{size:40,city:'Phoenix'});assert.equal(calls.length,3);
});
test('partition/provider errors remain incomplete results, not a successful no-match claim',async()=>{
 const client={entities:{Event:{filter:async(_q,sort)=>{if(sort==='-date')throw Error('PG unavailable');return [event('future',1)]}}},functions:{invoke:async()=>{throw {status:429}}}};
 const result=await fetchSellingEvents(client,createEventSearchRequest('Sample',area),true,now);
 assert.equal(result.pgError,true);assert.equal(result.tmError,true);assert.equal(result.rateLimited,true);assert.equal(result.events.length,1);
});
test('direct PG resolution preserves the complete live event object',async()=>{
 const full=event('canonical-live',-1,{event_end_utc:iso(2),transfer_window_status:'open'});
 const result=await resolveSellingEvent({entities:{Event:{get:async id=>{assert.equal(id,full.id);return full}}}},full.id);
 assert.equal(result.event_end_utc,full.event_end_utc);assert.equal(result.transfer_window_status,'open');assert.equal(result.id,'canonical-live');
});
test('synced provider selection uses its canonical PG ID without writing',async()=>{
 const client={entities:{Event:{filter:async()=>[event('canonical',1,{tm_id:'provider'})]}}};
 const result=await resolveSellingEvent(client,{id:'tm_provider',source:'ticketmaster',tm_id:'provider',image_url:'sample-art',event_end_utc:iso(3)});
 assert.equal(result.id,'canonical');assert.equal(result.image_url,'sample-art');assert.equal(result.event_end_utc,iso(3));
});
test('unsynced selection resolves the returned canonical record and retries a read failure without another sync',async()=>{
 let writes=0,gets=0,exists=false;
 const client={entities:{Event:{filter:async()=>exists?[event('created',1,{tm_id:'provider'})]:[],get:async()=>{if(++gets===1)throw Error('temporary read failure');return event('created',1)}}},functions:{invoke:async name=>{assert.equal(name,'syncTMEvent');writes++;exists=true;return {data:{id:'created'}}}}};
 const candidate={id:'tm_provider',tm_id:'provider',title:'Sample',source:'ticketmaster'};
 await assert.rejects(resolveSellingEvent(client,candidate));
 assert.equal((await resolveSellingEvent(client,candidate)).id,'created');assert.equal(writes,1);
});
test('display IDs and incomplete provider setup can never become submitted IDs',async()=>{
 assert.equal(isCanonicalEventId('tm_provider'),false);
 await assert.rejects(resolveSellingEvent({},'tm_provider'));
 await assert.rejects(resolveSellingEvent({entities:{Event:{filter:async()=>[]}},functions:{invoke:async()=>({data:{id:'tm_fake'}})}},{tm_id:'fake'}));
});
test('published submission and proof functions remain byte-for-byte unchanged',()=>{
 const baseline=execFileSync('git',['show','cea03f81a05d1a13a8294cc6772a275c44c3a61e:src/pages/CreateListing.jsx'],{encoding:'utf8'});
 const current=readFileSync(new URL('../src/pages/CreateListing.jsx',import.meta.url),'utf8');
 const block=s=>s.slice(s.indexOf('  const handleProofUpload'),s.indexOf('  const handleTmSearch')===-1?s.indexOf('  // ── Onboarding state'):s.indexOf('  const handleTmSearch')).trim();
 assert.equal(block(current),block(baseline));
});
