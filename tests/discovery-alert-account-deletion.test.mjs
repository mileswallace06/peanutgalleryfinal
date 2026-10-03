import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Real deleteAccount handler, entirely mocked adapters; maintenance prevents payment access.
async function run(user, body) {
  let handler;
  const calls = [];
  const entities = new Proxy({}, { get(_target, name) {
    return {
      filter: async query => name === 'User' ? [{id: query.email === 'admin-target@example.test' ? 'target-id' : 'owner-id'}] : [],
      update: async () => ({}), updateMany: async () => ({}), delete: async () => ({}),
      deleteMany: async query => { calls.push({name, query: structuredClone(query)}); return {}; },
    };
  } });
  const client = { auth: {me:async () => user}, asServiceRole:{entities},
    integrations:{Core:{SendEmail:async () => ({mock:true})}} };
  const source = readFileSync(new URL('../base44/functions/deleteAccount/entry.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(source, {
    Deno:{serve:fn => {handler=fn;},env:{get:() => {throw Error('unexpected secret access');}}},
    createClientFromRequest:() => client, Response,
    isMaintenanceActive:() => true,
    getUserPrivate:async () => null, getUserSecurityProfile:async () => null,
    Stripe:class {constructor() {throw Error('unexpected payment access');}},
    console:{warn:() => {},error:() => {}},
  });
  const response = await handler(new Request('https://local.invalid',{method:'POST',body:JSON.stringify(body)}));
  return { status:response.status, calls };
}
test('account cleanup includes both new entities for authenticated owner, ignoring spoofed target', async () => {
  const result = await run({id:'owner-id',email:'owner@example.test',role:'user'}, {email:'victim@example.test'});
  assert.equal(result.status,200);
  const alerts = result.calls.filter(call => call.name.startsWith('DiscoveryAlert'));
  assert.deepEqual(alerts.map(call => call.name),['DiscoveryAlertSubscription','DiscoveryAlertPreference']);
  for (const call of alerts) assert.deepEqual(call.query,{$or:[{user_id:'owner-id'},{user_email:'owner@example.test'}]});
});
test('authorized admin target cleanup uses resolved target identity and anonymous deletion remains rejected', async () => {
  const result = await run({id:'admin',email:'admin@example.test',role:'admin'}, {email:'admin-target@example.test'});
  assert.equal(result.status,200);
  for (const call of result.calls.filter(call => call.name.startsWith('DiscoveryAlert'))) assert.deepEqual(call.query,{$or:[{user_id:'target-id'},{user_email:'admin-target@example.test'}]});
  const denied = await run(null,{});
  assert.equal(denied.status,401); assert.equal(denied.calls.length,0);
});
