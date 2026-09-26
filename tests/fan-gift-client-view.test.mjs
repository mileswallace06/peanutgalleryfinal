import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(resolve(root, '.fan-gift-test-'));
test.after(() => rm(temporary, { recursive: true, force: true }));
const built = await build({
  stdin: {
    contents: `export {default as Card} from './src/components/flashdrops/FlashDropCard.jsx';
      export {default as Center} from './src/components/eventmode/FlashDropCenter.jsx';
      export {loadFanGifts} from './src/lib/fanGiftRead.js';
      export {state} from 'fixture';`,
    resolveDir: root, sourcefile: 'fixture-entry.jsx', loader: 'jsx',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
  plugins: [{ name: 'fan-gift-fixture', setup(builder) {
    builder.onResolve({ filter: /^(@\/api\/base44Client|fixture)$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    builder.onResolve({ filter: /^@\// }, args => ({ path: resolve(root, 'src', args.path.slice(2)) + '.jsx' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: `export const state = {calls: [], response: null, failure: null};
        export const base44 = {
          entities: new Proxy({}, {get() { throw new Error('Raw entity fallback is forbidden'); }}),
          functions: {async invoke(name, body) {
            state.calls.push({name,body}); if(state.failure) throw state.failure; return state.response;
          }}
        };`,
      loader: 'js', resolveDir: root,
    }));
  } }],
});
const modulePath = resolve(temporary, 'fixture.mjs');
await writeFile(modulePath, built.outputFiles[0].text);
const fixture = await import(pathToFileURL(modulePath));
const safeDrop = { id: 'gift-1', section: '101', row: 'A', quantity: 2,
  status: 'active', donor_name: 'A fan', is_donor: false, is_winner: false,
  ownership_verified: true, entry_closes_at: new Date(Date.now() + 60000).toISOString() };
const user = {id: 'member-id', email: 'self@example.test'};
const card = overrides => renderToStaticMarkup(createElement(StaticRouter, {location: '/'},
  createElement(fixture.Card, {drop: {...safeDrop, ...overrides}, user})));

test('donor controls work with server identity flags and no donor email', () => {
  const html = card({is_donor: true});
  assert.match(html, /Your drop is live/);
  assert.doesNotMatch(html, /Enter Now/);
});
test('other members retain the entry button without reading donor identity', () => {
  assert.match(card({is_donor: false}), /Enter Now/);
});
test('winner sees the winning result without receiving a winner email', () => {
  assert.match(card({status: 'winner_selected', is_winner: true}), /You Won!/);
});
test('nonwinner cannot become winner merely because email fields are missing', () => {
  const html = card({status: 'winner_selected', is_winner: false});
  assert.match(html, /Not this time/);
  assert.doesNotMatch(html, /You Won!/);
});
test('expired drop retains no-entry result', () => {
  assert.match(card({status: 'expired'}), /No entries — drop expired/);
});
test('read failure displays retry instead of pretending no gifts exist', () => {
  const html = renderToStaticMarkup(createElement(fixture.Center, {
    drops: [], user, listings: [], loading: false, loadError: true, onRetry() {},
  }));
  assert.match(html, /Fan Gifts couldn’t load/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /No fan gifts yet/);
});
test('member read calls only the limited-view function with the event identifier', async () => {
  fixture.state.calls = [];
  fixture.state.response = {data: {drops: [safeDrop], leaders: [{name: 'A fan', drops: 1, wins: 0}]}};
  const result = await fixture.loadFanGifts('event-1');
  assert.equal(result.drops[0].id, 'gift-1');
  assert.deepEqual(fixture.state.calls, [{name: 'getFlashDropView', body: {event_id: 'event-1'}}]);
});
test('unavailable or malformed projection has no raw-record fallback', async () => {
  fixture.state.response = {data: {error: 'Unavailable'}};
  await assert.rejects(fixture.loadFanGifts('event-1'), /could not be loaded/);
  fixture.state.failure = new Error('simulated gateway failure');
  await assert.rejects(fixture.loadFanGifts('event-1'), /gateway failure/);
  fixture.state.failure = null;
});
