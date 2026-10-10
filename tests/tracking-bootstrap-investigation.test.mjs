// I2 evidence only: execute first-party code with every provider replaced by a stub.
// These characterize current calls, not approved consent behavior or provider processing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const blocked = () => { throw new Error('Network/provider execution is forbidden in I2 investigation'); };
function execute(path, dependencies = {}, globals = {}, define = {}) {
  const module = { exports: {} };
  const code = transformSync(source(path), {
    loader: path.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs',
    jsxFactory: '__jsx', define,
  }).code;
  const context = vm.createContext({
    module, exports: module.exports,
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unstubbed dependency: ${name}`);
      return dependencies[name];
    },
    fetch: blocked, XMLHttpRequest: blocked, WebSocket: blocked,
    console: { log() {}, warn() {}, error() {} },
    __jsx: (type, props, ...children) => ({ type, props, children }),
    ...globals,
  });
  vm.runInContext(code, context, { timeout: 1000, filename: path });
  return module.exports;
}
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}
function oneSignal() {
  const calls = [];
  const provider = {
    init: async options => { calls.push(['init', plain(options)]); },
    login: async email => { calls.push(['login', email]); },
    logout: async () => { calls.push(['logout']); },
    Notifications: { permission: true, requestPermission: async () => { calls.push(['permission']); } },
  };
  return { calls, wrapper: execute('src/lib/oneSignal.js', { 'react-onesignal': provider }) };
}
function authHarness() {
  const push = oneSignal();
  const effects = [];
  const timers = new Set();
  const authCalls = [];
  let resolveAuth;
  let rejectAuth;
  const authResult = new Promise((resolve, reject) => { resolveAuth = resolve; rejectAuth = reject; });
  const react = {
    createContext: () => ({ Provider: 'fixture-provider' }),
    useState: initial => [initial, () => {}],
    useContext: blocked, useRef: initial => ({ current: initial }),
    useEffect: callback => effects.push(callback),
  };
  const base44 = { auth: {
    me: options => { authCalls.push(['me', plain(options)]); return authResult; },
    logout: () => { authCalls.push(['logout']); },
  } };
  const { AuthProvider } = execute('src/lib/AuthContext.jsx', {
    react, '@/api/base44Client': { base44 }, '@/lib/oneSignal': push.wrapper,
  }, {
    window: { location: { origin: 'https://pg.fixture.invalid' } },
    setTimeout: callback => { timers.add(callback); return callback; },
    clearTimeout: callback => timers.delete(callback),
  });
  const output = AuthProvider({ children: null });
  assert.equal(effects.length, 1);
  return { ...push, effects, timers, authCalls, resolveAuth, rejectAuth, output };
}

test('I2: fresh inline bootstrap schedules Impact script and commands without a consent action', () => {
  const scripts = [...source('index.html').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(match => match[2].trim()).map(match => match[2]);
  assert.equal(scripts.length, 1);
  const inserted = [];
  const context = vm.createContext({ fetch: blocked, XMLHttpRequest: blocked, WebSocket: blocked });
  context.window = context;
  context.document = {
    createElement: tag => { assert.equal(tag, 'script'); return {}; },
    getElementsByTagName: tag => {
      assert.equal(tag, 'script');
      return [{ parentNode: { insertBefore: script => inserted.push({ ...script }) } }];
    },
  };
  vm.runInContext(scripts[0], context, { timeout: 1000 });
  assert.deepEqual(inserted, [{ async: 1, src: 'https://utt.impactcdn.com/P-A7374474-4aa1-43ab-af61-43ef107a047f1.js' }]);
  assert.deepEqual(Array.from(context.impactStat.a, args => Array.from(args)), [['transformLinks'], ['trackImpression']]);
  // insertBefore is inert: no script download, cookies, provider code, or real DOM.
});

test('I2: guest auth mount calls OneSignal init before auth resolves, without requesting push permission', async () => {
  const h = authHarness();
  h.effects[0]();
  assert.equal(h.calls[0][0], 'init');
  assert.deepEqual(h.authCalls, [['me', { fresh: true }]]);
  h.rejectAuth({ status: 401 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.map(call => call[0]), ['init']);
  assert.equal(h.calls[0][1].notifyButton.enable, false);
  assert.equal(h.calls[0][1].promptOptions.slidedown.enabled, false);
  assert.equal(h.timers.size, 0);
});

test('I2: authenticated mount forwards synthetic email to OneSignal and logout unlinks it', async () => {
  const h = authHarness();
  h.effects[0]();
  h.resolveAuth({ id: 'fixture-user', email: 'fixture@example.invalid' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.map(call => call[0]), ['init', 'login']);
  assert.deepEqual(h.calls[1], ['login', 'fixture@example.invalid']);
  h.output.props.value.logout(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.map(call => call[0]), ['init', 'login', 'logout']);
  assert.equal(h.timers.size, 0);
});

test('I2: wrapper requests push permission only when its explicit request function is invoked', async () => {
  const { calls, wrapper } = oneSignal();
  await wrapper.initOneSignal();
  await wrapper.initOneSignal();
  await wrapper.loginOneSignalUser('');
  assert.deepEqual(calls.map(call => call[0]), ['init']);
  assert.equal(await wrapper.requestPushPermission(), 'granted');
  assert.deepEqual(calls.map(call => call[0]), ['init', 'permission']);
});

function appParams(url, initial = {}) {
  const localStorage = storage(initial);
  const window = { location: new URL(url), localStorage };
  window.history = { replaceState: (_state, _title, next) => { window.location = new URL(next, window.location); } };
  const result = execute('src/lib/app-params.js', {}, { window, document: { title: 'Fixture' }, URLSearchParams }, {
    'import.meta.env.VITE_BASE44_APP_ID': '"fixture-app"',
    'import.meta.env.VITE_BASE44_FUNCTIONS_VERSION': '"fixture-version"',
    'import.meta.env.VITE_BASE44_APP_BASE_URL': '"https://pg.fixture.invalid"',
  });
  return { ...result, localStorage, window };
}

test('I2: fresh bootstrap writes Base44 config and return URL to local storage', () => {
  const result = appParams('https://pg.fixture.invalid/events?category=music');
  assert.deepEqual([...result.localStorage.values.keys()].sort(), [
    'base44_app_base_url', 'base44_app_id', 'base44_from_url', 'base44_functions_version',
  ]);
  assert.equal(result.localStorage.getItem('base44_from_url'), 'https://pg.fixture.invalid/events?category=music');
  assert.equal(result.appParams.token, null);
});

test('I2: synthetic access token is persisted then removed from URL; explicit clear removes stored tokens', () => {
  const result = appParams('https://pg.fixture.invalid/events?access_token=fixture-only-token');
  assert.equal(result.localStorage.getItem('base44_access_token'), 'fixture-only-token');
  assert.equal(result.window.location.search, '');
  assert.equal(result.localStorage.getItem('base44_from_url'), 'https://pg.fixture.invalid/events');
  const cleared = appParams('https://pg.fixture.invalid/events?clear_access_token=true', {
    base44_access_token: 'fixture-only-token', token: 'fixture-only-token',
  });
  assert.equal(cleared.localStorage.getItem('base44_access_token'), null);
  assert.equal(cleared.localStorage.getItem('token'), null);
});

test('I2: navigation diagnostic forwards synthetic session, route, user agent and optional email to Base44 boundary', async () => {
  const writes = [];
  const sessionStorage = storage();
  const base44 = { entities: { EventNavigationLog: { create: async payload => writes.push(plain(payload)) } } };
  const { logNavEvent } = execute('src/lib/navLogger.js', { '@/api/base44Client': { base44 } }, {
    sessionStorage, navigator: { userAgent: 'I2 synthetic user agent' },
  });
  await logNavEvent({ result: 'success', event: { id: 'fixture-event' }, sourcePage: 'Events', generatedHref: '/events/fixture-event' });
  await logNavEvent({ result: 'success', event: { id: 'fixture-event-2' }, sourcePage: 'Events', generatedHref: '/events/fixture-event-2', userEmail: 'fixture@example.invalid' });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].user_email, '');
  assert.equal(writes[1].user_email, 'fixture@example.invalid');
  assert.equal(writes[0].generated_href, '/events/fixture-event');
  assert.equal(writes[0].user_agent, 'I2 synthetic user agent');
  assert.equal(writes[0].session_id, sessionStorage.getItem('pg_nav_session_id'));
  assert.equal(writes[0].session_id, writes[1].session_id);
  assert.ok(writes[0].session_id);
});
