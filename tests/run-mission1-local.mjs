// Isolated PostgreSQL, synthetic data only. Never reads a database URL.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const runtime = process.env.PG_MISSION1_RUNTIME || '/private/tmp/pg-mission1-local-runtime';
if (!runtime || !resolve(runtime).startsWith('/private/tmp/')) throw new Error('PG_MISSION1_RUNTIME must identify a temporary local installation');
const { default: EmbeddedPostgres } = await import(pathToFileURL(join(runtime, 'node_modules/embedded-postgres/dist/index.js')));
const { default: pg } = await import(pathToFileURL(join(runtime, 'node_modules/pg/lib/index.js')));
const directory = await mkdtemp(join(tmpdir(), 'pg-m1-'));
const server = new EmbeddedPostgres({ databaseDir: join(directory, 'data'), user: 'postgres', password: 'local_synthetic_only', port: 55439,
  persistent: true, initdbFlags: ['--locale=C', '--encoding=UTF8'], postgresFlags: ['-c', 'listen_addresses=', '-c', `unix_socket_directories=${directory}`, '-c', 'fsync=off'],
  onLog() {}, onError: message => console.error(String(message).slice(0, 500)) });
let client, template, failed = false;
try {
  await server.initialise(); await server.start();
  client = new pg.Client({ host: directory, port: 55439, user: 'postgres', password: 'local_synthetic_only', database: 'postgres' });
  await client.connect();
  // Local stand-in for the documented migration owner, without credentials.
  await client.query('CREATE ROLE neondb_owner NOLOGIN;');
  console.log((await client.query('SELECT version()')).rows[0].version);
  await client.query('CREATE DATABASE mission1_template');
  template = new pg.Client({ host: directory, port: 55439, user: 'postgres', password: 'local_synthetic_only', database: 'mission1_template' });
  await template.connect();
  for (const file of ['001_schema.sql', '001b_mission1_fields.sql', '002_functions.sql', '002b_transfer_functions.sql', '002c_proof_assessment.sql', '002d_buyer_confirmation.sql', '002e_active_capture_context.sql', '002f_no_relist_invariant.sql', '003_workers.sql', '004_roles_and_grants.sql', '005_mission1.sql', '006_mission1_projection.sql']) {
    try { await template.query(await readFile(new URL(`../database/authority_v1/${file}`, import.meta.url), 'utf8')); }
    catch (error) { throw new Error(`${file}: ${error.message}`); }
  }
  await template.query('GRANT authority_owner TO neondb_owner');
  await template.end();
  template = null;
  const files = process.argv.slice(2);
  if (!files.length) files.push('tests/mission1-authority.test.mjs');
  for (const file of files) {
    const exit = await new Promise((done, reject) => {
      const child = spawn(process.execPath, ['--experimental-vm-modules', file], {
        stdio: 'inherit', env: { ...process.env, PG_MISSION1_SOCKET: directory, PG_MISSION1_RUNTIME: runtime },
      });
      child.on('error', reject); child.on('exit', code => done(code ?? 1));
    });
    if (exit) failed = true;
  }
} catch (error) {
  failed = true; console.error(error.stack || error);
} finally {
  await template?.end(); await client?.end(); await server.stop();
}

// embedded-postgres uses async-exit-hook, whose beforeExit handler hardcodes
// exit 0. Teardown is already awaited, so explicitly exit with the suite result.
process.exit(failed ? 1 : 0);
