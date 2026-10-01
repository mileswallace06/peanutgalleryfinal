import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

async function run({ enabled, getterThrows = false, cacheThrows = false } = {}) {
  let handler, serviceReads = 0, cacheCalls = 0;
  const client = {};
  Object.defineProperty(client, 'asServiceRole', { get() {
    serviceReads += 1;
    if (getterThrows) throw Error('service unavailable');
    return {entities:{}};
  } });
  const source = readFileSync(new URL('../base44/functions/getTicketmasterEvents/entry.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(source, {
    Deno:{serve:fn => {handler=fn;},env:{get:name => name === 'DISCOVERY_ALERTS_ENABLED' ? enabled : 'mock-provider-key'}},
    createClientFromRequest:() => client,
    buildTMDiscoveryRequest:() => ({params:new URLSearchParams(),limit:1}),
    classifyTMResponse:() => ({events:[{id:'event1'}]}),
    normalizeTMEvent:raw => ({tm_id:raw.id}), ongoingCoverage:() => null,
    cacheProviderDiscoveryEvents:async () => {cacheCalls+=1;if(cacheThrows) throw Error('cache failed');},
    fetch:async () => ({ok:true,status:200,json:async () => ({})}),
    AbortController, Response, setTimeout:() => 1, clearTimeout:() => {},
  });
  const response = await handler(new Request('https://local.invalid',{method:'POST',body:'{}'}));
  return { status:response.status, body:await response.json(), serviceReads, cacheCalls };
}
test('default-off discovery neither accesses service role nor attempts cache I/O', async () => {
  for (const enabled of [undefined,'false','TRUE']) {
    assert.deepEqual(await run({enabled,getterThrows:true}),{status:200,body:{events:[{tm_id:'event1'}]},serviceReads:0,cacheCalls:0});
  }
});
test('activated discovery retains results across service getter and cache write failure', async () => {
  for (const options of [{},{getterThrows:true},{cacheThrows:true}]) {
    const result = await run({enabled:'true',...options});
    assert.equal(result.status,200);
    assert.deepEqual(result.body,{events:[{tm_id:'event1'}]});
    assert.equal(result.serviceReads,1);
    assert.equal(result.cacheCalls,options.getterThrows ? 0 : 1);
  }
});
