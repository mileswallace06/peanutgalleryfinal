import { fixtureSourceIsolation } from '../../helpers/fixtureIsolation.mjs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const baseline = process.env.PG_IDENTITY_CAPTURE_BEFORE === '1';
const sources = new Map();
export default defineConfig({ root, cacheDir: `${root}node_modules/.vite-event-identity${baseline ? '-baseline' : ''}`, plugins: [fixtureSourceIsolation(), 
  // Read-only historical rendering: never rewrite the shared worktree to take
  // before screenshots while other agents are editing it.
  ...(baseline ? [{ name: 'identity-reviewed-baseline', enforce: 'pre', load(id) {
    const path = id.split('?')[0];
    if (!path.startsWith(`${root}src/`) && !path.startsWith(`${root}base44/shared/`)) return null;
    if (!/\.(jsx?|css)$/.test(path)) return null;
    if (!sources.has(path)) sources.set(path, execFileSync('git', ['show', `c31a2e1:${path.slice(root.length)}`], { cwd: root, encoding: 'utf8' }));
    return sources.get(path);
  } }] : []), react()],
  optimizeDeps: { entries: [`${fixture}index.html`] },
  resolve: { alias: [
    { find: '@/api/base44Client', replacement: `${fixture}base44.js` },
    { find: '@/lib/navLogger', replacement: `${fixture}navLogger.js` },
    { find: '@', replacement: `${root}src` },
  ] }, server: { watch: null, hmr: false, host: '127.0.0.1', port: 4179, strictPort: true },
});
