import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(resolve(root, '.auth-field-test-'));
const mocks = {
  fixture: `export const state = { hooks: [], cursor: 0, calls: [], fail: false };`,
  react: `import { state } from 'fixture';
    export function useState(initial) { const i = state.cursor++; if (!(i in state.hooks)) state.hooks[i] = typeof initial === 'function' ? initial() : initial; return [state.hooks[i], value => { state.hooks[i] = typeof value === 'function' ? value(state.hooks[i]) : value; }]; }
    export function useRef(initial) { const i = state.cursor++; return state.hooks[i] ??= { current: initial }; }
    export const useEffect = () => {};`,
  router: `export const useLocation = () => ({search: '?from_url=%2Fevents', key: 'fixture'}); export const useNavigate = () => () => {}; export const Link = () => null;`,
  auth: `export const useAuth = () => ({checkUserAuth: async () => ({id: 'fixture-member'})});`,
  shell: `export default ({children}) => children;`,
  client: `import {state} from 'fixture';
    export const base44 = { auth: Object.fromEntries(['loginViaEmailPassword', 'register', 'verifyOtp', 'resetPasswordRequest', 'resetPassword', 'resendOtp', 'loginWithProvider'].map(name => [name, async () => { state.calls.push(name); if(state.fail) throw new Error('fixture failure'); }])) };`,
};
const result = await build({
  stdin: { contents: 'export {default as Auth} from "./src/pages/BrandedAuth.jsx"; export {state} from "fixture";', resolveDir: root, sourcefile: 'auth-fields-entry.jsx', loader: 'jsx' },
  bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
  plugins: [{ name: 'isolated-auth-fields', setup(builder) {
    builder.onResolve({filter: /.*/}, args => {
      const mock = args.path === 'fixture' ? 'fixture' : args.path === 'react' && args.importer.endsWith('BrandedAuth.jsx') ? 'react'
        : ({'react-router-dom': 'router', '@/lib/AuthContext': 'auth', '@/components/auth/PGAuthShell': 'shell', '@/api/base44Client': 'client'})[args.path];
      if (mock) return {path: mock, namespace: 'fixture'};
      if (args.path.startsWith('@/')) return {path: resolve(root, `${args.path.slice(2).startsWith('src/') ? '' : 'src/'}${args.path.slice(2)}.js`)};
    });
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: mocks[args.path], loader: 'js', resolveDir: root}));
  }}],
});
const bundlePath = resolve(temporary, 'auth-fields.mjs');
await writeFile(bundlePath, result.outputFiles[0].text);
const {Auth, state} = await import(pathToFileURL(bundlePath));
test.after(() => rm(temporary, {recursive: true, force: true}));
globalThis.window = {location: {origin: 'https://fixture.invalid'}};
const nodes = node => node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node?.props?.children)];
let mode;
function draw() { state.cursor = 0; return Auth({mode}); }
function start(nextMode) { mode = nextMode; state.hooks = []; state.calls = []; state.fail = false; return draw(); }
function field(tree, name) { return nodes(tree).find(node => node.props?.id === `pg-auth-${name}`); }
function change(name, value) { field(draw(), name).props.onChange({target: {value}}); }
async function submit() { nodes(draw()).find(node => node.type === 'form').props.onSubmit({preventDefault() {}}); await new Promise(resolveTick => setImmediate(resolveTick)); return draw(); }
function linkedErrors(tree, expected) {
  const feedback = nodes(tree).find(node => node.props?.id === 'pg-auth-feedback');
  assert.equal(feedback.props.role, 'alert');
  for (const name of ['email', 'password', 'confirm', 'code']) {
    const input = field(tree, name);
    if (!input) continue;
    assert.equal(input.props['aria-invalid'], expected.includes(name) || undefined, name);
    assert.equal(input.props['aria-describedby'], expected.includes(name) ? feedback.props.id : undefined, name);
  }
}
test('registration mismatch links only password fields to the visible error; editing clears invalid state', async () => {
  start('register'); change('email', 'fan@example.test'); change('password', 'example-one'); change('confirm', 'example-two');
  linkedErrors(await submit(), ['password', 'confirm']);
  assert.deepEqual(state.calls, []);
  change('confirm', 'example-one');
  assert.equal(field(draw(), 'confirm').props['aria-invalid'], undefined);
  assert.equal(nodes(draw()).find(node => node.props?.id === 'pg-auth-feedback'), undefined);
});
test('failed sign-in links its error to credentials while provider failure does not invalidate them', async () => {
  start('login'); change('email', 'fan@example.test'); change('password', 'fixture-value'); state.fail = true;
  linkedErrors(await submit(), ['email', 'password']);
  change('email', 'retry@example.test');
  const button = nodes(draw()).find(node => node.type === 'button' && node.props.children === 'Continue with Google');
  await button.props.onClick();
  linkedErrors(draw(), []);
});
test('invalid verification code is described by the visible error; resend removes stale invalid state', async () => {
  start('register'); change('email', 'fan@example.test'); change('password', 'same-value'); change('confirm', 'same-value');
  await submit(); change('code', '123456'); state.fail = true;
  linkedErrors(await submit(), ['code']);
  await nodes(draw()).find(node => node.type === 'button' && node.props.children === 'Send another code').props.onClick();
  assert.equal(field(draw(), 'code').props['aria-invalid'], undefined);
  assert.equal(nodes(draw()).find(node => node.props?.id === 'pg-auth-feedback').props.role, 'status');
});
test('forgot-password privacy-preserving response remains a status, with native email validation intact', async () => {
  const initial = start('forgot');
  assert.equal(field(initial, 'email').props.type, 'email');
  assert.equal(field(initial, 'email').props.required, true);
  change('email', 'fan@example.test'); state.fail = true;
  const tree = await submit();
  assert.equal(nodes(tree).find(node => node.props?.id === 'pg-auth-feedback').props.role, 'status');
  assert.equal(field(tree, 'email').props['aria-invalid'], undefined);
});
