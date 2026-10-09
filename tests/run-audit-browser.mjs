/** Local-only browser aggregate. Every runner uses an aliased, fail-closed SDK. */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('tests/artifacts/oct06');
await mkdir(output, { recursive: true });
const base = 'http://127.0.0.1:4174';
const env = { ...process.env,
  PG_REVIEW_BASE_URL: base, PG_ROUTE_REVIEW_URL: base, PG_LEGAL_REVIEW_URL: base, PG_PROFILE_REVIEW_URL: base, PG_SALES_REVIEW_URL: base,
  PG_LEGAL_EVIDENCE_DIR: path.join(output, 'legal'), PG_PROFILE_EVIDENCE_DIR: path.join(output, 'profile'),
  PG_FAN_EVIDENCE_DIR: path.join(output, 'fan-zone'), PG_SALES_EVIDENCE_DIR: path.join(output, 'sales-admin'),
  PG_LISTING_EVIDENCE_DIR: path.join(output, 'listing'), PG_EVENTS_EVIDENCE_DIR: path.join(output, 'events'),
  PG_ROUTE_EVIDENCE_DIR: path.join(output, 'routes'),
};
const suites = ['events-search-browser', 'legal-document-browser', 'fan-zone-browser', 'profile-beta-browser', 'listing-workflows-browser', 'sales-admin-browser', 'route-inventory-browser'];
const server = await createServer({ configFile: 'tests/fixtures/ticket-design/vite.config.mjs', logLevel: 'error', server: { host: '127.0.0.1', port: 4174, strictPort: true, watch: null, hmr: false } });
const results = [];
try {
  await server.listen();
  for (const name of suites) {
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, [`tests/${name}.mjs`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', value => { log += value; process.stdout.write(value); });
      child.stderr.on('data', value => { log += value; process.stderr.write(value); });
      child.on('error', error => resolve({ name, code: -1, log: error.message }));
      child.on('close', code => resolve({ name, code, log }));
    });
    await writeFile(path.join(output, `${name}.log`), result.log);
    results.push({ name, exit: result.code });
  }
} finally {
  await server.close();
  await writeFile(path.join(output, 'browser-summary.json'), JSON.stringify({ fixtureOnly: true, results }, null, 2));
}
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.length !== suites.length || results.some(result => result.exit !== 0) ? 1 : 0;
