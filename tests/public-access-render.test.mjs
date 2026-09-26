import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(resolve(root, '.public-access-render-'));
const mocks = {
  fixture: 'export const state = { path: "/", auth: {}, layoutMounts: 0 };',
  auth: 'import { state } from "fixture"; export const AuthProvider = ({children}) => children; export const useAuth = () => state.auth;',
  router: `export * from 'react-router-dom';
    import { createElement } from 'react';
    import { StaticRouter } from 'react-router-dom/server.js';
    import { state } from 'fixture';
    export const BrowserRouter = ({children}) => createElement(StaticRouter, { location: state.path }, children);`,
  query: 'export const QueryClientProvider = ({children}) => children;',
  client: 'export const queryClientInstance = {};',
  toaster: 'export const Toaster = () => null;',
  layout: `import { createElement } from 'react'; import { Outlet } from 'react-router-dom'; import { state } from 'fixture';
    export default function Layout() { state.layoutMounts++; return createElement('section', { 'data-member-layout': true }, createElement(Outlet)); }`,
  fallback: 'export default () => "route-loading";',
  other: 'export default () => "other-page";',
};

const result = await build({
  stdin: {
    contents: 'export {default as App} from "./src/App.jsx"; export {state} from "fixture";',
    resolveDir: root,
    sourcefile: 'public-access-entry.jsx',
    loader: 'jsx',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  jsx: 'automatic',
  plugins: [{
    name: 'public-access-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /^fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onResolve({ filter: /^react-router-dom$/ }, args => args.importer.endsWith('/App.jsx')
        ? { path: 'router', namespace: 'fixture' } : undefined);
      builder.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: 'query', namespace: 'fixture' }));
      builder.onResolve({ filter: /^@\// }, args => {
        const byPath = {
          '@/lib/AuthContext': 'auth', '@/lib/query-client': 'client',
          '@/components/ui/toaster': 'toaster', '@/components/Layout': 'layout',
          '@/components/RouteFallback': 'fallback', '@/components/UserNotRegisteredError': 'other',
        };
        const mock = byPath[args.path];
        if (mock) return { path: mock, namespace: 'fixture' };
        if (args.path === '@/lib/memberAccess') return { path: resolve(root, 'src/lib/memberAccess.js') };
        if (args.path === '@/pages/PrivacyPolicy') return { path: resolve(root, 'src/pages/PrivacyPolicy.jsx') };
        if (args.path.startsWith('@/pages/')) return { path: 'other', namespace: 'fixture' };
        return undefined;
      });
      builder.onResolve({ filter: /^\.\/lib\/PageNotFound$/ }, () => ({ path: 'other', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: root }));
    },
  }],
});

const bundlePath = resolve(temporary, 'routes.mjs');
await writeFile(bundlePath, result.outputFiles[0].text);
const { App, state } = await import(pathToFileURL(bundlePath));
test.after(() => rm(temporary, { recursive: true, force: true }));

async function renderRoute(path, auth) {
  state.path = path;
  state.auth = auth;
  state.layoutMounts = 0;
  return new Promise((resolveRender, reject) => {
    const output = new PassThrough();
    let html = '';
    output.on('data', chunk => { html += chunk; });
    output.on('end', () => resolveRender(html));
    output.on('error', reject);
    const stream = renderToPipeableStream(createElement(App), {
      onAllReady() { stream.pipe(output); },
      onShellError: reject,
      onError: reject,
    });
  });
}

test('actual /privacy route renders policy UI while authentication is loading', async () => {
  const html = await renderRoute('/privacy', { isLoadingAuth: true });
  assert.match(html, /Privacy Policy/);
  assert.match(html, /Loading the privacy policy/);
  assert.equal(state.layoutMounts, 0);
});

test('actual /privacy route stays public after authentication fails', async () => {
  const html = await renderRoute('/privacy', { isLoadingAuth: false, authError: { type: 'unknown' } });
  assert.match(html, /Privacy Policy/);
  assert.doesNotMatch(html, /We couldn’t check your sign-in/);
  assert.equal(state.layoutMounts, 0);
});

test('actual member route never mounts Layout for anonymous, pending, or failed auth', async () => {
  for (const auth of [
    { isAuthenticated: false, authError: { type: 'auth_required' } },
    { isLoadingAuth: true },
    { isAuthenticated: false, authError: { type: 'unknown' } },
  ]) {
    const html = await renderRoute('/events', auth);
    assert.equal(state.layoutMounts, 0);
    assert.doesNotMatch(html, /data-member-layout/);
  }
});

test('actual member route mounts Layout after the current account is verified', async () => {
  const html = await renderRoute('/events', { isAuthenticated: true, user: { id: 'existing-member' } });
  assert.ok(state.layoutMounts > 0);
  assert.match(html, /data-member-layout/);
});
