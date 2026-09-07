import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMockDeps } from './mockDeps.mjs';
import { createCoordinator } from '../../workers/notification/postgres.mjs';

export async function notificationDatabase() {
  // Reuse the existing isolated PostgreSQL runner. No URL/env credential read.
  const socket = process.env.PG_MISSION1_SOCKET;
  const runtime = process.env.PG_MISSION1_RUNTIME;
  if (!socket?.startsWith('/') || !socket.includes('/pg-m1-') || !runtime?.startsWith('/private/tmp/')) throw new Error('LOCAL_TEST_RUNNER_REQUIRED');
  const { default: pg } = await import(pathToFileURL(join(runtime, 'node_modules/pg/lib/index.js')));
  const config = { host: socket, port: 55439, user: 'postgres', password: 'local_synthetic_only' };
  const database = `notify_${randomUUID().replaceAll('-', '')}`;
  const setup = new pg.Client({ ...config, database: 'postgres' });
  await setup.connect();
  await setup.query(`CREATE DATABASE ${database} TEMPLATE template0`);
  await setup.end();
  const clients = [];
  const connect = async (role = null) => {
    const client = new pg.Client({ ...config, database });
    await client.connect(); clients.push(client);
    if (role === 'worker') await client.query('SET ROLE notification_worker');
    if (role === 'operator') await client.query('SET ROLE notification_reconciler');
    return client;
  };
  const admin = await connect();
  await admin.query(await readFile(new URL('../../database/notification_worker/001_dispatch.sql', import.meta.url), 'utf8'));
  const worker = await connect('worker');
  return {
    admin, worker, connect,
    async harness(seed = defaultSeed()) {
      const scope = `synthetic-${randomUUID()}`;
      await admin.query('SELECT notification_worker.configure($1,false,$2)', [scope, 'local-test-cutover-fixture']);
      const deps = createMockDeps({ seed });
      const calls = [];
      const entities = Object.fromEntries(['Notification', 'Purchase', 'PurchasePrivate', 'AdminAlert'].map(name => [name, {
        filter: async (...args) => structuredClone(await deps.entities[name].filter(...args)),
        update: async (...args) => { calls.push({ entity: name, method: 'update', args }); return deps.entities[name].update(...args); },
        create: async (...args) => { calls.push({ entity: name, method: 'create', args }); return deps.entities[name].create(...args); },
      }]));
      const coordinatorFor = client => createCoordinator(async (sql, args) => (await client.query(sql, args)).rows, scope);
      return { scope, deps, entities, calls, coordinator: coordinatorFor(worker), coordinatorFor,
        maintenance: async () => false,
        rows: name => deps._state.stores[name],
        journal: async () => (await admin.query('SELECT * FROM notification_worker.writes WHERE scope=$1 ORDER BY started_at', [scope])).rows,
        configure: (maintenance, ref = 'local-test-cutover-fixture') => admin.query('SELECT notification_worker.configure($1,$2,$3)', [scope, maintenance, ref]),
      };
    },
    close: () => Promise.all(clients.map(client => client.end())),
  };
}

export function notification(id, key, type = 'sale_created', status = 'pending', day = 1) {
  return { id, idempotency_key: key, type, dispatch_status: status, reference_id: 'purchase_synthetic',
    user_email: 'synthetic@example.invalid', title: 'Synthetic in-app notice', body: 'Local fixture only',
    read: false, action_url: '/purchase/purchase_synthetic', created_date: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z` };
}
export function defaultSeed() {
  return {
    Notification: [notification('sale_a', 'sale_created:purchase_synthetic'), notification('web_a', 'webhook:evt_synthetic', 'sale_complete')],
    Purchase: [{ id: 'purchase_synthetic', payment_status: 'captured', transfer_status: 'completed' }],
    PurchasePrivate: [{ id: 'private_synthetic', purchase_id: 'purchase_synthetic', seller_email: 'synthetic@example.invalid', payment_captured: true }],
  };
}
export function barrier() {
  let release, arrive;
  const reached = new Promise(resolve => { arrive = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  return { reached, release, wait: async () => { arrive(); await hold; } };
}
