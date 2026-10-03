/** Offline review only. Bundles fixture aliases, never a production SDK client. */
import { build } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './vite.config.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '.review-standalone');
await build({ ...config, configFile: false, base: './', build: {
  outDir, emptyOutDir: true, assetsInlineLimit: 2000000, cssCodeSplit: false,
  rollupOptions: { input: path.join(here, 'app.html'), output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'assets/[name][extname]' } },
} });
const js = await readFile(path.join(outDir, 'app.js'), 'utf8');
const css = await readFile(path.join(outDir, 'assets/style.css'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'"><title>PG isolated screen review — fictional data</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const destination = process.argv[2] || path.join(outDir, 'review.html');
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, html);
console.log(`Self-contained offline fixture: ${destination}`);
