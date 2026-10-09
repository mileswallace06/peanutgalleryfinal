import { fixtureSourceIsolation } from '../../helpers/fixtureIsolation.mjs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
export default defineConfig({ root, cacheDir: `${root}node_modules/.vite-oct09-lifecycle`, optimizeDeps: { entries: [`${fixture}index.html`] }, plugins: [fixtureSourceIsolation(), react(), { name: 'isolate-lifecycle-documents', configureServer(server) { server.middlewares.use((request, response, next) => {
  const destination = request.headers['sec-fetch-dest'];
  if (['document','iframe'].includes(destination) && new URL(request.url, 'http://127.0.0.1').pathname !== '/tests/fixtures/oct09-lifecycle/index.html') { response.statusCode = 403; response.end('Outside isolated fixture'); return; }
  next();
}); } }], resolve: { alias: [
 { find: '@/api/base44Client', replacement: `${fixture}base44.js` },
 { find: '@/lib/AuthContext', replacement: `${root}tests/fixtures/ticket-design/AuthContext.jsx` },
 { find: '@', replacement: `${root}src` },
]}, server: { host: '127.0.0.1', port: 4187, strictPort: true, hmr: false, watch: null } });
