/** Explicit offline allowlist. Never glob: this repository contains live financial canaries. */
import { spawnSync } from 'node:child_process';
const suites = [
  'audit-workflow-semantics', 'branded-auth-fields', 'branded-auth', 'member-access',
  'event-date-display', 'flash-drop-dialog', 'public-access-render', 'ui-control-contrast',
  'upgrade-route-clock', 'upgrade-showtime-state', 'tm-event-timezone-handler', 'venue-timezone-frontend',
  'event-search-request', 'selling-event-picker', 'selling-ongoing-provider', 'tm-ongoing-handler',
  'search-normalize', 'tm-response-handler', 'upgrade-discovery', 'upgrades-live-discovery',
  'upgrades-owned-navigation', 'listing-share', 'shared-listing-destination',
  'fan-post-composer', 'bucket-list-feed', 'browse-ticket-interaction',
  'event-discovery-paging', 'listing-event-lifecycle', 'legal-document', 'fan-zone-recovery',
  'profile-beta-accessibility', 'sales-admin-presentation', 'route-metadata',
  'oct09-discovery-state', 'oct09-discovery-paging', 'event-identity-presentation',
  'oct09-lifecycle', 'founder-read-recovery', 'purchase-detail',
];
const results = [];
for (const suite of suites) {
  const run = spawnSync(process.execPath, ['--test-reporter=tap', '--import', './tests/deny-network.mjs', `tests/${suite}.test.mjs`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const output = (run.stdout || '') + (run.stderr || '');
  const counts = Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(m => [m[1], Number(m[2])]));
  const legacy = output.match(/Total: (\d+) passed, (\d+) failed/);
  if (!('tests' in counts) && legacy) Object.assign(counts, { tests: Number(legacy[1]) + Number(legacy[2]), pass: Number(legacy[1]), fail: Number(legacy[2]), skipped: 0, reporter: 'legacy' });
  const record = { suite, exit: run.status, ...counts };
  results.push(record);
  console.log(`${run.status === 0 ? 'PASS' : 'FAIL'} ${suite} ${JSON.stringify(counts)}`);
  if (run.status !== 0) console.log(output);
}
console.log(JSON.stringify({ safeOffline: true, suiteCount: results.length, failures: results.filter(r => r.exit !== 0).length, results }, null, 2));
process.exitCode = results.some(r => r.exit !== 0) ? 1 : 0;
