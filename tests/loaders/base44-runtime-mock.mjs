/**
 * base44-runtime-mock.mjs — Mock for Deno's `base44:runtime` module.
 * Provides a no-op `secrets.get()` for Node.js test environments.
 */
export const secrets = {
  get: () => null,
};