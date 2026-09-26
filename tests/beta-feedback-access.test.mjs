import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { adminAccess } from '../src/lib/adminAccess.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(resolve(root, '.beta-feedback-test-'));
test.after(() => rm(temporary, { recursive: true, force: true }));

async function bundle(name, entry, fixtures, resolveFixture) {
  const result = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: `${name}.jsx`, loader: 'jsx' },
    bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
    plugins: [{ name, setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const fixture = resolveFixture(args);
        if (fixture) return { path: fixture, namespace: name };
        if (args.path === '@/lib/adminAccess') return { path: resolve(root, 'src/lib/adminAccess.js') };
      });
      builder.onLoad({ filter: /.*/, namespace: name }, args => ({ contents: fixtures[args.path], loader: 'js', resolveDir: root }));
    } }],
  });
  const path = resolve(temporary, `${name}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  return import(pathToFileURL(path));
}

const qa = await bundle('qa', 'export {default as Page} from "./src/pages/BetaQA.jsx"; export {state} from "fixture";', {
  fixture: 'export const state = {auth: {}, childMounts: 0};',
  auth: 'import {state} from "fixture"; export const useAuth = () => state.auth;',
  router: 'export const useNavigate = () => () => {}; export const Navigate = () => "access-denied";',
  child: 'import {state} from "fixture"; export default () => { state.childMounts++; return "protected-child"; };',
}, args => args.path === 'fixture' ? 'fixture' : args.path === '@/lib/AuthContext' ? 'auth'
  : args.path === 'react-router-dom' ? 'router' : args.path.startsWith('@/components/beta/') ? 'child' : null);

const form = await bundle('form', 'export {default as Form} from "./src/components/beta/BetaFeedbackForm.jsx"; export {state} from "fixture";', {
  fixture: 'export const state = { hooks: [], cursor: 0, createCalls: 0, create: async () => ({}), list: async () => [] };',
  react: `import {state} from "fixture";
    export function useState(initial) { const i = state.cursor++; if (!(i in state.hooks)) state.hooks[i] = typeof initial === 'function' ? initial() : initial; return [state.hooks[i], value => { state.hooks[i] = typeof value === 'function' ? value(state.hooks[i]) : value; }]; }
    export function useRef(initial) { const i = state.cursor++; return state.hooks[i] ??= {current: initial}; }
    export const useEffect = () => {};`,
  client: `import {state} from "fixture"; export const base44 = { entities: { BetaFeedback: {
    create: value => { state.createCalls++; return state.create(value); }, list: (...args) => state.list(...args),
  } } };`,
}, args => args.path === 'fixture' ? 'fixture' : args.path === 'react' && args.importer.endsWith('BetaFeedbackForm.jsx') ? 'react'
  : args.path === '@/api/base44Client' ? 'client' : null);


const verifiedAdmin = { authChecked: true, isAuthenticated: true, isLoadingAuth: false, user: { id: 'admin-id', role: 'admin' } };
const deniedCases = [
  ['anonymous', { ...verifiedAdmin, user: null, isAuthenticated: false }],
  ['regular member', { ...verifiedAdmin, user: { id: 'member-id', role: 'user' } }],
  ['disabled admin', { ...verifiedAdmin, user: { id: 'admin-id', role: 'admin', disabled: true } }],
  ['missing account ID', { ...verifiedAdmin, user: { role: 'admin' } }],
  ['failed refresh with stale admin', { ...verifiedAdmin, authError: { type: 'unknown' } }],
];
for (const [label, auth] of deniedCases) {
  test(`BetaQA does not mount protected children for ${label}`, () => {
    qa.state.auth = auth;
    qa.state.childMounts = 0;
    globalThis.localStorage = { getItem() { throw new Error('protected workspace mounted'); } };
    globalThis.sessionStorage = { getItem() { throw new Error('protected workspace mounted'); } };
    assert.equal(adminAccess(auth), 'denied');
    assert.match(renderToStaticMarkup(createElement(qa.Page)), /access-denied/);
    assert.equal(qa.state.childMounts, 0);
  });
}
test('pending authentication with a cached admin mounts only the checking state', () => {
  qa.state.auth = { ...verifiedAdmin, isLoadingAuth: true };
  qa.state.childMounts = 0;
  assert.match(renderToStaticMarkup(createElement(qa.Page)), /Checking admin access/);
  assert.equal(qa.state.childMounts, 0);
});
test('verified admin keeps the existing QA workspace and child flow', () => {
  qa.state.auth = verifiedAdmin;
  qa.state.childMounts = 0;
  globalThis.localStorage = { getItem: () => '', setItem() {} };
  globalThis.sessionStorage = { getItem: () => 'test-session', setItem() {} };
  const html = renderToStaticMarkup(createElement(qa.Page));
  assert.match(html, /Beta QA/);
  assert.match(html, /protected-child/);
  assert.equal(qa.state.childMounts, 1);
});
test('BetaFeedback schema requires the admin role for every client CRUD operation', async () => {
  const entity = JSON.parse(await readFile(resolve(root, 'base44/entities/BetaFeedback.jsonc'), 'utf8'));
  assert.deepEqual(entity.rls, Object.fromEntries(['create', 'read', 'update', 'delete']
    .map(operation => [operation, { user_condition: { role: 'admin' } }])));
  assert.deepEqual(entity.required, ['tester_name']);
});


function nodes(node) {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node?.props?.children)];
}
function draw() { form.state.cursor = 0; return form.Form(); }
function submitButton(tree) { return nodes(tree).find(node => node.type === 'button' && nodes(node.props.children).some(child => child === 'Submit Feedback' || child === 'Submitting…')); }
function newForm() {
  form.state.hooks = []; form.state.cursor = 0; form.state.createCalls = 0;
  form.state.list = async () => [];
  const tree = draw();
  nodes(tree).find(node => node.props?.placeholder === 'Tester name').props.onChange({target: {value: 'Test admin'}});
  return draw();
}
test('failed save preserves answers, clears busy state, and allows a successful retry', async () => {
  let tree = newForm();
  form.state.create = async () => { throw new Error('simulated private provider error'); };
  await submitButton(tree).props.onClick();
  tree = draw();
  assert.equal(submitButton(tree).props.disabled, false);
  assert.equal(nodes(tree).find(node => node.props?.placeholder === 'Tester name').props.value, 'Test admin');
  assert.match(nodes(tree).find(node => node.props?.role === 'alert').props.children, /Your answers are still here/);
  assert.ok(!nodes(tree).includes('Thanks for the feedback!'));
  form.state.create = async () => ({id: 'saved-id'});
  await submitButton(tree).props.onClick();
  assert.ok(nodes(draw()).includes('Thanks for the feedback!'));
  assert.equal(form.state.createCalls, 2);
});
test('repeated clicks during a pending save make only one create request', async () => {
  const tree = newForm();
  let complete;
  form.state.create = () => new Promise(resolveCreate => { complete = resolveCreate; });
  const button = submitButton(tree);
  const pending = button.props.onClick();
  await button.props.onClick();
  assert.equal(form.state.createCalls, 1);
  assert.equal(submitButton(draw()).props.disabled, true);
  complete({id: 'saved-id'});
  await pending;
  assert.ok(nodes(draw()).includes('Thanks for the feedback!'));
});
test('history refresh failure after an acknowledged save does not claim the save failed', async () => {
  const tree = newForm();
  form.state.create = async () => ({id: 'saved-id'});
  form.state.list = async () => { throw new Error('simulated history failure'); };
  await submitButton(tree).props.onClick();
  assert.ok(nodes(draw()).includes('Thanks for the feedback!'));
  assert.equal(form.state.createCalls, 1);
});
