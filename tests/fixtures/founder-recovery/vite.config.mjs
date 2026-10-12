import { fixtureSourceIsolation } from '../../helpers/fixtureIsolation.mjs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
export default defineConfig({ root, cacheDir: `${root}node_modules/.vite-founder-recovery`, plugins: [fixtureSourceIsolation(), react()],
  optimizeDeps: { entries: [`${fixture}index.html`] },
  resolve: { alias: [
    { find: '@/api/base44Client', replacement: `${fixture}base44.js` },
    { find: '@/lib/AuthContext', replacement: `${fixture}AuthContext.jsx` },
    { find: '@', replacement: `${root}src` },
  ] }, server: { watch: null, hmr: false, host: '127.0.0.1', port: 4183, strictPort: true },
});
