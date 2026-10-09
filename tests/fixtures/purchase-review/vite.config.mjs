import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { fixtureSourceIsolation } from '../../helpers/fixtureIsolation.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
export default {
  root, cacheDir: `${root}node_modules/.vite-purchase-review`, plugins: [
    { name: 'isolated-purchase-baseline', enforce: 'pre', load(id) {
      if (process.env.PG_PURCHASE_BASELINE === '1' && id === `${root}src/pages/PurchaseSuccess.jsx`) {
        return execFileSync('git', ['show', 'c31a2e1aa9f9c7d7916908ab948201cfad3243a8:src/pages/PurchaseSuccess.jsx'], { cwd: root, encoding: 'utf8' });
      }
    } }, fixtureSourceIsolation(), react(),
  ],
  optimizeDeps: { entries: [`${fixture}index.html`] },
  resolve: { alias: [{ find: '@/api/base44Client', replacement: `${fixture}base44.js` }, { find: '@', replacement: `${root}src` }] },
  server: { host: '127.0.0.1', port: 4188, strictPort: true, hmr: false, watch: null },
};
