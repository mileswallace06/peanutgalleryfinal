/**
 * npm-compat-hook.mjs — ESM resolve hook for Deno-style `npm:` specifiers.
 *
 * Maps `npm:<package>@<version>` to the installed `<package>` so Node.js
 * can resolve the import. Also maps `base44:runtime` to a mock module.
 */
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base44RuntimeMock = pathToFileURL(join(__dirname, 'base44-runtime-mock.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  // Map npm:<package>@<version> → <package>
  if (specifier.startsWith('npm:')) {
    let stripped = specifier.slice(4);
    // Remove trailing @<version> (e.g. @neondatabase/serverless@0.10.4 → @neondatabase/serverless)
    stripped = stripped.replace(/@(\d+\.\d+\.\d+)$/, '');
    return nextResolve(stripped, context);
  }
  // Map base44:runtime → mock
  if (specifier === 'base44:runtime') {
    return { url: base44RuntimeMock, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}