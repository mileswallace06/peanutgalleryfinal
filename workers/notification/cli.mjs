import { pathToFileURL } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { connectCoordinator } from './postgres.mjs';
import { runOnce, recoverReturned, publicStatus } from './worker.mjs';

const HELP = `PG-CREDITS-01 notification worker
node workers/notification/cli.mjs --once [--batch-size=50]
node workers/notification/cli.mjs --schedule [--batch-size=50]  (60 seconds, serial)
node workers/notification/cli.mjs --status
node workers/notification/cli.mjs --recover  (read-only Base44 verification)

Maintenance defaults ON. No connections are opened for a maintenance-skipped run.
Active processing requires dedicated PostgreSQL configuration AND an explicitly
provisioned workload adapter; see workers/notification/README.md.
`;
const SAFE_CODES = new Set(['INVALID_ARGUMENTS', 'NOTIFICATION_ADAPTER_REQUIRED', 'INVALID_NOTIFICATION_ADAPTER',
  'NOTIFICATION_DATABASE_REQUIRED', 'DEDICATED_NOTIFICATION_DATABASE_IDENTITY_REQUIRED', 'INVALID_SCOPE', 'COORDINATION_FAILED']);

async function loadWorkloadAdapter(env, signal) {
  const path = env.PG_NOTIFICATION_ADAPTER_MODULE;
  if (!path || !isAbsolute(path) || !path.endsWith('.mjs')) throw new Error('NOTIFICATION_ADAPTER_REQUIRED');
  // This is trusted deployment code, never a URL, CLI credential, or user input.
  // It must implement a supported workload identity and fresh maintenance read.
  // No SDK service token, personal API key, or admin session is synthesized here.
  const module = await import(pathToFileURL(path));
  if (typeof module.connectNotificationAdapter !== 'function') throw new Error('INVALID_NOTIFICATION_ADAPTER');
  const adapter = await module.connectNotificationAdapter({ scope: env.PG_NOTIFICATION_SCOPE, signal });
  if (typeof adapter?.maintenance !== 'function' ||
      !['Notification', 'Purchase', 'PurchasePrivate', 'AdminAlert'].every(name => typeof adapter.entities?.[name]?.filter === 'function') ||
      !['Notification', 'Purchase', 'PurchasePrivate'].every(name => typeof adapter.entities?.[name]?.update === 'function') ||
      typeof adapter.entities?.AdminAlert?.create !== 'function') {
    await adapter?.close?.();
    throw new Error('INVALID_NOTIFICATION_ADAPTER');
  }
  return adapter;
}

export async function main(args, { env = process.env, signal, output = value => console.log(JSON.stringify(value)),
  help = value => console.log(value), loadAdapter = loadWorkloadAdapter, connectDb = connectCoordinator,
  sleep = (ms, abort) => wait(ms, undefined, { signal: abort }), clock = Date.now } = {}) {
  if (args.length === 1 && args[0] === '--help') { help(HELP); return 0; }
  let adapter, coordinator, lastExit = 0;
  try {
    const modes = args.filter(arg => ['--once', '--schedule', '--status', '--recover'].includes(arg));
    const batchArgs = args.filter(arg => /^--batch-size=\d+$/.test(arg));
    if (modes.length !== 1 || batchArgs.length > 1 || args.length !== modes.length + batchArgs.length) throw new Error('INVALID_ARGUMENTS');
    const batchSize = batchArgs.length ? Number(batchArgs[0].split('=')[1]) : 50;
    if (batchSize < 1 || batchSize > 100 || !Number.isInteger(batchSize)) throw new Error('INVALID_ARGUMENTS');
    const mode = modes[0];
    const initialize = async (needsAdapter = true) => {
      // Adapter validation precedes opening the DB. No credential fallback.
      if (needsAdapter) adapter ||= await loadAdapter(env, signal);
      coordinator ||= await connectDb(env);
    };
    if (mode === '--status' || mode === '--recover') {
      await initialize(mode === '--recover');
      const result = mode === '--status' ? publicStatus(await coordinator.status())
        : await recoverReturned({ coordinator, entities: adapter.entities });
      output(result);
      lastExit = result.ok ? 0 : 2;
    } else do {
      if (signal?.aborted) break;
      const started = clock();
      let result;
      if (env.MAINTENANCE_MODE !== 'false') result = { ok: true, code: 'MAINTENANCE' };
      else {
        await initialize();
        result = await runOnce({ coordinator, entities: adapter.entities, batchSize, signal,
          maintenance: async () => env.MAINTENANCE_MODE !== 'false' || await adapter.maintenance() !== false });
      }
      output(result);
      lastExit = result.ok ? 0 : 2;
      if (mode !== '--schedule' || signal?.aborted) break;
      // No catch-up fan-out or overlapping timer callback, even on a slow run.
      try { await sleep(Math.max(0, 60_000 - (clock() - started)), signal); }
      catch { if (!signal?.aborted) throw new Error('WORKER_FAILED'); }
    } while (!signal?.aborted);
  } catch (error) {
    output({ ok: false, code: SAFE_CODES.has(error?.message) ? error.message : 'WORKER_FAILED' });
    lastExit = 2;
  } finally {
    try { await adapter?.close?.(); } catch { output({ ok: false, code: 'ADAPTER_CLOSE_FAILED' }); lastExit = 2; }
  }
  return lastExit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const shutdown = new AbortController();
  let deadline;
  const stop = () => {
    if (shutdown.signal.aborted) return;
    shutdown.abort();
    // A hung write is NOT retried or unlocked when this deadline expires.
    // Its durable started/returned record survives process exit for recovery.
    deadline = setTimeout(() => {
      console.error(JSON.stringify({ ok: false, code: 'SHUTDOWN_STATE_RETAINED' }));
      process.exit(2);
    }, 30_000);
    deadline.unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.exitCode = await main(process.argv.slice(2), { signal: shutdown.signal });
  clearTimeout(deadline);
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
