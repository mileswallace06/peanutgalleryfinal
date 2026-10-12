import { fixtureSourceIsolation } from '../../helpers/fixtureIsolation.mjs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
export default defineConfig({
  root, cacheDir: `${root}node_modules/.vite-fan-behavior`,
  optimizeDeps: { entries: [`${fixture}index.html`] },
  plugins: [fixtureSourceIsolation(), react()],
  resolve: { alias: [
    { find: '@/api/base44Client', replacement: `${fixture}base44.js` },
    { find: '@', replacement: `${root}src` },
  ] },
  server: { host: '127.0.0.1', strictPort: true, watch: null, hmr: false },
});
