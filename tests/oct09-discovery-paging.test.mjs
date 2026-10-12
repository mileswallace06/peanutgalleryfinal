import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryPager, advanceDiscoveryPager, discoveryPagerResult } from '../src/lib/eventDiscoveryPager.js';
import { createEventSearchRequest } from '../src/lib/eventSearchRequest.js';
import { bustTMCache } from '../src/lib/tmCache.js';
import { discoveryMock } from './helpers/discoveryMock.mjs';
const now=Date.parse('2026-10-09T12:00:00Z');
const request=createEventSearchRequest('',{city:'Phoenix',state:'AZ',label:'Phoenix, AZ'});
const row=(id,i,provider=false)=>({id,title:`Fixture ${id}`,date:new Date(now+(i+1)*3600000).toISOString(),venue:'Fixture Arena',city:'Phoenix',state:'AZ',...(provider?{tm_id:id}:{})});
for (const direction of ['provider first','local first']) test(`independent paging after ${direction} exhausts retains rows without refetching the exhausted source`, async()=>{
 bustTMCache();
 const pg=Array.from({length:direction==='provider first'?125:1},(_,i)=>row(`local-${i}`,i));
 const tm=Array.from({length:direction==='local first'?125:1},(_,i)=>row(`provider-${i}`,i,true));
 const client=discoveryMock(pg,tm);let pager=await advanceDiscoveryPager(client,createDiscoveryPager(request,now));
 const exhaustedCalls=client.calls.filter(c=>direction==='provider first'?c.name==='getTicketmasterEvents':c.name==='Event.filter').length;
 assert.equal(discoveryPagerResult(pager).limited,true);
 for(let i=0;i<5&&discoveryPagerResult(pager).hasMore;i++)pager=await advanceDiscoveryPager(client,pager);
 const result=discoveryPagerResult(pager);
 assert.equal(result.exhausted,true);assert.equal(result.events.length,126);assert.equal(new Set(result.events.map(e=>e.id)).size,126);
 assert.equal(client.calls.filter(c=>direction==='provider first'?c.name==='getTicketmasterEvents':c.name==='Event.filter').length,exhaustedCalls);
});
test('a failed later provider page retries just that cursor while retaining successful local continuation',async()=>{
 bustTMCache();const client=discoveryMock(Array.from({length:90},(_,i)=>row(`local-${i}`,i)),Array.from({length:90},(_,i)=>row(`provider-${i}`,i,true)));
 let pager=await advanceDiscoveryPager(client,createDiscoveryPager(request,now));client.failures.provider=true;
 pager=await advanceDiscoveryPager(client,pager);assert.equal(pager.streams.provider.page,1);
 const result=discoveryPagerResult(pager);assert.equal(result.events.length,120);assert.equal(result.exhausted,false);assert.equal(result.tmError,true);
 const localCalls=client.calls.filter(c=>c.name==='Event.filter').length;client.failures.provider=false;
 pager=await advanceDiscoveryPager(client,pager,{retryFailed:true});assert.equal(discoveryPagerResult(pager).events.length,160);
 assert.equal(client.calls.filter(c=>c.name==='Event.filter').length,localCalls);assert.deepEqual(client.calls.filter(c=>c.name==='getTicketmasterEvents').map(c=>c.params.page),[0,1,1]);
 pager=await advanceDiscoveryPager(client,pager);assert.equal(discoveryPagerResult(pager).events.length,180);assert.equal(discoveryPagerResult(pager).exhausted,true);
});
test('provider capped coverage stays limited after local exhaustion and never claims all results',async()=>{
 bustTMCache();const client=discoveryMock([row('local',1)]);client.functions.invoke=async()=>({data:{events:[row('provider',1,true)],pagination:{page:0,size:40,hasMore:false,nextPage:null,truncated:true}}});
 const result=discoveryPagerResult(await advanceDiscoveryPager(client,createDiscoveryPager(request,now)));
 assert.equal(result.events.length,2);assert.equal(result.hasMore,false);assert.equal(result.truncated,true);assert.equal(result.limited,true);assert.equal(result.exhausted,false);
});
