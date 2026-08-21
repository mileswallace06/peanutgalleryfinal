/**
 * npm-compat-register.mjs — Registers an ESM resolve hook that maps Deno-style
 * `npm:<package>@<version>` specifiers to the installed package, so Node.js
 * can import shared modules that use Deno import syntax.
 *
 * Usage: node --import ./tests/loaders/npm-compat-register.mjs <test-file>
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hookPath = join(__dirname, 'npm-compat-hook.mjs');
register(pathToFileURL(hookPath), import.meta.url);