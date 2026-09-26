import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: [
    { find: '@/api/base44Client', replacement: `${fixture}base44.js` },
    { find: '@/lib/AuthContext', replacement: `${fixture}AuthContext.jsx` },
    { find: '@', replacement: `${root}src` },
  ] },
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: {
    outDir: `${fixture}.review-dist`,
    emptyOutDir: true,
    rollupOptions: { input: { gallery: `${fixture}index.html`, app: `${fixture}app.html` } },
  },
});
