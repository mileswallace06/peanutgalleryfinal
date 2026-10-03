import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleNotifications } from '../src/lib/notificationVisibility.js';
const n = (id, status, extra = {}) => ({ id, type: 'upgrade_available', dispatch_status: status,
  user_email: 'fan@example.test', idempotency_key: 'discovery:upgrade:u1:e1', ...extra });
test('new discovery types hide pending, missing status, failed and superseded records', () => {
  const rows = [n('a','pending'),n('b','dispatched'),n('c','superseded'),n('d','failed'),n('e',undefined),n('f','dispatching')];
  assert.deepEqual(visibleNotifications(rows).map(row => row.id),['b']);
  assert.deepEqual(visibleNotifications([n('x','dispatched',{idempotency_key:null})]),[]);
});
test('dispatched discovery duplicates resolve by canonical ID, independently for each recipient', () => {
  const rows = [n('z','dispatched'),n('a','dispatched'),n('b','dispatched',{user_email:'another@example.test'})];
  assert.deepEqual(visibleNotifications(rows).map(row => row.id),['a','b']);
});
test('existing transactional notification behavior and ordering remain unchanged', () => {
  const rows = [n('a','pending',{type:'purchase_confirmed'}),n('b',undefined,{type:'sale_created'}),n('c','superseded',{type:'tickets_sent'}),n('d','dispatched',{type:'admin_message'})];
  assert.deepEqual(visibleNotifications(rows).map(row => row.id),['a','b','d']);
});
