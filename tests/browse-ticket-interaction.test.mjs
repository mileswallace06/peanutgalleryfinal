import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// Exercise the actual pure card components and their handlers without mounting
// the connected Events page. The only replaced dependency is the remote logger.
// These checks do not claim browser hit-testing, layout, or live navigation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eventsSource = await readFile(path.join(root, 'src/pages/Events.jsx'), 'utf8');
const rowStart = eventsSource.indexOf('\nfunction EventRow(');
assert.ok(rowStart >= 0, 'Expected the actual EventRow function in Events.jsx');
const requiredImports = new Set([
  'react-router-dom', 'lucide-react', '@/lib/upgradeEventState', '@/lib/eventDateDisplay', '@/lib/eventIdentity',
  '@/lib/eventUrl', '@/lib/navLogger', '@/components/events/EventThumbnail',
]);
const rowImports = eventsSource.split('\n').filter(line => {
  const match = line.match(/^import .+ from ['"]([^'"]+)['"];$/);
  return match && requiredImports.has(match[1]);
});
assert.equal(rowImports.length, requiredImports.size, 'Card dependencies must remain explicit');

const result = await build({
  stdin: {
    contents: `${rowImports.join('\n')}
      import MoveCloserListing from './src/components/eventmode/MoveCloserListing.jsx';
      import { navigationCalls } from '@/lib/navLogger';
      ${eventsSource.slice(rowStart)}
      export { EventRow, MoveCloserListing, Link, navigationCalls };`,
    resolveDir: root,
    sourcefile: 'browse-ticket-interaction-entry.jsx',
    loader: 'jsx',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'local-card-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/navLogger$/ }, () => ({ path: 'logger', namespace: 'test-only' }));
      builder.onLoad({ filter: /^logger$/, namespace: 'test-only' }, () => ({
        contents: 'export const navigationCalls = []; export function logNavEvent(value) { navigationCalls.push(value); }',
      }));
      builder.onResolve({ filter: /^@\// }, async ({ path: specifier }) => {
        const filename = path.join(root, 'src', specifier.slice(2));
        for (const suffix of ['', '.js', '.jsx']) {
          try { await access(filename + suffix); return { path: filename + suffix }; } catch { /* Try the next source extension. */ }
        }
        throw new Error(`Unresolved local dependency: ${specifier}`);
      });
    },
  }],
});
const { EventRow, MoveCloserListing, Link, navigationCalls } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);

function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== 'object') return [];
  return [element, ...nodes(element.props?.children)];
}
function textContent(element) {
  if (Array.isArray(element)) return element.map(textContent).join('');
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  return element && typeof element === 'object' ? textContent(element.props?.children) : '';
}
const baseListing = {
  id: 'listing-fixture', status: 'active', tier: 'lower', section: '101',
  row: '3', seats: '7–8', quantity: 2, asking_price: 35,
};

for (const [label, reservation_state] of [['available', undefined], ['reserved for you', 'reserved_for_you']]) {
  test(`Move Closer ${label}: one full-card button invokes the existing callback once`, () => {
    const listing = { ...baseListing, reservation_state };
    const calls = [];
    const card = MoveCloserListing({ listing, onView: value => calls.push(value), currentUserEmail: 'fixture@example.test' });
    const elements = nodes(card);
    const buttons = elements.filter(node => node.type === 'button');
    assert.equal(buttons.length, 1);
    assert.equal(elements.filter(node => typeof node.props?.onClick === 'function').length, 1);
    assert.equal(buttons[0].props.type, 'button');
    assert.match(buttons[0].props.className, /\binset-0\b/);
    assert.match(buttons[0].props.className, /\bh-full\b/);
    assert.match(buttons[0].props.className, /\bw-full\b/);
    assert.match(buttons[0].props['aria-label'], /section 101, row 3/);
    assert.equal(nodes(buttons[0]).filter(node => node.type === 'button' || node.type === 'a').length, 1);
    buttons[0].props.onClick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0], listing);
  });
}

for (const [label, patch, expectedStatus] of [
  ['sold', { status: 'sold' }, 'Sold'],
  ['reserved by another buyer', { reservation_state: 'reserved_by_other' }, 'Reserved'],
  ['transfer disabled', { transfer_status: 'transfer_disabled' }, 'Unavailable'],
  ['sold despite own reservation', { status: 'sold', reservation_state: 'reserved_for_you' }, 'Sold'],
  ['transfer disabled despite own reservation', { transfer_status: 'transfer_disabled', reservation_state: 'reserved_for_you' }, 'Unavailable'],
]) {
  test(`Move Closer ${label}: retains status and exposes no click target`, () => {
    const card = MoveCloserListing({ listing: { ...baseListing, ...patch }, onView: () => assert.fail('Disabled listing must never invoke onView') });
    assert.equal(nodes(card).filter(node => node.type === 'button' || node.type === 'a' || typeof node.props?.onClick === 'function').length, 0);
    assert.ok(textContent(card).includes(expectedStatus));
  });
}

const baseEvent = { title: 'Fixture show', date: '2099-06-20T20:00:00Z', venue: 'Fixture Hall', city: 'Phoenix', state: 'AZ' };
for (const [label, fields, expectedTo, expectTmState, isLive] of [
  ['PG event', { id: 'pg-event', source: 'pg' }, '/events/pg-event', false, false],
  ['Ticketmaster event', { id: 'tm_TM-123', tm_id: 'TM-123', source: 'ticketmaster' }, '/events/tm/TM-123', true, false],
  ['synced Ticketmaster record', { id: 'pg-synced-tm', tm_id: 'TM-123', source: 'ticketmaster' }, '/events/pg-synced-tm', true, false],
  ['live PG event', { id: 'pg-live', source: 'pg', is_beta_live: true }, '/upgrades/pg-live', false, true],
  ['Ticketmaster with a live flag', { id: 'tm_TM-123', source: 'ticketmaster', is_beta_live: true }, '/events/tm/TM-123', true, false],
]) {
  test(`Events ${label}: one wrapping link preserves destination, state, and click behavior`, () => {
    const event = { ...baseEvent, ...fields };
    const returnTo = '/events?browse=1&q=Fixture';
    let opened = 0;
    const row = EventRow({ event, returnTo, onOpen: () => { opened++; } });
    const links = nodes(row).filter(node => node.type === Link);
    assert.equal(links.length, 1);
    assert.equal(row.type, 'article');
    assert.equal(row.props.children, links[0]);
    assert.equal(links[0].props.to, expectedTo);
    assert.deepEqual(links[0].props.state, { discoveryReturnTo: returnTo, ...(expectTmState ? { tmEvent: event } : {}) });
    assert.equal(nodes(row).filter(node => node.type === 'button' || node.type === 'a').length, 0);
    const wrapped = nodes(links[0]);
    assert.ok(wrapped.some(node => node.props?.className === 'pg-browse-ticket-art'));
    assert.ok(wrapped.some(node => node.type === 'h3' && node.props.children === event.title));
    assert.ok(wrapped.some(node => node.props?.className === 'pg-browse-ticket-stub'));
    navigationCalls.length = 0;
    let stopped = 0;
    links[0].props.onClick({ stopPropagation() { stopped += 1; } });
    assert.equal(opened, 1, 'return position saved before navigation');
    assert.equal(stopped, isLive ? 1 : 0);
    assert.equal(navigationCalls.length, isLive ? 0 : 1);
    if (!isLive) {
      assert.equal(navigationCalls[0].event, event);
      assert.equal(navigationCalls[0].generatedHref, expectedTo);
      assert.equal(navigationCalls[0].sourcePage, 'Events');
    }
  });
}

test('Events missing destination: noninteractive card with an explicit unavailable label', () => {
  const row = EventRow({ event: { ...baseEvent, source: 'ticketmaster' } });
  assert.equal(nodes(row).filter(node => node.type === Link || node.type === 'button' || node.type === 'a' || typeof node.props?.onClick === 'function').length, 0);
  assert.ok(textContent(row).includes('Unavailable'));
});
