import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
export default defineConfig({
  root,
  // Fixture SDK/auth aliases differ from the Events fixture. Sharing Vite's
  // default cache lets one running server invalidate the other's prebundles.
  cacheDir: `${root}node_modules/.vite-ticket-design`,
  optimizeDeps: { entries: [`${fixture}app.html`, `${fixture}index.html`] },
  plugins: [react(), {
    name: 'isolate-review-documents',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        const isDocument = request.headers['sec-fetch-dest'] === 'document' || request.headers['sec-fetch-dest'] === 'iframe';
        if (isDocument && !['/tests/fixtures/ticket-design/', '/tests/fixtures/ticket-design/index.html', '/tests/fixtures/ticket-design/app.html'].includes(path)) {
          response.statusCode = 403;
          response.setHeader('Content-Type', 'text/plain');
          response.end('Visual review blocked navigation outside the isolated fixture.');
          return;
        }
        next();
      });
    },
  }],
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
