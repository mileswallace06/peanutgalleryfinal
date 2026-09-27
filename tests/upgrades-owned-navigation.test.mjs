import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Exercise the real card handler, substituting only hooks and remote boundaries.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(new URL('../src/pages/Upgrades.jsx', import.meta.url), 'utf8');
const start = source.indexOf('\nfunction EventCard(');
assert.ok(start > 0);
const bundle = await build({
  stdin: {
    contents: `import { format } from 'date-fns';
      import { ArrowRight, RefreshCw } from 'lucide-react';
      const useState = () => [false, () => {}];
      const calls = [];
      const useNavigate = () => path => calls.push(path);
      const logNavEvent = () => {};
      const EventThumbnail = () => null;
      const base44 = { functions: { invoke: () => { throw new Error('Owned tickets must not sync catalog events'); } } };
      ${source.slice(start)}
      export { EventCard, calls };`,
    resolveDir: root, loader: 'jsx', sourcefile: 'owned-card-test.jsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const { EventCard, calls } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

for (const [name, event, owned, mode, expected] of [
  ['owned upcoming ticket', { id: 'internal-event' }, true, 'upcoming', '/upgrades/internal-event'],
  ['owned synced Ticketmaster ticket', { id: 'internal-event', source: 'ticketmaster', tm_id: 'TM-123' }, true, 'upcoming', '/upgrades/internal-event'],
  ['owned live ticket', { id: 'internal-live' }, true, 'live', '/upgrades/internal-live'],
  ['ordinary upcoming discovery', { id: 'internal-event' }, false, 'upcoming', '/events/internal-event'],
]) {
  test(`${name} keeps its correct full-card destination`, async () => {
    calls.length = 0;
    const card = EventCard({ event: { title: 'Fixture event', ...event }, owned, mode });
    assert.equal(card.type, 'button');
    assert.equal(card.props.type, 'button');
    assert.equal(card.props.disabled, false);
    await card.props.onClick({ preventDefault: () => assert.fail('Must use the existing internal event ID') });
    assert.deepEqual(calls, [expected]);
  });
}

test('a missing event destination remains disabled', () => {
  const card = EventCard({ event: { title: 'Missing destination' }, owned: true, mode: 'upcoming' });
  assert.equal(card.props.disabled, true);
});
