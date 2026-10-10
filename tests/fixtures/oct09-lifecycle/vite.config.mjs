import { fixtureSourceIsolation } from '../../helpers/fixtureIsolation.mjs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const uploadBaseline = '3a56073ba06f9f25b42844d2ca67068dafd4c554';
export default defineConfig({ root, cacheDir: `${root}node_modules/.vite-oct09-lifecycle`, optimizeDeps: { entries: [`${fixture}index.html`] }, plugins: [fixtureSourceIsolation(), {
  name: 'pinned-fan-gift-upload-baseline', enforce: 'pre',
  load(id) {
    if (process.env.PG_FAN_GIFT_UPLOAD_BASELINE === uploadBaseline && id.split('?')[0] === `${root}src/components/flashdrops/CreateFlashDropSheet.jsx`) {
      return execFileSync('git', ['show', `${uploadBaseline}:src/components/flashdrops/CreateFlashDropSheet.jsx`], { cwd: root, encoding: 'utf8' });
    }
  },
}, react(), { name: 'isolate-lifecycle-documents', configureServer(server) { server.middlewares.use((request, response, next) => {
  const destination = request.headers['sec-fetch-dest'];
  if (['document','iframe'].includes(destination) && new URL(request.url, 'http://127.0.0.1').pathname !== '/tests/fixtures/oct09-lifecycle/index.html') { response.statusCode = 403; response.end('Outside isolated fixture'); return; }
  next();
}); } }], resolve: { alias: [
 { find: '@/api/base44Client', replacement: `${fixture}base44.js` },
 { find: '@/lib/AuthContext', replacement: `${root}tests/fixtures/ticket-design/AuthContext.jsx` },
 { find: '@', replacement: `${root}src` },
]}, server: { host: '127.0.0.1', port: 4187, strictPort: true, hmr: false, watch: null } });
