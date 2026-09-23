import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

test('real boot parameter reader never stores a password-reset URL or token', () => {
  const written = new Map();
  const token = 'fake-reset-token-for-test';
  const location = {
    origin: 'https://peanutgallery.store', pathname: '/reset-password',
    search: `?token=${token}`, hash: '',
    href: `https://peanutgallery.store/reset-password?token=${token}`,
  };
  const script = transformSync(readFileSync(new URL('../src/lib/app-params.js', import.meta.url), 'utf8'), {
    format: 'cjs', define: { 'import.meta.env': '{}' },
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(script, {
    module, exports: module.exports, URLSearchParams, Map,
    document: { title: 'Peanut Gallery' },
    window: {
      location, history: { replaceState() {} },
      localStorage: {
        getItem: (key) => written.get(key) || null,
        setItem: (key, value) => written.set(key, value),
        removeItem: (key) => written.delete(key),
      },
    },
  });
  assert.equal(module.exports.appParams.fromUrl, 'https://peanutgallery.store/login');
  assert.equal(JSON.stringify([...written]).includes(token), false);
});
